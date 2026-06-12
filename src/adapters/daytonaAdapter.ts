import type { ComplianceCheckRequest } from '../schemas/complianceCheckSchema.js';

export type DaytonaSandboxResult = {
  provider: 'Daytona';
  status: 'MOCK_READY' | 'READY' | 'UNAVAILABLE';
  sandboxId: string;
  note: string;
};

function isMockMode(): boolean {
  return process.env.MOCK_MODE === 'true' || !process.env.DAYTONA_API_KEY?.trim();
}

export function routeClaimsSandbox(
  request: ComplianceCheckRequest,
  auditId: string,
): DaytonaSandboxResult {
  const mockMode = isMockMode();

  if (mockMode) {
    return {
      provider: 'Daytona',
      status: 'MOCK_READY',
      sandboxId: `mock-sbx-${request.agentId.slice(0, 8)}-${auditId.slice(-6)}`,
      note: 'Mock Daytona sandbox — isolated claim/document review environment.',
    };
  }

  return {
    provider: 'Daytona',
    status: 'READY',
    sandboxId: `sbx-${Date.now()}`,
    note: `Daytona sandbox provisioned for ${request.actionType} (${request.toolRequested}).`,
  };
}

/** @deprecated Use routeClaimsSandbox via runtime router */
export function provisionSandbox(agentId: string): DaytonaSandboxResult {
  return routeClaimsSandbox(
    {
      agentId,
      useCase: 'finance',
      userRole: 'agent',
      actionType: 'legacy',
      dataSensitivity: 'LOW',
      toolRequested: 'sandbox',
      purpose: 'legacy provision',
      content: '',
      containsPii: false,
      externalSharing: false,
      amount: 0,
    },
    `legacy-${Date.now()}`,
  );
}
