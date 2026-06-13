import type { FinalAgentState, InferredIntent, T3Governance } from '../schemas/agentIntakeSchema.js';
import type { PublicEnrichment, PublicEnrichmentFinding } from '../schemas/agentIntakeSchema.js';
import { enrichPublicWeb } from '../adapters/brightDataAdapter.js';
import { isGlobalMockMode } from '../config/toolCapabilityMap.js';

export type PublicEnrichmentInput = {
  missionId: string;
  agentId: string;
  inferredIntent: InferredIntent;
  selectedWorkflow: string;
  content: string;
  dataBoundary: {
    detected: boolean;
    types: string[];
    privateBlockedFromExternal: boolean;
  };
  publicSearchQuery: string;
  enrichmentAllowed: boolean;
  enrichmentBlockedReason?: string;
  privateDataBlockedFromExternalTools: boolean;
  t3Governance: T3Governance;
  finalAgentState: FinalAgentState;
  promptInjectionBlocked?: boolean;
};

const UNSAFE_QUERY_PATTERNS = [
  /\bpassport\b/i,
  /\bnric\b/i,
  /\bssn\b/i,
  /\bsalary\b/i,
  /\bbank\b/i,
  /\baccount\s+number\b/i,
  /@/,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\bSGD\s*[\d,]+/i,
  /\bUSD\s*[\d,]+/i,
];

function canUseLiveBrightData(): boolean {
  if (isGlobalMockMode()) return false;
  const hasKey = Boolean(process.env.BRIGHTDATA_API_KEY?.trim());
  const hasMcpUrl = Boolean(process.env.BRIGHTDATA_MCP_URL?.trim());
  return hasKey || hasMcpUrl;
}

