import type { FinalAgentState, InferredIntent, Modality } from '../schemas/agentIntakeSchema.js';
import type { TrustResult } from '../schemas/complianceCheckSchema.js';
import type { TokenRouterAgentDecision } from '../agents/tokenRouterAgent.js';
import type { LlmJudgeResult } from '../agents/llmJudgeAgent.js';
import type { ExecutionSpec } from '../execution/executionSpec.js';
import type { RuntimeExecutionResult } from '../execution/executionSpec.js';
import type { PublicEnrichment } from '../schemas/agentIntakeSchema.js';
import {
  brightDataToolReason,
  brightDataToolStatus,
} from '../services/publicEnrichmentService.js';
import type { T3Governance } from '../schemas/agentIntakeSchema.js';
import {
  terminal3ToolReason,
  terminal3ToolStatus,
} from '../services/t3GovernanceService.js';
import {
  isAdapterMocked,
  isGlobalMockMode,
  liveOrMocked,
  type ToolChainStatus,
  type ToolName,
} from '../config/toolCapabilityMap.js';

export type ToolChainEntry = {
  tool: ToolName;
  role: string;
  status: ToolChainStatus;
  reason: string;
};

export type ToolDecisionInput = {
  intent: InferredIntent;
  modalities: Modality[];
  finalAgentState: FinalAgentState;
  promptInjectionBlocked: boolean;
  intentControlBlocked: boolean;
  trust: TrustResult | { status: string; provider?: string };
  tokenRouterDecision: TokenRouterAgentDecision | { route: string };
  dataBoundary: { detected: boolean; privateBlockedFromExternal: boolean; types: string[] };
  enrichmentAllowed: boolean;
  publicSearchQuery: string;
  enrichmentResult?: { status: string };
  publicEnrichment?: PublicEnrichment;
  kimiStatus?: string;
  senseNovaStatus?: string;
  judge: LlmJudgeResult | { verdict: FinalAgentState; summary: string };
  executionSpec: ExecutionSpec | { targetRuntime: string; status: string };
  runtime: RuntimeExecutionResult | { executed: boolean; status: string };
  t3Governance?: T3Governance;
};

function executionPermitted(state: FinalAgentState): boolean {
  return state === 'EXECUTION_QUEUED' || state === 'AUTO_EXECUTION_APPROVED';
}

function governanceBlocked(state: FinalAgentState): boolean {
  return state === 'AUTO_BLOCKED_BY_POLICY' || state === 'AUTO_HOLD_REVIEW_REQUIRED';
}

function hasDocumentModality(modalities: Modality[]): boolean {
  return modalities.includes('DOCUMENT') || modalities.includes('IMAGE');
}

function resolveTerminal3(input: ToolDecisionInput): ToolChainEntry {
  if (input.t3Governance) {
    const status = terminal3ToolStatus(input.t3Governance);
    return {
      tool: 'Terminal 3',
      role: 'identity_governance_audit',
      status,
      reason: terminal3ToolReason(input.t3Governance),
    };
  }

  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'Terminal 3',
      role: 'identity_governance_audit',
      status: 'BLOCKED',
      reason: 'Identity governance blocked — untrusted content or intent failed control-map checks.',
    };
  }

  const status = input.trust.status;
  if (status === 'FAILED' || status === 'DENIED') {
    return {
      tool: 'Terminal 3',
      role: 'identity_governance_audit',
      status: 'BLOCKED',
      reason: 'Agent passport verification failed — governance hold applied.',
    };
  }

  const mocked = status === 'MOCK_VERIFIED' || isAdapterMocked('T3N_API_KEY');
  return {
    tool: 'Terminal 3',
    role: 'identity_governance_audit',
    status: liveOrMocked(!mocked),
    reason: mocked
      ? 'Mock Terminal 3 passport verified for governed agent identity and audit readiness.'
      : 'Terminal 3 passport verified for governed agent identity and audit readiness.',
  };
}

function resolveTokenRouter(input: ToolDecisionInput): ToolChainEntry {
  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'TokenRouter',
      role: 'model_routing_cost_boundary',
      status: 'BLOCKED',
      reason: 'Model routing blocked — governance rejected case before LLM chain.',
    };
  }

  const route = input.tokenRouterDecision.route;
  if (route === 'BLOCKED_BY_POLICY') {
    return {
      tool: 'TokenRouter',
      role: 'model_routing_cost_boundary',
      status: 'BLOCKED',
      reason: 'TokenRouter blocked — policy denied request before model selection.',
    };
  }

  return {
    tool: 'TokenRouter',
    role: 'model_routing_cost_boundary',
    status: isGlobalMockMode() ? 'MOCKED' : 'USED',
    reason: `TokenRouter selected route ${route} with governed model/cost boundaries.`,
  };
}

