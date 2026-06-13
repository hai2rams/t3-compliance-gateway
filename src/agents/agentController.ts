import type {
  AgentIntakeRequest,
  AgentIntakeResponse,
  AgentTraceStep,
} from '../schemas/agentIntakeSchema.js';
import type { ComplianceCheckRequest } from '../schemas/complianceCheckSchema.js';
import { getAgentControl, isIntentAllowedForAgent } from '../config/agentControlMap.js';
import {
  runRegulatedIntakeAgent,
  buildAgentDataBoundary,
} from './regulatedIntakeAgent.js';
import { runTokenRouterAgent } from './tokenRouterAgent.js';
import { runLlmJudgeAgent } from './llmJudgeAgent.js';
import { AgentTraceBuilder, detectPromptInjection } from './agentTrace.js';
import { runComplianceCheck } from '../services/agentCompliance.js';
import { buildEnrichmentPlan, hintsNeedPublicWeb } from '../services/publicQueryExtractor.js';
import { enrichPublicWeb } from '../adapters/brightDataAdapter.js';
import { verifyAgentTrust } from '../adapters/terminal3Adapter.js';
import { mapIntentToWorkflow, planExecution } from '../services/executionPlanner.js';
import { executeRuntimePlan } from '../execution/runtimeExecutor.js';
import { recordAgentIntake } from '../services/agentAuditLog.js';

