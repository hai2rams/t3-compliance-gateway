export type VideoDbResult = {
  provider: 'VideoDB';
  status: 'MOCK_INDEXED' | 'INDEXED' | 'SKIPPED';
  clipId: string;
  retentionPolicy: string;
};

export function indexAuditClip(auditId: string): VideoDbResult {
  const mockMode = process.env.MOCK_MODE === 'true' || !process.env.VIDEODB_API_KEY;

  if (mockMode) {
    return {
      provider: 'VideoDB',
      status: 'MOCK_INDEXED',
      clipId: `mock-clip-${auditId}`,
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
