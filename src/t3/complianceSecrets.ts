import type { TenantClient } from '@terminal3/t3n-sdk';

const SECRETS_MAP_TAIL = 'secrets';

/** Keys we track after sealing — values never leave the TEE map. */
const sealedKeyRegistry = new Set<string>();

export type ComplianceInitResult = {
  mapName: string;
  sealedKeys: string[];
  message: string;
};

export type ComplianceKeysView = {
  mapName: string;
  keys: Array<{ name: string; sealed: true }>;
  note: string;
};

/**
 * Creates the hardware-isolated secrets map and seeds compliance config keys.
 *
 * @see https://docs.terminal3.io/developers/adk/tips/create-kv-maps
 * @see https://docs.terminal3.io/developers/adk/tips/seed-api-key
 */
export async function initializeComplianceSecrets(
  tenant: TenantClient,
  contractId: number,
  entries: Record<string, string>,
): Promise<ComplianceInitResult> {
  if (!Number.isInteger(contractId) || contractId < 0) {
    throw new Error('T3N_CONTRACT_ID must be a non-negative integer contract id');
  }

  const mapName = tenant.canonicalName(SECRETS_MAP_TAIL);

  await tenant.maps.create({
    tail: SECRETS_MAP_TAIL,
    visibility: 'private',
    writers: { only: [contractId] },
    readers: { only: [contractId] },
  });

  const sealedKeys: string[] = [];

  for (const [key, value] of Object.entries(entries)) {
    if (!value.trim()) {
      continue;
    }

    await tenant.executeControl('map-entry-set', {
      map_name: mapName,
      key,
      value,
    });

    sealedKeyRegistry.add(key);
    sealedKeys.push(key);
  }

  return {
    mapName,
    sealedKeys,
    message:
      'Compliance keys sealed in z::<tenant>:secrets. Values are only readable inside your TEE contract.',
  };
}

/**
 * Returns metadata for sealed keys. Secret values cannot be read back via the
 * tenant SDK — only your TEE contract can call kv_store::get inside the enclave.
 */
export function listComplianceConfigKeys(tenant: TenantClient): ComplianceKeysView {
  return {
    mapName: tenant.canonicalName(SECRETS_MAP_TAIL),
    keys: [...sealedKeyRegistry].sort().map((name) => ({ name, sealed: true as const })),
    note:
      'Sealed values are not exposed by this gateway. Invoke your TEE contract to use secrets at runtime.',
  };
}
