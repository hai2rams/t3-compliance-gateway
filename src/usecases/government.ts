import type {
  ComplianceCheckRequest,
  ComplianceDecision,
  SensitiveDataResult,
} from '../schemas/complianceCheckSchema.js';

export function evaluateGovernmentPolicy(
  request: ComplianceCheckRequest,
  riskScore: number,
  sensitiveData: SensitiveDataResult,
): { decision: ComplianceDecision; policyId: string; reasoning: string } {
  if (request.actionType === 'benefit_eligibility' || request.purpose.toLowerCase().includes('benefit')) {
    return {
      decision: 'REVIEW',
      policyId: 'GOV-BENEFIT-ELIGIBILITY-001',
      reasoning:
        'Benefit eligibility decisions require human review and citizen identity verification.',
    };
  }

  if (request.externalSharing) {
    return {
      decision: 'DENY',
      policyId: 'GOV-EXPORT-BLOCK-002',
      reasoning: 'Government citizen data cannot be shared externally without statutory authority.',
    };
  }

  if (sensitiveData.types.includes('CITIZEN_ID')) {
    return {
      decision: 'REVIEW',
      policyId: 'GOV-CITIZEN-ID-003',
      reasoning: 'Citizen identifier detected; eligibility workflow requires supervised review.',
    };
  }

  if (riskScore >= 60) {
    return {
      decision: 'REVIEW',
      policyId: 'GOV-RISK-REVIEW-004',
      reasoning: `Government services risk score ${riskScore} triggers mandatory review.`,
    };
  }

  return {
    decision: 'ALLOW',
    policyId: 'GOV-STANDARD-ALLOW-005',
    reasoning: 'Government action within standard public-sector compliance thresholds.',
  };
}
