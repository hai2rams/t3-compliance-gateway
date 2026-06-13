export const LLM_JUDGE_PROMPT = `Validate the regulated intake recommendation.
Return one final agent state:
AUTO_EXECUTION_APPROVED — policy allows planned execution
AUTO_HOLD_REVIEW_REQUIRED — human review required (e.g. KYC/credit)
AUTO_BLOCKED_BY_POLICY — denied by policy or data boundary
EXECUTION_QUEUED — approved and queued for runtime executor
AI does not approve loans. Credit/KYC cases require governance verification.`;
