import type {
  DaytonaExecution,
  FinalAgentState,
  InferredIntent,
  T3Governance,
} from '../schemas/agentIntakeSchema.js';
import type { ToolChainStatus } from '../config/toolCapabilityMap.js';
import { isGlobalMockMode } from '../config/toolCapabilityMap.js';
import { routeClaimsSandbox } from '../adapters/daytonaAdapter.js';

export type DaytonaExecutionInput = {
  missionId: string;
  agentId: string;
  inferredIntent: InferredIntent;
  selectedWorkflow: string;
  finalAgentState: FinalAgentState;
  t3Governance: T3Governance;
  dataBoundary: {
    detected: boolean;
    types: string[];
    privateBlockedFromExternal: boolean;
  };
  sensitiveDataDetected: boolean;
  detectedSensitiveTypes: string[];
  executionPlan: Record<string, unknown>;
  policyId: string;
  promptInjectionBlocked?: boolean;
  intentControlBlocked?: boolean;
};

const SAFE_COMMANDS: Record<string, string> = {
  CREDIT_KYC_PRECHECK: 'validate-kyc-package --input redacted_case.json',
  CLAIMS_REVIEW: 'validate-claims-package --input redacted_case.json',
  VENDOR_ONBOARDING: 'validate-vendor-documents --input redacted_case.json',
  GENERAL_REGULATED_CASE: 'validate-regulated-documents --input redacted_case.json',
  PUBLIC_WEB_RESEARCH: 'validate-regulated-documents --input redacted_case.json',
};

const CONTAINER_IMAGES: Record<string, string> = {
  CREDIT_KYC_PRECHECK: 'kyc-document-validator:latest',
  CLAIMS_REVIEW: 'regulated-doc-sandbox:latest',
  VENDOR_ONBOARDING: 'regulated-doc-sandbox:latest',
};

const DEFAULT_ARTIFACTS = [
  'validation_report.json',
  'redaction_summary.json',
  'audit_manifest.json',
];

function canUseLiveDaytona(): boolean {
  if (isGlobalMockMode()) return false;
  return Boolean(process.env.DAYTONA_API_KEY?.trim());
}

function isDaytonaRelevant(intent: InferredIntent, targetRuntime: string): boolean {
  if (targetRuntime !== 'Daytona') return false;
  if (intent === 'BATCH_RISK_SCAN' || intent === 'VIDEO_REVIEW') return false;
  return true;
}

function resolveContainerImage(intent: InferredIntent): string {
  return CONTAINER_IMAGES[intent] ?? 'regulated-doc-sandbox:latest';
}

function resolvePlannedCommand(intent: InferredIntent): string {
  return SAFE_COMMANDS[intent] ?? SAFE_COMMANDS.GENERAL_REGULATED_CASE;
}

function buildSafetyNotes(sensitiveDataDetected: boolean, intent?: InferredIntent): string[] {
  if (sensitiveDataDetected || intent === 'CREDIT_KYC_PRECHECK' || intent === 'CLAIMS_REVIEW') {
    return [
      'No raw sensitive KYC data is passed to the sandbox.',
      'Only redacted input is eligible for runtime execution.',
      'External network access is disabled by default.',
      'Execution is held until governance approval.',
    ];
  }

  return [
    'Predefined command whitelist only — arbitrary user commands are never executed.',
    'External network access is disabled by default.',
    'Execution is held until governance approval.',
  ];
}

function skippedExecution(
  reason: string,
  intent: InferredIntent,
): DaytonaExecution {
  return {
    provider: 'Daytona',
    mode: 'MOCK',
    allowedToDispatch: false,
    dispatchStatus: 'NOT_DISPATCHED',
    executionMode: 'Docker Sandbox',
    jobClass: 'LIGHT_DOCUMENT_SANDBOX',
    containerImage: resolveContainerImage(intent),
    workspace: {
      type: 'EPHEMERAL_SANDBOX',
      persistence: 'EPHEMERAL',
      ttlMinutes: 30,
    },
    inputPolicy: {
      rawSensitiveDataAllowed: false,
      redactedInputOnly: true,
      externalNetwork: 'DISABLED_BY_DEFAULT',
      secretsInjected: false,
    },
    resourceLimits: {
      cpu: '1 vCPU',
      memory: '1GB',
      timeoutSeconds: 300,
    },
    plannedCommand: '',
    artifacts: [],
    reason,
    safetyNotes: buildSafetyNotes(false),
  };
}

