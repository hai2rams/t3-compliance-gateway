import {
  T3nClient,
  TenantClient,
  createEthAuthInput,
  eth_get_address,
  getNodeUrl,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
  type TenantSdkEnvironment,
} from '@terminal3/t3n-sdk';

export type T3Session = {
  t3n: T3nClient;
  tenant: TenantClient;
  tenantDid: string;
};

let sessionPromise: Promise<T3Session> | null = null;

/**
 * Bootstraps an authenticated T3n + Tenant client per Terminal 3 ADK docs:
 * handshake → SIWE auth → TenantClient bound to the session DID.
 */
export async function getT3Session(
  apiKey: string,
  environment: TenantSdkEnvironment,
): Promise<T3Session> {
  if (!sessionPromise) {
    sessionPromise = createT3Session(apiKey, environment);
  }
  return sessionPromise;
}

async function createT3Session(
  apiKey: string,
  environment: TenantSdkEnvironment,
): Promise<T3Session> {
  setEnvironment(environment);

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(apiKey);

  const t3n = new T3nClient({
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(address, undefined, apiKey),
    },
  });

  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  const tenantDid = did.value;

  const tenant = new TenantClient({
    t3n,
    baseUrl: getNodeUrl(),
    tenantDid,
    environment,
  });

  return { t3n, tenant, tenantDid };
}

export function resetT3Session(): void {
  sessionPromise = null;
}
