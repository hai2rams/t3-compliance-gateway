//! Reads sealed compliance configuration and returns a derived snapshot.

#[derive(serde::Serialize)]
pub struct ComplianceSnapshot {
    pub policy_version: Option<String>,
    pub region: Option<String>,
    pub audit_webhook_configured: bool,
    pub contract_id: u32,
    pub tenant_did_hex: String,
}

pub fn get_compliance_snapshot(_input: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        let snapshot = get_compliance_snapshot_wasm()?;
        serde_json::to_vec(&snapshot).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = _input;
        Err("get_compliance_snapshot is only implemented on the wasm32 target".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{kv_store, logging},
    tenant::tenant_context,
};

#[cfg(target_arch = "wasm32")]
fn get_compliance_snapshot_wasm() -> Result<ComplianceSnapshot, String> {
    let tid = tenant_context::tenant_did();
    let contract_id = tenant_context::contract_id();
    let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));

    let policy_version = read_optional_string(&map_name, b"compliance_policy_version")?;
    let region = read_optional_string(&map_name, b"compliance_region")?;
    let audit_webhook_configured =
        kv_store::get(&map_name, b"audit_webhook_secret")
            .map_err(|e| alloc::format!("kv read audit_webhook_secret: {e}"))?
            .is_some();

    let _ = logging::info("compliance snapshot generated");

    Ok(ComplianceSnapshot {
        policy_version,
        region,
        audit_webhook_configured,
        contract_id,
        tenant_did_hex: hex::encode(&tid),
    })
}

#[cfg(target_arch = "wasm32")]
fn read_optional_string(map_name: &str, key: &[u8]) -> Result<Option<String>, String> {
    match kv_store::get(map_name, key).map_err(|e| alloc::format!("kv read: {e}"))? {
        Some(bytes) => Ok(Some(
            String::from_utf8(bytes).map_err(|e| alloc::format!("invalid utf-8 for key: {e}"))?,
        )),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_non_wasm_returns_err() {
        let result = get_compliance_snapshot(b"{}");
        assert!(result.is_err());
    }
}
