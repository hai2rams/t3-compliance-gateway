# Autonomous Regulated Intake Agent

**Upload or paste any regulated case — the agent classifies, governs, enriches safely, judges, plans execution, and records the audit trail.**

## Problem

Regulated teams receive heterogeneous cases — claims packets, KYC bundles, batch risk jobs, inspection video — but tooling is fragmented. Sensitive data leaks into the wrong models, external enrichment runs without boundaries, and there is no single governed path from intake to execution plan.

## Solution overview

This project is a **compliance-first autonomous intake gateway** built on the existing `t3-compliance-gateway` backend. A case enters once; the system:

1. Classifies workflow and modality
2. Routes LLM reasoning through **TokenRouter** (Kimi → SenseNova → Gemini → mock)
3. Applies **Terminal 3** identity, permission scope, and TEE-backed governance
4. Protects private data at the **data boundary**
5. Enriches only public-safe context via **BrightData/MCP** (adapter-ready)
6. Validates with an **LLM judge** (human review when required)
7. Prepares a **runtime execution plan** (Daytona / Nosana / VideoDB)
8. Records a full **audit trail**

> **AI does not approve loans or final business actions.** AI-generated assessments require human verification before operational use.

## Architecture flow

```
Incoming Case
  → Autonomous Intake Agent
  → Modality Detection
  → TokenRouter Agent
  → Terminal 3 Agent Passport / Permission Scope
  → Data Boundary
  → BrightData/MCP Public Enrichment
  → LLM Judge
  → Execution Planner
  → Runtime Executor
  → Audit Trail
```

Implementation mapping today: **Sensitive Data Filter → Policy Engine → Risk Scoring → TokenRouter → Kimi / SenseNova / Gemini → Terminal 3 → ALLOW / DENY / REVIEW → Runtime Router → Audit Log**.

## Autonomous agent flow

| Stage | Responsibility |
|-------|----------------|
| **Intake** | Accept pasted/uploaded case payload (`POST /api/v1/compliance/check`) |
| **Classification** | `workflowType`: `CLAIMS_REVIEW`, `BULK_BATCH_JOB`, `VIDEO_ANALYSIS` |
| **Modality detection** | Document, batch/GPU, or video signals (`needsGpu`, `needsVideo`, content patterns) |
| **TokenRouter** | Selects LLM provider and cost/risk tier — does **not** choose runtime host |
| **Terminal 3** | Agent trust, TEE contract mode, sealed secrets map (hardware-isolated) |
| **Data boundary** | PII/sensitive labeling, redaction preview — private fields blocked from external enrichment |
| **BrightData/MCP** | Public web enrichment only (mock-safe adapter; no PII egress) |
| **LLM judge** | Kimi / SenseNova semantic reasoning; REVIEW when policy requires human gate |
| **Execution planner** | Daytona (sandbox), Nosana (GPU batch), or VideoDB (media workflow) — **planned**, not arbitrary shell |
| **Audit trail** | `GET /api/v1/compliance/audit-log` + in-memory telemetry |

## Sponsor / tool mapping

| Sponsor | Role in this product |
|---------|----------------------|
| **Terminal 3** | Agent identity, permission scope, TEE/governance, audit, secrets map |
| **TokenRouter** | Model routing, cost boundary, fallback routing |
| **Kimi** | Primary reasoning, summary, judge |
| **SenseNova** | Document / image / multimodal reasoning |
| **BrightData** | Public web enrichment (MCP-ready adapter pattern) |
| **Daytona** | Docker / sandbox execution plan |
| **Nosana** | GPU / batch execution plan |
| **VideoDB** | Video / audio workflow |
| **Gemini** | Legacy fallback LLM (`/api/v1/audit` semantic layer; optional `LLM_PROVIDER=gemini`) |

