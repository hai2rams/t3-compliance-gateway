import type {
  ComplianceCheckRequest,
  WorkflowClassification,
  WorkflowType,
} from '../schemas/complianceCheckSchema.js';

const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  CLAIMS_REVIEW: 'Claims / Document Upload Review',
  BULK_BATCH_JOB: 'Bulk Batch Job',
  VIDEO_ANALYSIS: 'Secure Video Analysis',
};

export function classifyWorkflow(request: ComplianceCheckRequest): WorkflowClassification {
  const workflowType = inferWorkflowType(request);
  const hints: string[] = [];

  if (request.jobMode) hints.push(`jobMode=${request.jobMode}`);
  if (request.estimatedRecords !== undefined) {
    hints.push(`estimatedRecords=${request.estimatedRecords}`);
  }
  if (request.needsGpu) hints.push('needsGpu=true');
  if (request.needsVideo) hints.push('needsVideo=true');
  if (request.needsWebData) hints.push('needsWebData=true');

  if (workflowType === 'BULK_BATCH_JOB' && !request.needsGpu) {
    hints.push('bulk workflow typically expects GPU compute');
  }
  if (workflowType === 'VIDEO_ANALYSIS' && !request.needsVideo) {
    hints.push('video workflow flagged without needsVideo=true');
  }

  return {
    workflowType,
    label: WORKFLOW_LABELS[workflowType],
    hints,
  };
}

function inferWorkflowType(request: ComplianceCheckRequest): WorkflowType {
  if (request.workflowType) {
    return request.workflowType;
  }

  if (request.needsVideo || request.actionType.includes('VIDEO')) {
    return 'VIDEO_ANALYSIS';
  }

  if (
    request.needsGpu ||
    request.jobMode === 'BATCH' ||
    (request.estimatedRecords ?? 0) > 1_000
  ) {
    return 'BULK_BATCH_JOB';
  }

  return 'CLAIMS_REVIEW';
}
