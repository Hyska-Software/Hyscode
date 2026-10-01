use keyring::{Entry, Error as KeyringError};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

const KEYRING_SERVICE: &str = "com.hyscode.credentials";
const KEYRING_INDEX_ACCOUNT: &str = "__hyscode_account_index_v1";

/// In-memory cache backed by each platform's native secure credential store.
pub struct KeychainState(pub Arc<Mutex<HashMap<String, String>>>);

trait CredentialBackend {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

struct SystemCredentialBackend;

/// Service/account charset: 1–64 chars of `[A-Za-z0-9:_-]`.
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

fn validate_storage_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 256 {
        return Err("Credential key must be 1-256 characters".to_string());
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '_' || c == '-')
    {
        return Err("Credential key contains unsupported characters".to_string());
    }
    Ok(())
}

fn credential_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("Could not open the operating-system credential store: {error}"))
}

impl CredentialBackend for SystemCredentialBackend {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match credential_entry(account)?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(format!(
                "Could not read a credential from the operating-system store: {error}"
            )),
        }
    }

    fn set(&self, account: &str, password: &str) -> Result<(), String> {
        credential_entry(account)?
            .set_password(password)
            .map_err(|error| {
                format!("Could not save a credential to the operating-system store: {error}")
            })
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match credential_entry(account)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!(
                "Could not delete a credential from the operating-system store: {error}"
            )),
        }
    }
}

fn read_index_with(backend: &impl CredentialBackend) -> Result<Vec<String>, String> {
    let Some(index) = backend.get(KEYRING_INDEX_ACCOUNT)? else {
        return Ok(Vec::new());
    };
    let accounts: Vec<String> = serde_json::from_str(&index)
        .map_err(|error| format!("Credential-store index is invalid: {error}"))?;
    let mut unique = HashSet::with_capacity(accounts.len());
    for account in &accounts {
        validate_storage_key(account)?;
        if !unique.insert(account) {
            return Err("Credential-store index contains duplicate account keys".to_string());
        }
    }
    Ok(accounts)
}

fn read_os_keychain_with(
    backend: &impl CredentialBackend,
) -> Result<HashMap<String, String>, String> {
    let accounts = read_index_with(backend)?;
    let mut store = HashMap::with_capacity(accounts.len());
    for account in accounts {
        let password = backend.get(&account)?.ok_or_else(|| {
            format!("Credential-store index references a missing item: {account}")
        })?;
        store.insert(account, password);
    }
    Ok(store)
}

/// Persist all values before publishing the account index. Orphan cleanup happens
/// only after every new value and the index have been verified by readback.
fn persist_os_keychain_with(
    store: &HashMap<String, String>,
    backend: &impl CredentialBackend,
) -> Result<(), String> {
    for key in store.keys() {
        validate_storage_key(key)?;
    }

    let old_accounts = read_index_with(backend)?;
    let mut new_accounts: Vec<String> = store.keys().cloned().collect();
    new_accounts.sort();
    for account in &new_accounts {
        let password = store
            .get(account)
            .ok_or_else(|| "Credential disappeared during persistence".to_string())?;
        backend.set(account, password)?;
        if backend.get(account)?.as_deref() != Some(password.as_str()) {
            return Err(format!("Credential verification failed for {account}"));
        }
    }

    let index = serde_json::to_string(&new_accounts)
        .map_err(|error| format!("Could not encode the credential-store index: {error}"))?;
    backend.set(KEYRING_INDEX_ACCOUNT, &index)?;
    if backend.get(KEYRING_INDEX_ACCOUNT)?.as_deref() != Some(index.as_str()) {
        return Err("Credential-store index verification failed".to_string());
    }

    let retained: HashSet<&str> = new_accounts.iter().map(String::as_str).collect();
    for account in old_accounts {
        if !retained.contains(account.as_str()) {
            if let Err(error) = backend.delete(&account) {
                eprintln!("[keychain] stale credential cleanup failed for {account}: {error}");
            }
        }
    }
    Ok(())
}

fn persist_os_keychain(store: &HashMap<String, String>) -> Result<(), String> {
    persist_os_keychain_with(store, &SystemCredentialBackend)
}

fn read_os_keychain() -> Result<HashMap<String, String>, String> {
    read_os_keychain_with(&SystemCredentialBackend)
}

