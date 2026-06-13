import type { AgentIntakeRequest } from '../schemas/agentIntakeSchema.js';
import { COMPANY_POLICY } from '../config/companyPolicy.js';

const EMPLOYER_PATTERN =
  /\b(?:employer(?:\s+name)?|company(?:\s+name)?)\s+([A-Za-z0-9][A-Za-z0-9\s&.-]{2,60})/i;

export type PublicQueryResult = {
  allowed: boolean;
  publicQuery: string;
  blockedReason?: string;
  extractedTerms: string[];
};

export function extractPublicQuery(content: string, needsPublicWeb: boolean): PublicQueryResult {
  const extractedTerms: string[] = [];
  let publicQuery = '';

  const employerMatch = content.match(EMPLOYER_PATTERN);
  if (employerMatch?.[1]) {
    publicQuery = employerMatch[1].trim();
    extractedTerms.push(publicQuery);
  }

  if (!publicQuery && needsPublicWeb) {
    const genericCompany = content.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g);
    if (genericCompany?.length) {
      const candidate = genericCompany.find(
        (name) => !COMPANY_POLICY.blockedExternalFields.some((b) => name.toLowerCase().includes(b)),
      );
      if (candidate) {
        publicQuery = candidate;
        extractedTerms.push(candidate);
      }
    }
  }

  const containsBlocked = COMPANY_POLICY.blockedExternalFields.some((field) =>
    publicQuery.toLowerCase().includes(field),
  );

  if (containsBlocked) {
    return {
      allowed: false,
      publicQuery: '',
      blockedReason: 'Extracted query contained blocked private field terms.',
      extractedTerms,
    };
  }

  return {
    allowed: Boolean(publicQuery),
    publicQuery,
    extractedTerms,
  };
}

export function buildEnrichmentPlan(
  content: string,
  needsPublicWeb: boolean,
  privateDataDetected: boolean,
): { allowed: boolean; publicQuery: string; blockedReason?: string } {
  if (privateDataDetected && !needsPublicWeb) {
    return {
      allowed: false,
      publicQuery: '',
      blockedReason: 'Enrichment skipped — case contains private data and no public web need declared.',
    };
  }

  const extracted = extractPublicQuery(content, needsPublicWeb);

  if (privateDataDetected && extracted.publicQuery) {
    return {
      allowed: true,
      publicQuery: extracted.publicQuery,
      blockedReason: undefined,
    };
  }

  if (!extracted.allowed) {
    return {
      allowed: false,
      publicQuery: '',
      blockedReason: extracted.blockedReason ?? 'No safe public query available.',
    };
  }

  return { allowed: true, publicQuery: extracted.publicQuery };
}

export function hintsNeedPublicWeb(request: AgentIntakeRequest): boolean {
  return Boolean(request.hints?.needsPublicWeb);
}
