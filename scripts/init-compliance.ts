import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { getT3Session } from '../src/t3/client.js';
import { initializeComplianceSecrets } from '../src/t3/complianceSecrets.js';

async function main(): Promise<void> {
  const config = loadConfig(true);
  const { tenant, tenantDid } = await getT3Session(config.t3nApiKey, config.t3nEnvironment);

  const result = await initializeComplianceSecrets(
    tenant,
    config.t3nContractId,
    config.complianceDefaults,
  );

  console.log('Compliance secrets initialized.');
  console.log(`  tenant: ${tenantDid}`);
  console.log(`  map:    ${result.mapName}`);
  console.log(`  keys:   ${result.sealedKeys.join(', ') || '(none)'}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[init-compliance] failed: ${message}`);
  process.exit(1);
});