function resolveKimi(input: ToolDecisionInput): ToolChainEntry {
  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'Kimi',
      role: 'reasoning_summary_judge',
      status: 'BLOCKED',
      reason: 'Kimi reasoning blocked — external LLM chain halted by governance guard.',
    };
  }

  if (input.tokenRouterDecision.route === 'BLOCKED_BY_POLICY') {
    return {
      tool: 'Kimi',
      role: 'reasoning_summary_judge',
      status: 'SKIPPED',
      reason: 'Kimi skipped — policy denied before reasoning could start.',
    };
  }

  const kimiStatus = input.kimiStatus ?? '';
  if (kimiStatus === 'COMPLETED') {
    return {
      tool: 'Kimi',
      role: 'reasoning_summary_judge',
      status: 'USED',
      reason: 'Kimi completed risk summary and judge reasoning for this regulated case.',
    };
  }
  if (kimiStatus === 'MOCK_COMPLETED') {
    return {
      tool: 'Kimi',
      role: 'reasoning_summary_judge',
      status: 'MOCKED',
      reason: 'Mock Kimi reasoning applied for risk summary and governed judge recommendation.',
    };
  }
  if (kimiStatus === 'SKIPPED') {
    return {
      tool: 'Kimi',
      role: 'reasoning_summary_judge',
      status: 'SKIPPED',
      reason: 'Kimi skipped — another provider was selected or policy skipped LLM inference.',
    };
  }

  const needsReasoning =
    input.intent !== 'BATCH_RISK_SCAN' || input.finalAgentState !== 'AUTO_BLOCKED_BY_POLICY';

  if (!needsReasoning) {
    return {
      tool: 'Kimi',
      role: 'reasoning_summary_judge',
      status: 'SKIPPED',
      reason: 'Kimi skipped — batch path does not require text judge reasoning.',
    };
  }

  return {
    tool: 'Kimi',
    role: 'reasoning_summary_judge',
    status: isAdapterMocked('KIMI_API_KEY') ? 'MOCKED' : 'PLANNED',
    reason: governanceBlocked(input.finalAgentState)
      ? 'Kimi judge reasoning planned — awaiting governance clearance before live inference.'
      : 'Kimi queued for text reasoning, summary, and governed judge validation.',
  };
}

function resolveSenseNova(input: ToolDecisionInput): ToolChainEntry {
  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'SenseNova',
      role: 'document_image_multimodal_reasoning',
      status: 'BLOCKED',
      reason: 'SenseNova blocked — multimodal reasoning halted by governance guard.',
    };
  }

  if (!hasDocumentModality(input.modalities) && input.intent !== 'VIDEO_REVIEW') {
    return {
      tool: 'SenseNova',
      role: 'document_image_multimodal_reasoning',
      status: 'SKIPPED',
      reason: 'SenseNova skipped — no document or image modality detected for this case.',
    };
  }

  const snStatus = input.senseNovaStatus ?? '';
  if (snStatus === 'COMPLETED' || snStatus === 'SCANNED') {
    return {
      tool: 'SenseNova',
      role: 'document_image_multimodal_reasoning',
      status: 'USED',
      reason: 'SenseNova completed document or visual reasoning for uploaded case content.',
    };
  }
  if (snStatus === 'MOCK_COMPLETED' || snStatus === 'MOCK_SCANNED') {
    return {
      tool: 'SenseNova',
      role: 'document_image_multimodal_reasoning',
      status: 'MOCKED',
      reason: 'Mock SenseNova document/visual scan applied under governed multimodal routing.',
    };
  }

  if (input.intent === 'VIDEO_REVIEW') {
    return {
      tool: 'SenseNova',
      role: 'document_image_multimodal_reasoning',
      status: isAdapterMocked('SENSENOVA_API_KEY') ? 'MOCKED' : 'PLANNED',
      reason: 'SenseNova planned for selected video frame reasoning after VideoDB indexing.',
    };
  }

  return {
    tool: 'SenseNova',
    role: 'document_image_multimodal_reasoning',
    status: isAdapterMocked('SENSENOVA_API_KEY') ? 'MOCKED' : 'PLANNED',
    reason: governanceBlocked(input.finalAgentState)
      ? 'SenseNova document reasoning planned — held until governance approves KYC/claims package.'
      : 'SenseNova planned for document and image multimodal reasoning.',
  };
}

