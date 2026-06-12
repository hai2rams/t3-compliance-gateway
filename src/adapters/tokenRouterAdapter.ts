import type { ComplianceDecision, RouteResult } from '../schemas/complianceCheckSchema.js';

export type TokenRouterInput = {
  decision: ComplianceDecision;
  riskScore: number;
  toolRequested: string;
  dataSensitivity: string;
};

export function routeModel(input: TokenRouterInput): RouteResult {
  if (input.decision === 'DENY') {
    return {
      provider: 'TokenRouter',
      selectedModel: 'SKIP_LLM',
      routeReason: 'Policy denied request; LLM inference skipped to prevent data leakage.',
    };
  }

  if (input.decision === 'ALLOW' && input.riskScore < 30) {
    return {
      provider: 'TokenRouter',
      selectedModel: 'FAST_MODEL',
      routeReason: 'Low-risk approved action routed to fast compliance model.',
    };
  }

  if (input.decision === 'REVIEW' || input.riskScore >= 50) {
    return {
      provider: 'TokenRouter',
      selectedModel: 'KIMI_STRONG_REVIEW',
      routeReason: 'Elevated risk or REVIEW decision routed to strong reasoning model.',
    };
  }

  return {
    provider: 'TokenRouter',
    selectedModel: 'KIMI',
    routeReason: `Tool "${input.toolRequested}" routed to Kimi for semantic compliance check.`,
  };
}
