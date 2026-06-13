import type {
  ComplianceCheckRequest,
  ComplianceDecision,
  SensitiveDataResult,
  UseCase,
} from '../schemas/complianceCheckSchema.js';
import { evaluateFinancePolicy } from '../usecases/finance.js';
import { evaluateGovernmentPolicy } from '../usecases/government.js';
import { evaluateProcurementPolicy } from '../usecases/procurement.js';

export type PolicyEvaluation = {
  decision: ComplianceDecision;
  policyId: string;
  reasoning: string;
};

type PolicyEvaluator = (
  request: ComplianceCheckRequest,
  riskScore: number,
  sensitiveData: SensitiveDataResult,
) => PolicyEvaluation;

const evaluators: Record<UseCase, PolicyEvaluator> = {
  finance: evaluateFinancePolicy,
  government: evaluateGovernmentPolicy,
  procurement: evaluateProcurementPolicy,
};

export function evaluatePolicy(
  request: ComplianceCheckRequest,
  riskScore: number,
  sensitiveData: SensitiveDataResult,
): PolicyEvaluation {
  const evaluator = evaluators[request.useCase];
  const result = evaluator(request, riskScore, sensitiveData);

  if (request.externalSharing && sensitiveData.detected && result.decision === 'ALLOW') {
    return {
      decision: 'DENY',
      policyId: 'GLOBAL-PII-EXPORT-BLOCK',
      reasoning:
        'External sharing with detected sensitive data is blocked by global export-control policy.',
    };
  }

  if (riskScore >= 85 && result.decision === 'ALLOW') {
    return {
      decision: 'REVIEW',
      policyId: 'GLOBAL-HIGH-RISK-ESCALATION',
      reasoning: `Risk score ${riskScore} exceeds auto-approval threshold; escalated to governance review.`,
    };
  }

  return result;
}
