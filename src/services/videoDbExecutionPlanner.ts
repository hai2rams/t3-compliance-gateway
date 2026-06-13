import type {
  DaytonaExecution,
  FinalAgentState,
  InferredIntent,
  NosanaExecution,
  VideoDbExecution,
  VideoDbQueueStatus,
} from '../schemas/agentIntakeSchema.js';
import { buildExecutionPlanFromDaytonaExecution } from './daytonaExecutionPlanner.js';
import { buildExecutionPlanFromNosanaExecution } from './nosanaExecutionPlanner.js';
import type { ToolChainStatus } from '../config/toolCapabilityMap.js';
import { isGlobalMockMode } from '../config/toolCapabilityMap.js';
import { routeVideoWorkflow } from '../adapters/videoDbAdapter.js';
import type { ComplianceCheckRequest } from '../schemas/complianceCheckSchema.js';

export type VideoDbExecutionInput = {
  missionId: string;
  agentId: string;
  inferredIntent: InferredIntent;
  selectedWorkflow: string;
  finalAgentState: FinalAgentState;
  dataBoundary: {
    detected: boolean;
    types: string[];
    privateBlockedFromExternal: boolean;
  };
  sensitiveDataDetected: boolean;
  detectedSensitiveTypes: string[];
  hasVideo: boolean;
  hasAudio: boolean;
  policyId: string;
  executionPlan: Record<string, unknown>;
  promptInjectionBlocked?: boolean;
  intentControlBlocked?: boolean;
};

const PLANNED_ACTIONS = [
  'extract_keyframes',
  'generate_redacted_transcript',
  'detect_sensitive_context',
  'prepare_review_summary',
] as const;

const ARTIFACTS = [
  'keyframe_manifest.json',
  'redacted_transcript.txt',
  'video_review_summary.json',
  'video_audit_manifest.json',
];

const SKIP_INTENTS: InferredIntent[] = [
  'CREDIT_KYC_PRECHECK',
  'CLAIMS_REVIEW',
  'BATCH_RISK_SCAN',
  'VENDOR_ONBOARDING',
  'PUBLIC_WEB_RESEARCH',
  'GENERAL_REGULATED_CASE',
];

function canUseLiveVideoDb(): boolean {
  if (isGlobalMockMode()) return false;
  return Boolean(process.env.VIDEODB_API_KEY?.trim());
}

function isVideoWorkflowIntent(intent: InferredIntent, hasVideo: boolean): boolean {
  return intent === 'VIDEO_REVIEW' || hasVideo;
}

function buildSafetyNotes(sensitiveDataDetected: boolean): string[] {
  if (sensitiveDataDetected) {
    return [
      'Sensitive video/audio context detected — raw media is not shared externally.',
      'Face recognition is disabled by policy.',
      'Only redacted transcript and keyframe summaries are eligible outputs.',
      'Workflow dispatch is held until governance approval.',
    ];
  }

  return [
    'Raw video is not shared externally by default.',
    'Face recognition is disabled — only governed frame and transcript artifacts are produced.',
    'Predefined workflow actions only — no arbitrary user commands.',
    'Video audit manifest recorded for compliance review.',
  ];
}

function baseVideoExecution(
  overrides: Partial<VideoDbExecution> &
    Pick<VideoDbExecution, 'allowedToQueue' | 'queueStatus' | 'reason'>,
): VideoDbExecution {
  return {
    provider: 'VideoDB',
    mode: 'MOCK',
    jobClass: 'SECURE_VIDEO_REVIEW',
    workflowType: 'VIDEO_AUDIO_ANALYSIS',
    mediaPolicy: {
      rawVideoAllowed: false,
      frameExtractionAllowed: true,
      audioTranscriptAllowed: true,
      faceRecognitionAllowed: false,
      externalSharingAllowed: false,
      redactedTranscriptOnly: true,
    },
    plannedActions: [...PLANNED_ACTIONS],
    artifacts: ARTIFACTS,
    safetyNotes: buildSafetyNotes(false),
    ...overrides,
  };
}

function skippedExecution(reason: string): VideoDbExecution {
  return baseVideoExecution({
    allowedToQueue: false,
    queueStatus: 'SKIPPED',
    plannedActions: [],
    artifacts: [],
    reason,
    safetyNotes: [],
  });
}

function blockedExecution(reason: string): VideoDbExecution {
  return baseVideoExecution({
    allowedToQueue: false,
    queueStatus: 'BLOCKED',
    plannedActions: [],
    artifacts: [],
    reason,
    safetyNotes: [
      'Arbitrary user commands are never derived from uploaded content.',
      ...buildSafetyNotes(true),
    ],
  });
}

function toComplianceStub(input: VideoDbExecutionInput): ComplianceCheckRequest {
  return {
    workflowType: 'VIDEO_ANALYSIS',
    useCase: 'government',
    agentId: input.agentId,
    userRole: 'authorized_officer',
    actionType: 'VIDEO_REVIEW',
    dataSensitivity: input.sensitiveDataDetected ? 'HIGH' : 'MEDIUM',
    toolRequested: 'video_analysis',
    purpose: input.selectedWorkflow,
    content: '',
    containsPii: input.sensitiveDataDetected,
    externalSharing: false,
    amount: 0,
    needsVideo: input.hasVideo,
    jobMode: 'STREAMING',
  };
}

