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

/**
 * Layer 2: Gemini 2.5 Flash Semantic Filter
 * Catches deep linguistic bypasses and context tricks with a fail-secure fallback
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

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `
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

    const response = await model.generateContent(prompt);
    const cleanJson = response.response.text().trim();
    const result = JSON.parse(cleanJson) as { passed: boolean; reasoning: string };

    return {
      passed: result.passed,
      reasoning: result.reasoning,
      triggeredLayer: 'SEMANTIC',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Gemini API Infrastructure Fault encountered:', message);

    return {
      passed: false,
      reasoning:
        'Fail-Secure Lock: High-fidelity AI auditing layer timed out or threw an infrastructure error. Transaction frozen out of caution.',
      triggeredLayer: 'FAIL_SECURE',
    };
  }
}
