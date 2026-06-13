import { z } from 'zod';

export const AgentIntakeHintsSchema = z.object({
  hasFile: z.boolean().optional().default(false),
  hasImage: z.boolean().optional().default(false),
  hasAudio: z.boolean().optional().default(false),
  hasVideo: z.boolean().optional().default(false),
  hasBatch: z.boolean().optional().default(false),
  needsPublicWeb: z.boolean().optional().default(false),
});

export const AgentIntakeRequestSchema = z.object({
  agentId: z.string().min(1),
  goal: z.string().min(1),
  content: z.string(),
  hints: AgentIntakeHintsSchema.optional().default({}),
});

export type AgentIntakeRequest = z.infer<typeof AgentIntakeRequestSchema>;

export type Modality =
  | 'TEXT'
  | 'DOCUMENT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'BATCH'
  | 'WEB_RESEARCH'
  | 'MIXED';

export type InferredIntent =
  | 'CREDIT_KYC_PRECHECK'
  | 'VENDOR_ONBOARDING'
  | 'CLAIMS_REVIEW'
  | 'BATCH_RISK_SCAN'
  | 'VIDEO_REVIEW'
  | 'PUBLIC_WEB_RESEARCH'
  | 'GENERAL_REGULATED_CASE';

export type FinalAgentState =
  | 'AUTO_EXECUTION_APPROVED'
  | 'AUTO_HOLD_REVIEW_REQUIRED'
  | 'AUTO_BLOCKED_BY_POLICY'
  | 'EXECUTION_QUEUED';

export type AgentTraceStep = {
  step: number;
  agent: string;
  action: string;
  status: 'COMPLETED' | 'BLOCKED' | 'SKIPPED' | 'HOLD';
  summary: string;
};

export type ToolChainStatus = 'USED' | 'MOCKED' | 'PLANNED' | 'BLOCKED' | 'SKIPPED';

export type ToolChainEntry = {
  tool: string;
  role: string;
  status: ToolChainStatus;
  reason: string;
};

export type ToolOrchestration = {
  strategy: 'GOVERNED_AUTONOMOUS_TOOL_CHAIN';
  tools: ToolChainEntry[];
  nextToolAction: string;
  blockedToolActions: string[];
  auditSummary: string;
};

export type T3GovernanceMode = 'LIVE' | 'MOCK';

export type T3GovernanceIdentityStatus = 'VERIFIED' | 'MOCK_VERIFIED' | 'DENIED';

export type T3GovernancePermissionStatus = 'ALLOWED' | 'SCOPED' | 'DENIED';

export type T3GovernanceDecision = 'ALLOW_EXECUTION' | 'HOLD_FOR_REVIEW' | 'BLOCK_EXECUTION';

export type T3DataBoundaryScope = 'PUBLIC_ONLY' | 'INTERNAL_ONLY' | 'RESTRICTED_SENSITIVE';

export type T3ContractMode = 'TEE_COMPLIANCE_GATEWAY_READY' | 'TEE_COMPLIANCE_GATEWAY_MOCK';

export type T3Governance = {
  provider: 'Terminal 3';
  mode: T3GovernanceMode;
  identityStatus: T3GovernanceIdentityStatus;
  permissionStatus: T3GovernancePermissionStatus;
  contractMode: T3ContractMode;
  governanceDecision: T3GovernanceDecision;
  scope: {
    agentId: string;
    allowedIntent: string;
    allowedExternalTools: string[];
    allowedRuntime: string;
    dataBoundary: T3DataBoundaryScope;
  };
  proof: {
    governanceId: string;
    policyId: string;
    decisionHash: string;
    executionPlanHash: string;
    timestamp: string;
  };
  auditSummary: string;
};

export type AgentIntakeResponse = {
  missionId: string;
  agentId: string;
  detectedModality: string;
  inferredIntent: InferredIntent;
  selectedWorkflow: string;
  agentTrace: AgentTraceStep[];
  tokenRouterDecision: Record<string, unknown>;
  agentPassport: Record<string, unknown>;
  dataBoundary: Record<string, unknown>;
  enrichmentPlan: Record<string, unknown>;
  llmJudge: Record<string, unknown>;
  executionPlan: Record<string, unknown>;
  toolOrchestration: ToolOrchestration;
  t3Governance: T3Governance;
  finalAgentState: FinalAgentState;
  timestamp: string;
};
