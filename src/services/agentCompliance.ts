import type {
  ComplianceCheckRequest,
  ComplianceCheckResponse,
} from '../schemas/complianceCheckSchema.js';
import { verifyAgentTrust } from '../adapters/terminal3Adapter.js';
import { routeModel } from '../adapters/tokenRouterAdapter.js';
import { runKimiReasoning } from '../adapters/kimiAdapter.js';
import { provisionSandbox } from '../adapters/daytonaAdapter.js';
import { queueGpuJob } from '../adapters/nosanaAdapter.js';
import { scanDocument } from '../adapters/senseNovaAdapter.js';
import { indexAuditClip } from '../adapters/videoDbAdapter.js';
import { scanSensitiveData } from './sensitiveDataFilter.js';
import { calculateRiskScore } from './riskScoring.js';
import { evaluatePolicy } from './policyEngine.js';
import { createAuditId } from './auditLog.js';

export async function runComplianceCheck(
  request: ComplianceCheckRequest,
): Promise<ComplianceCheckResponse> {
  const sensitiveData = scanSensitiveData(request.content, request.containsPii);
  const riskScore = calculateRiskScore(request, sensitiveData);
  const policy = evaluatePolicy(request, riskScore, sensitiveData);
  const route = routeModel({
    decision: policy.decision,
    riskScore,
    toolRequested: request.toolRequested,
    dataSensitivity: request.dataSensitivity,
  });

  const [trust, kimi] = await Promise.all([
    verifyAgentTrust({
      agentId: request.agentId,
      actionType: request.actionType,
      purpose: request.purpose,
    }),
    runKimiReasoning({
      content: request.content,
      purpose: request.purpose,
      decision: policy.decision,
      route,
    }),
  ]);

  // Sponsor adapters invoked for audit trail (mock-safe)
  provisionSandbox(request.agentId);
  queueGpuJob(request.toolRequested);
  scanDocument(request.content);

  const auditId = createAuditId();
  indexAuditClip(auditId);

  let reasoning = policy.reasoning;
  if (kimi.status !== 'SKIPPED') {
    reasoning = `${policy.reasoning} | Kimi: ${kimi.summary}`;
  }
  if (trust.status === 'FAILED') {
    reasoning = `${reasoning} | Terminal 3 trust verification failed — escalated to REVIEW.`;
  }

  let decision = policy.decision;
  if (trust.status === 'FAILED' && decision === 'ALLOW') {
    decision = 'REVIEW';
  }

  const sponsorTools = [
    'Terminal3',
    'TokenRouter',
    'Kimi',
    'Daytona',
    'Nosana',
    'SenseNova',
    'VideoDB',
  ];

  return {
    decision,
    riskScore,
    policyId: policy.policyId,
    reasoning,
    sensitiveData,
    route,
    trust,
    kimi,
    sponsorTools,
    auditId,
    timestamp: new Date().toISOString(),
  };
}
