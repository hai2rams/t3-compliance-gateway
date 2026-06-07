import { GoogleGenerativeAI } from '@google/generative-ai';

const BLACKLIST = ['offshore', 'bribe', 'crypto', 'evasion'];

export interface AuditResult {
  passed: boolean;
  reasoning: string;
  triggeredLayer: 'DETERMINISTIC' | 'SEMANTIC' | 'NONE' | 'FAIL_SECURE';
}

/**
 * Layer 1: Deterministic string normalization filter
 * Strips special characters, spaces, and hyphens to block evasions like "off-shore"
 */
export function evaluateDeterministicRules(text: string, amount: number): AuditResult | null {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const forbidden of BLACKLIST) {
    if (normalizedText.includes(forbidden)) {
      return {
        passed: false,
        reasoning: `Flagged by deterministic pre-filter: Contained forbidden keyword trace matching '${forbidden}'.`,
        triggeredLayer: 'DETERMINISTIC',
      };
    }
  }

  if (amount > 500) {
    return {
      passed: false,
      reasoning:
        'Flagged by deterministic pre-filter: Transaction amount exceeds the unverified agent threshold of $500.',
      triggeredLayer: 'DETERMINISTIC',
    };
  }

  return null;
}

// 2.0/1.5 families were retired June 2026 — prefer current Flash tiers with free quota.
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
] as const;

const SEMANTIC_AUDIT_PROMPT = (text: string) => `
  You are an enterprise risk, compliance, and anti-bribery auditing model.
  Analyze the following transaction ledger note submitted by an autonomous AI agent.
  Detect any hidden intents of corruption, bribery, undeclared foreign allocations, policy evasion, or shell company laundering.

  Transaction Text: "${text}"

  Respond strictly in valid JSON format matching this schema:
  {
    "passed": boolean,
    "reasoning": "A concise single-sentence summary explaining why the transaction was approved or flagged"
  }
`;

function isRetryableModelError(message: string): boolean {
  return /503|429|404|not found|high demand|unavailable|overloaded|rate limit|quota/i.test(
    message,
  );
}

/**
 * Layer 2: Gemini semantic filter with model fallback chain.
 * Catches deep linguistic bypasses and context tricks with a fail-secure fallback.
 */
export async function evaluateSemanticCompliance(
  text: string,
  apiKey: string,
): Promise<AuditResult> {
  if (!apiKey) {
    return {
      passed: false,
      reasoning:
        'Fail-Secure Triggered: Terminal 3 hardware secrets enclave returned an empty API credential key.',
      triggeredLayer: 'FAIL_SECURE',
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const errors: string[] = [];

  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' },
      });

      const response = await model.generateContent(SEMANTIC_AUDIT_PROMPT(text));
      const cleanJson = response.response.text().trim();
      const result = JSON.parse(cleanJson) as { passed: boolean; reasoning: string };

      return {
        passed: result.passed,
        reasoning: result.reasoning,
        triggeredLayer: 'SEMANTIC',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${modelName}: ${message}`);
      console.error(`❌ Gemini model fault (${modelName}):`, message);

      if (!isRetryableModelError(message)) {
        break;
      }
    }
  }

  return {
    passed: false,
    reasoning:
      'Fail-Secure Lock: High-fidelity AI auditing layer timed out or threw an infrastructure error. Transaction frozen out of caution.',
    triggeredLayer: 'FAIL_SECURE',
  };
}
