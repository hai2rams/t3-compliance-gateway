import type { ComplianceCheckRequest } from '../schemas/complianceCheckSchema.js';

export type NosanaComputeResult = {
  provider: 'Nosana';
  status: 'MOCK_QUEUED' | 'QUEUED' | 'UNAVAILABLE';
  jobId: string;
  gpuTier: string;
};

function isMockMode(): boolean {
  return process.env.MOCK_MODE === 'true' || !process.env.NOSANA_API_KEY?.trim();
}

export function routeBatchCompute(request: ComplianceCheckRequest): NosanaComputeResult {
  const mockMode = isMockMode();
  const records = request.estimatedRecords ?? 0;
  const gpuTier =
    records > 10_000 ? 'inference-large' : records > 1_000 ? 'inference-medium' : 'inference-small';

  if (mockMode) {
    return {
      provider: 'Nosana',
      status: 'MOCK_QUEUED',
      jobId: `mock-nosana-${request.agentId.slice(0, 8)}-${Date.now()}`,
      gpuTier,
    };
  }

  return {
    provider: 'Nosana',
    status: 'QUEUED',
    jobId: `nosana-${Date.now()}`,
    gpuTier,
  };
}

/** @deprecated Use routeBatchCompute via runtime router */
export function queueGpuJob(workload: string): NosanaComputeResult {
  return routeBatchCompute({
    agentId: 'legacy-agent',
    useCase: 'finance',
    userRole: 'agent',
    actionType: 'BATCH_ANALYSIS',
    dataSensitivity: 'MEDIUM',
    toolRequested: workload,
    purpose: 'legacy batch job',
    content: '',
    containsPii: false,
    externalSharing: false,
    amount: 0,
    needsGpu: true,
    estimatedRecords: 1000,
  });
}
