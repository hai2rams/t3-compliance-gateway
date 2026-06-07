# T3 Compliance Gateway — API reference

Indexed from [Terminal 3 ADK documentation](https://docs.terminal3.io/developers/adk/overview/what-is-adk).

## External: Terminal 3 Network (T3N)

| Item | Value |
|------|-------|
| SDK | `@terminal3/t3n-sdk` |
| Docs index | https://docs.terminal3.io/llms.txt |
| OpenAPI | https://docs.terminal3.io/api-reference/openapi.json |
| Environment | `testnet` or `production` via `setEnvironment()` |

### Secrets map (hardware-isolated)

1. **Create map** — `tenant.maps.create({ tail: "secrets", visibility: "private", writers/readers: { only: [contractId] } })`
2. **Seed keys** — `tenant.executeControl("map-entry-set", { map_name, key, value })`
3. **Read at runtime** — only inside TEE contract via `kv_store::get("secrets", key)`; not readable via gateway

## Local gateway (this repo)

Base URL: `http://localhost:3000`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| POST | `/api/v1/compliance/config/initialize` | Create secrets map + seal compliance keys |
| GET | `/api/v1/compliance/config/keys` | List sealed key names (not values) |
| POST | `/api/v1/compliance/config/read-via-contract` | Outline: read derived compliance state via TEE contract |

## Environment

See `.env.example` — requires `T3N_API_KEY`, `T3N_CONTRACT_ID`, and optional compliance defaults.

## TEE contract (this repo)

| Path | Purpose |
|------|---------|
| `contracts/compliance-gateway/` | Rust WASM contract |
| `scripts/register-contract.ts` | Register contract → `T3N_CONTRACT_ID` |
| `scripts/init-compliance.ts` | Seal keys into `z::<tenant>:secrets` |

```bash
npm run build:contract
npm run register:contract
npm run init:compliance
```

## Source docs

- [Write TEE contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract)
- [Register TEE contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract)
- [Create tenant KV maps](https://docs.terminal3.io/developers/adk/tips/create-kv-maps.md)
- [Seed API key into secrets map](https://docs.terminal3.io/developers/adk/tips/seed-api-key.md)
