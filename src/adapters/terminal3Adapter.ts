import type { TrustResult } from '../schemas/complianceCheckSchema.js';
import { loadConfig } from '../config.js';
import { isGlobalMockMode } from '../config/toolCapabilityMap.js';

export type Terminal3VerifyInput = {
  agentId: string;
  actionType: string;
  purpose: string;
};

function canUseLiveTerminal3(): boolean {
  const config = loadConfig();
  return (
    Boolean(config.t3nApiKey) &&
    !isGlobalMockMode() &&
    Number.isInteger(config.t3nContractId) &&
    config.t3nContractId > 0
  );
}

export async function verifyAgentTrust(input: Terminal3VerifyInput): Promise<TrustResult> {
  if (!canUseLiveTerminal3()) {
    return {
      provider: 'Terminal 3',
      status: 'MOCK_VERIFIED',
      contractMode: 'TEE_COMPLIANCE_GATEWAY',
    };
  }

  const config = loadConfig();

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
