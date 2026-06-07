import type { AuditResult } from './compliance.js';

export interface AuditTrace extends AuditResult {
  timestamp: string;
  amount: number;
  rawText: string;
}

const auditLedger: AuditTrace[] = [];

export function recordAuditTrace(
  rawText: string,
  amount: number,
  result: AuditResult,
): AuditTrace {
  const trace: AuditTrace = {
    ...result,
    timestamp: new Date().toISOString(),
    amount,
    rawText,
  };
  auditLedger.push(trace);
  return trace;
}

export function getAuditTelemetry() {
  const totalProcessed = auditLedger.length;
  const totalApproved = auditLedger.filter((entry) => entry.passed).length;
  const totalRejected = auditLedger.filter((entry) => !entry.passed).length;
  const caughtByDeterministic = auditLedger.filter(
    (entry) => entry.triggeredLayer === 'DETERMINISTIC',
  ).length;
  const caughtBySemantic = auditLedger.filter(
    (entry) => entry.triggeredLayer === 'SEMANTIC' && !entry.passed,
  ).length;
  const failSecure = auditLedger.filter(
    (entry) => entry.triggeredLayer === 'FAIL_SECURE',
  ).length;

  return {
    status: 'success',
    timestamp: new Date().toISOString(),
    telemetry: {
      totalProcessed,
      totalApproved,
      totalRejected,
      caughtByDeterministic,
      caughtBySemantic,
      failSecure,
      estimatedApiCostSaved: `$${(caughtByDeterministic * 0.15).toFixed(2)}`,
      recentIncidents: auditLedger.slice(-5),
    },
  };
}
