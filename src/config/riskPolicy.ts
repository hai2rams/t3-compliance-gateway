import { getGovernedIntentPolicy } from './companyPolicy.js';

export const RISK_POLICY = {
  autoHoldAboveRiskScore: 50,
  autoBlockAboveRiskScore: 85,
  kycReviewRequired: true,
  batchAllowAnonymized: true,
  externalPiiExportBlocked: true,
};

export function requiresHumanReview(intent: string, riskScore: number): boolean {
  const governed = getGovernedIntentPolicy(intent);
  if (governed?.holdOnSensitiveData) return true;
  if (intent === 'VENDOR_ONBOARDING' && riskScore >= 40) return true;
  if (riskScore >= RISK_POLICY.autoHoldAboveRiskScore) return true;
  return false;
}

export function isPolicyBlocked(riskScore: number, policyDecision: string, intent?: string): boolean {
  if (policyDecision === 'DENY') return true;
  if (intent === 'CREDIT_KYC_PRECHECK' || intent === 'VENDOR_ONBOARDING') return false;
  if (riskScore >= RISK_POLICY.autoBlockAboveRiskScore) return true;
  return false;
}
