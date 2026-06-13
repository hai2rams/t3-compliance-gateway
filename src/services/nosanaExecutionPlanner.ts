import type {
  FinalAgentState,
  InferredIntent,
  NosanaExecution,
  NosanaQueueStatus,
} from '../schemas/agentIntakeSchema.js';
import type { ToolChainStatus } from '../config/toolCapabilityMap.js';
import { isGlobalMockMode } from '../config/toolCapabilityMap.js';
import { routeBatchCompute } from '../adapters/nosanaAdapter.js';
import type { ComplianceCheckRequest } from '../schemas/complianceCheckSchema.js';

export type NosanaExecutionInput = {
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
  estimatedRecords: number;
  needsGpu: boolean;
  policyId: string;
  executionPlan: Record<string, unknown>;
  promptInjectionBlocked?: boolean;
  intentControlBlocked?: boolean;
};

const BATCH_PLANNED_COMMAND = 'run-batch-risk-scan --input anonymized_batch.json';
const BATCH_CONTAINER_IMAGE = 'batch-risk-scanner:latest';
const BATCH_ARTIFACTS = [
  'risk_summary.json',
  'anomaly_scores.json',
  'batch_audit_manifest.json',
];

const SKIP_INTENTS: InferredIntent[] = [
  'CREDIT_KYC_PRECHECK',
  'CLAIMS_REVIEW',
  'VENDOR_ONBOARDING',
  'VIDEO_REVIEW',
  'PUBLIC_WEB_RESEARCH',
  'GENERAL_REGULATED_CASE',
];

function canUseLiveNosana(): boolean {
  if (isGlobalMockMode()) return false;
  return Boolean(process.env.NOSANA_API_KEY?.trim());
}

function buildBatchSafetyNotes(sensitiveDataDetected: boolean): string[] {
  if (sensitiveDataDetected) {
    return [
      'Sensitive data detected — raw PII is not eligible for Nosana GPU queue.',
      'Only anonymized batch input may proceed after governance approval.',
      'Predefined command whitelist — arbitrary user commands are never executed.',
      'External network access is disabled by default.',
    ];
  }

  return [
    'Anonymized batch input only — no raw PII is sent to the GPU runtime.',
    'Predefined command whitelist — arbitrary user commands are never executed.',
    'External network access is disabled by default.',
    'Batch audit manifest recorded for governance review.',
  ];
}

function baseBatchExecution(
  overrides: Partial<NosanaExecution> & Pick<NosanaExecution, 'allowedToQueue' | 'queueStatus' | 'reason'>,
): NosanaExecution {
  return {
    provider: 'Nosana',
    mode: 'MOCK',
    jobClass: 'GPU_BATCH_RISK_SCAN',
    workloadType: 'ANONYMIZED_BATCH_ANALYSIS',
    containerImage: BATCH_CONTAINER_IMAGE,
    estimatedRecords: 20_000,
    gpuRequired: true,
    inputPolicy: {
      rawSensitiveDataAllowed: false,
      anonymizedInputOnly: true,
      externalNetwork: 'DISABLED_BY_DEFAULT',
      secretsInjected: false,
    },
    resourceLimits: {
      gpu: '1 GPU',
      cpu: '2 vCPU',
      memory: '4GB',
      timeoutSeconds: 900,
    },
    plannedCommand: BATCH_PLANNED_COMMAND,
    artifacts: BATCH_ARTIFACTS,
    safetyNotes: buildBatchSafetyNotes(false),
    ...overrides,
  };
}

function skippedExecution(reason: string, estimatedRecords: number): NosanaExecution {
  return baseBatchExecution({
    mode: 'MOCK',
    allowedToQueue: false,
    queueStatus: 'SKIPPED',
    estimatedRecords,
    plannedCommand: '',
    artifacts: [],
    reason,
    safetyNotes: [],
  });
}

function blockedExecution(reason: string, estimatedRecords: number): NosanaExecution {
  return baseBatchExecution({
    mode: 'MOCK',
    allowedToQueue: false,
    queueStatus: 'BLOCKED',
    estimatedRecords,
    plannedCommand: '',
    artifacts: [],
    reason,
    safetyNotes: [
      'Arbitrary user commands are never derived from uploaded content.',
      ...buildBatchSafetyNotes(true),
    ],
  });
}

function toComplianceStub(input: NosanaExecutionInput): ComplianceCheckRequest {
  return {
    workflowType: 'BULK_BATCH_JOB',
    useCase: 'finance',
    agentId: input.agentId,
    userRole: 'risk_analyst',
    actionType: 'BATCH_RISK_SCAN',
    dataSensitivity: input.sensitiveDataDetected ? 'HIGH' : 'MEDIUM',
    toolRequested: 'batch_anomaly_detector',
    purpose: input.selectedWorkflow,
    content: '',
    containsPii: input.sensitiveDataDetected,
    externalSharing: false,
    amount: 0,
    jobMode: 'BATCH',
    estimatedRecords: input.estimatedRecords,
    needsGpu: true,
  };
}

