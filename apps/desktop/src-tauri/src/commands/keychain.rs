use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

// SECURITY: plaintext JSON key store — migrate to Stronghold (OS keychain /
// encrypted vault). Service/account names are validated; file permissions are
// restricted to owner-only on Unix; the storage path never falls back to the
// process working directory.

/// File-backed key store. Keys are persisted as a JSON file in the app's
/// local data directory. For production, swap for tauri-plugin-stronghold.
pub struct KeychainState(pub Arc<Mutex<HashMap<String, String>>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct KeychainEntry {
    pub service: String,
    pub account: String,
}

/// Service/account charset: 1–64 chars of `[A-Za-z0-9:_-]`. Rejects `..`,
/// `/`, `\` and empty values so crafted names cannot collide keys or escape
/// any future path-based storage layout.
fn validate_key_part(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 64 {
        return Err(format!("Validation: {label} must be 1-64 characters"));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '_' || c == '-')
    {
        return Err(format!(
            "Validation: {label} allows only [A-Za-z0-9:_-]: '{value}'"
        ));
    }
    Ok(())
}

fn validate_keychain_key(service: &str, account: &str) -> Result<(), String> {
    validate_key_part("service", service)?;
    validate_key_part("account", account)?;
    Ok(())
}

fn keychain_path() -> Result<PathBuf, String> {
    // Never fall back to `current_dir()`: that would write secrets next to
    // whatever the process happened to start in (e.g. a cloned repo).
    let base = dirs::data_local_dir()
        .ok_or_else(|| "Cannot determine local data directory for keychain".to_string())?;
    Ok(base.join("hyscode").join("keychain.json"))
}

pub fn load_keychain() -> HashMap<String, String> {
    let Ok(path) = keychain_path() else {
        return HashMap::new();
    };
    let Ok(data) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn persist_keychain(store: &HashMap<String, String>) {
    let Ok(path) = keychain_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(data) = serde_json::to_string(store) else {
        return;
    };
    // Atomic write (temp + rename) so a crash mid-write never leaves a
    // truncated keychain.json behind.
    let tmp = path.with_extension("json.tmp");
    let _ = std::fs::write(&tmp, data);
    // Owner-only permissions so other local users cannot read secrets.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    let _ = std::fs::rename(&tmp, &path);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

/// Public variant for sibling modules that hold a lock reference.
pub fn persist_keychain_ref(store: &HashMap<String, String>) {
    persist_keychain(store);
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_set(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
    password: String,
) -> Result<(), String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{}:{}", service, account);
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    store.insert(key, password);
    persist_keychain(&store);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_get(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<Option<String>, String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{}:{}", service, account);
    let store = state.0.lock().map_err(|e| e.to_string())?;
    Ok(store.get(&key).cloned())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_delete(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<bool, String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{}:{}", service, account);
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    let existed = store.remove(&key).is_some();
    persist_keychain(&store);
    Ok(existed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_has(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<bool, String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{}:{}", service, account);
    let store = state.0.lock().map_err(|e| e.to_string())?;
    Ok(store.contains_key(&key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_and_bad_charset_in_key_parts() {
        let overlong = "x".repeat(65);
        let mut bad_cases = vec!["", "..", "../x", "a/b", "a\\b", "a b", "a:b/c"];
        bad_cases.push(overlong.as_str());
        for bad in bad_cases {
            assert!(validate_key_part("service", bad).is_err(), "{bad}");
            assert!(validate_key_part("account", bad).is_err(), "{bad}");
        }
        for good in ["hyscode", "github:oauth", "acc-1_2", "a:b_c-d"] {
            assert!(validate_key_part("service", good).is_ok(), "{good}");
            assert!(validate_key_part("account", good).is_ok(), "{good}");
        }
        assert!(validate_keychain_key("svc", "acc").is_ok());
        assert!(validate_keychain_key("../svc", "acc").is_err());
    }
}
