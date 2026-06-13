import type {
  AgentIntakeRequest,
  InferredIntent,
  Modality,
} from '../schemas/agentIntakeSchema.js';
import {
  isDeclaredAnonymizedBatchInput,
  scanSensitiveDataForIntake,
  type AnonymizedBatchContext,
} from '../services/anonymizedBatchGuard.js';

export type IntakeAnalysis = {
  modalities: Modality[];
  detectedModality: string;
  inferredIntent: InferredIntent;
  selectedWorkflow: string;
  containsPii: boolean;
  amount: number;
};

export function runRegulatedIntakeAgent(request: AgentIntakeRequest): IntakeAnalysis {
  const content = request.content;
  const hints = request.hints ?? {};

  const modalities = detectModalities(content, hints);
  const inferredIntent = inferIntent(request.goal, content, hints, modalities);
  const detectedModality = formatDetectedModality(modalities, inferredIntent);
  const selectedWorkflow = mapWorkflow(inferredIntent);

  const amountMatch =
    inferredIntent === 'BATCH_RISK_SCAN' || hints.hasBatch
      ? null
      : content.match(/\b(?:SGD|USD|\$)\s*([\d,]+)/i) ?? content.match(/\b([\d,]+)\b/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;

  return {
    modalities,
    detectedModality,
    inferredIntent,
    selectedWorkflow,
    containsPii: detectPii(content, hints, inferredIntent),
    amount,
  };
}

function detectModalities(
  content: string,
  hints: NonNullable<AgentIntakeRequest['hints']>,
): Modality[] {
  const modalities = new Set<Modality>(['TEXT']);

  if (
    hints.hasFile ||
    /\b(passport|salary slip|bank statement|document|uploaded|invoice|claim)\b/i.test(content)
  ) {
    modalities.add('DOCUMENT');
  }
  if (hints.hasImage || /\b(image|photo|\.png|\.jpg)\b/i.test(content)) {
    modalities.add('IMAGE');
  } else if (
    /\bscan\b/i.test(content) &&
    !hints.hasBatch &&
    !modalities.has('BATCH') &&
    !/\bbatch\b/i.test(content)
  ) {
    modalities.add('IMAGE');
  }
  if (hints.hasAudio || /\baudio\b/i.test(content)) {
    modalities.add('AUDIO');
  }
  if (hints.hasVideo || /\bvideo\b/i.test(content)) {
    modalities.add('VIDEO');
  }
  if (hints.hasBatch || /\bbatch\b/i.test(content)) {
    modalities.add('BATCH');
  }
  if (hints.needsPublicWeb || /\b(employer|company name|public web)\b/i.test(content)) {
    modalities.add('WEB_RESEARCH');
  }

  if (hints.hasBatch || modalities.has('BATCH')) {
    modalities.delete('IMAGE');
    modalities.delete('DOCUMENT');
    modalities.delete('MIXED');
  }

  if (modalities.size > 2) modalities.add('MIXED');

  return [...modalities];
}

function inferIntent(
  goal: string,
  content: string,
  hints: NonNullable<AgentIntakeRequest['hints']>,
  modalities: Modality[],
): InferredIntent {
  const text = `${goal} ${content}`.toLowerCase();

  if (/\b(kyc|know your customer|loan|credit precheck|credit check)\b/i.test(text)) {
    return 'CREDIT_KYC_PRECHECK';
  }
  if (/\bvendor onboarding\b/i.test(text)) return 'VENDOR_ONBOARDING';
  if (/\bclaim\b/i.test(text)) return 'CLAIMS_REVIEW';
  if (hints.hasBatch || modalities.includes('BATCH') || /\bbatch\b/i.test(text)) {
    return 'BATCH_RISK_SCAN';
  }
  if (hints.hasVideo || modalities.includes('VIDEO')) return 'VIDEO_REVIEW';
  if (hints.needsPublicWeb || modalities.includes('WEB_RESEARCH')) {
    return 'PUBLIC_WEB_RESEARCH';
  }
  return 'GENERAL_REGULATED_CASE';
}

function formatDetectedModality(modalities: Modality[], intent: InferredIntent): string {
  if (intent === 'CREDIT_KYC_PRECHECK') {
    return 'DOCUMENT + TEXT';
  }
  if (intent === 'BATCH_RISK_SCAN') {
    return 'BATCH';
  }
  return modalities.filter((m) => m !== 'MIXED').join(' + ');
}

function mapWorkflow(intent: InferredIntent): string {
  switch (intent) {
    case 'CREDIT_KYC_PRECHECK':
      return 'CREDIT_KYC_PRECHECK';
    case 'BATCH_RISK_SCAN':
      return 'BATCH_RISK_SCAN';
    case 'VIDEO_REVIEW':
      return 'VIDEO_ANALYSIS';
    case 'CLAIMS_REVIEW':
      return 'CLAIMS_REVIEW';
    case 'VENDOR_ONBOARDING':
      return 'VENDOR_ONBOARDING';
    case 'PUBLIC_WEB_RESEARCH':
      return 'PUBLIC_WEB_RESEARCH';
    default:
      return 'GENERAL_REGULATED_CASE';
  }
}

function detectPii(
  content: string,
  hints: NonNullable<AgentIntakeRequest['hints']>,
  inferredIntent?: InferredIntent,
): boolean {
  if (
    isDeclaredAnonymizedBatchInput(content, {
      hasBatch: hints.hasBatch,
      inferredIntent,
    })
  ) {
    return false;
  }

  if (/\b(passport|salary|bank statement)\b/i.test(content)) {
    return true;
  }

  return scanSensitiveDataForIntake(content, true, {
    hasBatch: hints.hasBatch,
    inferredIntent,
    selectedWorkflow: inferredIntent === 'BATCH_RISK_SCAN' ? 'BATCH_RISK_SCAN' : undefined,
  }).detected;
}

export function buildAgentDataBoundary(
  content: string,
  context: AnonymizedBatchContext = {},
): {
  detected: boolean;
  types: string[];
  redactedPreview: string;
  privateBlockedFromExternal: boolean;
} {
  if (isDeclaredAnonymizedBatchInput(content, context)) {
    return {
      detected: false,
      types: [],
      redactedPreview: content.slice(0, 200),
      privateBlockedFromExternal: false,
    };
  }

  const base = scanSensitiveDataForIntake(content, true, context);
  const types = new Set<string>(base.types);

  const isBatchRisk =
    context.inferredIntent === 'BATCH_RISK_SCAN' ||
    context.hasBatch === true ||
    context.selectedWorkflow === 'BATCH_RISK_SCAN' ||
    context.selectedWorkflow === 'BULK_BATCH_JOB';

  if (!isBatchRisk) {
    if (/\bsalary\s+slip\b/i.test(content)) types.add('SALARY_DOCUMENT');
    if (/\bbank\s+statement\b/i.test(content)) types.add('BANK_ACCOUNT');
    if (/\bpassport\b/i.test(content)) {
      types.add('PASSPORT_ID');
      types.delete('CONFIDENTIAL_KEYWORD');
    }
    if (/\bsalary\b/i.test(content) && !types.has('SALARY_DOCUMENT')) {
      types.add('FINANCIAL_DOCUMENT');
    }
  }

  const ordered = [
    'PASSPORT_ID',
    'SALARY_DOCUMENT',
    'BANK_ACCOUNT',
    'FINANCIAL_DOCUMENT',
    'CLAIM_DOCUMENT',
    'CONFIDENTIAL_KEYWORD',
    'EMAIL',
    'PHONE',
    'CITIZEN_ID',
  ];

  const sorted = [...types].sort(
    (a, b) => (ordered.indexOf(a) === -1 ? 99 : ordered.indexOf(a)) -
      (ordered.indexOf(b) === -1 ? 99 : ordered.indexOf(b)),
  );

  return {
    detected: sorted.length > 0,
    types: sorted,
    redactedPreview: base.redactedPreview,
    privateBlockedFromExternal: sorted.length > 0,
  };
}
