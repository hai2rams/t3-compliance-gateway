import type { AgentIntakeRequest, AgentIntakeResponse } from '../schemas/agentIntakeSchema.js';

export type AgentIntakeAuditEntry = AgentIntakeResponse & {
  request: AgentIntakeRequest;
};

const agentIntakeAuditLog: AgentIntakeAuditEntry[] = [];

export function recordAgentIntake(
  request: AgentIntakeRequest,
  response: AgentIntakeResponse,
): AgentIntakeAuditEntry {
  const entry: AgentIntakeAuditEntry = { ...response, request };
  agentIntakeAuditLog.unshift(entry);
  if (agentIntakeAuditLog.length > 100) {
    agentIntakeAuditLog.length = 100;
  }
  return entry;
}

export function getAgentIntakeAuditLog(): AgentIntakeAuditEntry[] {
  return [...agentIntakeAuditLog];
}