All integrations live behind adapters in `src/adapters/`. See [mock-safe adapter strategy](#mock-safe-adapter-strategy) below.

## Demo flow — hero: Credit / KYC Precheck Package

1. User uploads or pastes a **KYC package** (claims workflow sample: passport, salary slip, bank statement).
2. Agent **classifies** automatically as `CLAIMS_REVIEW`.
3. **TokenRouter** routes **SenseNova + Kimi** for document/multimodal reasoning.
4. **Data boundary** protects passport, salary, and bank details (redacted preview in UI).
5. **Terminal 3** verifies agent identity and permission scope (`MOCK_VERIFIED` without keys).
6. **BrightData/MCP** receives only **public company terms** — never private KYC fields.
7. **LLM judge** returns **REVIEW** — hold required before any business action.
8. **Daytona** Docker sandbox plan is **prepared but not executed** on REVIEW.
9. Full **audit** is recorded in the compliance audit log.

Open the demo UI, load **Claims document with PII**, click **Run Compliance Check**.

## How to run

```bash
cp .env.example .env   # fill keys locally; never commit .env
npm install
npm run typecheck
npm start
```

Default URL: **http://localhost:4000/** (port from `PORT` in `.env`, default `4000`).

Mock mode (no live API keys):

```bash
MOCK_MODE=true npm start
```

Optional TEE contract setup (unchanged from original gateway):

```bash
npm run build:contract
npm run register:contract
npm run init:compliance
```

## Main endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `POST` | `/api/v1/compliance/check` | Autonomous regulated intake + compliance decision |
| `GET` | `/api/v1/compliance/audit-log` | Compliance check audit history |
| `POST` | `/api/v1/audit` | Legacy dual-layer audit (deterministic + Gemini) |
| `GET` | `/api/v1/analytics` | Legacy audit telemetry |
| `POST` | `/api/v1/compliance/config/initialize` | Seal compliance keys into T3 secrets map |
| `GET` | `/api/v1/compliance/config/keys` | List sealed key names |
| `POST` | `/api/v1/compliance/config/read-via-contract` | TEE compliance snapshot |

API reference: [`docs/api/README.md`](docs/api/README.md)

## Mock-safe adapter strategy

- Set `MOCK_MODE=true` in `.env` (see `.env.example`).
- Each sponsor adapter checks for its API key; missing keys → mock responses, no outbound calls.
- **TokenRouter** and **runtime router** return mock statuses (`QUEUED_MOCK`, `MOCK_ROUTED`, etc.) when keys are absent.
- **Private data is never sent** to BrightData/MCP or external enrichment adapters — only public-safe enrichment payloads.
- **Runtime execution is planned**, not arbitrary shell execution; DENY/REVIEW block runtime dispatch.

Adapter locations: `src/adapters/terminal3Adapter.ts`, `tokenRouterAdapter.ts`, `kimiAdapter.ts`, `senseNovaAdapter.ts`, `geminiAdapter.ts`, `daytonaAdapter.ts`, `nosanaAdapter.ts`, `videoDbAdapter.ts`.

## Security & governance notes

- **Never commit** `.env`, `.env.local`, or API keys. Use `.env.example` placeholders only.
- Terminal 3 secrets map: values readable inside TEE contract, not exposed via gateway list endpoints.
- Policy engine: finance / government / procurement packs; global PII export block.
- `DENY` → runtime `BLOCKED`; `REVIEW` → `AWAITING_APPROVAL` — no execution until human approval.
- AI output is advisory; regulated decisions require human verification.

## Future work

- BrightData/MCP adapter implementation and public-enrichment UI card
- Autonomous intake from file upload (multipart) with modality auto-detection
- Agent passport signing (`x-t3-agent-id` / signature validation)
- Persistent audit store (replace in-memory ledger)
- CI, OpenAPI validation, deployment hardening

## Legacy documentation

The original hackathon gateway README (phased plan, TEE registration, workflow tables) is preserved at:

[`docs/legacy/README-original.md`](docs/legacy/README-original.md)
