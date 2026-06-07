import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { getT3Session } from './t3/client.js';
import {
  initializeComplianceSecrets,
  listComplianceConfigKeys,
} from './t3/complianceSecrets.js';

const InitializeBodySchema = z.object({
  entries: z.record(z.string(), z.string()).optional(),
});

const app = express();
app.use(express.json());

const config = loadConfig();

function t3Config() {
  return loadConfig(true);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 't3-compliance-gateway' });
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
