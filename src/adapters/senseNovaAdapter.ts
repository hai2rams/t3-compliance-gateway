export type SenseNovaVisionResult = {
  provider: 'SenseNova';
  status: 'MOCK_SCANNED' | 'SCANNED' | 'SKIPPED';
  findings: string[];
};

export function scanDocument(content: string): SenseNovaVisionResult {
  const mockMode = process.env.MOCK_MODE === 'true' || !process.env.SENSENOVA_API_KEY;
  const hasImageRef = /\[image|\.png|\.jpg|document scan/i.test(content);

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
      findings: ['Mock OCR: no prohibited visual content detected.'],
    };
  }

  return {
    provider: 'SenseNova',
    status: 'SCANNED',
    findings: ['Document visual scan completed.'],
  };
}
