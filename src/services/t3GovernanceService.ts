import { createHash } from 'node:crypto';
import type { FinalAgentState, InferredIntent, T3Governance } from '../schemas/agentIntakeSchema.js';
import type { TrustResult } from '../schemas/complianceCheckSchema.js';
import { loadConfig, type AppConfig } from '../config.js';
import { verifyAgentTrust } from '../adapters/terminal3Adapter.js';
import { isGlobalMockMode } from '../config/toolCapabilityMap.js';

export type AgentGovernanceInput = {
  missionId: string;
  agentId: string;
  inferredIntent: InferredIntent;
  selectedWorkflow: string;
  dataSensitivity: string;
  sensitiveDataDetected: boolean;
  detectedSensitiveTypes: string[];
  requestedExternalTools: string[];
  requestedRuntime: string;
  finalAgentState: FinalAgentState;
  executionPlan: Record<string, unknown>;
  policyId: string;
  publicEnrichmentAllowed: boolean;
  purpose: string;
  trust?: TrustResult;
};

const MOCK_AUDIT_PREFIX =
  'Mock-safe Terminal 3 governance proof generated. Live T3 can be enabled with credentials.';

function hashPayload(label: string, payload: Record<string, unknown>): string {
  const digest = createHash('sha256')
    .update(label)
    .update(JSON.stringify(payload))
    .digest('hex');
  return `sha256:${digest.slice(0, 32)}`;
}

export function canUseLiveT3(config: AppConfig): boolean {
  return (
    Boolean(config.t3nApiKey) &&
    !isGlobalMockMode() &&
    Number.isInteger(config.t3nContractId) &&
    config.t3nContractId > 0
  );
}

function resolveDataBoundary(
  sensitiveDataDetected: boolean,
  publicEnrichmentAllowed: boolean,
): T3Governance['scope']['dataBoundary'] {
  if (sensitiveDataDetected) return 'RESTRICTED_SENSITIVE';
  if (publicEnrichmentAllowed) return 'PUBLIC_ONLY';
  return 'INTERNAL_ONLY';
}

function resolveGovernanceDecision(
  finalAgentState: FinalAgentState,
  identityDenied: boolean,
): {
  governanceDecision: T3Governance['governanceDecision'];
  permissionStatus: T3Governance['permissionStatus'];
} {
  if (identityDenied || finalAgentState === 'AUTO_BLOCKED_BY_POLICY') {
    return { governanceDecision: 'BLOCK_EXECUTION', permissionStatus: 'DENIED' };
  }
  if (finalAgentState === 'AUTO_HOLD_REVIEW_REQUIRED') {
    return { governanceDecision: 'HOLD_FOR_REVIEW', permissionStatus: 'SCOPED' };
  }
  if (finalAgentState === 'EXECUTION_QUEUED' || finalAgentState === 'AUTO_EXECUTION_APPROVED') {
    return { governanceDecision: 'ALLOW_EXECUTION', permissionStatus: 'ALLOWED' };
  }
  return { governanceDecision: 'HOLD_FOR_REVIEW', permissionStatus: 'SCOPED' };
}

function buildAllowedExternalToolsList(
  input: AgentGovernanceInput,
  governanceDecision: T3Governance['governanceDecision'],
): string[] {
  if (governanceDecision === 'BLOCK_EXECUTION') return [];

  const allowed = new Set<string>();

  for (const tool of input.requestedExternalTools) {
    if (/brightdata|mcp/i.test(tool)) {
      if (input.publicEnrichmentAllowed) allowed.add(tool);
    } else if (governanceDecision === 'ALLOW_EXECUTION') {
      allowed.add(tool);
    }
  }

  if (input.publicEnrichmentAllowed) {
    allowed.add('BrightData/MCP');
  }

  return [...allowed];
}

function mockTrustEnvelope(): TrustResult {
  return {
    provider: 'Terminal 3',
    status: 'MOCK_VERIFIED',
    contractMode: 'TEE_COMPLIANCE_GATEWAY',
  };
}

