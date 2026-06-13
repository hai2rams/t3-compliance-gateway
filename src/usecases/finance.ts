import type {
  ComplianceCheckRequest,
  ComplianceDecision,
  SensitiveDataResult,
} from '../schemas/complianceCheckSchema.js';

export function evaluateFinancePolicy(
  request: ComplianceCheckRequest,
  riskScore: number,
  sensitiveData: SensitiveDataResult,
): { decision: ComplianceDecision; policyId: string; reasoning: string } {
  if (request.externalSharing && (request.containsPii || sensitiveData.detected)) {
    return {
      decision: 'DENY',
      policyId: 'FIN-EXPORT-PII-001',
      reasoning:
        'Finance policy blocks external export of PII or sensitive financial identifiers.',
    };
  }

  const authorizedBatchRole =
    request.userRole === 'risk_analyst' || request.userRole === 'admin';
  const batchComputeContext =
    request.jobMode === 'BATCH' ||
    (request.estimatedRecords ?? 0) >= 5_000 ||
    request.needsGpu === true;

  if (
    request.workflowType === 'BULK_BATCH_JOB' &&
    request.actionType === 'BATCH_ANALYSIS' &&
    authorizedBatchRole &&
    !request.containsPii &&
    !request.externalSharing &&
    (request.dataSensitivity === 'LOW' || request.dataSensitivity === 'MEDIUM') &&
    batchComputeContext
  ) {
    return {
      decision: 'ALLOW',
      policyId: 'FIN-BATCH-ANON-ALLOW-001',
      reasoning:
        'Anonymized internal batch analysis is allowed for authorized risk users and can be routed to approved compute.',
    };
  }

  if (
    request.actionType === 'internal_summary' &&
    request.dataSensitivity === 'LOW' &&
    !request.externalSharing
  ) {
    return {
      decision: 'ALLOW',
      policyId: 'FIN-INTERNAL-SUMMARY-010',
      reasoning: 'Low-sensitivity internal finance summary approved for authorized role.',
    };
  }

  if (riskScore >= 70) {
    return {
      decision: 'REVIEW',
      policyId: 'FIN-RISK-REVIEW-020',
      reasoning: `Finance transaction risk score ${riskScore} requires compliance officer review.`,
    };
  }

  if (request.dataSensitivity === 'LOW' && !sensitiveData.detected) {
    return {
      decision: 'ALLOW',
      policyId: 'FIN-GENERAL-ALLOW-030',
      reasoning: 'No sensitive data detected; finance action within standard thresholds.',
    };
  }

  return {
    decision: 'REVIEW',
    policyId: 'FIN-DEFAULT-REVIEW-040',
    reasoning: 'Finance action requires manual review under default policy.',
  };
}
