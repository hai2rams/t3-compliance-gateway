import type { SensitiveDataResult, SensitiveDataType } from '../schemas/complianceCheckSchema.js';

const PATTERNS: Array<{ type: SensitiveDataType; regex: RegExp }> = [
  { type: 'EMAIL', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'PHONE', regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { type: 'BANK_ACCOUNT', regex: /\b\d{8,17}\b/g },
  { type: 'CITIZEN_ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    type: 'CONFIDENTIAL_KEYWORD',
    regex: /\b(confidential|classified|ssn|social security|passport|secret)\b/gi,
  },
];

function redactMatch(type: SensitiveDataType): string {
  const labels: Record<SensitiveDataType, string> = {
    EMAIL: '[REDACTED_EMAIL]',
    PHONE: '[REDACTED_PHONE]',
    BANK_ACCOUNT: '[REDACTED_BANK_ACCOUNT]',
    CITIZEN_ID: '[REDACTED_CITIZEN_ID]',
    CONFIDENTIAL_KEYWORD: '[REDACTED_CONFIDENTIAL]',
  };
  return labels[type];
}

export function scanSensitiveData(content: string, containsPiiFlag: boolean): SensitiveDataResult {
  const types = new Set<SensitiveDataType>();
  let redactedPreview = content;

  for (const { type, regex } of PATTERNS) {
    if (regex.test(content)) {
      types.add(type);
      redactedPreview = redactedPreview.replace(regex, redactMatch(type));
    }
    regex.lastIndex = 0;
  }

  if (containsPiiFlag && types.size === 0) {
    types.add('CONFIDENTIAL_KEYWORD');
  }

  const detected = types.size > 0;

  return {
    detected,
    types: [...types],
    redactedPreview: detected ? redactedPreview : content.slice(0, 200),
  };
}
