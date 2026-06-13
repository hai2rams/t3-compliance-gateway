import type {
  ComplianceCheckRequest,
  ComplianceDecision,
  RuntimeRoutingResult,
  WorkflowType,
} from '../schemas/complianceCheckSchema.js';
import { routeClaimsSandbox } from '../adapters/daytonaAdapter.js';
import { routeBatchCompute } from '../adapters/nosanaAdapter.js';
import { routeVideoWorkflow } from '../adapters/videoDbAdapter.js';

export function routeRuntimeExecution(
  decision: ComplianceDecision,
  workflowType: WorkflowType,
  request: ComplianceCheckRequest,
  auditId: string,
): RuntimeRoutingResult {
  if (decision === 'DENY') {
    return {
      provider: 'NONE',
      status: 'BLOCKED',
      jobClass: 'NONE',
      reason: 'Policy denied request before runtime execution.',
    };
  }

  if (decision === 'REVIEW') {
    return {
      provider: 'NONE',
      status: 'AWAITING_APPROVAL',
      jobClass: 'NONE',
      reason: 'Human review required before runtime execution.',
    };
  }

  switch (workflowType) {
    case 'CLAIMS_REVIEW': {
      const daytona = routeClaimsSandbox(request, auditId);
      return {
        provider: 'Daytona',
        status: daytona.status === 'MOCK_READY' ? 'MOCK_ROUTED' : 'ROUTED',
        jobClass: 'LIGHT_DOCUMENT_SANDBOX',
        reason:
          'Approved claim/document review can run in an isolated Daytona sandbox.',
        executionId: daytona.sandboxId,
      };
    }
    case 'BULK_BATCH_JOB': {
      const nosana = routeBatchCompute(request);
      return {
        provider: 'Nosana',
        status: nosana.status.startsWith('MOCK') ? 'QUEUED_MOCK' : 'ROUTED',
        jobClass: 'HEAVY_BATCH_GPU',
        reason: 'Approved heavy/batch workload can be dispatched to Nosana compute.',
        executionId: nosana.jobId,
      };
    }
    case 'VIDEO_ANALYSIS': {
      const videoDb = routeVideoWorkflow(request, auditId);
      return {
        provider: 'VideoDB',
        status: videoDb.status.startsWith('MOCK') ? 'MOCK_ROUTED' : 'ROUTED',
        jobClass: 'VIDEO_WORKFLOW',
        reason: 'Approved video workflow can be processed by VideoDB.',
        executionId: videoDb.clipId,
      };
    }
  }
}
