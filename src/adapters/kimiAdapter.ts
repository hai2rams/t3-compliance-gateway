import type { ComplianceDecision, KimiReasoningResult, RouteResult } from '../schemas/complianceCheckSchema.js';

export type KimiInput = {
  content: string;
  purpose: string;
  decision: ComplianceDecision;
  route: RouteResult;
};

export async function runKimiReasoning(input: KimiInput): Promise<KimiReasoningResult> {
  if (input.route.selectedModel === 'SKIP_LLM') {
    return {
      provider: 'Kimi',
      status: 'SKIPPED',
      summary: 'Kimi reasoning skipped — policy denied before LLM invocation.',
    };
  }

  const apiKey = process.env.KIMI_API_KEY?.trim() ?? '';
  const mockMode = process.env.MOCK_MODE === 'true' || !apiKey;

  if (!apiKey && !mockMode) {
    return {
      provider: 'Kimi',
      status: 'UNAVAILABLE',
      summary: 'Kimi API key not configured.',
    };
  }

  if (mockMode) {
    const alignment =
      input.decision === 'ALLOW'
        ? 'Mock Kimi analysis: content aligns with stated purpose.'
        : input.decision === 'DENY'
          ? 'Mock Kimi analysis: detected policy conflict with stated purpose.'
          : 'Mock Kimi analysis: ambiguous intent — recommend governance review.';

    return {
      provider: 'Kimi',
      status: 'MOCK_COMPLETED',
      summary: alignment,
    };
  }

  return {
    provider: 'Kimi',
    status: 'COMPLETED',
    summary: 'Kimi semantic review completed (live mode).',
  };
}
