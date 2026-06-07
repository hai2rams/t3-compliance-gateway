//! Minimal compliance gateway TEE contract for Terminal 3 z-space tenants.
//!
//! Reads sealed keys from `z::<tenant>:secrets` and returns a derived snapshot
//! without exposing sensitive values like webhook secrets.

#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "compliance-gateway",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod snapshot;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::compliance_gateway::contracts::Guest for Component {
    fn get_compliance_snapshot(
        req: exports::z::compliance_gateway::contracts::GenericInput,
    ) -> Result<Vec<u8>, alloc::string::String> {
        let input = req.input.unwrap_or_default();
        snapshot::get_compliance_snapshot(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3);
    }
}
