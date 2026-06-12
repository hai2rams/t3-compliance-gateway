import type { ComplianceCheckRequest, ComplianceCheckResponse } from '../schemas/complianceCheckSchema.js';

export type ComplianceAuditEntry = ComplianceCheckResponse & {
  request: ComplianceCheckRequest;
};

const complianceAuditLog: ComplianceAuditEntry[] = [];

export function recordComplianceCheck(
  request: ComplianceCheckRequest,
  response: ComplianceCheckResponse,
): ComplianceAuditEntry {
  const entry: ComplianceAuditEntry = { ...response, request };
  complianceAuditLog.unshift(entry);
  if (complianceAuditLog.length > 100) {
    complianceAuditLog.length = 100;
  }
  return entry;
}

export function getComplianceAuditLog(): ComplianceAuditEntry[] {
  return [...complianceAuditLog];
}

export function createAuditId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
