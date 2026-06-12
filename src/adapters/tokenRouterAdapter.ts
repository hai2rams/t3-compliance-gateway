import type {
  ComplianceDecision,
  LlmProviderName,
  RouteResult,
  WorkflowType,
} from '../schemas/complianceCheckSchema.js';

export type TokenRouterInput = {
  decision: ComplianceDecision;
  riskScore: number;
  toolRequested: string;
  dataSensitivity: string;
  workflowType?: WorkflowType;
};

export function routeModel(input: TokenRouterInput): RouteResult {
  if (input.decision === 'DENY') {
    return {
      provider: 'TokenRouter',
      selectedModel: 'SKIP_LLM',
      selectedLlmProvider: 'Mock',
      routeReason: 'Policy denied request; LLM inference skipped to prevent data leakage.',
    };
  }

  const explicitProvider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicitProvider === 'gemini') {
    return {
      provider: 'TokenRouter',
      selectedModel: 'GEMINI',
      selectedLlmProvider: 'Gemini',
      routeReason: 'LLM_PROVIDER=gemini — routed to Gemini legacy provider.',
    };
  }

  if (input.decision === 'REVIEW' || input.riskScore >= 50) {
    return {
      provider: 'TokenRouter',
      selectedModel: 'KIMI_STRONG_REVIEW',
      selectedLlmProvider: 'Kimi',
      routeReason: 'Elevated risk or REVIEW decision — Kimi strong-review (primary sponsor LLM).',
    };
  }

  if (input.workflowType === 'VIDEO_ANALYSIS' && input.riskScore >= 35) {
    return {
      provider: 'TokenRouter',
      selectedModel: 'SENSENOVA',
      selectedLlmProvider: 'SenseNova',
      routeReason:
        'Video workflow with elevated risk — SenseNova vision reasoning selected as primary LLM.',
    };
  }

  return {
    provider: 'TokenRouter',
    selectedModel: 'KIMI',
    selectedLlmProvider: 'Kimi',
    routeReason: `Tool "${input.toolRequested}" routed to Kimi (default hackathon reasoning provider).`,
  };
}

export function resolveLlmProviderFromRoute(route: RouteResult): LlmProviderName {
  return route.selectedLlmProvider;
}
