import type { FinalAgentState } from '../schemas/agentIntakeSchema.js';
import type { ToolOrchestration } from '../schemas/agentIntakeSchema.js';
import type { LlmJudgeResult } from './llmJudgeAgent.js';
import { TOOL_ORCHESTRATION_STRATEGY } from '../config/toolCapabilityMap.js';
import {
  buildToolChain,
  deriveAuditSummary,
  deriveBlockedToolActions,
  deriveNextToolAction,
  type ToolDecisionInput,
} from '../services/toolDecisionEngine.js';

export type { ToolDecisionInput };

const BLOCKED_EXECUTION_SPEC = {
  targetRuntime: 'NONE' as const,
  executionMode: 'NONE',
  jobClass: 'NONE',
  containerImage: null,
  status: 'NOT_PLANNED',
  reason: 'Execution not planned — governance block.',
};

const BLOCKED_RUNTIME = {
  executed: false,
  status: 'NOT_EXECUTED',
  note: 'Executor blocked — governance hold or policy block.',
  spec: BLOCKED_EXECUTION_SPEC,
};

export function orchestrateAgentTools(
  input: ToolDecisionInput & { missionId: string },
): ToolOrchestration {
  const tools = buildToolChain(input);

  return {
    strategy: TOOL_ORCHESTRATION_STRATEGY,
    tools,
    nextToolAction: deriveNextToolAction(tools, input.finalAgentState),
    blockedToolActions: deriveBlockedToolActions(tools),
    auditSummary: deriveAuditSummary(tools, input.finalAgentState, input.missionId),
  };
}

export function orchestrateBlockedTools(
  missionId: string,
  input: Omit<ToolDecisionInput, 'finalAgentState' | 'judge' | 'executionSpec' | 'runtime'> & {
    blockReason: string;
  },
): ToolOrchestration {
  const blockedJudge: LlmJudgeResult = {
    verdict: 'AUTO_BLOCKED_BY_POLICY',
    summary: input.blockReason,
    policyAligned: true,
    requiresHumanVerification: false,
  };

  return orchestrateAgentTools({
    ...input,
    missionId,
    finalAgentState: 'AUTO_BLOCKED_BY_POLICY',
    judge: blockedJudge,
    executionSpec: { ...BLOCKED_EXECUTION_SPEC, reason: input.blockReason },
    runtime: { ...BLOCKED_RUNTIME, note: input.blockReason },
  });
}