function blockedExecution(
  reason: string,
  intent: InferredIntent,
): DaytonaExecution {
  return {
    provider: 'Daytona',
    mode: 'MOCK',
    allowedToDispatch: false,
    dispatchStatus: 'BLOCKED',
    executionMode: 'Docker Sandbox',
    jobClass: 'LIGHT_DOCUMENT_SANDBOX',
    containerImage: resolveContainerImage(intent),
    workspace: {
      type: 'EPHEMERAL_SANDBOX',
      persistence: 'EPHEMERAL',
      ttlMinutes: 0,
    },
    inputPolicy: {
      rawSensitiveDataAllowed: false,
      redactedInputOnly: true,
      externalNetwork: 'DISABLED_BY_DEFAULT',
      secretsInjected: false,
    },
    resourceLimits: {
      cpu: '1 vCPU',
      memory: '1GB',
      timeoutSeconds: 300,
    },
    plannedCommand: '',
    artifacts: [],
    reason,
    safetyNotes: [
      'Arbitrary user commands are never derived from uploaded content.',
      ...buildSafetyNotes(true),
    ],
  };
}

export function buildDaytonaExecutionPlan(input: DaytonaExecutionInput): DaytonaExecution {
  const targetRuntime = String(input.executionPlan.targetRuntime ?? 'NONE');

  if (input.promptInjectionBlocked || input.intentControlBlocked) {
    return blockedExecution(
      'Daytona execution blocked — untrusted content or policy block active. No planned command derived from user input.',
      input.inferredIntent,
    );
  }

  if (input.finalAgentState === 'AUTO_BLOCKED_BY_POLICY') {
    return blockedExecution(
      'Daytona execution blocked — policy denied runtime dispatch.',
      input.inferredIntent,
    );
  }

  if (input.inferredIntent === 'BATCH_RISK_SCAN') {
    return skippedExecution(
      'Daytona skipped — Nosana remains the target runtime for batch risk scans.',
      input.inferredIntent,
    );
  }

  if (input.inferredIntent === 'VIDEO_REVIEW') {
    return skippedExecution(
      'Daytona skipped — VideoDB remains the target runtime for secure video review.',
      input.inferredIntent,
    );
  }

  if (!isDaytonaRelevant(input.inferredIntent, targetRuntime)) {
    return skippedExecution(
      `Daytona skipped — ${targetRuntime} is the planned runtime for this workflow.`,
      input.inferredIntent,
    );
  }

  const liveEligible = canUseLiveDaytona();
  let mode: DaytonaExecution['mode'] = liveEligible ? 'LIVE' : 'MOCK';
  const sensitive = input.sensitiveDataDetected || input.dataBoundary.privateBlockedFromExternal;
  const workspacePersistence = sensitive ? 'STATEFUL' : 'EPHEMERAL';
  const workspaceType = sensitive ? 'STATEFUL_SANDBOX' : 'EPHEMERAL_SANDBOX';
  const plannedCommand = resolvePlannedCommand(input.inferredIntent);
  const containerImage =
    String(input.executionPlan.containerImage ?? '') || resolveContainerImage(input.inferredIntent);

  if (input.finalAgentState === 'AUTO_HOLD_REVIEW_REQUIRED') {
    return {
      provider: 'Daytona',
      mode,
      allowedToDispatch: false,
      dispatchStatus: 'AWAITING_GOVERNANCE_APPROVAL',
      executionMode: 'Docker Sandbox',
      jobClass: String(input.executionPlan.jobClass ?? 'LIGHT_DOCUMENT_SANDBOX'),
      containerImage,
      workspace: {
        type: workspaceType,
        persistence: workspacePersistence,
        ttlMinutes: 30,
      },
      inputPolicy: {
        rawSensitiveDataAllowed: false,
        redactedInputOnly: true,
        externalNetwork: 'DISABLED_BY_DEFAULT',
        secretsInjected: false,
      },
      resourceLimits: {
        cpu: '1 vCPU',
        memory: '1GB',
        timeoutSeconds: 300,
      },
      plannedCommand,
      artifacts: [...DEFAULT_ARTIFACTS],
      reason:
        'Sensitive regulated package requires governance approval before Daytona sandbox execution.',
      safetyNotes: buildSafetyNotes(sensitive, input.inferredIntent),
    };
  }

  if (
    input.finalAgentState === 'EXECUTION_QUEUED' ||
    input.finalAgentState === 'AUTO_EXECUTION_APPROVED'
  ) {
    if (liveEligible) {
      try {
        routeClaimsSandbox(
          {
            agentId: input.agentId,
            useCase: 'finance',
            userRole: 'regulated_agent',
            actionType: input.inferredIntent,
            dataSensitivity: sensitive ? 'HIGH' : 'MEDIUM',
            toolRequested: 'daytona_sandbox',
            purpose: input.selectedWorkflow,
            content: '',
            containsPii: sensitive,
            externalSharing: false,
            amount: 0,
          },
          input.missionId,
        );
      } catch {
        mode = 'MOCK';
      }
    }

    const dispatchStatus: DaytonaExecution['dispatchStatus'] =
      mode === 'LIVE' ? 'QUEUED_LIVE' : 'QUEUED_MOCK';

    return {
      provider: 'Daytona',
      mode,
      allowedToDispatch: true,
      dispatchStatus,
      executionMode: 'Docker Sandbox',
      jobClass: String(input.executionPlan.jobClass ?? 'LIGHT_DOCUMENT_SANDBOX'),
      containerImage,
      workspace: {
        type: workspaceType,
        persistence: workspacePersistence,
        ttlMinutes: 30,
      },
      inputPolicy: {
        rawSensitiveDataAllowed: false,
        redactedInputOnly: true,
        externalNetwork: 'DISABLED_BY_DEFAULT',
        secretsInjected: false,
      },
      resourceLimits: {
        cpu: '1 vCPU',
        memory: '1GB',
        timeoutSeconds: 300,
      },
      plannedCommand,
      artifacts: [...DEFAULT_ARTIFACTS],
      reason:
        mode === 'LIVE'
          ? 'Governance-approved Daytona sandbox queued with redacted-input-only policy.'
          : 'Mock-safe Daytona execution plan queued — live dispatch requires Daytona credentials.',
      safetyNotes: buildSafetyNotes(sensitive, input.inferredIntent),
    };
  }

  return {
    provider: 'Daytona',
    mode,
    allowedToDispatch: false,
    dispatchStatus: 'NOT_DISPATCHED',
    executionMode: 'Docker Sandbox',
    jobClass: String(input.executionPlan.jobClass ?? 'LIGHT_DOCUMENT_SANDBOX'),
    containerImage,
    workspace: {
      type: workspaceType,
      persistence: workspacePersistence,
      ttlMinutes: 30,
    },
    inputPolicy: {
      rawSensitiveDataAllowed: false,
      redactedInputOnly: true,
      externalNetwork: 'DISABLED_BY_DEFAULT',
      secretsInjected: false,
    },
    resourceLimits: {
      cpu: '1 vCPU',
      memory: '1GB',
      timeoutSeconds: 300,
    },
    plannedCommand,
    artifacts: [...DEFAULT_ARTIFACTS],
    reason: 'Daytona execution plan prepared — dispatch not permitted for current agent state.',
    safetyNotes: buildSafetyNotes(sensitive, input.inferredIntent),
  };
}

