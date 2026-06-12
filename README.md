# T3 Compliance Gateway

Docs-first project for integrating with the T3 Compliance Gateway API.

This repo is intentionally separate from other hackathon work. **Phase 1 is indexing API documentation** so Cursor can help with implementation later.

## Phased plan

| Phase | Goal | Status |
|-------|------|--------|
| 1 | Index API docs in this repo + Cursor | **Current** |
| 2 | Scaffold client/service code from the spec | Next |
| 3 | Scale: auth, retries, tests, deployment | Later |

## Phase 1 — Index the API (do this first)

### A. Add docs to this repo

Put canonical API material under `docs/api/`:

```
docs/api/
├── README.md       # base URL, auth, common flows
├── openapi.yaml    # or openapi.json — preferred if available
└── examples.md     # real request/response samples
```

If the API exposes OpenAPI:

```bash
# example — adjust URL to your gateway
curl http://localhost:8080/openapi.json -o docs/api/openapi.json
```

### B. Tell Cursor about the docs

1. Open this folder in Cursor: `cursor ~/Projects/t3-compliance-gateway`
2. In Agent chat, attach docs when asking for help:
   - `@docs/api/openapi.yaml`
   - `@docs/api/README.md`
3. Optional — public docs URL: chat → `@Docs` → **Add new doc**

### C. Reindex after changes

Command Palette → **Reindex** (or restart Cursor) after adding/updating spec files.

## Phase 2 — TEE contract + registration

```bash
# 1. Build WASM contract (requires Rust + wasm32-wasip2)
npm run build:contract

# 2. Register on T3N (writes T3N_CONTRACT_ID to .env)
npm run register:contract

# 3. Seal compliance keys into hardware-isolated secrets map
npm run init:compliance

# 4. Start gateway (default port 4000 — use another port if 3000 is taken locally)
cp .env.example .env
PORT=4000 MOCK_MODE=true npm start
```

Demo UI: http://localhost:4000/

### Regulated AI workflows (`/api/v1/compliance/check`)

All workflows pass through the same compliance gateway first:

**Sensitive Data Filter → Policy Engine → Risk Scoring → TokenRouter → Kimi / SenseNova / Gemini → Terminal 3 → ALLOW / DENY / REVIEW → Runtime Router**

| Workflow | `workflowType` | Runtime destination (when ALLOW) |
|----------|----------------|----------------------------------|
| Claims / Document Upload Review | `CLAIMS_REVIEW` | **Daytona** — `LIGHT_DOCUMENT_SANDBOX` |
| Bulk Batch Job | `BULK_BATCH_JOB` | **Nosana** — `HEAVY_BATCH_GPU` |
| Secure Video Analysis | `VIDEO_ANALYSIS` | **VideoDB** — `VIDEO_WORKFLOW` |

- **DENY** → runtime `NONE` / `BLOCKED` (no execution)
- **REVIEW** → runtime `NONE` / `AWAITING_APPROVAL` (human gate before execution)

Finance, government, and procurement **use-case policies** remain unchanged.

### TokenRouter vs Runtime Router

- **TokenRouter** chooses the **LLM reasoning provider** only (not where jobs execute).
- **Runtime Router** chooses where **approved** workloads execute (Daytona / Nosana / VideoDB).

LLM provider order for `/api/v1/compliance/check`:

1. **Kimi** — default primary sponsor LLM
2. **SenseNova** — optional fallback (vision/video workloads)
3. **Gemini** — legacy fallback (`LLM_PROVIDER=gemini` for explicit override)
4. **Mock** — safe local fallback when no API keys are set

The existing **`/api/v1/audit`** endpoint continues to use Gemini for its semantic layer.

All LLM and runtime providers are behind adapters. Runtime adapters (Daytona, Nosana, VideoDB) run in **mock mode** by default (`MOCK_MODE=true`).

Invoke the contract snapshot:

```bash
curl -X POST http://localhost:4000/api/v1/compliance/config/read-via-contract \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Phase 3 — Scale (later)

- typed client generation, integration tests, CI, deployment
- env-based config, secrets, observability
- CI validation against the OpenAPI spec

## Quick start in Cursor

```
Read @docs/api/README.md and @docs/api/openapi.yaml.
Summarize auth, endpoints, and error handling for the T3 Compliance Gateway.
```
