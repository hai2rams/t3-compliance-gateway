export type NosanaComputeResult = {
  provider: 'Nosana';
  status: 'MOCK_QUEUED' | 'QUEUED' | 'UNAVAILABLE';
  jobId: string;
  gpuTier: string;
};

export function queueGpuJob(workload: string): NosanaComputeResult {
  const mockMode = process.env.MOCK_MODE === 'true' || !process.env.NOSANA_API_KEY;

  if (mockMode) {
    return {
      provider: 'Nosana',
      status: 'MOCK_QUEUED',
      jobId: `mock-nosana-${Date.now()}`,
      gpuTier: 'inference-small',
    };
  }

  return {
    provider: 'Nosana',
    status: 'QUEUED',
    jobId: `nosana-${Date.now()}`,
    gpuTier: 'inference-medium',
  };
}
