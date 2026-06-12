import type {
  ComplianceCheckRequest,
  SensitiveDataResult,
} from '../schemas/complianceCheckSchema.js';

const SENSITIVITY_WEIGHT: Record<ComplianceCheckRequest['dataSensitivity'], number> = {
  LOW: 5,
  MEDIUM: 20,
  HIGH: 40,
  CRITICAL: 60,
};

export function calculateRiskScore(
  request: ComplianceCheckRequest,
  sensitiveData: SensitiveDataResult,
): number {
  let score = SENSITIVITY_WEIGHT[request.dataSensitivity];

  if (request.containsPii) score += 15;
  if (sensitiveData.detected) score += sensitiveData.types.length * 8;
  if (request.externalSharing) score += 25;

  if (request.amount > 10_000) score += 30;
  else if (request.amount > 1_000) score += 15;
  else if (request.amount > 500) score += 8;

  if (request.useCase === 'government') score += 10;
  if (request.useCase === 'procurement' && request.amount > 500) score += 12;

  if (request.workflowType === 'BULK_BATCH_JOB') score += 8;
  if (request.workflowType === 'VIDEO_ANALYSIS') score += 12;
  if ((request.estimatedRecords ?? 0) > 10_000) score += 15;
  else if ((request.estimatedRecords ?? 0) > 1_000) score += 8;
  if (request.needsGpu) score += 10;
  if (request.needsVideo) score += 10;
  if (request.needsWebData) score += 12;

  return Math.min(100, Math.max(0, score));
}
