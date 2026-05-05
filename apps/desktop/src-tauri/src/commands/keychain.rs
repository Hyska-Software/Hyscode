use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

/// File-backed key store. Keys are persisted as a JSON file in the app's
/// local data directory. For production, swap for tauri-plugin-stronghold.
pub struct KeychainState(pub Arc<Mutex<HashMap<String, String>>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct KeychainEntry {
    pub service: String,
    pub account: String,
}

fn keychain_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
        .join("hyscode")
        .join("keychain.json")
}

pub fn load_keychain() -> HashMap<String, String> {
    let path = keychain_path();
    let Ok(data) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn persist_keychain(store: &HashMap<String, String>) {
    let path = keychain_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(data) = serde_json::to_string(store) {
        let _ = std::fs::write(&path, data);
    }
}

/// Public variant for sibling modules that hold a lock reference.
pub fn persist_keychain_ref(store: &HashMap<String, String>) {
    persist_keychain(store);
}

#[tauri::command]
pub async fn keychain_set(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
    password: String,
) -> Result<(), String> {
    let key = format!("{}:{}", service, account);
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    store.insert(key, password);
    persist_keychain(&store);
    Ok(())
}

#[tauri::command]
pub async fn keychain_get(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<Option<String>, String> {
    let key = format!("{}:{}", service, account);
    let store = state.0.lock().map_err(|e| e.to_string())?;
    Ok(store.get(&key).cloned())
}

#[tauri::command]
pub async fn keychain_delete(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<bool, String> {
    let key = format!("{}:{}", service, account);
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    let existed = store.remove(&key).is_some();
    persist_keychain(&store);
    Ok(existed)
}

#[tauri::command]
pub async fn keychain_has(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<bool, String> {
    let key = format!("{}:{}", service, account);
    let store = state.0.lock().map_err(|e| e.to_string())?;
    Ok(store.contains_key(&key))
}
