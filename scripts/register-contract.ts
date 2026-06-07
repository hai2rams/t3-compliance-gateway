import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { getT3Session } from '../src/t3/client.js';

const WASM_PATH = resolve(
  'contracts/compliance-gateway/target/wasm32-wasip2/release/compliance_gateway.wasm',
);

type RegisterResult = {
  contract_id?: number;
  contractId?: number;
};

function extractContractId(result: unknown): number {
  if (!result || typeof result !== 'object') {
    throw new Error('Unexpected register response shape');
  }

  const payload = result as RegisterResult;
  const contractId = payload.contract_id ?? payload.contractId;

  if (typeof contractId !== 'number' || !Number.isInteger(contractId)) {
    throw new Error(`Register succeeded but contract id was missing: ${JSON.stringify(result)}`);
  }

  return contractId;
}

async function updateEnvContractId(contractId: number): Promise<void> {
  const envPath = resolve('.env');
  let contents: string;

  try {
    contents = await readFile(envPath, 'utf8');
  } catch {
    contents = '';
  }

  const line = `T3N_CONTRACT_ID=${contractId}`;
  if (/^T3N_CONTRACT_ID=.*$/m.test(contents)) {
    contents = contents.replace(/^T3N_CONTRACT_ID=.*$/m, line);
  } else {
    contents = contents.trimEnd() + (contents.endsWith('\n') || contents.length === 0 ? '' : '\n') + `${line}\n`;
  }

  await writeFile(envPath, contents, 'utf8');
}

async function main(): Promise<void> {
  const config = loadConfig(true);
  const contractTail = process.env.T3N_CONTRACT_TAIL?.trim() || 'compliance-gateway-v1';
  const contractVersion = process.env.T3N_CONTRACT_VERSION?.trim() || '0.1.0';

  const wasmBytes = await readFile(WASM_PATH);
  const { tenant, tenantDid } = await getT3Session(config.t3nApiKey, config.t3nEnvironment);

  console.log(`[register] tenant: ${tenantDid}`);
  console.log(`[register] tail: ${contractTail}`);
  console.log(`[register] version: ${contractVersion}`);
  console.log(`[register] wasm: ${WASM_PATH} (${wasmBytes.byteLength} bytes)`);

  const result = await tenant.contracts.register({
    tail: contractTail,
    version: contractVersion,
    wasm: wasmBytes,
  });

  const contractId = extractContractId(result);
  const tenantId = tenantDid.replace(/^did:t3n:/, '');
  const scriptName = `z:${tenantId}:${contractTail}`;

  await updateEnvContractId(contractId);

  console.log('');
  console.log('Registration complete.');
  console.log(`  script name:  ${scriptName}`);
  console.log(`  contract id:  ${contractId}`);
  console.log('');
  console.log('Updated .env with T3N_CONTRACT_ID.');
  console.log('Next: npm run init:compliance');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[register] failed: ${message}`);
  process.exit(1);
});
