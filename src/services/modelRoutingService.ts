import type {
  FinalAgentState,
  InferredIntent,
  Modality,
  ModelRouting,
  ModelRoutingModelStatus,
  ModelRoutingRoute,
} from '../schemas/agentIntakeSchema.js';
import type { ComplianceDecision } from '../schemas/complianceCheckSchema.js';
import type { TokenRouterAgentDecision } from '../agents/tokenRouterAgent.js';
import { runTokenRouterAgent } from '../agents/tokenRouterAgent.js';
import { isGlobalMockMode, isAdapterMocked } from '../config/toolCapabilityMap.js';
import type { ToolChainStatus } from '../config/toolCapabilityMap.js';

export type ModelRoutingInput = {
  missionId: string;
  agentId: string;
  inferredIntent: InferredIntent;
  detectedModality: string;
  modalities: Modality[];
  riskScore: number;
  sensitiveDataDetected: boolean;
  dataBoundary: {
    detected: boolean;
    types: string[];
    privateBlockedFromExternal: boolean;
  };
  requestedTask: string;
  finalAgentState: FinalAgentState;
  policyDecision: ComplianceDecision;
  promptInjectionBlocked?: boolean;
  intentControlBlocked?: boolean;
  kimiStatus?: string;
  senseNovaStatus?: string;
  geminiStatus?: string;
};

function canUseLiveTokenRouter(): boolean {
  if (isGlobalMockMode()) return false;
  return Boolean(process.env.TOKENROUTER_API_KEY?.trim());
}

function resolveKimiModelStatus(kimiStatus?: string): ModelRoutingModelStatus {
  if (kimiStatus === 'COMPLETED') return 'LIVE';
  if (kimiStatus === 'MOCK_COMPLETED') return 'MOCKED';
  if (kimiStatus === 'SKIPPED') return 'SKIPPED';
  if (isAdapterMocked('KIMI_API_KEY')) return 'MOCKED';
  return 'PLANNED';
}

function resolveSenseNovaModelStatus(
  senseNovaStatus: string | undefined,
  selected: boolean,
): ModelRoutingModelStatus {
  if (!selected) return 'SKIPPED';
  if (senseNovaStatus === 'COMPLETED' || senseNovaStatus === 'SCANNED') return 'LIVE';
  if (senseNovaStatus === 'MOCK_COMPLETED' || senseNovaStatus === 'MOCK_SCANNED') {
    return 'MOCKED';
  }
  if (senseNovaStatus === 'SKIPPED' || senseNovaStatus === 'UNAVAILABLE') return 'SKIPPED';
  if (isAdapterMocked('SENSENOVA_API_KEY')) return 'MOCKED';
  return 'PLANNED';
}

function normalizeRoute(
  decision: TokenRouterAgentDecision,
  intent: InferredIntent,
  modalities: Modality[],
): ModelRoutingRoute {
  if (decision.route === 'BLOCKED_BY_POLICY' || decision.models.includes('SKIP_LLM')) {
    return 'SKIP_LLM';
  }
  if (intent === 'BATCH_RISK_SCAN') return 'BATCH_RISK_REASONING';
  if (decision.route === 'DOCUMENT_KYC_REVIEW') return 'DOCUMENT_KYC_REVIEW';
  if (decision.route === 'DOCUMENT_MULTIMODAL') return 'MULTIMODAL_REVIEW';
  if (decision.route === 'WEB_RESEARCH') return 'WEB_RESEARCH_SUMMARY';
  if (decision.route === 'VIDEO_AUDIO' || intent === 'VIDEO_REVIEW') return 'VIDEO_REVIEW';
  if (modalities.includes('DOCUMENT') || modalities.includes('IMAGE')) {
    return intent === 'CREDIT_KYC_PRECHECK' ? 'DOCUMENT_KYC_REVIEW' : 'MULTIMODAL_REVIEW';
  }
  return 'TEXT_REASONING';
}

