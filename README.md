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

## Phase 2 — Build (later)

Once `docs/api/` is populated, ask Cursor to:

- generate typed client models from OpenAPI
- add integration tests from `examples.md`
- wire gateway calls into your app layer

## Phase 3 — Scale (later)

- env-based config, secrets, observability
- CI validation against the OpenAPI spec
- deployment and runbooks

## Quick start in Cursor

```
Read @docs/api/README.md and @docs/api/openapi.yaml.
Summarize auth, endpoints, and error handling for the T3 Compliance Gateway.
```