function resolveBrightData(input: ToolDecisionInput): ToolChainEntry {
  if (input.publicEnrichment) {
    const status = brightDataToolStatus(input.publicEnrichment);
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status,
      reason: brightDataToolReason(input.publicEnrichment),
    };
  }

  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status: 'BLOCKED',
      reason: 'Public enrichment blocked — governance rejected case before external lookup.',
    };
  }

  if (input.dataBoundary.privateBlockedFromExternal && !input.publicSearchQuery) {
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status: 'BLOCKED',
      reason: 'BrightData/MCP blocked — private data present and no sanitized public query available.',
    };
  }

  if (input.intent === 'BATCH_RISK_SCAN') {
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status: 'SKIPPED',
      reason: 'BrightData/MCP skipped — anonymized batch scan does not require public web enrichment.',
    };
  }

  const enrichStatus = input.enrichmentResult?.status ?? '';
  if (enrichStatus === 'COMPLETED') {
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status: 'USED',
      reason: `BrightData/MCP completed public-only enrichment for: ${input.publicSearchQuery}.`,
    };
  }
  if (enrichStatus === 'MOCK_COMPLETED') {
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status: 'MOCKED',
      reason: `Mock BrightData/MCP enrichment with sanitized public query: ${input.publicSearchQuery}.`,
    };
  }
  if (enrichStatus === 'BLOCKED') {
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status: 'BLOCKED',
      reason: 'BrightData/MCP blocked — private data would be exposed without a safe public query.',
    };
  }

  if (!input.enrichmentAllowed && !input.publicSearchQuery) {
    return {
      tool: 'BrightData/MCP',
      role: 'public_web_enrichment',
      status: 'SKIPPED',
      reason: 'BrightData/MCP skipped — no public enrichment need detected for this case.',
    };
  }

  return {
    tool: 'BrightData/MCP',
    role: 'public_web_enrichment',
    status: isAdapterMocked('BRIGHTDATA_API_KEY') ? 'MOCKED' : 'PLANNED',
    reason: input.publicSearchQuery
      ? `BrightData/MCP planned for public-only query: ${input.publicSearchQuery}.`
      : 'BrightData/MCP planned when a sanitized public search term is available.',
  };
}

function resolveDaytona(input: ToolDecisionInput): ToolChainEntry {
  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'Daytona',
      role: 'docker_sandbox_execution',
      status: 'BLOCKED',
      reason: 'Daytona execution blocked — governance rejected case before runtime dispatch.',
    };
  }

  const documentRuntimeIntents: InferredIntent[] = ['CREDIT_KYC_PRECHECK', 'CLAIMS_REVIEW'];

  const needsDaytona =
    documentRuntimeIntents.includes(input.intent) ||
    ((input.intent === 'VENDOR_ONBOARDING' || input.intent === 'GENERAL_REGULATED_CASE') &&
      hasDocumentModality(input.modalities)) ||
    (hasDocumentModality(input.modalities) && input.intent === 'PUBLIC_WEB_RESEARCH');

  if (!needsDaytona || input.intent === 'BATCH_RISK_SCAN' || input.intent === 'VIDEO_REVIEW') {
    return {
      tool: 'Daytona',
      role: 'docker_sandbox_execution',
      status: 'SKIPPED',
      reason: 'Daytona skipped — case routed to another runtime or no document sandbox required.',
    };
  }

  if (governanceBlocked(input.finalAgentState)) {
    return {
      tool: 'Daytona',
      role: 'docker_sandbox_execution',
      status: 'PLANNED',
      reason: 'Daytona sandbox planned for document validation — not executed until governance approval.',
    };
  }

  if (executionPermitted(input.finalAgentState) && input.runtime.executed) {
    return {
      tool: 'Daytona',
      role: 'docker_sandbox_execution',
      status: liveOrMocked(!isAdapterMocked('DAYTONA_API_KEY')),
      reason: 'Daytona sandbox dispatched for governed document/KYC validation workload.',
    };
  }

  if (executionPermitted(input.finalAgentState)) {
    return {
      tool: 'Daytona',
      role: 'docker_sandbox_execution',
      status: isAdapterMocked('DAYTONA_API_KEY') ? 'MOCKED' : 'PLANNED',
      reason: 'Daytona execution approved — sandbox dispatch planned under governed container image.',
    };
  }

  return {
    tool: 'Daytona',
    role: 'docker_sandbox_execution',
    status: 'PLANNED',
    reason: 'Daytona sandbox planned for document validation after policy and judge clearance.',
  };
}