function resolveLiveQueue(
  input: NosanaExecutionInput,
): { mode: 'LIVE' | 'MOCK'; queueStatus: NosanaQueueStatus } {
  if (!canUseLiveNosana()) {
    return { mode: 'MOCK', queueStatus: 'QUEUED_MOCK' };
  }

  try {
    const result = routeBatchCompute(toComplianceStub(input));
    if (result.status === 'QUEUED') {
      return { mode: 'LIVE', queueStatus: 'QUEUED_LIVE' };
    }
    return { mode: 'MOCK', queueStatus: 'QUEUED_MOCK' };
  } catch {
    return { mode: 'MOCK', queueStatus: 'QUEUED_MOCK' };
  }
}

export function buildNosanaExecutionPlan(input: NosanaExecutionInput): NosanaExecution {
  const records = input.estimatedRecords > 0 ? input.estimatedRecords : 20_000;

  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return blockedExecution(
      'Nosana GPU batch blocked — untrusted content or policy block active before compute dispatch.',
      records,
    );
  }

  if (input.finalAgentState === 'AUTO_BLOCKED_BY_POLICY') {
    return blockedExecution(
      'Nosana GPU batch blocked — policy denied runtime dispatch.',
      records,
    );
  }

  if (SKIP_INTENTS.includes(input.inferredIntent)) {
    return skippedExecution(
      'Nosana skipped because this is not a batch/GPU risk scan.',
      records,
    );
  }

  if (input.inferredIntent !== 'BATCH_RISK_SCAN') {
    return skippedExecution(
      'Nosana skipped — case is not a governed batch/GPU risk scan.',
      records,
    );
  }

  if (input.sensitiveDataDetected || input.dataBoundary.detected) {
    return baseBatchExecution({
      mode: 'MOCK',
      allowedToQueue: false,
      queueStatus: 'AWAITING_GOVERNANCE_APPROVAL',
      estimatedRecords: records,
      plannedCommand: '',
      artifacts: [],
      reason:
        'Sensitive data detected — anonymized batch GPU execution held until governance approves redacted input.',
      safetyNotes: buildBatchSafetyNotes(true),
    });
  }

  const mayQueue =
    input.finalAgentState === 'EXECUTION_QUEUED' ||
    input.finalAgentState === 'AUTO_EXECUTION_APPROVED';

  if (!mayQueue) {
    return baseBatchExecution({
      mode: 'MOCK',
      allowedToQueue: false,
      queueStatus: 'AWAITING_GOVERNANCE_APPROVAL',
      estimatedRecords: records,
      reason:
        'Anonymized batch risk scan planned — held until governance approves GPU/batch dispatch.',
      safetyNotes: buildBatchSafetyNotes(false),
    });
  }

  const live = resolveLiveQueue(input);

  return baseBatchExecution({
    mode: live.mode,
    allowedToQueue: true,
    queueStatus: live.queueStatus,
    estimatedRecords: records,
    reason: 'Anonymized batch risk scan is eligible for governed GPU/batch execution.',
    safetyNotes: buildBatchSafetyNotes(false),
  });
}

export function buildExecutionPlanFromNosanaExecution(
  nosanaExecution: NosanaExecution,
  base: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    provider: 'Nosana',
    targetRuntime: 'Nosana',
    executionMode: 'GPU Batch',
    jobClass: nosanaExecution.jobClass,
    containerImage: nosanaExecution.containerImage,
    mode: nosanaExecution.mode,
    queueStatus: nosanaExecution.queueStatus,
    allowedToQueue: nosanaExecution.allowedToQueue,
    workloadType: nosanaExecution.workloadType,
    estimatedRecords: nosanaExecution.estimatedRecords,
    gpuRequired: nosanaExecution.gpuRequired,
    inputPolicy: nosanaExecution.inputPolicy,
    resourceLimits: nosanaExecution.resourceLimits,
    plannedCommand: nosanaExecution.plannedCommand,
    artifacts: nosanaExecution.artifacts,
    safetyNotes: nosanaExecution.safetyNotes,
    reason: nosanaExecution.reason,
    status: nosanaExecution.queueStatus,
  };
}

export function nosanaToolStatus(nosanaExecution: NosanaExecution): ToolChainStatus {
  if (nosanaExecution.queueStatus === 'BLOCKED') {
    return 'BLOCKED';
  }

  if (nosanaExecution.queueStatus === 'SKIPPED') {
    return 'SKIPPED';
  }

  if (nosanaExecution.queueStatus === 'AWAITING_GOVERNANCE_APPROVAL') {
    return 'PLANNED';
  }

  if (nosanaExecution.queueStatus === 'QUEUED_LIVE') {
    return 'USED';
  }

  if (nosanaExecution.queueStatus === 'QUEUED_MOCK') {
    return 'MOCKED';
  }

  return 'PLANNED';
}

export function nosanaToolReason(nosanaExecution: NosanaExecution): string {
  const status = nosanaToolStatus(nosanaExecution);
  if (status === 'BLOCKED') {
    return `BLOCKED: ${nosanaExecution.reason}`;
  }
  if (status === 'SKIPPED') {
    return `SKIPPED: ${nosanaExecution.reason}`;
  }
  if (nosanaExecution.queueStatus === 'AWAITING_GOVERNANCE_APPROVAL') {
    return `PLANNED: ${nosanaExecution.reason}`;
  }
  if (nosanaExecution.queueStatus === 'QUEUED_LIVE') {
    return `USED: ${nosanaExecution.reason}`;
  }
  return `${status}: ${nosanaExecution.reason}`;
}
