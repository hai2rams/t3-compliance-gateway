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
import { runLlmJudgeAgent } from './llmJudgeAgent.js';
import { AgentTraceBuilder, detectPromptInjection } from './agentTrace.js';
import { runComplianceCheck } from '../services/agentCompliance.js';
import { buildEnrichmentPlan, hintsNeedPublicWeb } from '../services/publicQueryExtractor.js';
import {
  buildEnrichmentPlanFromPublicEnrichment,
  runPublicEnrichment,
} from '../services/publicEnrichmentService.js';
import { verifyAgentTrust } from '../adapters/terminal3Adapter.js';
import { mapIntentToWorkflow, planExecution } from '../services/executionPlanner.js';
import { executeRuntimePlan } from '../execution/runtimeExecutor.js';
import { recordAgentIntake } from '../services/agentAuditLog.js';
import {
  orchestrateAgentTools,
  orchestrateBlockedTools,
} from './agentToolOrchestrator.js';
import {
  buildAgentPassportFromGovernance,
  evaluateAgentGovernance,
} from '../services/t3GovernanceService.js';
import {
  buildDaytonaExecutionPlan,
} from '../services/daytonaExecutionPlanner.js';
import {
  alignExecutionPlanWithRuntime,
  buildNosanaExecutionPlan,
} from '../services/nosanaExecutionPlanner.js';
import {
  buildTokenRouterDecisionFromModelRouting,
  routeModelForAgentTask,
} from '../services/modelRoutingService.js';

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

function deriveRequestedExternalTools(
  enrichmentAllowed: boolean,
  modelRoute: string,
): string[] {
  const tools: string[] = [];
  if (enrichmentAllowed || modelRoute === 'WEB_RESEARCH' || modelRoute === 'WEB_RESEARCH_SUMMARY') {
    tools.push('BrightData/MCP');
  }
  if (modelRoute !== 'SKIP_LLM' && modelRoute !== 'BLOCKED_BY_POLICY') {
    tools.push('Kimi', 'SenseNova');
  }
  return tools;
}

