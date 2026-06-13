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
  finalAgentState: FinalAgentState;
  timestamp: string;
};