function resolveRoutePurpose(
  route: ModelRoutingRoute,
  requestedTask: string,
): ModelRouting['routePurpose'] {
  if (route === 'SKIP_LLM') return 'skipped';
  if (route === 'DOCUMENT_KYC_REVIEW') {
    return 'document_reasoning + risk_reasoning + judge';
  }
  if (requestedTask === 'judge') return 'judge';
  if (route === 'WEB_RESEARCH_SUMMARY') return 'summary';
  if (route === 'BATCH_RISK_REASONING') return 'risk_reasoning';
  if (route === 'MULTIMODAL_REVIEW') {
    return 'document_reasoning + risk_reasoning';
  }
  if (route === 'VIDEO_REVIEW') return 'classification';
  return 'risk_reasoning';
}

function resolveCostBoundary(
  route: ModelRoutingRoute,
  riskScore: number,
  sensitiveDataDetected: boolean,
  policyDecision: ComplianceDecision,
): ModelRouting['costBoundary'] {
  if (route === 'SKIP_LLM' || policyDecision === 'DENY') return 'SKIPPED_FOR_POLICY';
  if (sensitiveDataDetected || riskScore >= 50 || policyDecision === 'REVIEW') {
    return 'HIGH_RISK_ALLOWED';
  }
  if (route === 'TEXT_REASONING') return 'LOW_COST';
  return 'STANDARD';
}

function resolvePrivacyBoundary(
  route: ModelRoutingRoute,
  input: ModelRoutingInput,
): ModelRouting['privacyBoundary'] {
  if (route === 'SKIP_LLM' || input.policyDecision === 'DENY') {
    return 'INTERNAL_ONLY';
  }
  if (input.sensitiveDataDetected || input.dataBoundary.privateBlockedFromExternal) {
    return 'GOVERNED_SENSITIVE_CONTEXT';
  }
  return 'NO_PRIVATE_DATA_TO_EXTERNAL_MODEL';
}

function buildRouteReason(
  route: ModelRoutingRoute,
  intent: InferredIntent,
  input: ModelRoutingInput,
): string {
  if (input.promptInjectionBlocked) {
    return 'Deterministic policy blocked prompt injection before model call.';
  }
  if (input.intentControlBlocked) {
    return 'Intent control blocked model routing before LLM invocation.';
  }
  if (route === 'SKIP_LLM') {
    return 'Policy denied request — LLM inference skipped to save cost and reduce risk.';
  }
  if (route === 'DOCUMENT_KYC_REVIEW') {
    return 'Document-heavy KYC case requires multimodal reasoning and risk/judge reasoning under governance.';
  }
  if (route === 'MULTIMODAL_REVIEW') {
    return 'Document or image modality requires SenseNova multimodal reasoning with Kimi risk/judge follow-up.';
  }
  if (route === 'WEB_RESEARCH_SUMMARY') {
    return 'Public web research case routed to Kimi summary reasoning; BrightData handles external enrichment.';
  }
  if (route === 'VIDEO_REVIEW') {
    return 'Video or audio workflow routed to VideoDB with Kimi judge reasoning; SenseNova optional for frame reasoning.';
  }
  if (route === 'BATCH_RISK_REASONING') {
    return 'Batch risk scan routed to Kimi reasoning; Nosana remains the execution runtime tool.';
  }
  if (intent === 'VENDOR_ONBOARDING') {
    return 'Vendor onboarding case uses governed text and document reasoning with public enrichment support.';
  }
  return 'Text-only regulated case routed to Kimi for reasoning, summary, and judge validation.';
}

