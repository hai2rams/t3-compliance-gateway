import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { getT3Session } from './t3/client.js';
import {
  initializeComplianceSecrets,
  listComplianceConfigKeys,
} from './t3/complianceSecrets.js';
import { resolveSecretFromMaps } from './t3/resolveSecret.js';
import {
  evaluateDeterministicRules,
  evaluateSemanticCompliance,
} from './services/compliance.js';
import { getAuditTelemetry, recordAuditTrace } from './services/telemetry.js';
import { ComplianceCheckRequestSchema } from './schemas/complianceCheckSchema.js';
import { runComplianceCheck } from './services/agentCompliance.js';
import {
  getComplianceAuditLog,
  recordComplianceCheck,
} from './services/auditLog.js';

const InitializeBodySchema = z.object({
  entries: z.record(z.string(), z.string()).optional(),
});

const AuditBodySchema = z.object({
  rawText: z.string(),
  amount: z.number(),
  currency: z.string().optional(),
});

const app = express();
app.use(express.json());
app.use(express.static('public'));

const config = loadConfig();

function t3Config() {
  return loadConfig(true);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 't3-compliance-gateway' });
});

/**
 * Dual-layer compliance audit: deterministic pre-filter → T3-sealed Gemini semantic scan.
 */
app.post('/api/v1/audit', async (req, res) => {
  const parsed = AuditBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid audit request payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { rawText, amount } = parsed.data;

  const deterministic = evaluateDeterministicRules(rawText, amount);
  if (deterministic) {
    const trace = recordAuditTrace(rawText, amount, deterministic);
    res.status(200).json({
      decision: trace.passed ? 'APPROVED' : 'REJECTED',
      ...trace,
    });
    return;
  }

  try {
    const runtime = t3Config();
    const { tenant } = await getT3Session(runtime.t3nApiKey, runtime.t3nEnvironment);
    const geminiApiKey = await resolveSecretFromMaps(tenant, 'gemini_api_key');

    const semantic = await evaluateSemanticCompliance(rawText, geminiApiKey);
    const trace = recordAuditTrace(rawText, amount, semantic);

    res.status(200).json({
      decision: trace.passed ? 'APPROVED' : 'REJECTED',
      ...trace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const failSecure = recordAuditTrace(rawText, amount, {
      passed: false,
      reasoning: `Fail-Secure Lock: Unable to reach Terminal 3 secrets context (${message}).`,
      triggeredLayer: 'FAIL_SECURE',
    });
    res.status(200).json({
      decision: 'REJECTED',
      ...failSecure,
    });
  }
});

app.get('/api/v1/analytics', (_req, res) => {
  res.json(getAuditTelemetry());
});

/**
 * Hackathon scaffold: regulated agent compliance check with sponsor-tool adapters.
 */
app.post('/api/v1/compliance/check', async (req, res) => {
  const parsed = ComplianceCheckRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid compliance check payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const response = await runComplianceCheck(parsed.data);
    recordComplianceCheck(parsed.data, response);
    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'ComplianceCheckFailed', message });
  }
});

app.get('/api/v1/compliance/audit-log', (_req, res) => {
  res.json(getComplianceAuditLog());
});

/**
 * Bootstrap T3N session and seal compliance configuration into the tenant
 * hardware-isolated secrets map (z::<tenant>:secrets).
 */
app.post('/api/v1/compliance/config/initialize', async (req, res) => {
  try {
    const parsed = InitializeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid initialize payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const runtime = t3Config();
    const entries = {
      ...runtime.complianceDefaults,
      ...parsed.data.entries,
    };

    const { tenant } = await getT3Session(runtime.t3nApiKey, runtime.t3nEnvironment);
    const result = await initializeComplianceSecrets(
      tenant,
      runtime.t3nContractId,
      entries,
    );

    res.status(200).json({
      tenantDid: tenant.config.tenantDid,
      contractTail: runtime.t3nContractTail,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'ComplianceInitFailed', message });
  }
});

/**
 * List sealed compliance key names. Values stay inside the TEE secrets map.
 */
app.get('/api/v1/compliance/config/keys', async (_req, res) => {
  try {
    const runtime = t3Config();
    const { tenant, tenantDid } = await getT3Session(runtime.t3nApiKey, runtime.t3nEnvironment);
    const keys = listComplianceConfigKeys(tenant);

    res.status(200).json({
      tenantDid,
      environment: runtime.t3nEnvironment,
      ...keys,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'ComplianceKeysReadFailed', message });
  }
});

/**
 * Outline for TEE-backed reads: contract code calls kv_store::get("secrets", key)
 * inside the enclave and returns derived compliance state — never raw secrets.
 */
app.post('/api/v1/compliance/config/read-via-contract', async (req, res) => {
  const body = z
    .object({
      functionName: z.string().default('get-compliance-snapshot'),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid contract read payload',
      details: body.error.flatten(),
    });
    return;
  }

  try {
    const runtime = t3Config();
    const { tenant } = await getT3Session(runtime.t3nApiKey, runtime.t3nEnvironment);

    const result = await tenant.contracts.execute(runtime.t3nContractTail, {
      version: runtime.t3nContractVersion,
      functionName: body.data.functionName,
      input: body.data.input ?? {},
    });

    res.status(200).json({
      contractTail: runtime.t3nContractTail,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(501).json({
      error: 'ContractReadNotReady',
      message,
      hint: 'Deploy and register your TEE contract, then read secrets only from inside contract code.',
    });
  }
});

app.listen(config.port, () => {
  console.log(`[t3-compliance-gateway] listening on http://localhost:${config.port}`);
  console.log(`[t3-compliance-gateway] T3N environment: ${config.t3nEnvironment}`);
});
