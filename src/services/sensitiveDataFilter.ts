import type { SensitiveDataResult, SensitiveDataType } from '../schemas/complianceCheckSchema.js';

const PATTERNS: Array<{ type: SensitiveDataType; regex: RegExp }> = [
  { type: 'CLAIM_DOCUMENT', regex: /\bclaim\s+document\b/gi },
  {
    type: 'FINANCIAL_DOCUMENT',
    regex: /\b(salary\s+slip|bank\s+statement|payslip|pay\s+stub)\b/gi,
  },
  {
    type: 'PASSPORT_ID',
    regex: /\bpassport\s*(?:number|no|#|id)\s*[:#]?\s*[\w-]+/gi,
  },
  { type: 'EMAIL', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'PHONE', regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { type: 'BANK_ACCOUNT', regex: /\b(account\s+number|bank\s+account)\b/gi },
  { type: 'BANK_ACCOUNT', regex: /\b\d{8,17}\b/g },
  { type: 'CITIZEN_ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    type: 'CONFIDENTIAL_KEYWORD',
    regex: /\b(confidential|classified|ssn|social security|secret)\b/gi,
  },
];

const TYPE_DISPLAY_ORDER: SensitiveDataType[] = [
  'CONFIDENTIAL_KEYWORD',
  'CLAIM_DOCUMENT',
  'FINANCIAL_DOCUMENT',
  'PASSPORT_ID',
  'BANK_ACCOUNT',
  'CITIZEN_ID',
  'EMAIL',
  'PHONE',
];

function redactMatch(type: SensitiveDataType): string {
  const labels: Record<SensitiveDataType, string> = {
    EMAIL: '[REDACTED_EMAIL]',
    PHONE: '[REDACTED_PHONE]',
    BANK_ACCOUNT: '[REDACTED_BANK_ACCOUNT]',
    CITIZEN_ID: '[REDACTED_CITIZEN_ID]',
    PASSPORT_ID: '[REDACTED_PASSPORT]',
    FINANCIAL_DOCUMENT: '[REDACTED_FINANCIAL_DOC]',
    CLAIM_DOCUMENT: '[REDACTED_CLAIM_DOC]',
    CONFIDENTIAL_KEYWORD: '[REDACTED_CONFIDENTIAL]',
  };
  return labels[type];
}

function sortTypes(types: Set<SensitiveDataType>): SensitiveDataType[] {
  return [...types].sort(
    (a, b) => TYPE_DISPLAY_ORDER.indexOf(a) - TYPE_DISPLAY_ORDER.indexOf(b),
  );
}

export function scanSensitiveData(
  content: string,
  containsPiiFlag: boolean,
  options: { batchRiskScan?: boolean; videoWorkflowScan?: boolean } = {},
): SensitiveDataResult {
  const types = new Set<SensitiveDataType>();
  let redactedPreview = content;

  for (const { type, regex } of PATTERNS) {
    if (regex.test(content)) {
      types.add(type);
      redactedPreview = redactedPreview.replace(regex, redactMatch(type));
    }
    regex.lastIndex = 0;
  }

  // Passport mentioned without a structured ID still signals confidential PII in claim context.
  if (
    !options.batchRiskScan &&
    /\bpassport\b/i.test(content) &&
    !types.has('PASSPORT_ID')
  ) {
    types.add('CONFIDENTIAL_KEYWORD');
    redactedPreview = redactedPreview.replace(/\bpassport\b/gi, redactMatch('CONFIDENTIAL_KEYWORD'));
  }

  if (containsPiiFlag && types.size === 0 && !options.batchRiskScan && !options.videoWorkflowScan) {
    types.add('CONFIDENTIAL_KEYWORD');
  }

  const detected = types.size > 0;

  return {
    detected,
    types: sortTypes(types),
    redactedPreview: detected ? redactedPreview : content.slice(0, 200),
  };
}
