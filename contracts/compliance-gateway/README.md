# Compliance gateway TEE contract

Minimal Terminal 3 WASM contract based on [Terminal-3/z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight).

## Prerequisites

```bash
rustup target add wasm32-wasip2
cargo install wasm-tools   # optional verification
```

## Build

From the repository root:

```bash
npm run build:contract
```

Output:

```
contracts/compliance-gateway/target/wasm32-wasip2/release/compliance_gateway.wasm
```

## Register on T3N

```bash
npm run register:contract
```

Writes `T3N_CONTRACT_ID` into `.env`.

## Export

| Function | Purpose |
|----------|---------|
| `get-compliance-snapshot` | Read derived compliance config from `z::<tenant>:secrets` |

Raw webhook secrets are never returned — only `audit_webhook_configured: true/false`.
