import type { InferredIntent } from '../schemas/agentIntakeSchema.js';
import type { SensitiveDataResult } from '../schemas/complianceCheckSchema.js';
import { scanSensitiveData } from './sensitiveDataFilter.js';

export type AnonymizedBatchContext = {
  hasBatch?: boolean;
  hasVideo?: boolean;
  hasAudio?: boolean;
  inferredIntent?: InferredIntent | string;
  selectedWorkflow?: string;
};

const ANONYMIZED_BATCH_WORDING = /\b(anonymized|tokenized|synthetic|aggregated)\b/i;

const NO_RAW_IDENTIFIER_DECLARATIONS = [
  /\bno\s+raw\s+personal\s+identifiers?\b/i,
  /\bcontains\s+no\s+raw\s+personal\s+identifiers?\b/i,
  /\bno\s+(?:raw\s+)?pii\b/i,
  /\bcontains\s+no\s+(?:raw\s+)?pii\b/i,
  /\bno\s+names?\b/i,
  /\bno\s+account\s+numbers?\b/i,
  /\bno\s+emails?\b/i,
  /\bno\s+phone\s+numbers?\b/i,
  /\banonymized\s+transaction\s+records?\b/i,
];

const NEGATION_MASK_PATTERNS = [
  /\bno\s+names?\b/gi,
  /\bno\s+account\s+numbers?\b/gi,
  /\bno\s+emails?\b/gi,
  /\bno\s+phone\s+numbers?\b/gi,
  /\bno\s+(?:raw\s+)?pii\b/gi,
  /\bcontains\s+no\s+(?:raw\s+)?pii\b/gi,
  /\bno\s+raw\s+personal\s+identifiers?\b/gi,
  /\bcontains\s+no\s+raw\s+personal\s+identifiers?\b/gi,
];

function isBatchContext(content: string, context: AnonymizedBatchContext): boolean {
  return (
    context.hasBatch === true ||
    context.inferredIntent === 'BATCH_RISK_SCAN' ||
    context.selectedWorkflow === 'BULK_BATCH_JOB' ||
    context.selectedWorkflow === 'BATCH_RISK_SCAN' ||
    /\bbatch\b/i.test(content)
  );
}

function hasAnonymizedBatchWording(content: string): boolean {
  return ANONYMIZED_BATCH_WORDING.test(content);
}

function hasNoRawIdentifierDeclaration(content: string): boolean {
  return NO_RAW_IDENTIFIER_DECLARATIONS.some((pattern) => pattern.test(content));
}

/** True only when structured identifier values are present — not negated absence phrases. */
export function hasActualPiiValues(content: string): boolean {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content)) return true;
  if (/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(content)) return true;
  if (/\bpassport\s*(?:number|no|#|id)\s*[:#]?\s*[\w-]+/i.test(content)) return true;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) return true;
  if (/\b[STFG]\d{7}[A-Z]\b/i.test(content)) return true;
  if (/\b\d{8,17}\b/.test(content)) return true;
  return false;
}

function maskNegatedAbsencePhrases(content: string): string {
  let masked = content;
  for (const pattern of NEGATION_MASK_PATTERNS) {
    masked = masked.replace(pattern, '[ABSENCE_DECLARED]');
  }
  return masked;
}

export function isDeclaredAnonymizedBatchInput(
  content: string,
  context: AnonymizedBatchContext = {},
): boolean {
  if (!isBatchContext(content, context)) return false;
  if (!hasAnonymizedBatchWording(content)) return false;
  if (!hasNoRawIdentifierDeclaration(content)) return false;
  if (hasActualPiiValues(content)) return false;
  return true;
}

export function cleanAnonymizedBatchSensitiveResult(content: string): SensitiveDataResult {
  return {
    detected: false,
    types: [],
    redactedPreview: content.slice(0, 200),
  };
}

export function scanSensitiveDataForIntake(
  content: string,
  containsPiiFlag: boolean,
  context: AnonymizedBatchContext = {},
): SensitiveDataResult {
  if (isDeclaredAnonymizedBatchInput(content, context)) {
    return cleanAnonymizedBatchSensitiveResult(content);
  }

  const batchContext = isBatchContext(content, context);
  const videoContext =
    context.inferredIntent === 'VIDEO_REVIEW' ||
    context.hasVideo === true ||
    context.selectedWorkflow === 'VIDEO_REVIEW' ||
    context.selectedWorkflow === 'VIDEO_ANALYSIS';
  const scanContent = batchContext ? maskNegatedAbsencePhrases(content) : content;
  const effectiveContainsPiiFlag =
    (batchContext && context.inferredIntent === 'BATCH_RISK_SCAN') || videoContext
      ? false
      : containsPiiFlag;

  return scanSensitiveData(scanContent, effectiveContainsPiiFlag, {
    batchRiskScan: batchContext && context.inferredIntent === 'BATCH_RISK_SCAN',
    videoWorkflowScan: videoContext,
  });
}

export function isAnonymizedBatchEligibleForPolicy(
  request: {
    content: string;
    actionType: string;
    workflowType?: string;
    jobMode?: string;
    needsGpu?: boolean;
    estimatedRecords?: number;
    containsPii?: boolean;
  },
  sensitiveData: SensitiveDataResult,
): boolean {
  const batchIntent =
    request.actionType === 'BATCH_RISK_SCAN' ||
    request.actionType === 'BATCH_ANALYSIS' ||
    request.workflowType === 'BULK_BATCH_JOB' ||
    request.jobMode === 'BATCH';

  const batchComputeContext =
    request.needsGpu === true ||
    /\b(gpu|batch\s+compute)\b/i.test(request.content) ||
    (request.estimatedRecords ?? 0) >= 5_000;

  return (
    batchIntent &&
    batchComputeContext &&
    !request.containsPii &&
    !sensitiveData.detected &&
    isDeclaredAnonymizedBatchInput(request.content, {
      hasBatch: request.jobMode === 'BATCH' || request.workflowType === 'BULK_BATCH_JOB',
      inferredIntent: request.actionType,
      selectedWorkflow: request.workflowType,
    })
  );
}
