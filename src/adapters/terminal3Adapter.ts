import type { TrustResult } from '../schemas/complianceCheckSchema.js';
import { loadConfig } from '../config.js';

export type Terminal3VerifyInput = {
  agentId: string;
  actionType: string;
  purpose: string;
};

export async function verifyAgentTrust(input: Terminal3VerifyInput): Promise<TrustResult> {
  const config = loadConfig();
  const hasApiKey = Boolean(config.t3nApiKey);

  if (!hasApiKey || process.env.MOCK_MODE === 'true') {
    return {
      provider: 'Terminal 3',
      status: 'MOCK_VERIFIED',
      contractMode: 'TEE_COMPLIANCE_GATEWAY',
    };
  }

  try {
    const { getT3Session } = await import('../t3/client.js');
    await getT3Session(config.t3nApiKey, config.t3nEnvironment);
    return {
      provider: 'Terminal 3',
      status: 'VERIFIED',
      contractMode: 'TEE_COMPLIANCE_GATEWAY',
    };
  } catch {
    return {
      provider: 'Terminal 3',
      status: 'FAILED',
      contractMode: 'TEE_COMPLIANCE_GATEWAY',
    };
  }
}
