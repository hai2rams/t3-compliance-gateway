import type {
  ComplianceCheckRequest,
  ComplianceCheckResponse,
} from '../schemas/complianceCheckSchema.js';
import { verifyAgentTrust } from '../adapters/terminal3Adapter.js';
import { routeModel } from '../adapters/tokenRouterAdapter.js';
import { runLlmReasoning } from '../adapters/geminiAdapter.js';
import { scanDocument } from '../adapters/senseNovaAdapter.js';
import { scanSensitiveData } from './sensitiveDataFilter.js';
import { calculateRiskScore } from './riskScoring.js';
import { evaluatePolicy } from './policyEngine.js';
import { createAuditId } from './auditLog.js';
import { classifyWorkflow } from './workflowClassifier.js';
import { routeRuntimeExecution } from './runtimeRouter.js';

export async function runComplianceCheck(
  request: ComplianceCheckRequest,
): Promise<ComplianceCheckResponse> {
  const workflow = classifyWorkflow(request);
  const enrichedRequest: ComplianceCheckRequest = {
    ...request,
    workflowType: workflow.workflowType,
  };

  const sensitiveData = scanSensitiveData(enrichedRequest.content, enrichedRequest.containsPii);
  const riskScore = calculateRiskScore(enrichedRequest, sensitiveData);
  const policy = evaluatePolicy(enrichedRequest, riskScore, sensitiveData);
  const route = routeModel({
    decision: policy.decision,
    riskScore,
    toolRequested: enrichedRequest.toolRequested,
    dataSensitivity: enrichedRequest.dataSensitivity,
    workflowType: workflow.workflowType,
  });

  const [trust, llm] = await Promise.all([
    verifyAgentTrust({
      agentId: enrichedRequest.agentId,
      actionType: enrichedRequest.actionType,
      purpose: enrichedRequest.purpose,
    }),
    runLlmReasoning({
      content: enrichedRequest.content,
      purpose: enrichedRequest.purpose,
      decision: policy.decision,
      route,
      needsVideo: enrichedRequest.needsVideo,
    }),
  ]);

  const { kimi, senseNova, gemini, llmProvider } = llm;

  if (workflow.workflowType === 'CLAIMS_REVIEW') {
    scanDocument(enrichedRequest.content);
  }

  const auditId = createAuditId();

  let reasoning = policy.reasoning;
  if (workflow.hints.length) {
    reasoning = `${reasoning} | Workflow: ${workflow.label} (${workflow.hints.join(', ')})`;
  }
  if (kimi.status !== 'SKIPPED') {
    reasoning = `${reasoning} | Kimi: ${kimi.summary}`;
  } else if (senseNova && senseNova.status !== 'SKIPPED' && senseNova.status !== 'UNAVAILABLE') {
    reasoning = `${reasoning} | SenseNova: ${senseNova.summary}`;
  } else if (gemini && gemini.status !== 'SKIPPED' && gemini.status !== 'UNAVAILABLE') {
    reasoning = `${reasoning} | Gemini: ${gemini.summary}`;
  }
  if (trust.status === 'FAILED') {
    reasoning = `${reasoning} | Terminal 3 trust verification failed — escalated to REVIEW.`;
  }

  let decision = policy.decision;
  if (trust.status === 'FAILED' && decision === 'ALLOW') {
    decision = 'REVIEW';
  }

  const runtime = routeRuntimeExecution(
    decision,
    workflow.workflowType,
    enrichedRequest,
    auditId,
  );

  const sponsorTools = [
    'Terminal3',
    'TokenRouter',
    'Kimi',
    'SenseNova',
    'Gemini',
    'Daytona',
    'Nosana',
    'VideoDB',
  ];

  return {
    workflowType: workflow.workflowType,
    workflowLabel: workflow.label,
    decision,
    riskScore,
    policyId: policy.policyId,
    reasoning,
    sensitiveData,
    route,
    llmProvider,
    trust,
    kimi,
    ...(senseNova ? { senseNova } : {}),
    ...(gemini ? { gemini } : {}),
    runtime,
    sponsorTools,
    auditId,
    timestamp: new Date().toISOString(),
  };
}