export function buildExecutionPlanFromDaytonaExecution(
  daytonaExecution: DaytonaExecution,
  base: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    provider: daytonaExecution.provider,
    executionMode: daytonaExecution.executionMode,
    jobClass: daytonaExecution.jobClass,
    containerImage: daytonaExecution.containerImage,
    dispatchStatus: daytonaExecution.dispatchStatus,
    allowedToDispatch: daytonaExecution.allowedToDispatch,
    mode: daytonaExecution.mode,
    workspace: daytonaExecution.workspace,
    inputPolicy: daytonaExecution.inputPolicy,
    resourceLimits: daytonaExecution.resourceLimits,
    plannedCommand: daytonaExecution.plannedCommand,
    artifacts: daytonaExecution.artifacts,
    safetyNotes: daytonaExecution.safetyNotes,
    reason: daytonaExecution.reason,
    status:
      daytonaExecution.dispatchStatus === 'AWAITING_GOVERNANCE_APPROVAL'
        ? 'AWAITING_GOVERNANCE_APPROVAL'
        : base.status,
  };
}

export function daytonaToolStatus(daytonaExecution: DaytonaExecution): ToolChainStatus {
  if (daytonaExecution.dispatchStatus === 'BLOCKED') {
    return 'BLOCKED';
  }

  if (daytonaExecution.reason.toLowerCase().includes('skipped')) {
    return 'SKIPPED';
  }

  if (daytonaExecution.dispatchStatus === 'AWAITING_GOVERNANCE_APPROVAL') {
    return 'PLANNED';
  }

  if (daytonaExecution.dispatchStatus === 'QUEUED_LIVE') {
    return 'USED';
  }

  if (
    daytonaExecution.dispatchStatus === 'QUEUED_MOCK' ||
    (daytonaExecution.dispatchStatus === 'NOT_DISPATCHED' && daytonaExecution.mode === 'MOCK')
  ) {
    return 'MOCKED';
  }

  return 'PLANNED';
}

export function daytonaToolReason(daytonaExecution: DaytonaExecution): string {
  const status = daytonaToolStatus(daytonaExecution);
  if (status === 'BLOCKED') {
    return `BLOCKED: ${daytonaExecution.reason}`;
  }
  if (status === 'SKIPPED') {
    return `SKIPPED: ${daytonaExecution.reason}`;
  }
  if (daytonaExecution.dispatchStatus === 'AWAITING_GOVERNANCE_APPROVAL') {
    return `PLANNED: ${daytonaExecution.reason} Redacted-input-only sandbox.`;
  }
  if (daytonaExecution.dispatchStatus === 'QUEUED_LIVE') {
    return `USED: ${daytonaExecution.reason}`;
  }
  return `${status}: ${daytonaExecution.reason} Redacted-input-only sandbox; governance approval required before dispatch.`;
}