function isQuerySafe(publicQuery: string): boolean {
  const trimmed = publicQuery.trim();
  if (!trimmed) return false;
  return !UNSAFE_QUERY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function kycEnrichmentSummary(entity: string): string {
  return `Mock public enrichment completed for ${entity} using public-only context. No private KYC data was transmitted.`;
}

function buildMockFindings(publicQuery: string, intent: InferredIntent): PublicEnrichmentFinding[] {
  const entity = publicQuery.trim();

  if (intent === 'CREDIT_KYC_PRECHECK') {
    return [
      {
        title: 'Public company profile signal',
        sourceType: 'company_registry',
        summary: `Mock registry footprint for ${entity} using public-only employer context.`,
        riskSignal: 'UNKNOWN',
      },
      {
        title: 'Public risk/news signal',
        sourceType: 'news',
        summary: `Mock open-web scan for ${entity} returned no immediate adverse public media.`,
        riskSignal: 'LOW',
      },
    ];
  }

  const findings: PublicEnrichmentFinding[] = [
    {
      title: `${entity} — public company footprint`,
      sourceType: intent === 'VENDOR_ONBOARDING' ? 'company_registry' : 'mock',
      summary: `Mock public registry signal for ${entity}; no private customer data transmitted.`,
      riskSignal: 'LOW',
    },
    {
      title: `${entity} — public web mentions`,
      sourceType: 'public_web',
      summary: `Mock open-web enrichment returned neutral business context for ${entity}.`,
      riskSignal: 'LOW',
    },
  ];

  if (intent === 'VENDOR_ONBOARDING') {
    findings.push({
      title: `${entity} — vendor risk signal`,
      sourceType: 'risk_signal',
      summary: 'Mock vendor intelligence scan found no immediate public adverse media.',
      riskSignal: 'UNKNOWN',
    });
  }

  return findings;
}

function buildLiveFindings(publicQuery: string, rawFindings: string[]): PublicEnrichmentFinding[] {
  if (!rawFindings.length) {
    return buildMockFindings(publicQuery, 'PUBLIC_WEB_RESEARCH');
  }

  return rawFindings.map((line, index) => ({
    title: `Public enrichment result ${index + 1}`,
    sourceType: 'public_web' as const,
    summary: line,
    riskSignal: 'UNKNOWN' as const,
  }));
}

function blockedResult(
  reason: string,
  dataBoundary: PublicEnrichmentInput['dataBoundary'],
  publicSearchQuery: string,
): PublicEnrichment {
  return {
    provider: 'BrightData/MCP',
    mode: 'MOCK',
    allowed: false,
    status: 'BLOCKED',
    publicSearchQuery,
    privateDataRemoved: dataBoundary.privateBlockedFromExternal,
    blockedPrivateDataTypes: [...dataBoundary.types],
    findings: [],
    summary: 'Public enrichment blocked by governance and data-boundary policy.',
    reason,
  };
}

function skippedResult(
  reason: string,
  dataBoundary: PublicEnrichmentInput['dataBoundary'],
): PublicEnrichment {
  return {
    provider: 'BrightData/MCP',
    mode: 'MOCK',
    allowed: false,
    status: 'SKIPPED',
    publicSearchQuery: '',
    privateDataRemoved: dataBoundary.privateBlockedFromExternal,
    blockedPrivateDataTypes: [...dataBoundary.types],
    findings: [],
    summary: 'Public enrichment skipped for this governed workflow.',
    reason,
  };
}

export function runPublicEnrichment(input: PublicEnrichmentInput): PublicEnrichment {
  const publicQuery = input.publicSearchQuery.trim();
  const blockedTypes = [...input.dataBoundary.types];

  if (input.promptInjectionBlocked || input.finalAgentState === 'AUTO_BLOCKED_BY_POLICY') {
    return blockedResult(
      'Public enrichment blocked — untrusted content or policy block active.',
      input.dataBoundary,
      publicQuery,
    );
  }

  if (input.t3Governance.governanceDecision === 'BLOCK_EXECUTION') {
    return blockedResult(
      'Public enrichment blocked — Terminal 3 governance denied external tool usage.',
      input.dataBoundary,
      publicQuery,
    );
  }

  if (input.inferredIntent === 'BATCH_RISK_SCAN') {
    return skippedResult(
      'BrightData/MCP skipped — anonymized batch scan does not require public web enrichment.',
      input.dataBoundary,
    );
  }

  if (input.inferredIntent === 'VIDEO_REVIEW') {
    return skippedResult(
      'BrightData/MCP skipped — secure video review does not require public web enrichment.',
      input.dataBoundary,
    );
  }

  if (!input.enrichmentAllowed || !publicQuery) {
    return blockedResult(
      input.enrichmentBlockedReason ?? 'No safe public enrichment query available.',
      input.dataBoundary,
      publicQuery,
    );
  }

  if (!isQuerySafe(publicQuery)) {
    return blockedResult(
      'Extracted query failed public-only safety checks — private terms removed from external request.',
      input.dataBoundary,
      '',
    );
  }

  const liveEligible = canUseLiveBrightData();

  try {
    const adapterResult = enrichPublicWeb(publicQuery);

    if (liveEligible && adapterResult.status === 'COMPLETED') {
      const findings = buildLiveFindings(publicQuery, adapterResult.findings);
      return {
        provider: 'BrightData/MCP',
        mode: 'LIVE',
        allowed: true,
        status: 'COMPLETED',
        publicSearchQuery: publicQuery,
        privateDataRemoved: input.privateDataBlockedFromExternalTools,
        blockedPrivateDataTypes: blockedTypes,
        findings,
        summary: `Public-only enrichment completed for "${publicQuery}" with private data stripped before external lookup.`,
        reason: adapterResult.note,
      };
    }

    const findings = buildMockFindings(publicQuery, input.inferredIntent);
    const kycSummary =
      input.inferredIntent === 'CREDIT_KYC_PRECHECK'
        ? kycEnrichmentSummary(publicQuery)
        : `Mock-safe public-only enrichment performed for ${publicQuery}; no private data transmitted.`;
    return {
      provider: 'BrightData/MCP',
      mode: 'MOCK',
      allowed: true,
      status: 'MOCK_COMPLETED',
      publicSearchQuery: publicQuery,
      privateDataRemoved: input.privateDataBlockedFromExternalTools,
      blockedPrivateDataTypes: blockedTypes,
      findings,
      summary: kycSummary,
      reason: liveEligible
        ? 'Live BrightData adapter not available; mock-safe public enrichment applied.'
        : 'BrightData credentials or MCP endpoint not configured; mock-safe enrichment applied.',
    };
  } catch {
    const findings = buildMockFindings(publicQuery, input.inferredIntent);
    const kycSummary =
      input.inferredIntent === 'CREDIT_KYC_PRECHECK'
        ? kycEnrichmentSummary(publicQuery)
        : `Mock-safe public-only enrichment performed for ${publicQuery} after live call fallback.`;
    return {
      provider: 'BrightData/MCP',
      mode: 'MOCK',
      allowed: true,
      status: 'MOCK_COMPLETED',
      publicSearchQuery: publicQuery,
      privateDataRemoved: input.privateDataBlockedFromExternalTools,
      blockedPrivateDataTypes: blockedTypes,
      findings,
      summary: kycSummary,
      reason: 'BrightData live call failed safely; mock-safe public enrichment applied.',
    };
  }
}

export function buildEnrichmentPlanFromPublicEnrichment(
  publicEnrichment: PublicEnrichment,
): Record<string, unknown> {
  return {
    provider: publicEnrichment.provider,
    allowed: publicEnrichment.allowed,
    status: publicEnrichment.status,
    mode: publicEnrichment.mode,
    publicSearchQuery: publicEnrichment.publicSearchQuery,
    privateDataRemoved: publicEnrichment.privateDataRemoved,
    blockedPrivateDataTypes: publicEnrichment.blockedPrivateDataTypes,
    summary: publicEnrichment.summary,
    reason: publicEnrichment.reason,
    findings: publicEnrichment.findings,
    mcpReady: true,
  };
}

export function brightDataToolReason(publicEnrichment: PublicEnrichment): string {
  if (publicEnrichment.status === 'BLOCKED') {
    return `BLOCKED: ${publicEnrichment.reason}`;
  }
  if (publicEnrichment.status === 'SKIPPED') {
    return `SKIPPED: ${publicEnrichment.reason}`;
  }
  const statusWord =
    publicEnrichment.mode === 'LIVE' && publicEnrichment.status === 'COMPLETED'
      ? 'USED'
      : 'MOCKED';
  return `${statusWord}: sanitized public-only query "${publicEnrichment.publicSearchQuery}" — ${publicEnrichment.summary}`;
}

export function brightDataToolStatus(
  publicEnrichment: PublicEnrichment,
): 'USED' | 'MOCKED' | 'BLOCKED' | 'SKIPPED' {
  if (publicEnrichment.status === 'BLOCKED') return 'BLOCKED';
  if (publicEnrichment.status === 'SKIPPED') return 'SKIPPED';
  if (publicEnrichment.mode === 'LIVE' && publicEnrichment.status === 'COMPLETED') {
    return 'USED';
  }
  if (publicEnrichment.status === 'MOCK_COMPLETED') return 'MOCKED';
  return 'SKIPPED';
}
