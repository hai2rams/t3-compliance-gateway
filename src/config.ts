export type AppConfig = {
  port: number;
  t3nApiKey: string;
  t3nEnvironment: 'testnet' | 'production';
  t3nContractId: number;
  t3nContractTail: string;
  t3nContractVersion: string;
  complianceDefaults: Record<string, string>;
};

export function loadConfig(requireT3n = false): AppConfig {
  const apiKey = process.env.T3N_API_KEY?.trim() ?? '';
  if (requireT3n && !apiKey) {
    throw new Error('Missing required environment variable: T3N_API_KEY');
  }

  const contractIdRaw = process.env.T3N_CONTRACT_ID?.trim();
  const contractId = contractIdRaw ? Number(contractIdRaw) : NaN;

  const portParsed = Number(process.env.PORT);
  const port =
    Number.isInteger(portParsed) && portParsed > 0 && portParsed <= 65535
      ? portParsed
      : 4000;

  return {
    port,
    t3nApiKey: apiKey,
    t3nEnvironment:
      process.env.T3N_ENVIRONMENT === 'production' ? 'production' : 'testnet',
    t3nContractId: contractId,
    t3nContractTail: process.env.T3N_CONTRACT_TAIL?.trim() || 'compliance-gateway-v1',
    t3nContractVersion: process.env.T3N_CONTRACT_VERSION?.trim() || '0.1.0',
    complianceDefaults: {
      compliance_policy_version: process.env.COMPLIANCE_POLICY_VERSION?.trim() || '1.0.0',
      compliance_region: process.env.COMPLIANCE_REGION?.trim() || 'us',
      ...(process.env.AUDIT_WEBHOOK_SECRET?.trim()
        ? { audit_webhook_secret: process.env.AUDIT_WEBHOOK_SECRET.trim() }
        : {}),
    },
  };
}
