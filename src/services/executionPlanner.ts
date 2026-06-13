import type { InferredIntent } from '../schemas/agentIntakeSchema.js';
import type { WorkflowType } from '../schemas/complianceCheckSchema.js';
import type { FinalAgentState } from '../schemas/agentIntakeSchema.js';
import type { ExecutionSpec } from '../execution/executionSpec.js';

export function mapIntentToWorkflow(intent: InferredIntent): WorkflowType {
  switch (intent) {
    case 'BATCH_RISK_SCAN':
      return 'BULK_BATCH_JOB';
    case 'VIDEO_REVIEW':
      return 'VIDEO_ANALYSIS';
    case 'CREDIT_KYC_PRECHECK':
    case 'VENDOR_ONBOARDING':
    case 'CLAIMS_REVIEW':
      return 'CLAIMS_REVIEW';
    default:
      return 'CLAIMS_REVIEW';
  }
}

export function planExecution(
  intent: InferredIntent,
  workflow: WorkflowType,
  finalState: FinalAgentState,
): ExecutionSpec {
  if (
    finalState === 'AUTO_BLOCKED_BY_POLICY' ||
    finalState === 'AUTO_HOLD_REVIEW_REQUIRED'
  ) {
    return buildHoldPlan(intent, workflow);
  }

  switch (workflow) {
    case 'BULK_BATCH_JOB':
      return {
        targetRuntime: 'Nosana',
        executionMode: 'GPU Batch',
        jobClass: 'HEAVY_BATCH_GPU',
        containerImage: null,
        status: finalState === 'EXECUTION_QUEUED' ? 'QUEUED_MOCK' : 'PLANNED',
        reason: 'Approved heavy/batch workload can be dispatched to Nosana compute.',
      };
    case 'VIDEO_ANALYSIS':
      return {
        targetRuntime: 'VideoDB',
        executionMode: 'Video Workflow',
        jobClass: 'VIDEO_WORKFLOW',
        containerImage: null,
        status: finalState === 'EXECUTION_QUEUED' ? 'QUEUED_MOCK' : 'PLANNED',
        reason: 'Approved video workflow can be processed by VideoDB.',
      };
    default:
      return {
        targetRuntime: 'Daytona',
        executionMode: 'Docker Sandbox',
        jobClass: 'LIGHT_DOCUMENT_SANDBOX',
        containerImage:
          intent === 'CREDIT_KYC_PRECHECK'
            ? 'kyc-document-validator:latest'
            : 'regulated-doc-sandbox:latest',
        status: finalState === 'EXECUTION_QUEUED' ? 'QUEUED_MOCK' : 'PLANNED',
        reason: 'Approved document/KYC job can run in an isolated Daytona sandbox.',
      };
  }
}

function buildHoldPlan(intent: InferredIntent, workflow: WorkflowType): ExecutionSpec {
  const base = planExecution(intent, workflow, 'EXECUTION_QUEUED');
  return {
    ...base,
    status: 'AWAITING_GOVERNANCE_APPROVAL',
    reason:
      intent === 'CREDIT_KYC_PRECHECK'
        ? 'Sensitive KYC package requires governed review before execution.'
        : 'Execution plan prepared — awaiting governance approval.',
  };
}
