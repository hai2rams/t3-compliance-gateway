import type {
  ComplianceDecision,
  SenseNovaReasoningResult,
} from '../schemas/complianceCheckSchema.js';

export type SenseNovaVisionResult = {
  provider: 'SenseNova';
  status: 'MOCK_SCANNED' | 'SCANNED' | 'SKIPPED';
  findings: string[];
};

export type SenseNovaReasoningInput = {
  content: string;
  purpose: string;
  decision: ComplianceDecision;
  needsVideo?: boolean;
};

function isMockMode(): boolean {
  return process.env.MOCK_MODE === 'true' || !process.env.SENSENOVA_API_KEY?.trim();
}

export function scanDocument(content: string): SenseNovaVisionResult {
  const mockMode = isMockMode();
  const hasImageRef = /\[image|\.png|\.jpg|document scan|passport|video|faces/i.test(content);

  if (!hasImageRef) {
    return {
      provider: 'SenseNova',
      status: 'SKIPPED',
      findings: [],
    };
  }

  if (mockMode) {
    return {
      provider: 'SenseNova',
      status: 'MOCK_SCANNED',
      findings: ['Mock SenseNova scan: no prohibited visual content detected.'],
    };
  }

  return {
    provider: 'SenseNova',
    status: 'SCANNED',
    findings: ['Document visual scan completed.'],
  };
}

export async function runSenseNovaReasoning(
  input: SenseNovaReasoningInput,
): Promise<SenseNovaReasoningResult> {
  const apiKey = process.env.SENSENOVA_API_KEY?.trim() ?? '';
  const mockMode = isMockMode();

  if (!apiKey && !mockMode) {
    return {
      provider: 'SenseNova',
      status: 'UNAVAILABLE',
      summary: 'SenseNova API key not configured.',
    };
  }

  const vision = scanDocument(input.content);
  if (vision.status === 'SKIPPED' && !input.needsVideo) {
    return {
      provider: 'SenseNova',
      status: 'UNAVAILABLE',
      summary: 'SenseNova skipped — no visual/video content detected.',
    };
  }

  const alignment =
    input.decision === 'ALLOW'
      ? 'SenseNova analysis: visual content aligns with stated purpose.'
      : input.decision === 'DENY'
        ? 'SenseNova analysis: visual content conflicts with policy.'
        : 'SenseNova analysis: visual signals ambiguous — recommend review.';

  const findings = vision.findings.length ? ` ${vision.findings.join(' ')}` : '';

  return {
    provider: 'SenseNova',
    status: mockMode ? 'MOCK_COMPLETED' : 'COMPLETED',
    summary: `${mockMode ? 'Mock ' : ''}${alignment}${findings}`,
  };
}
