export type ExecutionSpec = {
  targetRuntime: 'Daytona' | 'Nosana' | 'VideoDB' | 'BrightData' | 'NONE';
  executionMode: string;
  jobClass: string;
  containerImage: string | null;
  status: string;
  reason: string;
  executionId?: string;
};

export type RuntimeExecutionResult = {
  executed: boolean;
  status: string;
  note: string;
  spec: ExecutionSpec;
};