async function buildBlockedResponse(
  missionId: string,
  request: AgentIntakeRequest,
  intake: ReturnType<typeof runRegulatedIntakeAgent>,
  trace: AgentTraceStep[],
  reason: string,
  options: { promptInjectionBlocked?: boolean; intentControlBlocked?: boolean } = {},
): Promise<AgentIntakeResponse> {
  const dataBoundary = buildAgentDataBoundary(request.content);
  const policyId = options.promptInjectionBlocked
    ? 'PROMPT-INJECTION-GUARD'
    : 'INTENT-CONTROL-BLOCK';

  const t3Governance = await evaluateAgentGovernance({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    dataSensitivity: intake.containsPii ? 'HIGH' : 'MEDIUM',
    sensitiveDataDetected: dataBoundary.detected,
    detectedSensitiveTypes: dataBoundary.types,
    requestedExternalTools: [],
    requestedRuntime: 'NONE',
    finalAgentState: 'AUTO_BLOCKED_BY_POLICY',
    executionPlan: { status: 'NOT_PLANNED', targetRuntime: 'NONE' },
    policyId,
    publicEnrichmentAllowed: false,
    purpose: request.goal,
    trust: { provider: 'Terminal 3', status: 'FAILED', contractMode: 'TEE_COMPLIANCE_GATEWAY' },
  });

  const publicEnrichment = runPublicEnrichment({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    content: request.content,
    dataBoundary,
    publicSearchQuery: '',
    enrichmentAllowed: false,
    enrichmentBlockedReason: reason,
    privateDataBlockedFromExternalTools: dataBoundary.privateBlockedFromExternal,
    t3Governance,
    finalAgentState: 'AUTO_BLOCKED_BY_POLICY',
    promptInjectionBlocked: Boolean(options.promptInjectionBlocked),
  });

  const modelRouting = routeModelForAgentTask({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    detectedModality: intake.detectedModality,
    modalities: intake.modalities,
    riskScore: 100,
    sensitiveDataDetected: dataBoundary.detected,
    dataBoundary,
    requestedTask: 'agent_intake',
    finalAgentState: 'AUTO_BLOCKED_BY_POLICY',
    policyDecision: 'DENY',
    promptInjectionBlocked: Boolean(options.promptInjectionBlocked),
    intentControlBlocked: Boolean(options.intentControlBlocked),
    kimiStatus: 'SKIPPED',
    senseNovaStatus: 'SKIPPED',
  });

  const tokenRouterDecision = buildTokenRouterDecisionFromModelRouting(modelRouting);

  const blockedExecutionBase = { status: 'NOT_PLANNED', targetRuntime: 'NONE' };
  const daytonaExecution = buildDaytonaExecutionPlan({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    finalAgentState: 'AUTO_BLOCKED_BY_POLICY',
    t3Governance,
    dataBoundary,
    sensitiveDataDetected: dataBoundary.detected,
    detectedSensitiveTypes: dataBoundary.types,
    executionPlan: blockedExecutionBase,
    policyId,
    promptInjectionBlocked: Boolean(options.promptInjectionBlocked),
    intentControlBlocked: Boolean(options.intentControlBlocked),
  });

  const nosanaExecution = buildNosanaExecutionPlan({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    finalAgentState: 'AUTO_BLOCKED_BY_POLICY',
    dataBoundary,
    sensitiveDataDetected: dataBoundary.detected,
    detectedSensitiveTypes: dataBoundary.types,
    estimatedRecords: intake.inferredIntent === 'BATCH_RISK_SCAN' ? 20_000 : 0,
    needsGpu: intake.inferredIntent === 'BATCH_RISK_SCAN',
    policyId,
    executionPlan: blockedExecutionBase,
    promptInjectionBlocked: Boolean(options.promptInjectionBlocked),
    intentControlBlocked: Boolean(options.intentControlBlocked),
  });

  const toolOrchestration = orchestrateBlockedTools(missionId, {
    intent: intake.inferredIntent,
    modalities: intake.modalities,
    promptInjectionBlocked: Boolean(options.promptInjectionBlocked),
    intentControlBlocked: Boolean(options.intentControlBlocked),
    blockReason: reason,
    trust: { status: 'FAILED', provider: 'Terminal 3' },
    tokenRouterDecision,
    modelRouting,
    dataBoundary,
    enrichmentAllowed: false,
    publicSearchQuery: '',
    publicEnrichment,
    daytonaExecution,
    nosanaExecution,
    t3Governance,
  });

  const agentControl = getAgentControl(request.agentId);

  return {
    missionId,
    agentId: request.agentId,
    detectedModality: intake.detectedModality,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    agentTrace: trace,
    tokenRouterDecision: {
      route: tokenRouterDecision.route,
      primaryProvider: tokenRouterDecision.primaryProvider,
      secondaryProviders: tokenRouterDecision.secondaryProviders,
      models: tokenRouterDecision.models,
      routeReason: tokenRouterDecision.routeReason,
      documentReasoningProvider: tokenRouterDecision.documentReasoningProvider,
      judgeReasoningProvider: tokenRouterDecision.judgeReasoningProvider,
    },
    modelRouting,
    agentPassport: buildAgentPassportFromGovernance(t3Governance, agentControl.requiresT3Passport),
    dataBoundary,
    enrichmentPlan: buildEnrichmentPlanFromPublicEnrichment(publicEnrichment),
    publicEnrichment,
    llmJudge: { verdict: 'AUTO_BLOCKED_BY_POLICY', summary: reason },
    executionPlan: alignExecutionPlanWithRuntime(
      blockedExecutionBase,
      daytonaExecution,
      nosanaExecution,
    ),
    daytonaExecution,
    nosanaExecution,
    toolOrchestration,
    t3Governance,
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
    const blocked = await buildBlockedResponse(
      missionId,
      request,
      intake,
      trace.build(),
      'Prompt injection guard blocked untrusted content instructions.',
      { promptInjectionBlocked: true },
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
    const blocked = await buildBlockedResponse(
      missionId,
      request,
      intake,
      trace.build(),
      'Intent not in agent control map.',
      { intentControlBlocked: true },
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

  const modelRouting = routeModelForAgentTask({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    detectedModality: intake.detectedModality,
    modalities: intake.modalities,
    riskScore: compliance.riskScore,
    sensitiveDataDetected: dataBoundary.detected,
    dataBoundary,
    requestedTask: 'agent_intake',
    finalAgentState: judge.verdict,
    policyDecision: compliance.decision,
    kimiStatus: compliance.kimi.status,
    senseNovaStatus: compliance.senseNova?.status,
    geminiStatus: compliance.gemini?.status,
  });

  const tokenRouterDecision = buildTokenRouterDecisionFromModelRouting(modelRouting);

  trace.add(
    'TokenRouterAgent',
    'ROUTE_MODEL',
    modelRouting.route === 'SKIP_LLM' ? 'BLOCKED' : 'COMPLETED',
    modelRouting.routeReason,
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

  const executionPlanPayload = {
    targetRuntime: executionSpec.targetRuntime,
    executionMode: executionSpec.executionMode,
    jobClass: executionSpec.jobClass,
    containerImage: executionSpec.containerImage,
    status: executionSpec.status,
    reason: executionSpec.reason,
    executed: runtime.executed,
    runtimeStatus: runtime.status,
  };

  const t3Governance = await evaluateAgentGovernance({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    dataSensitivity: intake.containsPii ? 'HIGH' : 'MEDIUM',
    sensitiveDataDetected: dataBoundary.detected,
    detectedSensitiveTypes: dataBoundary.types,
    requestedExternalTools: deriveRequestedExternalTools(
      enrichmentSpec.allowed,
      modelRouting.route,
    ),
    requestedRuntime: executionSpec.targetRuntime,
    finalAgentState: judge.verdict,
    executionPlan: executionPlanPayload,
    policyId: compliance.policyId,
    publicEnrichmentAllowed: enrichmentSpec.allowed && Boolean(enrichmentSpec.publicQuery),
    purpose: request.goal,
    trust,
  });

  trace.add(
    'Terminal3Agent',
    'GOVERNANCE_PROOF',
    t3Governance.governanceDecision === 'BLOCK_EXECUTION'
      ? 'BLOCKED'
      : t3Governance.governanceDecision === 'HOLD_FOR_REVIEW'
        ? 'HOLD'
        : 'COMPLETED',
    t3Governance.auditSummary,
  );

  const daytonaExecution = buildDaytonaExecutionPlan({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    finalAgentState: judge.verdict,
    t3Governance,
    dataBoundary,
    sensitiveDataDetected: dataBoundary.detected,
    detectedSensitiveTypes: dataBoundary.types,
    executionPlan: executionPlanPayload,
    policyId: compliance.policyId,
  });

  const nosanaExecution = buildNosanaExecutionPlan({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    finalAgentState: judge.verdict,
    dataBoundary,
    sensitiveDataDetected: dataBoundary.detected,
    detectedSensitiveTypes: dataBoundary.types,
    estimatedRecords:
      mapIntentToWorkflow(intake.inferredIntent) === 'BULK_BATCH_JOB' ? 20_000 : 0,
    needsGpu: intake.inferredIntent === 'BATCH_RISK_SCAN',
    policyId: compliance.policyId,
    executionPlan: executionPlanPayload,
  });

  const executionPlanFinal = alignExecutionPlanWithRuntime(
    executionPlanPayload,
    daytonaExecution,
    nosanaExecution,
  );

  const publicEnrichment = runPublicEnrichment({
    missionId,
    agentId: request.agentId,
    inferredIntent: intake.inferredIntent,
    selectedWorkflow: intake.selectedWorkflow,
    content: request.content,
    dataBoundary,
    publicSearchQuery: enrichmentSpec.publicQuery,
    enrichmentAllowed: enrichmentSpec.allowed,
    enrichmentBlockedReason: enrichmentSpec.blockedReason,
    privateDataBlockedFromExternalTools: dataBoundary.privateBlockedFromExternal,
    t3Governance,
    finalAgentState: judge.verdict,
  });

  trace.add(
    'EnrichmentAgent',
    'PUBLIC_ENRICHMENT',
    publicEnrichment.status === 'BLOCKED' || publicEnrichment.status === 'SKIPPED'
      ? 'SKIPPED'
      : 'COMPLETED',
    publicEnrichment.publicSearchQuery
      ? `${publicEnrichment.mode} ${publicEnrichment.status}: ${publicEnrichment.publicSearchQuery}`
      : publicEnrichment.reason,
  );

  const toolOrchestration = orchestrateAgentTools({
    missionId,
    intent: intake.inferredIntent,
    modalities: intake.modalities,
    finalAgentState: judge.verdict,
    promptInjectionBlocked: false,
    intentControlBlocked: false,
    trust,
    tokenRouterDecision,
    modelRouting,
    dataBoundary,
    enrichmentAllowed: enrichmentSpec.allowed,
    publicSearchQuery: enrichmentSpec.publicQuery,
    publicEnrichment,
    kimiStatus: compliance.kimi.status,
    senseNovaStatus: compliance.senseNova?.status,
    judge,
    executionSpec,
    runtime,
    t3Governance,
    daytonaExecution,
    nosanaExecution,
  });

  trace.add(
    'ToolOrchestratorAgent',
    'COMPOSE_TOOL_CHAIN',
    judge.verdict === 'AUTO_BLOCKED_BY_POLICY' ? 'BLOCKED' : 'COMPLETED',
    toolOrchestration.nextToolAction,
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
    modelRouting,
    agentPassport: buildAgentPassportFromGovernance(t3Governance, agentControl.requiresT3Passport),
    dataBoundary: {
      detected: dataBoundary.detected,
      types: dataBoundary.types,
      redactedPreview: dataBoundary.redactedPreview,
      blockedFromExternalTools: dataBoundary.privateBlockedFromExternal,
      policy: 'Private data must not be sent to BrightData/MCP or external enrichment.',
    },
    enrichmentPlan: buildEnrichmentPlanFromPublicEnrichment(publicEnrichment),
    publicEnrichment,
    llmJudge: {
      verdict: judge.verdict,
      summary: judge.summary,
      policyAligned: judge.policyAligned,
      requiresHumanVerification: judge.requiresHumanVerification,
      kimiStatus: compliance.kimi.status,
      senseNovaStatus: compliance.senseNova?.status,
    },
    executionPlan: executionPlanFinal,
    daytonaExecution,
    nosanaExecution,
    toolOrchestration,
    t3Governance,
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
