import type { FinalAgentState } from '../schemas/agentIntakeSchema.js';
import type { ExecutionSpec, RuntimeExecutionResult } from './executionSpec.js';

export function executeRuntimePlan(
  finalState: FinalAgentState,
  spec: ExecutionSpec,
  missionId: string,
): RuntimeExecutionResult {
  if (
    finalState === 'AUTO_BLOCKED_BY_POLICY' ||
    finalState === 'AUTO_HOLD_REVIEW_REQUIRED'
  ) {
    return {
      executed: false,
      status: 'NOT_EXECUTED',
      note: 'Executor blocked — governance hold or policy block. No runtime dispatch.',
      spec,
    };
  }

  if (finalState !== 'AUTO_EXECUTION_APPROVED' && finalState !== 'EXECUTION_QUEUED') {
    return {
      executed: false,
      status: 'NOT_EXECUTED',
      note: 'Executor blocked — final agent state does not permit execution.',
      spec,
    };
  }

  const mockMode = process.env.MOCK_MODE === 'true';
  return {
    executed: !mockMode,
    status: mockMode ? 'MOCK_PLANNED_ONLY' : 'DISPATCHED',
    note: mockMode
      ? 'Mock mode — execution plan recorded without live runtime dispatch.'
      : 'Runtime dispatch signaled to adapter (planned execution only in hackathon build).',
    spec: {
      ...spec,
      executionId: `${spec.targetRuntime.toLowerCase()}-${missionId.slice(-8)}`,
    },
  };
}
