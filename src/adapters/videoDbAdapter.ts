import type { ComplianceCheckRequest } from '../schemas/complianceCheckSchema.js';

export type VideoDbResult = {
  provider: 'VideoDB';
  status: 'MOCK_INDEXED' | 'INDEXED' | 'SKIPPED';
  clipId: string;
  retentionPolicy: string;
};

function isMockMode(): boolean {
  return process.env.MOCK_MODE === 'true' || !process.env.VIDEODB_API_KEY?.trim();
}

export function routeVideoWorkflow(
  request: ComplianceCheckRequest,
  auditId: string,
): VideoDbResult {
  const mockMode = isMockMode();

  if (mockMode) {
    return {
      provider: 'VideoDB',
      status: 'MOCK_INDEXED',
      clipId: `mock-clip-${request.agentId.slice(0, 8)}-${auditId.slice(-6)}`,
      retentionPolicy: 'compliance-90d',
    };
  }

  return {
    provider: 'VideoDB',
    status: 'INDEXED',
    clipId: `clip-${auditId}`,
    retentionPolicy: 'compliance-90d',
  };
}

/** @deprecated Use routeVideoWorkflow via runtime router */
export function indexAuditClip(auditId: string): VideoDbResult {
  return routeVideoWorkflow(
    {
      agentId: 'legacy-agent',
      useCase: 'government',
      userRole: 'officer',
      actionType: 'VIDEO_ANALYSIS',
      dataSensitivity: 'HIGH',
      toolRequested: 'video_analysis',
      purpose: 'legacy video index',
      content: 'video',
      containsPii: true,
      externalSharing: false,
      amount: 0,
      needsVideo: true,
    },
    auditId,
  );
}
