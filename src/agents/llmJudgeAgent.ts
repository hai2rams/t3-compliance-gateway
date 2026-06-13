import type { FinalAgentState, InferredIntent } from '../schemas/agentIntakeSchema.js';
import type { ComplianceDecision } from '../schemas/complianceCheckSchema.js';
import { isPolicyBlocked, requiresHumanReview } from '../config/riskPolicy.js';

export type LlmJudgeResult = {
  verdict: FinalAgentState;
  summary: string;
  policyAligned: boolean;
  requiresHumanVerification: boolean;
};

export function runLlmJudgeAgent(
  intent: InferredIntent,
  policyDecision: ComplianceDecision,
  riskScore: number,
  privateDataDetected: boolean,
  trustFailed: boolean,
): LlmJudgeResult {
  if (intent === 'CREDIT_KYC_PRECHECK' && privateDataDetected) {
    return {
      verdict: 'AUTO_HOLD_REVIEW_REQUIRED',
      summary:
        'Review hold required — sensitive KYC identity and financial documents need governance verification.',
      policyAligned: true,
      requiresHumanVerification: true,
    };
  }

  if (isPolicyBlocked(riskScore, policyDecision, intent) || policyDecision === 'DENY') {
    return {
      verdict: 'AUTO_BLOCKED_BY_POLICY',
      summary: 'Blocked by policy engine — no execution permitted.',
      policyAligned: true,
      requiresHumanVerification: false,
    };
  }

  if (
    intent === 'CREDIT_KYC_PRECHECK' ||
    requiresHumanReview(intent, riskScore) ||
    policyDecision === 'REVIEW' ||
    trustFailed
  ) {
    return {
      verdict: 'AUTO_HOLD_REVIEW_REQUIRED',
      summary:
        'Review hold required — regulated case needs governance verification before business action.',
      policyAligned: true,
      requiresHumanVerification: true,
    };
  }

  if (policyDecision === 'ALLOW' && !privateDataDetected) {
    return {
      verdict: 'EXECUTION_QUEUED',
      summary: 'Policy approved — execution may be queued after governance checks.',
      policyAligned: true,
      requiresHumanVerification: false,
    };
  }

  if (policyDecision === 'ALLOW') {
    return {
      verdict: 'AUTO_EXECUTION_APPROVED',
      summary: 'Auto execution approved with data boundary protections in place.',
      policyAligned: true,
      requiresHumanVerification: false,
    };
  }

  return {
    verdict: 'AUTO_HOLD_REVIEW_REQUIRED',
    summary: 'Default hold — regulated case requires reviewer sign-off.',
    policyAligned: true,
    requiresHumanVerification: true,
  };
}
