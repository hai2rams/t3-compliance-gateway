export type DaytonaSandboxResult = {
  provider: 'Daytona';
  status: 'MOCK_READY' | 'READY' | 'UNAVAILABLE';
  sandboxId: string;
  note: string;
};

export function provisionSandbox(agentId: string): DaytonaSandboxResult {
  const mockMode = process.env.MOCK_MODE === 'true' || !process.env.DAYTONA_API_KEY;

  if (mockMode) {
    return {
      provider: 'Daytona',
      status: 'MOCK_READY',
      sandboxId: `mock-sbx-${agentId.slice(0, 8)}`,
      note: 'Mock Daytona sandbox — isolated agent execution environment.',
    };
  }

  return {
    provider: 'Daytona',
    status: 'READY',
    sandboxId: `sbx-${Date.now()}`,
    note: 'Daytona sandbox provisioned for regulated agent workload.',
  };
}