fn persist_and_cleanup_legacy(store: &HashMap<String, String>) -> Result<(), String> {
    persist_os_keychain(store)?;
    let verified = read_os_keychain()?;
    if &verified != store {
        return Err(
            "Secure keychain persistence readback did not match the requested state".to_string(),
        );
    }

    if let Ok(path) = legacy_keychain_path() {
        if path.exists() {
            match std::fs::read_to_string(&path).ok().and_then(|contents| {
                serde_json::from_str::<HashMap<String, String>>(&contents).ok()
            }) {
                Some(_) => {
                    if let Err(error) = std::fs::remove_file(&path) {
                        eprintln!("[keychain] verified credentials but could not remove legacy file: {error}");
                    }
                }
                None => eprintln!("[keychain] preserving unreadable legacy keychain file"),
            }
        }
    }
    Ok(())
}

fn legacy_keychain_path() -> Result<PathBuf, String> {
    // This path is read only for one-time migration. No credentials are written
    // back to the plaintext file.
    let base = dirs::data_local_dir().ok_or_else(|| {
        "Cannot determine local data directory for keychain migration".to_string()
    })?;
    Ok(base.join("hyscode").join("keychain.json"))
}

fn migrate_legacy_keychain_with(
    path: &PathBuf,
    backend: &impl CredentialBackend,
) -> Result<Option<HashMap<String, String>>, String> {
    let data = match std::fs::read_to_string(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read the legacy keychain: {error}")),
    };
    let legacy: HashMap<String, String> = serde_json::from_str(&data)
        .map_err(|error| format!("Legacy keychain data is invalid and was preserved: {error}"))?;

    persist_os_keychain_with(&legacy, backend)?;
    let verified = read_os_keychain_with(backend)?;
    if verified != legacy {
        return Err("Secure keychain migration readback did not match the legacy data".to_string());
    }

    std::fs::remove_file(path).map_err(|error| {
        format!("Secure migration verified, but legacy file cleanup failed: {error}")
    })?;
    Ok(Some(verified))
}

fn migrate_legacy_keychain(path: &PathBuf) -> Result<Option<HashMap<String, String>>, String> {
    migrate_legacy_keychain_with(path, &SystemCredentialBackend)
}

/// Load credentials from native storage, migrating and removing the old JSON
/// file only after every secret and the index pass a secure-store readback.
pub fn load_keychain() -> HashMap<String, String> {
    let legacy_path = legacy_keychain_path();
    match legacy_path
        .as_ref()
        .map_err(Clone::clone)
        .and_then(migrate_legacy_keychain)
    {
        Ok(Some(store)) => return store,
        Ok(None) => {}
        Err(error) => {
            eprintln!("[keychain] secure migration warning: {error}");
            if let Ok(path) = legacy_path {
                if let Ok(data) = std::fs::read_to_string(path) {
                    if let Ok(store) = serde_json::from_str::<HashMap<String, String>>(&data) {
                        return store;
                    }
                }
            }
        }
    }

    match read_os_keychain() {
        Ok(store) => store,
        Err(error) => {
            eprintln!("[keychain] operating-system credential store unavailable: {error}");
            HashMap::new()
        }
    }
}

/// Persist a caller-mutated cache and report secure-store failures to its caller.
pub fn persist_keychain_ref(store: &HashMap<String, String>) -> Result<(), String> {
    persist_and_cleanup_legacy(store)
}

