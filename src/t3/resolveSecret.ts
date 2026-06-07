import type { TenantClient } from '@terminal3/t3n-sdk';

const SECRETS_MAP_TAIL = 'secrets';

/**
 * Read a sealed value from the tenant secrets map via T3N control plane.
 * Falls back to GEMINI_API_KEY env for local development when the map entry is absent.
 */
export async function resolveSecretFromMaps(
  tenant: TenantClient,
  key: string,
): Promise<string> {
  const mapName = tenant.canonicalName(SECRETS_MAP_TAIL);

  try {
    const result = await tenant.executeControl('map-entry-get', {
      map_name: mapName,
      key,
    });

    if (result && typeof result === 'object' && 'value' in result) {
      const value = (result as { value: unknown }).value;
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    // map-entry-get may be unavailable until secrets are seeded — fall through
  }

  return process.env.GEMINI_API_KEY?.trim() ?? '';
}
