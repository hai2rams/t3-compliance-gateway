import { z } from 'zod';

export const UseCaseSchema = z.enum(['finance', 'government', 'procurement']);
export const WorkflowTypeSchema = z.enum([
  'CLAIMS_REVIEW',
  'BULK_BATCH_JOB',
  'VIDEO_ANALYSIS',
]);
export const JobModeSchema = z.enum(['INTERACTIVE', 'BATCH', 'STREAMING']);
export const DataSensitivitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const ComplianceDecisionSchema = z.enum(['ALLOW', 'DENY', 'REVIEW']);
export const SensitiveDataTypeSchema = z.enum([
  'EMAIL',
  'PHONE',
  'BANK_ACCOUNT',
  'CITIZEN_ID',
  'CONFIDENTIAL_KEYWORD',
]);

export const ComplianceCheckRequestSchema = z.object({
  workflowType: WorkflowTypeSchema.optional(),
  useCase: UseCaseSchema,
  agentId: z.string().min(1),
  userRole: z.string().min(1),
  actionType: z.string().min(1),
  dataSensitivity: DataSensitivitySchema,
  toolRequested: z.string().min(1),
  purpose: z.string().min(1),
  content: z.string(),
  containsPii: z.boolean(),
  externalSharing: z.boolean(),
  amount: z.number().nonnegative(),
  jobMode: JobModeSchema.optional(),
  estimatedRecords: z.number().nonnegative().optional(),
  needsGpu: z.boolean().optional(),
  needsVideo: z.boolean().optional(),
  needsWebData: z.boolean().optional(),
});

export type ComplianceCheckRequest = z.infer<typeof ComplianceCheckRequestSchema>;
export type UseCase = z.infer<typeof UseCaseSchema>;
export type WorkflowType = z.infer<typeof WorkflowTypeSchema>;
export type JobMode = z.infer<typeof JobModeSchema>;
export type DataSensitivity = z.infer<typeof DataSensitivitySchema>;
export type ComplianceDecision = z.infer<typeof ComplianceDecisionSchema>;
export type SensitiveDataType = z.infer<typeof SensitiveDataTypeSchema>;

export type SensitiveDataResult = {
  detected: boolean;
  types: SensitiveDataType[];
  redactedPreview: string;
};

export type LlmProviderName = 'Kimi' | 'SenseNova' | 'Gemini' | 'Mock';

export type RouteResult = {
  provider: 'TokenRouter';
  selectedModel: 'SKIP_LLM' | 'KIMI' | 'KIMI_STRONG_REVIEW' | 'SENSENOVA' | 'GEMINI' | 'MOCK';
  selectedLlmProvider: LlmProviderName;
  routeReason: string;
};

export type TrustResult = {
  provider: 'Terminal 3';
  status: 'VERIFIED' | 'MOCK_VERIFIED' | 'FAILED';
  contractMode: 'TEE_COMPLIANCE_GATEWAY';
};

export type KimiReasoningResult = {
  provider: 'Kimi';
  status: 'COMPLETED' | 'SKIPPED' | 'MOCK_COMPLETED' | 'UNAVAILABLE';
  summary: string;
};

export type SenseNovaReasoningResult = {
  provider: 'SenseNova';
  status: 'COMPLETED' | 'SKIPPED' | 'MOCK_COMPLETED' | 'UNAVAILABLE';
  summary: string;
};

export type GeminiReasoningResult = {
  provider: 'Gemini';
  status: 'COMPLETED' | 'SKIPPED' | 'MOCK_COMPLETED' | 'FAIL_SECURE' | 'UNAVAILABLE';
  summary: string;
};

export type RuntimeRoutingResult = {
  provider: 'Daytona' | 'Nosana' | 'VideoDB' | 'NONE';
  status: 'ROUTED' | 'MOCK_ROUTED' | 'BLOCKED' | 'AWAITING_APPROVAL';
  jobClass: string;
  reason: string;
  executionId?: string;
};

export type WorkflowClassification = {
  workflowType: WorkflowType;
  label: string;
  hints: string[];
};

export type ComplianceCheckResponse = {
  workflowType: WorkflowType;
  workflowLabel: string;
  decision: ComplianceDecision;
  riskScore: number;
  policyId: string;
  reasoning: string;
  sensitiveData: SensitiveDataResult;
  route: RouteResult;
  llmProvider: LlmProviderName;
  trust: TrustResult;
  kimi: KimiReasoningResult;
  senseNova?: SenseNovaReasoningResult;
  gemini?: GeminiReasoningResult;
  runtime: RuntimeRoutingResult;
  sponsorTools: string[];
  auditId: string;
  timestamp: string;
};