pub fn update_keychain_ref<T>(
    store: &mut HashMap<String, String>,
    update: impl FnOnce(&mut HashMap<String, String>) -> Result<T, String>,
) -> Result<T, String> {
    let previous = store.clone();
    let result = match update(store) {
        Ok(result) => result,
        Err(error) => {
            *store = previous;
            return Err(error);
        }
    };
    if let Err(error) = persist_keychain_ref(store) {
        *store = previous;
        return Err(error);
    }
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_set(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
    password: String,
) -> Result<(), String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{service}:{account}");
    let mut store = state.0.lock().map_err(|error| error.to_string())?;
    update_keychain_ref(&mut store, |store| {
        store.insert(key, password);
        Ok(())
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_get(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<Option<String>, String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{service}:{account}");
    let store = state.0.lock().map_err(|error| error.to_string())?;
    Ok(store.get(&key).cloned())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_delete(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<bool, String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{service}:{account}");
    let mut store = state.0.lock().map_err(|error| error.to_string())?;
    if !store.contains_key(&key) {
        return Ok(false);
    }
    update_keychain_ref(&mut store, |store| Ok(store.remove(&key).is_some()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keychain_has(
    state: State<'_, KeychainState>,
    service: String,
    account: String,
) -> Result<bool, String> {
    validate_keychain_key(&service, &account)?;
    let key = format!("{service}:{account}");
    let store = state.0.lock().map_err(|error| error.to_string())?;
    Ok(store.contains_key(&key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryBackend {
        values: Mutex<HashMap<String, String>>,
        fail_writes: bool,
    }

    impl CredentialBackend for MemoryBackend {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            self.values
                .lock()
                .map(|values| values.get(account).cloned())
                .map_err(|error| error.to_string())
        }

        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            if self.fail_writes {
                return Err("injected secure-store write failure".to_string());
            }
            self.values
                .lock()
                .map_err(|error| error.to_string())?
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            self.values
                .lock()
                .map_err(|error| error.to_string())?
                .remove(account);
            Ok(())
        }
    }

    fn legacy_file() -> PathBuf {
        std::env::temp_dir().join(format!(
            "hyscode-keychain-migration-{}.json",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn rejects_traversal_and_bad_charset_in_key_parts() {
        let overlong = "x".repeat(65);
        let bad_cases = ["", "..", "../x", "a/b", "a\\b", "a b", "a:b/c"];
        for bad in bad_cases {
            assert!(validate_key_part("service", bad).is_err(), "{bad}");
            assert!(validate_key_part("account", bad).is_err(), "{bad}");
        }
        assert!(validate_key_part("service", &overlong).is_err());
        for good in ["hyscode", "github:oauth", "acc-1_2", "a:b_c-d"] {
            assert!(validate_key_part("service", good).is_ok(), "{good}");
            assert!(validate_key_part("account", good).is_ok(), "{good}");
        }
        assert!(validate_keychain_key("svc", "acc").is_ok());
        assert!(validate_keychain_key("../svc", "acc").is_err());
        assert!(validate_storage_key("hyscode:github_account:account-1:access_token").is_ok());
        assert!(validate_storage_key("../../secrets").is_err());
    }

    #[test]
    fn migration_removes_plaintext_only_after_secure_store_readback() {
        let path = legacy_file();
        let legacy = HashMap::from([
            (
                "hyscode:provider_api_key".to_string(),
                "secret-value".to_string(),
            ),
            (
                "hyscode:github_account:account-1:access_token".to_string(),
                "token-value".to_string(),
            ),
        ]);
        std::fs::write(&path, serde_json::to_string(&legacy).unwrap()).unwrap();
        let backend = MemoryBackend::default();

        let migrated = migrate_legacy_keychain_with(&path, &backend).unwrap();

        assert_eq!(migrated, Some(legacy.clone()));
        assert!(
            !path.exists(),
            "legacy plaintext must be removed after verified migration"
        );
        assert_eq!(read_os_keychain_with(&backend).unwrap(), legacy);
    }

    #[test]
    fn failed_secure_migration_preserves_plaintext_for_recovery() {
        let path = legacy_file();
        let legacy = HashMap::from([(
            "hyscode:provider_api_key".to_string(),
            "secret-value".to_string(),
        )]);
        let legacy_json = serde_json::to_string(&legacy).unwrap();
        std::fs::write(&path, &legacy_json).unwrap();
        let backend = MemoryBackend {
            fail_writes: true,
            ..MemoryBackend::default()
        };

        let result = migrate_legacy_keychain_with(&path, &backend);

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), legacy_json);
        let _ = std::fs::remove_file(path);
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "writes a real credential to the OS store; run explicitly via -- --ignored"]
    fn windows_native_credential_store_round_trips_a_unique_secret() {
        let account = format!("test_{}", uuid::Uuid::new_v4().simple());
        let entry = credential_entry(&account).unwrap();
        let set_result = entry.set_password("hyscode-native-store-test");
        let stored = entry.get_password();
        let delete_result = entry.delete_credential();

        assert!(
            set_result.is_ok(),
            "Windows Credential Manager write failed: {set_result:?}"
        );
        assert!(matches!(stored, Ok(secret) if secret == "hyscode-native-store-test"));
        assert!(
            delete_result.is_ok(),
            "Windows Credential Manager cleanup failed: {delete_result:?}"
        );
    }
}