function buildSelectedModels(
  route: ModelRoutingRoute,
  input: ModelRoutingInput,
): ModelRouting['selectedModels'] {
  if (route === 'SKIP_LLM') {
    return [
      {
        model: 'SenseNova',
        role: 'document_image_multimodal_reasoning',
        status: 'SKIPPED',
        reason: 'SenseNova skipped — policy blocked LLM chain before multimodal inference.',
      },
      {
        model: 'Kimi',
        role: 'risk_reasoning_judge_summary',
        status: 'SKIPPED',
        reason: 'Kimi skipped — policy blocked LLM chain before reasoning.',
      },
    ];
  }

  const models: ModelRouting['selectedModels'] = [];
  const needsSenseNova =
    route === 'DOCUMENT_KYC_REVIEW' ||
    route === 'MULTIMODAL_REVIEW' ||
    route === 'VIDEO_REVIEW';

  if (needsSenseNova) {
    const snStatus = resolveSenseNovaModelStatus(input.senseNovaStatus, true);
    models.push({
      model: 'SenseNova',
      role: 'document_image_multimodal_reasoning',
      status: snStatus,
      reason:
        snStatus === 'LIVE'
          ? 'SenseNova completed governed document/image multimodal reasoning.'
          : snStatus === 'MOCKED'
            ? 'Mock SenseNova document/image reasoning under governed sensitive context.'
            : snStatus === 'SKIPPED'
              ? 'SenseNova skipped — no document or image signal for this route.'
              : 'SenseNova planned for document/image multimodal reasoning.',
    });
  }

  const needsKimi =
    route === 'TEXT_REASONING' ||
    route === 'DOCUMENT_KYC_REVIEW' ||
    route === 'MULTIMODAL_REVIEW' ||
    route === 'WEB_RESEARCH_SUMMARY' ||
    route === 'BATCH_RISK_REASONING' ||
    route === 'VIDEO_REVIEW';

  if (needsKimi) {
    const kimiStatus = resolveKimiModelStatus(input.kimiStatus);

    models.push({
      model: 'Kimi',
      role: 'risk_reasoning_judge_summary',
      status: kimiStatus,
      reason:
        kimiStatus === 'LIVE'
          ? 'Kimi completed governed text reasoning, summary, and judge validation.'
          : kimiStatus === 'MOCKED'
            ? 'Mock Kimi reasoning for risk summary and judge recommendation.'
            : kimiStatus === 'SKIPPED'
              ? 'Kimi skipped — another provider handled reasoning or policy skipped LLM.'
              : 'Kimi remains planned until governance approval.',
    });
  }

  if (route === 'VIDEO_REVIEW') {
    models.push({
      model: 'VideoDB',
      role: 'video_audio_workflow',
      status: isAdapterMocked('VIDEODB_API_KEY') ? 'MOCKED' : 'PLANNED',
      reason: 'VideoDB handles video/audio workflow orchestration for this route.',
    });
  }

  return models;
}

function resolveTokenRouterMode(
  route: ModelRoutingRoute,
  selectedModels: ModelRouting['selectedModels'],
): ModelRouting['mode'] {
  if (route === 'SKIP_LLM') return 'MOCK';
  if (canUseLiveTokenRouter()) return 'LIVE';
  const anyLiveModel = selectedModels.some((m) => m.status === 'LIVE');
  if (anyLiveModel && !isGlobalMockMode()) return 'LIVE';
  return 'MOCK';
}

