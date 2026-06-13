import type {
  ComplianceDecision,
  GeminiReasoningResult,
  KimiReasoningResult,
  LlmProviderName,
  RouteResult,
  SenseNovaReasoningResult,
} from '../schemas/complianceCheckSchema.js';
import { evaluateSemanticCompliance } from '../services/compliance.js';
import { runKimiReasoning } from './kimiAdapter.js';
import { runSenseNovaReasoning } from './senseNovaAdapter.js';

export type LlmReasoningInput = {
  content: string;
  purpose: string;
  decision: ComplianceDecision;
  route: RouteResult;
  needsVideo?: boolean;
};

export type LlmReasoningOutput = {
  llmProvider: LlmProviderName;
  kimi: KimiReasoningResult;
  senseNova?: SenseNovaReasoningResult;
  gemini?: GeminiReasoningResult;
};

export function getLlmProviderOverride(): 'kimi' | 'gemini' | null {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider === 'gemini') return 'gemini';
  if (provider === 'kimi') return 'kimi';
  return null;
}

export async function runGeminiReasoning(
  input: LlmReasoningInput,
): Promise<GeminiReasoningResult> {
  if (input.route.selectedModel === 'SKIP_LLM') {
    return {
      provider: 'Gemini',
      status: 'SKIPPED',
      summary: 'Gemini reasoning skipped — policy denied before LLM invocation.',
    };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
  const mockMode = process.env.MOCK_MODE === 'true' || !apiKey;

  if (!apiKey && !mockMode) {
    return {
      provider: 'Gemini',
      status: 'UNAVAILABLE',
      summary: 'Gemini API key not configured.',
    };
  }

  if (mockMode) {
    const alignment =
      input.decision === 'ALLOW'
        ? 'Mock Gemini analysis: content aligns with stated purpose.'
        : input.decision === 'DENY'
          ? 'Mock Gemini analysis: detected policy conflict with stated purpose.'
          : 'Mock Gemini analysis: ambiguous intent — recommend governance review.';

    return {
      provider: 'Gemini',
      status: 'MOCK_COMPLETED',
      summary: alignment,
    };
  }

  const result = await evaluateSemanticCompliance(input.content, apiKey);
  return {
    provider: 'Gemini',
    status: result.triggeredLayer === 'FAIL_SECURE' ? 'FAIL_SECURE' : 'COMPLETED',
    summary: result.reasoning,
  };
}

function isUsable(
  status: KimiReasoningResult['status'] | SenseNovaReasoningResult['status'] | GeminiReasoningResult['status'],
): boolean {
  return status === 'COMPLETED' || status === 'MOCK_COMPLETED';
}

function skippedKimi(reason: string): KimiReasoningResult {
  return { provider: 'Kimi', status: 'SKIPPED', summary: reason };
}

export async function runLlmReasoning(input: LlmReasoningInput): Promise<LlmReasoningOutput> {
  if (input.route.selectedModel === 'SKIP_LLM') {
    return {
      llmProvider: 'Mock',
      kimi: {
        provider: 'Kimi',
        status: 'SKIPPED',
        summary: 'LLM chain skipped — policy denied.',
      },
    };
  }

  const override = getLlmProviderOverride();
  if (override === 'gemini') {
    const gemini = await runGeminiReasoning(input);
    return {
      llmProvider: isUsable(gemini.status) ? 'Gemini' : 'Mock',
      kimi: skippedKimi('Kimi skipped — LLM_PROVIDER=gemini explicit override.'),
      gemini,
    };
  }

  if (input.route.selectedLlmProvider === 'SenseNova') {
    const senseNova = await runSenseNovaReasoning({
      content: input.content,
      purpose: input.purpose,
      decision: input.decision,
      needsVideo: input.needsVideo,
    });
    if (isUsable(senseNova.status)) {
      return {
        llmProvider: senseNova.status === 'MOCK_COMPLETED' ? 'Mock' : 'SenseNova',
        kimi: skippedKimi('Kimi skipped — TokenRouter selected SenseNova for video workflow.'),
        senseNova,
      };
    }
  }

  const kimi = await runKimiReasoning(input);
  if (isUsable(kimi.status)) {
    return {
      llmProvider: kimi.status === 'MOCK_COMPLETED' ? 'Mock' : 'Kimi',
      kimi,
    };
  }

  const senseNova = await runSenseNovaReasoning({
    content: input.content,
    purpose: input.purpose,
    decision: input.decision,
    needsVideo: input.needsVideo,
  });
  if (isUsable(senseNova.status)) {
    return {
      llmProvider: senseNova.status === 'MOCK_COMPLETED' ? 'Mock' : 'SenseNova',
      kimi: skippedKimi('Kimi unavailable — fell back to SenseNova.'),
      senseNova,
    };
  }

  const gemini = await runGeminiReasoning(input);
  if (isUsable(gemini.status)) {
    return {
      llmProvider: 'Gemini',
      kimi: skippedKimi('Kimi and SenseNova unavailable — fell back to Gemini legacy provider.'),
      gemini,
    };
  }

  const mockKimi = await runKimiReasoning({
    ...input,
    route: { ...input.route, selectedModel: 'KIMI' },
  });
  return {
    llmProvider: 'Mock',
    kimi: {
      ...mockKimi,
      status: 'MOCK_COMPLETED',
      summary: 'Safe local mock fallback — no live LLM API keys available.',
    },
  };
}