function resolveNosana(input: ToolDecisionInput): ToolChainEntry {
  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'Nosana',
      role: 'gpu_batch_execution',
      status: 'BLOCKED',
      reason: 'Nosana GPU batch blocked — governance rejected case before compute dispatch.',
    };
  }

  if (input.intent !== 'BATCH_RISK_SCAN') {
    return {
      tool: 'Nosana',
      role: 'gpu_batch_execution',
      status: 'SKIPPED',
      reason: 'Nosana skipped — case is not a governed batch/GPU risk scan.',
    };
  }

  if (governanceBlocked(input.finalAgentState)) {
    return {
      tool: 'Nosana',
      role: 'gpu_batch_execution',
      status: 'PLANNED',
      reason: 'Nosana GPU batch planned — held until governance approves anonymized batch execution.',
    };
  }

  if (executionPermitted(input.finalAgentState) && input.runtime.executed) {
    return {
      tool: 'Nosana',
      role: 'gpu_batch_execution',
      status: liveOrMocked(!isAdapterMocked('NOSANA_API_KEY')),
      reason: 'Nosana GPU batch job dispatched for governed anonymized risk scan.',
    };
  }

  return {
    tool: 'Nosana',
    role: 'gpu_batch_execution',
    status: isAdapterMocked('NOSANA_API_KEY') ? 'MOCKED' : 'PLANNED',
    reason: 'Nosana GPU batch execution planned for anonymized internal risk scan workload.',
  };
}

function resolveVideoDb(input: ToolDecisionInput): ToolChainEntry {
  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return {
      tool: 'VideoDB',
      role: 'video_audio_workflow',
      status: 'BLOCKED',
      reason: 'VideoDB workflow blocked — governance rejected case before media processing.',
    };
  }

  if (input.intent !== 'VIDEO_REVIEW' && !input.modalities.includes('VIDEO')) {
    return {
      tool: 'VideoDB',
      role: 'video_audio_workflow',
      status: 'SKIPPED',
      reason: 'VideoDB skipped — no secure video or audio workflow detected.',
    };
  }

  if (governanceBlocked(input.finalAgentState)) {
    return {
      tool: 'VideoDB',
      role: 'video_audio_workflow',
      status: 'PLANNED',
      reason: 'VideoDB workflow planned — held for governance review when faces or private context detected.',
    };
  }

  if (executionPermitted(input.finalAgentState) && input.runtime.executed) {
    return {
      tool: 'VideoDB',
      role: 'video_audio_workflow',
      status: liveOrMocked(!isAdapterMocked('VIDEODB_API_KEY')),
      reason: 'VideoDB secure video workflow dispatched under compliance retention policy.',
    };
  }

  return {
    tool: 'VideoDB',
    role: 'video_audio_workflow',
    status: isAdapterMocked('VIDEODB_API_KEY') ? 'MOCKED' : 'PLANNED',
    reason: 'VideoDB workflow planned for governed secure video/audio analysis.',
  };
}

export function buildToolChain(input: ToolDecisionInput): ToolChainEntry[] {
  return [
    resolveTerminal3(input),
    resolveTokenRouter(input),
    resolveKimi(input),
    resolveSenseNova(input),
    resolveBrightData(input),
    resolveDaytona(input),
    resolveNosana(input),
    resolveVideoDb(input),
  ];
}

export function deriveNextToolAction(
  tools: ToolChainEntry[],
  finalAgentState: FinalAgentState,
): string {
  if (finalAgentState === 'AUTO_BLOCKED_BY_POLICY') {
    return 'Halt tool chain — policy block active; no external tools or runtime dispatch permitted.';
  }
  if (finalAgentState === 'AUTO_HOLD_REVIEW_REQUIRED') {
    const planned = tools.find((t) => t.status === 'PLANNED' || t.status === 'MOCKED');
    return planned
      ? `Prepare governance review package; ${planned.tool} remains planned until human approval.`
      : 'Prepare governance review package; hold all runtime dispatch until human approval.';
  }
  if (finalAgentState === 'EXECUTION_QUEUED' || finalAgentState === 'AUTO_EXECUTION_APPROVED') {
    const runtime = tools.find(
      (t) =>
        (t.tool === 'Daytona' || t.tool === 'Nosana' || t.tool === 'VideoDB') &&
        (t.status === 'PLANNED' || t.status === 'MOCKED' || t.status === 'USED'),
    );
    return runtime
      ? `Proceed with governed ${runtime.tool} dispatch when runtime executor confirms approval.`
      : 'Proceed with governed enrichment and reasoning tools; no heavy runtime required.';
  }
  return 'Continue governed autonomous tool chain under active policy controls.';
}

export function deriveBlockedToolActions(tools: ToolChainEntry[]): string[] {
  return tools.filter((t) => t.status === 'BLOCKED').map((t) => `${t.tool}: ${t.reason}`);
}

export function deriveAuditSummary(
  tools: ToolChainEntry[],
  finalAgentState: FinalAgentState,
  missionId: string,
): string {
  const used = tools.filter((t) => t.status === 'USED' || t.status === 'MOCKED').length;
  const planned = tools.filter((t) => t.status === 'PLANNED').length;
  const blocked = tools.filter((t) => t.status === 'BLOCKED').length;
  return `Mission ${missionId}: ${used} tools active/mock, ${planned} planned, ${blocked} blocked; final state ${finalAgentState}.`;
}