export function routeModelForAgentTask(input: ModelRoutingInput): ModelRouting {
  const blockedByGovernance =
    Boolean(input.promptInjectionBlocked) ||
    Boolean(input.intentControlBlocked) ||
    input.finalAgentState === 'AUTO_BLOCKED_BY_POLICY' ||
    input.policyDecision === 'DENY';

  const baseDecision = blockedByGovernance
    ? {
        route: 'BLOCKED_BY_POLICY',
        primaryProvider: 'NONE',
        secondaryProviders: [] as string[],
        models: ['SKIP_LLM'],
        routeReason: buildRouteReason('SKIP_LLM', input.inferredIntent, input),
      }
    : runTokenRouterAgent(input.modalities, input.inferredIntent, input.policyDecision);

  const route = blockedByGovernance
    ? 'SKIP_LLM'
    : normalizeRoute(baseDecision, input.inferredIntent, input.modalities);

  const selectedModels = buildSelectedModels(route, input);
  const mode = resolveTokenRouterMode(route, selectedModels);

  return {
    provider: 'TokenRouter',
    mode,
    route,
    routePurpose: resolveRoutePurpose(route, input.requestedTask),
    selectedModels,
    fallbackModel: 'Gemini',
    costBoundary: resolveCostBoundary(
      route,
      input.riskScore,
      input.sensitiveDataDetected,
      input.policyDecision,
    ),
    privacyBoundary: resolvePrivacyBoundary(route, input),
    routeReason: buildRouteReason(route, input.inferredIntent, input),
  };
}

export function buildTokenRouterDecisionFromModelRouting(
  modelRouting: ModelRouting,
): TokenRouterAgentDecision {
  if (modelRouting.route === 'SKIP_LLM') {
    return {
      route: 'BLOCKED_BY_POLICY',
      primaryProvider: 'NONE',
      secondaryProviders: [],
      models: ['SKIP_LLM'],
      routeReason: modelRouting.routeReason,
    };
  }

  const llmModels = modelRouting.selectedModels.filter(
    (m) => m.model === 'Kimi' || m.model === 'SenseNova',
  );
  const primary = llmModels[0];
  const secondary = llmModels.slice(1);

  const legacyRoute =
    modelRouting.route === 'MULTIMODAL_REVIEW'
      ? 'DOCUMENT_MULTIMODAL'
      : modelRouting.route === 'WEB_RESEARCH_SUMMARY'
        ? 'WEB_RESEARCH'
        : modelRouting.route === 'VIDEO_REVIEW'
          ? 'VIDEO_AUDIO'
          : modelRouting.route === 'TEXT_REASONING'
            ? 'TEXT'
            : modelRouting.route === 'BATCH_RISK_REASONING'
              ? 'BATCH_RISK'
              : modelRouting.route;

  return {
    route: legacyRoute,
    primaryProvider: primary?.model ?? 'Kimi',
    secondaryProviders: secondary.map((m) => m.model),
    models: llmModels.map((m) => m.model.toUpperCase()),
    routeReason: modelRouting.routeReason,
    documentReasoningProvider: modelRouting.selectedModels.find((m) =>
      m.role.includes('document'),
    )?.model,
    judgeReasoningProvider: modelRouting.selectedModels.find((m) =>
      m.role.includes('judge') || m.role.includes('risk') || m.role.includes('summary'),
    )?.model,
  };
}

export function tokenRouterToolStatus(modelRouting: ModelRouting): ToolChainStatus {
  if (modelRouting.route === 'SKIP_LLM') return 'SKIPPED';
  return modelRouting.mode === 'LIVE' ? 'USED' : 'MOCKED';
}

export function tokenRouterToolReason(modelRouting: ModelRouting): string {
  const status = tokenRouterToolStatus(modelRouting);
  return `${status}: ${modelRouting.route} — ${modelRouting.routeReason}`;
}

export function modelStatusToToolStatus(status: ModelRoutingModelStatus): ToolChainStatus {
  switch (status) {
    case 'LIVE':
      return 'USED';
    case 'MOCKED':
      return 'MOCKED';
    case 'PLANNED':
      return 'PLANNED';
    case 'SKIPPED':
    default:
      return 'SKIPPED';
  }
}

export function resolveModelToolEntry(
  modelRouting: ModelRouting,
  modelName: 'Kimi' | 'SenseNova',
  role: string,
): { status: ToolChainStatus; reason: string } | null {
  const selected = modelRouting.selectedModels.find((m) => m.model === modelName);
  if (!selected) return null;
  return {
    status: modelStatusToToolStatus(selected.status),
    reason: `${selected.status}: ${selected.reason}`,
  };
}
