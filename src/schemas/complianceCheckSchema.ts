import { z } from 'zod';

export const UseCaseSchema = z.enum(['finance', 'government', 'procurement']);
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
});

export type ComplianceCheckRequest = z.infer<typeof ComplianceCheckRequestSchema>;
export type UseCase = z.infer<typeof UseCaseSchema>;
export type DataSensitivity = z.infer<typeof DataSensitivitySchema>;
export type ComplianceDecision = z.infer<typeof ComplianceDecisionSchema>;
export type SensitiveDataType = z.infer<typeof SensitiveDataTypeSchema>;

export type SensitiveDataResult = {
  detected: boolean;
  types: SensitiveDataType[];
  redactedPreview: string;
};

export type RouteResult = {
  provider: 'TokenRouter';
  selectedModel: 'SKIP_LLM' | 'FAST_MODEL' | 'KIMI' | 'KIMI_STRONG_REVIEW';
  routeReason: string;
};

export type TrustResult = {
  provider: 'Terminal 3';
  status: 'VERIFIED' | 'MOCK_VERIFIED' | 'FAILED';
  contractMode: 'TEE_COMPLIANCE_GATEWAY';
};

export type KimiReasoningResult = {
  provider: 'Kimi';
  status: 'COMPLETED' | 'SKIPPED' | 'MOCK_COMPLETED';
  summary: string;
};

export type ComplianceCheckResponse = {
  decision: ComplianceDecision;
  riskScore: number;
  policyId: string;
  reasoning: string;
  sensitiveData: SensitiveDataResult;
  route: RouteResult;
  trust: TrustResult;
  kimi: KimiReasoningResult;
  sponsorTools: string[];
  auditId: string;
  timestamp: string;
};