function resolveLiveQueue(
  input: VideoDbExecutionInput,
): { mode: 'LIVE' | 'MOCK'; queueStatus: VideoDbQueueStatus } {
  if (!canUseLiveVideoDb()) {
    return { mode: 'MOCK', queueStatus: 'QUEUED_MOCK' };
  }

  try {
    const result = routeVideoWorkflow(toComplianceStub(input), input.missionId);
    if (result.status === 'INDEXED') {
      return { mode: 'LIVE', queueStatus: 'QUEUED_LIVE' };
    }
    return { mode: 'MOCK', queueStatus: 'QUEUED_MOCK' };
  } catch {
    return { mode: 'MOCK', queueStatus: 'QUEUED_MOCK' };
  }
}

export function buildVideoDbExecutionPlan(input: VideoDbExecutionInput): VideoDbExecution {
  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return blockedExecution(
      'VideoDB workflow blocked — untrusted content or policy block active before media processing.',
    );
  }

  if (input.finalAgentState === 'AUTO_BLOCKED_BY_POLICY') {
    return blockedExecution('VideoDB workflow blocked — policy denied runtime dispatch.');
  }

  if (SKIP_INTENTS.includes(input.inferredIntent)) {
    return skippedExecution('VideoDB skipped because this is not a video/audio workflow.');
  }

  if (!isVideoWorkflowIntent(input.inferredIntent, input.hasVideo)) {
    return skippedExecution('VideoDB skipped — no secure video or audio workflow detected.');
  }

  const sensitive =
    input.sensitiveDataDetected ||
    input.dataBoundary.detected ||
    input.dataBoundary.privateBlockedFromExternal;

  if (sensitive) {
    return baseVideoExecution({
      mode: 'MOCK',
      allowedToQueue: false,
      queueStatus: 'AWAITING_GOVERNANCE_APPROVAL',
      reason:
        'Sensitive video/audio context requires governed review before VideoDB workflow dispatch.',
      safetyNotes: buildSafetyNotes(true),
    });
  }

  const mayQueue =
    input.finalAgentState === 'EXECUTION_QUEUED' ||
    input.finalAgentState === 'AUTO_EXECUTION_APPROVED';

  if (!mayQueue) {
    return baseVideoExecution({
      mode: 'MOCK',
      allowedToQueue: false,
      queueStatus: 'AWAITING_GOVERNANCE_APPROVAL',
      reason:
        'VideoDB secure workflow planned — held until governance approves media processing.',
      safetyNotes: buildSafetyNotes(false),
    });
  }

  const live = resolveLiveQueue(input);

  return baseVideoExecution({
    mode: live.mode,
    allowedToQueue: true,
    queueStatus: live.queueStatus,
    reason: 'Governed video/audio workflow is eligible for VideoDB secure processing.',
    safetyNotes: buildSafetyNotes(false),
  });
}

export function buildExecutionPlanFromVideoDbExecution(
  videoDbExecution: VideoDbExecution,
  base: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    provider: 'VideoDB',
    targetRuntime: 'VideoDB',
    executionMode: 'Secure Video Workflow',
    jobClass: videoDbExecution.jobClass,
    workflowType: videoDbExecution.workflowType,
    mode: videoDbExecution.mode,
    queueStatus: videoDbExecution.queueStatus,
    allowedToQueue: videoDbExecution.allowedToQueue,
    mediaPolicy: videoDbExecution.mediaPolicy,
    plannedActions: videoDbExecution.plannedActions,
    artifacts: videoDbExecution.artifacts,
    safetyNotes: videoDbExecution.safetyNotes,
    reason: videoDbExecution.reason,
    status: videoDbExecution.queueStatus,
  };
}

export function alignExecutionPlanWithRuntime(
  base: Record<string, unknown>,
  daytonaExecution: DaytonaExecution,
  nosanaExecution: NosanaExecution,
  videoDbExecution: VideoDbExecution,
): Record<string, unknown> {
  const target = String(base.targetRuntime ?? 'NONE');
  if (target === 'VideoDB') {
    return buildExecutionPlanFromVideoDbExecution(videoDbExecution, base);
  }
  if (target === 'Nosana') {
    return buildExecutionPlanFromNosanaExecution(nosanaExecution, base);
  }
  return buildExecutionPlanFromDaytonaExecution(daytonaExecution, base);
}

export function videoDbToolStatus(videoDbExecution: VideoDbExecution): ToolChainStatus {
  if (videoDbExecution.queueStatus === 'BLOCKED') {
    return 'BLOCKED';
  }

  if (videoDbExecution.queueStatus === 'SKIPPED') {
    return 'SKIPPED';
  }

  if (videoDbExecution.queueStatus === 'AWAITING_GOVERNANCE_APPROVAL') {
    return 'PLANNED';
  }

  if (videoDbExecution.queueStatus === 'QUEUED_LIVE') {
    return 'USED';
  }

  if (videoDbExecution.queueStatus === 'QUEUED_MOCK') {
    return 'MOCKED';
  }

  return 'PLANNED';
}

export function videoDbToolReason(videoDbExecution: VideoDbExecution): string {
  const status = videoDbToolStatus(videoDbExecution);
  if (status === 'BLOCKED') {
    return `BLOCKED: ${videoDbExecution.reason}`;
  }
  if (status === 'SKIPPED') {
    return `SKIPPED: ${videoDbExecution.reason}`;
  }
  if (videoDbExecution.queueStatus === 'AWAITING_GOVERNANCE_APPROVAL') {
    return `PLANNED: ${videoDbExecution.reason}`;
  }
  if (videoDbExecution.queueStatus === 'QUEUED_LIVE') {
    return `USED: ${videoDbExecution.reason}`;
  }
  return `${status}: ${videoDbExecution.reason}`;
}
