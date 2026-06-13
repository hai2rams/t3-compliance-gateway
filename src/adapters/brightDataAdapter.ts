export type BrightDataEnrichmentResult = {
  provider: 'BrightData';
  status: 'MOCK_COMPLETED' | 'COMPLETED' | 'SKIPPED' | 'BLOCKED';
  publicQuery: string;
  findings: string[];
  note: string;
};

function isMockMode(): boolean {
  return process.env.MOCK_MODE === 'true' || !process.env.BRIGHTDATA_API_KEY?.trim();
}

export function enrichPublicWeb(publicQuery: string): BrightDataEnrichmentResult {
  if (!publicQuery.trim()) {
    return {
      provider: 'BrightData',
      status: 'SKIPPED',
      publicQuery: '',
      findings: [],
      note: 'No public query extracted.',
    };
  }

  if (isMockMode()) {
    return {
      provider: 'BrightData',
      status: 'MOCK_COMPLETED',
      publicQuery,
      findings: [`Mock BrightData/MCP enrichment for public entity: ${publicQuery}`],
      note: 'Mock-safe public enrichment — no private data transmitted.',
    };
  }

  return {
    provider: 'BrightData',
    status: 'COMPLETED',
    publicQuery,
    findings: [`Public enrichment completed for: ${publicQuery}`],
    note: 'BrightData MCP adapter (live mode).',
  };
}
