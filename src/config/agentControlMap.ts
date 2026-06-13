import { ALLOWED_GOVERNED_INTENTS, isGovernedIntent } from './companyPolicy.js';

export type AgentRole = 'regulated-intake-agent' | 'token-router-agent' | 'llm-judge-agent' | 'executor-agent';

export type AgentControl = {
  role: AgentRole;
  allowedIntents: string[];
  maxRiskScore: number;
  requiresT3Passport: boolean;
};

const REGULATED_INTAKE_CONTROL: AgentControl = {
  role: 'regulated-intake-agent',
  allowedIntents: [...ALLOWED_GOVERNED_INTENTS],
  maxRiskScore: 100,
  requiresT3Passport: true,
};

export const AGENT_CONTROL_MAP: Record<string, AgentControl> = {
  'regulated-intake-agent': REGULATED_INTAKE_CONTROL,
  'loan-officer-agent': REGULATED_INTAKE_CONTROL,
  'credit-kyc-agent': REGULATED_INTAKE_CONTROL,
};

export function getAgentControl(agentId: string): AgentControl {
  return AGENT_CONTROL_MAP[agentId] ?? REGULATED_INTAKE_CONTROL;
}

export function isIntentAllowedForAgent(agentId: string, intent: string): boolean {
  const control = getAgentControl(agentId);
  if (control.allowedIntents.includes(intent)) return true;
  return isGovernedIntent(intent);
}