export async function evaluateAgentGovernance(
  input: AgentGovernanceInput,
): Promise<T3Governance> {
  const config = loadConfig();
  const liveEligible = canUseLiveT3(config);

  let trust: TrustResult;
  let mode: T3Governance['mode'] = 'MOCK';
  let auditSummary: string;

  if (liveEligible) {
    try {
      const liveTrust = await verifyAgentTrust({
        agentId: input.agentId,
        actionType: input.inferredIntent,
        purpose: input.purpose,
      });

      if (liveTrust.status === 'VERIFIED') {
        mode = 'LIVE';
        trust = liveTrust;
        auditSummary = `Terminal 3 LIVE governance applied: verified agent identity under contract ${config.t3nContractId}.`;
      } else {
        mode = 'MOCK';
        trust = mockTrustEnvelope();
        auditSummary = `${MOCK_AUDIT_PREFIX} Live verification returned ${liveTrust.status}; mock envelope applied.`;
      }
    } catch {
      mode = 'MOCK';
      trust = mockTrustEnvelope();
      auditSummary = `${MOCK_AUDIT_PREFIX} Live T3 session failed safely; mock envelope applied.`;
    }
  } else {
    trust = mockTrustEnvelope();
    mode = 'MOCK';
    auditSummary = `${MOCK_AUDIT_PREFIX}`;
  }

  let identityStatus: T3Governance['identityStatus'] =
    mode === 'LIVE' && trust.status === 'VERIFIED'
      ? 'VERIFIED'
      : trust.status === 'FAILED'
        ? 'DENIED'
        : 'MOCK_VERIFIED';

  if (mode !== 'LIVE' && identityStatus !== 'DENIED') {
    identityStatus = 'MOCK_VERIFIED';
  }

  const identityDenied = identityStatus === 'DENIED';
  const contractMode: T3Governance['contractMode'] =
    mode === 'LIVE' ? 'TEE_COMPLIANCE_GATEWAY_READY' : 'TEE_COMPLIANCE_GATEWAY_MOCK';

  const dataBoundary = resolveDataBoundary(
    input.sensitiveDataDetected,
    input.publicEnrichmentAllowed,
  );
  const { governanceDecision, permissionStatus } = resolveGovernanceDecision(
    input.finalAgentState,
    identityDenied,
  );

  const allowedExternalTools = buildAllowedExternalToolsList(input, governanceDecision);

  const timestamp = new Date().toISOString();
  const governanceId = `gov_${input.missionId.replace(/^mission_/, '')}`;

  const decisionPayload = {
    missionId: input.missionId,
    agentId: input.agentId,
    inferredIntent: input.inferredIntent,
    finalAgentState: input.finalAgentState,
    policyId: input.policyId,
    governanceDecision,
    permissionStatus,
    mode,
  };

  const executionPayload = {
    missionId: input.missionId,
    requestedRuntime: input.requestedRuntime,
    executionPlan: input.executionPlan,
    governanceDecision,
    mode,
  };

  const decisionHash = hashPayload('t3-governance-decision', decisionPayload);
  const executionPlanHash = hashPayload('t3-execution-plan', executionPayload);

  const fullAuditSummary =
    mode === 'MOCK'
      ? MOCK_AUDIT_PREFIX
      : `${auditSummary} Governance decision ${governanceDecision} for ${input.inferredIntent} under ${input.policyId}.`;

  return {
    provider: 'Terminal 3',
    mode,
    identityStatus,
    permissionStatus,
    contractMode,
    governanceDecision,
    scope: {
      agentId: input.agentId,
      allowedIntent: input.inferredIntent,
      allowedExternalTools,
      allowedRuntime:
        governanceDecision === 'ALLOW_EXECUTION' ? input.requestedRuntime : 'NONE',
      dataBoundary,
    },
    proof: {
      governanceId,
      policyId: input.policyId,
      decisionHash,
      executionPlanHash,
      timestamp,
    },
    auditSummary: fullAuditSummary,
  };
}

export function buildAgentPassportFromGovernance(
  t3Governance: T3Governance,
  requiresT3Passport: boolean,
): Record<string, unknown> {
  const blockedCapabilities: string[] = [];

  if (t3Governance.governanceDecision === 'BLOCK_EXECUTION') {
    blockedCapabilities.push('runtime_dispatch', 'external_enrichment', 'auto_execution');
  } else if (t3Governance.governanceDecision === 'HOLD_FOR_REVIEW') {
    blockedCapabilities.push('runtime_dispatch', 'auto_execution');
  }

  if (t3Governance.scope.dataBoundary === 'RESTRICTED_SENSITIVE') {
    blockedCapabilities.push('private_data_export');
  }

  return {
    identityProvider: 'Terminal 3',
    didStatus: t3Governance.identityStatus,
    status: t3Governance.identityStatus,
    provider: t3Governance.provider,
    mode: t3Governance.mode,
    contractMode: t3Governance.contractMode,
    auditMode: t3Governance.contractMode,
    requiresT3Passport,
    permissionScope: t3Governance.scope,
    permissionStatus: t3Governance.permissionStatus,
    governanceDecision: t3Governance.governanceDecision,
    blockedCapabilities: [...new Set(blockedCapabilities)],
    governanceId: t3Governance.proof.governanceId,
  };
}

export function terminal3ToolReason(t3Governance: T3Governance): string {
  if (
    t3Governance.governanceDecision === 'BLOCK_EXECUTION' ||
    t3Governance.identityStatus === 'DENIED'
  ) {
    return `BLOCKED: ${t3Governance.governanceDecision} under ${t3Governance.contractMode}.`;
  }
  const statusWord = t3Governance.mode === 'LIVE' ? 'USED' : 'MOCKED';
  if (t3Governance.mode !== 'LIVE') {
    return `${statusWord}: ${MOCK_AUDIT_PREFIX}`;
  }
  return `${statusWord}: ${t3Governance.governanceDecision} under ${t3Governance.contractMode} (${t3Governance.permissionStatus}).`;
}

export function terminal3ToolStatus(t3Governance: T3Governance): 'USED' | 'MOCKED' | 'BLOCKED' {
  if (
    t3Governance.governanceDecision === 'BLOCK_EXECUTION' ||
    t3Governance.identityStatus === 'DENIED'
  ) {
    return 'BLOCKED';
  }
  return t3Governance.mode === 'LIVE' ? 'USED' : 'MOCKED';
}
