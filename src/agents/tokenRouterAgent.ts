import type { Modality, InferredIntent } from '../schemas/agentIntakeSchema.js';
import type { ComplianceDecision } from '../schemas/complianceCheckSchema.js';

export type TokenRouterAgentDecision = {
  route: string;
  primaryProvider: string;
  secondaryProviders: string[];
  models: string[];
  routeReason: string;
  documentReasoningProvider?: string;
  judgeReasoningProvider?: string;
};

export function resolveRoutingPolicyDecision(
  intent: InferredIntent,
  policyDecision: ComplianceDecision,
): ComplianceDecision {
  if (policyDecision === 'DENY') return 'DENY';
  if (intent === 'CREDIT_KYC_PRECHECK' || intent === 'VENDOR_ONBOARDING') {
    return 'ALLOW';
  }
  return policyDecision;
}

export function runTokenRouterAgent(
  modalities: Modality[],
  intent: InferredIntent,
  policyDecision: ComplianceDecision,
): TokenRouterAgentDecision {
  const routingDecision = resolveRoutingPolicyDecision(intent, policyDecision);

  if (routingDecision === 'DENY') {
    return {
      route: 'BLOCKED_BY_POLICY',
      primaryProvider: 'NONE',
      secondaryProviders: [],
      models: ['SKIP_LLM'],
      routeReason: 'Policy denied request — LLM inference skipped.',
    };
  }

  const hasDocument = modalities.includes('DOCUMENT') || modalities.includes('IMAGE');
  const hasVideo = modalities.includes('VIDEO') || modalities.includes('AUDIO');
  const hasWeb = modalities.includes('WEB_RESEARCH');

  if (intent === 'CREDIT_KYC_PRECHECK') {
    return {
      route: 'DOCUMENT_KYC_REVIEW',
      primaryProvider: 'SenseNova',
      secondaryProviders: ['Kimi'],
      models: ['SenseNova', 'Kimi'],
      documentReasoningProvider: 'SenseNova',
      judgeReasoningProvider: 'Kimi',
      routeReason:
        'SenseNova for KYC document reasoning; Kimi for risk/judge reasoning.',
    };
  }

  if (hasDocument && intent !== 'PUBLIC_WEB_RESEARCH') {
    return {
      route: 'DOCUMENT_MULTIMODAL',
      primaryProvider: 'SenseNova',
      secondaryProviders: ['Kimi'],
      models: ['SenseNova', 'Kimi'],
      documentReasoningProvider: 'SenseNova',
      judgeReasoningProvider: 'Kimi',
      routeReason:
        'SenseNova for document reasoning; Kimi for risk/judge reasoning.',
    };
  }

  if (hasWeb) {
    return {
      route: 'WEB_RESEARCH',
      primaryProvider: 'Kimi',
      secondaryProviders: ['BrightData'],
      models: ['KIMI', 'BRIGHTDATA_MCP'],
      judgeReasoningProvider: 'Kimi',
      routeReason: 'Kimi reasoning plus BrightData public enrichment.',
    };
  }

  if (hasVideo) {
    return {
      route: 'VIDEO_AUDIO',
      primaryProvider: 'VideoDB',
      secondaryProviders: ['Kimi'],
      models: ['VIDEODB', 'KIMI'],
      judgeReasoningProvider: 'Kimi',
      routeReason: 'VideoDB workflow with Kimi judge reasoning.',
    };
  }

  return {
    route: 'TEXT',
    primaryProvider: 'Kimi',
    secondaryProviders: [],
    models: ['KIMI'],
    judgeReasoningProvider: 'Kimi',
    routeReason: 'TEXT modality routed to Kimi default reasoning provider.',
  };
}