function createMissionId(): string {
  return `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toComplianceRequest(
  request: AgentIntakeRequest,
  intake: ReturnType<typeof runRegulatedIntakeAgent>,
): ComplianceCheckRequest {
  const workflowType = mapIntentToWorkflow(intake.inferredIntent);

  return {
    workflowType,
    useCase:
      intake.inferredIntent === 'VIDEO_REVIEW'
        ? 'government'
        : intake.inferredIntent === 'BATCH_RISK_SCAN'
          ? 'finance'
          : 'finance',
    agentId: request.agentId,
    userRole:
      intake.inferredIntent === 'CREDIT_KYC_PRECHECK'
        ? 'loan_officer'
        : intake.inferredIntent === 'BATCH_RISK_SCAN'
          ? 'risk_analyst'
          : 'regulated_agent',
    actionType: intake.inferredIntent,
    dataSensitivity: intake.containsPii ? 'HIGH' : 'MEDIUM',
    toolRequested: toolForIntent(intake.inferredIntent),
    purpose: request.goal,
    content: request.content,
    containsPii: intake.containsPii,
    externalSharing: false,
    amount: intake.amount,
    jobMode: workflowType === 'BULK_BATCH_JOB' ? 'BATCH' : 'INTERACTIVE',
    estimatedRecords: workflowType === 'BULK_BATCH_JOB' ? 20_000 : 1,
    needsGpu: intake.inferredIntent === 'BATCH_RISK_SCAN',
    needsVideo: intake.modalities.includes('VIDEO'),
    needsWebData: intake.modalities.includes('WEB_RESEARCH'),
  };
}

function toolForIntent(intent: string): string {
  switch (intent) {
    case 'CREDIT_KYC_PRECHECK':
      return 'kyc_document_validator';
    case 'BATCH_RISK_SCAN':
      return 'batch_anomaly_detector';
    case 'VIDEO_REVIEW':
      return 'video_analysis';
    case 'PUBLIC_WEB_RESEARCH':
      return 'public_web_enrichment';
    default:
      return 'regulated_intake_processor';
  }
}

function buildBlockedResponse(
  missionId: string,
  request: AgentIntakeRequest,
  intake: ReturnType<typeof runRegulatedIntakeAgent>,
  trace: AgentTraceStep[],
  reason: string,
): AgentIntakeResponse {
  return {
    missionId,
    agentId: request.agentId,
    detectedModality: intake.detectedModality,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    agentTrace: trace,
    tokenRouterDecision: {
      route: 'BLOCKED_BY_POLICY',
      primaryProvider: 'NONE',
      models: ['SKIP_LLM'],
      routeReason: reason,
    },
    agentPassport: { status: 'DENIED', reason },
    dataBoundary: buildAgentDataBoundary(request.content),
    enrichmentPlan: { allowed: false, publicSearchQuery: '', status: 'BLOCKED' },
    llmJudge: { verdict: 'AUTO_BLOCKED_BY_POLICY', summary: reason },
    executionPlan: { status: 'NOT_PLANNED', targetRuntime: 'NONE' },
    finalAgentState: 'AUTO_BLOCKED_BY_POLICY',
    timestamp: new Date().toISOString(),
  };
}

export async function runAgentIntake(request: AgentIntakeRequest): Promise<AgentIntakeResponse> {
  const missionId = createMissionId();
  const agentControl = getAgentControl(request.agentId);
  const trace = new AgentTraceBuilder();

  const intake = runRegulatedIntakeAgent(request);

  trace.add(
    'IntakeAgent',
    'UNDERSTAND_GOAL',
    'COMPLETED',
    `Classified regulated ${intake.inferredIntent.replace(/_/g, ' ').toLowerCase()} case.`,
  );
  trace.add(
    'ModalityAgent',
    'DETECT_MODALITY',
    'COMPLETED',
    `Detected modality: ${intake.detectedModality}.`,
  );
  trace.add(
    'IntakeAgent',
    'SELECT_WORKFLOW',
    'COMPLETED',
    `Selected workflow: ${intake.selectedWorkflow}.`,
  );

  if (detectPromptInjection(request.content)) {
    trace.add(
      'GovernanceAgent',
      'PROMPT_INJECTION_GUARD',
      'BLOCKED',
      'Untrusted override instructions detected in uploaded content.',
    );
    const blocked = buildBlockedResponse(
      missionId,
      request,
      intake,
      trace.build(),
      'Prompt injection guard blocked untrusted content instructions.',
    );
    recordAgentIntake(request, blocked);
    return blocked;
  }

  if (!isIntentAllowedForAgent(request.agentId, intake.inferredIntent)) {
    trace.add(
      'GovernanceAgent',
      'INTENT_CONTROL',
      'BLOCKED',
      'Intent not permitted for this agent identity.',
    );
    const blocked = buildBlockedResponse(
      missionId,
      request,
      intake,
      trace.build(),
      'Intent not in agent control map.',
    );
    recordAgentIntake(request, blocked);
    return blocked;
  }

  const complianceRequest = toComplianceRequest(request, intake);
  const compliance = await runComplianceCheck(complianceRequest);
  trace.add(
    'GovernanceAgent',
    'POLICY_CHECK',
    compliance.decision === 'DENY' ? 'BLOCKED' : compliance.decision === 'REVIEW' ? 'HOLD' : 'COMPLETED',
    `Policy ${compliance.policyId} → ${compliance.decision} (risk ${compliance.riskScore}).`,
  );

  const trust = await verifyAgentTrust({
    agentId: request.agentId,
    actionType: intake.inferredIntent,
    purpose: request.goal,
  });
  trace.add(
    'Terminal3Agent',
    'VERIFY_PASSPORT',
    trust.status === 'FAILED' ? 'HOLD' : 'COMPLETED',
    `Agent passport ${trust.status}.`,
  );

  const tokenRouterDecision = runTokenRouterAgent(
    intake.modalities,
    intake.inferredIntent,
    compliance.decision,
  );
  trace.add(
    'TokenRouterAgent',
    'ROUTE_MODEL',
    tokenRouterDecision.route === 'BLOCKED_BY_POLICY' ? 'BLOCKED' : 'COMPLETED',
    tokenRouterDecision.routeReason,
  );

  const dataBoundary = buildAgentDataBoundary(request.content);
  trace.add(
    'DataBoundaryAgent',
    'PROTECT_PRIVATE_DATA',
    'COMPLETED',
    dataBoundary.detected
      ? `Sensitive types: ${dataBoundary.types.join(', ')}. Private data blocked from external tools.`
      : 'No sensitive data detected.',
  );

  const enrichmentSpec = buildEnrichmentPlan(
    request.content,
    hintsNeedPublicWeb(request),
    dataBoundary.privateBlockedFromExternal,
  );

  const enrichmentResult =
    enrichmentSpec.allowed && enrichmentSpec.publicQuery
      ? enrichPublicWeb(enrichmentSpec.publicQuery)
      : {
          provider: 'BrightData' as const,
          status: 'BLOCKED' as const,
          publicQuery: '',
          findings: [],
          note: enrichmentSpec.blockedReason ?? 'Public enrichment not allowed.',
        };

  trace.add(
    'EnrichmentAgent',
    'PUBLIC_ENRICHMENT',
    enrichmentResult.status === 'BLOCKED' ? 'SKIPPED' : 'COMPLETED',
    enrichmentSpec.publicQuery
      ? `Public-only query: ${enrichmentSpec.publicQuery}`
      : enrichmentResult.note,
  );

  const trustFailed = trust.status === 'FAILED';
  const judge = runLlmJudgeAgent(
    intake.inferredIntent,
    compliance.decision,
    compliance.riskScore,
    dataBoundary.privateBlockedFromExternal,
    trustFailed,
  );
  trace.add(
    'LLMJudgeAgent',
    'VALIDATE_RECOMMENDATION',
    judge.verdict === 'AUTO_BLOCKED_BY_POLICY' ? 'BLOCKED' : judge.verdict === 'AUTO_HOLD_REVIEW_REQUIRED' ? 'HOLD' : 'COMPLETED',
    judge.summary,
  );

  const executionSpec = planExecution(
    intake.inferredIntent,
    mapIntentToWorkflow(intake.inferredIntent),
    judge.verdict,
  );

  const runtime = executeRuntimePlan(judge.verdict, executionSpec, missionId);
  trace.add(
    'ExecutorAgent',
    'PLAN_RUNTIME',
    runtime.executed ? 'COMPLETED' : judge.verdict === 'AUTO_HOLD_REVIEW_REQUIRED' ? 'HOLD' : 'SKIPPED',
    runtime.note,
  );

  const response: AgentIntakeResponse = {
    missionId,
    agentId: request.agentId,
    detectedModality: intake.detectedModality,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    agentTrace: trace.build(),
    tokenRouterDecision: {
      route: tokenRouterDecision.route,
      primaryProvider: tokenRouterDecision.primaryProvider,
      secondaryProviders: tokenRouterDecision.secondaryProviders,
      models: tokenRouterDecision.models,
      routeReason: tokenRouterDecision.routeReason,
      documentReasoningProvider: tokenRouterDecision.documentReasoningProvider,
      judgeReasoningProvider: tokenRouterDecision.judgeReasoningProvider,
      complianceRoute: {
        selectedModel: compliance.route.selectedModel,
        selectedLlmProvider: compliance.route.selectedLlmProvider,
      },
    },
    agentPassport: {
      provider: trust.provider,
      status: trust.status,
      contractMode: trust.contractMode,
      requiresT3Passport: agentControl.requiresT3Passport,
      permissionScope: intake.inferredIntent,
    },
    dataBoundary: {
      detected: dataBoundary.detected,
      types: dataBoundary.types,
      redactedPreview: dataBoundary.redactedPreview,
      blockedFromExternalTools: dataBoundary.privateBlockedFromExternal,
      policy: 'Private data must not be sent to BrightData/MCP or external enrichment.',
    },
    enrichmentPlan: {
      allowed: enrichmentSpec.allowed,
      publicSearchQuery: enrichmentSpec.publicQuery,
      blockedReason: enrichmentSpec.blockedReason,
      privateDataBlocked: dataBoundary.privateBlockedFromExternal,
      brightData: enrichmentResult,
      mcpReady: true,
    },
    llmJudge: {
      verdict: judge.verdict,
      summary: judge.summary,
      policyAligned: judge.policyAligned,
      requiresHumanVerification: judge.requiresHumanVerification,
      kimiStatus: compliance.kimi.status,
      senseNovaStatus: compliance.senseNova?.status,
    },
    executionPlan: {
      targetRuntime: executionSpec.targetRuntime,
      executionMode: executionSpec.executionMode,
      jobClass: executionSpec.jobClass,
      containerImage: executionSpec.containerImage,
      status: executionSpec.status,
      reason: executionSpec.reason,
      executed: runtime.executed,
      runtimeStatus: runtime.status,
    },
    finalAgentState: judge.verdict,
    timestamp: new Date().toISOString(),
  };

  recordAgentIntake(request, response);
  return response;
}

export const DEFAULT_KYC_SAMPLE_REQUEST: AgentIntakeRequest = {
  agentId: 'regulated-intake-agent',
  goal: 'Credit/KYC precheck for loan application',
  content:
    'Customer uploaded passport, salary slip, bank statement, employer name Acme Logistics, and requested loan amount SGD 80,000.',
  hints: {
    hasFile: true,
    hasImage: false,
    hasAudio: false,
    hasVideo: false,
    hasBatch: false,
    needsPublicWeb: true,
  },
};
