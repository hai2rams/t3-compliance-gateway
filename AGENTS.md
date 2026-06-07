# Agent guide — T3 Compliance Gateway

## Current phase

**Index API documentation first.** No application code yet.

## Source of truth

| File | Purpose |
|------|---------|
| `docs/api/openapi.yaml` | OpenAPI spec |
| `docs/api/README.md` | Auth, base URL, flows |
| `docs/api/examples.md` | Example requests/responses |

## Cursor usage

- Attach `@docs/api/openapi.yaml` and `@docs/api/README.md` in chat.
- After updating docs, run **Reindex** from the Command Palette.

## Next phases (not started)

1. Generate typed client from OpenAPI
2. Integration tests from examples
3. Deploy and operational hardening
