import type {
  ComplianceCheckRequest,
  ComplianceDecision,
  SensitiveDataResult,
} from '../schemas/complianceCheckSchema.js';

export function evaluateProcurementPolicy(
  request: ComplianceCheckRequest,
  riskScore: number,
  sensitiveData: SensitiveDataResult,
): { decision: ComplianceDecision; policyId: string; reasoning: string } {
  if (
    request.actionType === 'payment_approval' &&
    request.amount >= 5_000
  ) {
    if (request.amount >= 25_000 || riskScore >= 75) {
      return {
        decision: 'DENY',
        policyId: 'PROC-HIGH-VALUE-DENY-001',
        reasoning: `Procurement payment of $${request.amount.toLocaleString()} exceeds auto-approval ceiling; denied pending board review.`,
      };
    }
    return {
      decision: 'REVIEW',
      policyId: 'PROC-HIGH-VALUE-REVIEW-002',
      reasoning: `High-value procurement payment ($${request.amount.toLocaleString()}) requires dual approval.`,
    };
  }

  if (request.amount > 500 && sensitiveData.detected) {
    return {
      decision: 'REVIEW',
      policyId: 'PROC-SENSITIVE-PAYMENT-003',
      reasoning: 'Procurement payment with sensitive vendor data requires compliance review.',
    };
  }

  if (riskScore >= 65) {
    return {
      decision: 'REVIEW',
      policyId: 'PROC-RISK-REVIEW-004',
      reasoning: `Procurement risk score ${riskScore} requires sourcing committee review.`,
    };
  }

  return {
    decision: 'ALLOW',
    policyId: 'PROC-STANDARD-ALLOW-005',
    reasoning: 'Procurement action within standard approval limits.',
  };
}
