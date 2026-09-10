// ─── GitHub Accounts (multi-account store) ───────────────────────────────────
// Storage model:
//   hyscode:github_accounts                   → JSON array of GitHubAccountMeta
//   hyscode:github_account:{id}:access_token  → token for one account
//   hyscode:github_active_account             → id of the selected account
//
// OAuth accounts use `oauth-{github user id}` ids (stable across re-logins);
// manually provided tokens use `token-{uuid}` with a user-supplied label.
// Legacy single-account keys are migrated on first listing.

use super::github_repos::fetch_github_user;
use super::keychain::{persist_keychain_ref, KeychainState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

pub const ACCOUNTS_KEY: &str = "hyscode:github_accounts";
pub const ACTIVE_ACCOUNT_KEY: &str = "hyscode:github_active_account";
pub const LEGACY_ACCESS_TOKEN_KEY: &str = "hyscode:github_access_token";
pub const LEGACY_ACCESS_SCOPE_KEY: &str = "hyscode:github_access_scope";
pub const LEGACY_PAT_KEY: &str = "hyscode:github_token";

const KIND_OAUTH: &str = "oauth";
const KIND_TOKEN: &str = "token";
const DEFAULT_TOKEN_LABEL: &str = "Personal access token";

const NO_ACCOUNT_ERROR: &str =
    "No GitHub account connected. Add an account in Settings → Git or from the status bar.";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubAccountMeta {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub login: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub scopes: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Serialize)]
pub struct GitHubAccountsState {
    pub accounts: Vec<GitHubAccountMeta>,
    pub active_account_id: Option<String>,
}

pub fn account_token_key(id: &str) -> String {
    format!("hyscode:github_account:{id}:access_token")
}

pub fn list_accounts(store: &HashMap<String, String>) -> Vec<GitHubAccountMeta> {
    store
        .get(ACCOUNTS_KEY)
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default()
}

fn save_accounts(
    store: &mut HashMap<String, String>,
    accounts: &[GitHubAccountMeta],
) -> Result<(), String> {
    let raw = serde_json::to_string(accounts)
        .map_err(|e| format!("Failed to serialize GitHub accounts: {e}"))?;
    store.insert(ACCOUNTS_KEY.to_string(), raw);
    Ok(())
}

/// Id of the selected account, falling back to the first stored account when
/// the stored selection is missing or points at a removed account.
pub fn active_account_id(store: &HashMap<String, String>) -> Option<String> {
    let accounts = list_accounts(store);
    if accounts.is_empty() {
        return None;
    }
    let stored = store.get(ACTIVE_ACCOUNT_KEY).cloned();
    match stored {
        Some(id) if accounts.iter().any(|account| account.id == id) => Some(id),
        _ => accounts.first().map(|account| account.id.clone()),
    }
}

pub fn account_token(store: &HashMap<String, String>, id: &str) -> Option<String> {
    store
        .get(&account_token_key(id))
        .cloned()
        .filter(|token| !token.trim().is_empty())
}

/// Resolve `(account_id, token)` for an operation. An explicit id must be
/// connected; otherwise the active account is used.
pub fn resolve_account_token(
    store: &HashMap<String, String>,
    account_id: Option<&str>,
) -> Result<(String, String), String> {
    let accounts = list_accounts(store);
    let requested = account_id.map(str::trim).filter(|value| !value.is_empty());
    let id = match requested {
        Some(requested) => {
            if !accounts.iter().any(|account| account.id == requested) {
                return Err(format!("GitHub account '{requested}' is not connected."));
            }
            requested.to_string()
        }
        None => active_account_id(store).ok_or_else(|| NO_ACCOUNT_ERROR.to_string())?,
    };
    let token = account_token(store, &id).ok_or_else(|| {
        format!("GitHub account '{id}' has no stored token. Reconnect it in Settings → Git.")
    })?;
    Ok((id, token))
}

pub fn upsert_account(
    store: &mut HashMap<String, String>,
    account: GitHubAccountMeta,
    token: &str,
) -> Result<(), String> {
    let id = account.id.clone();
    let mut accounts = list_accounts(store);
    match accounts.iter_mut().find(|existing| existing.id == id) {
        Some(existing) => *existing = account,
        None => accounts.push(account),
    }
    save_accounts(store, &accounts)?;
    store.insert(account_token_key(&id), token.to_string());
    Ok(())
}

pub fn set_active_account(
    store: &mut HashMap<String, String>,
    account_id: &str,
) -> Result<(), String> {
    let accounts = list_accounts(store);
    if !accounts.iter().any(|account| account.id == account_id) {
        return Err(format!("GitHub account '{account_id}' is not connected."));
    }
    store.insert(ACTIVE_ACCOUNT_KEY.to_string(), account_id.to_string());
    Ok(())
}

pub fn remove_account(
    store: &mut HashMap<String, String>,
    account_id: &str,
) -> Result<bool, String> {
    let mut accounts = list_accounts(store);
    let before = accounts.len();
    accounts.retain(|account| account.id != account_id);
    if accounts.len() == before {
        return Ok(false);
    }
    save_accounts(store, &accounts)?;
    store.remove(&account_token_key(account_id));
    if store.get(ACTIVE_ACCOUNT_KEY).map(String::as_str) == Some(account_id) {
        match accounts.first() {
            Some(next) => {
                store.insert(ACTIVE_ACCOUNT_KEY.to_string(), next.id.clone());
            }
            None => {
                store.remove(ACTIVE_ACCOUNT_KEY);
            }
        }
    }
    Ok(true)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn token_label(label: &str) -> String {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        DEFAULT_TOKEN_LABEL.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Convert the legacy single-account keys into account entries. Runs at most
/// once per key: the legacy keys are removed after a successful migration.
/// Network failures are tolerated — identity fields stay empty and are filled
/// by `github_account_refresh` later.
pub async fn migrate_legacy_accounts(
    keychain: &Arc<Mutex<HashMap<String, String>>>,
) -> Result<bool, String> {
    let (legacy_access, legacy_scope, legacy_pat) = {
        let store = keychain.lock().map_err(|e| e.to_string())?;
        (
            store
                .get(LEGACY_ACCESS_TOKEN_KEY)
                .cloned()
                .filter(|token| !token.trim().is_empty()),
            store.get(LEGACY_ACCESS_SCOPE_KEY).cloned(),
            store
                .get(LEGACY_PAT_KEY)
                .cloned()
                .filter(|token| !token.trim().is_empty()),
        )
    };

    if legacy_access.is_none() && legacy_pat.is_none() {
        return Ok(false);
    }

    if let Some(token) = legacy_access {
        let identity = fetch_github_user(&token).await.ok();
        let account = GitHubAccountMeta {
            id: identity
                .as_ref()
                .map(|identity| format!("{KIND_OAUTH}-{}", identity.user.id))
                .unwrap_or_else(|| format!("{KIND_OAUTH}-{}", uuid::Uuid::new_v4())),
            kind: KIND_OAUTH.to_string(),
            login: identity
                .as_ref()
                .map(|identity| identity.user.login.clone()),
            name: identity
                .as_ref()
                .and_then(|identity| identity.user.name.clone()),
            avatar_url: identity
                .as_ref()
                .map(|identity| identity.user.avatar_url.clone()),
            html_url: identity
                .as_ref()
                .map(|identity| identity.user.html_url.clone()),
            label: None,
            scopes: legacy_scope
                .clone()
                .or_else(|| identity.and_then(|identity| identity.scopes)),
            added_at: now_ms(),
        };
        let mut store = keychain.lock().map_err(|e| e.to_string())?;
        upsert_account(&mut store, account, &token)?;
        store.remove(LEGACY_ACCESS_TOKEN_KEY);
        store.remove(LEGACY_ACCESS_SCOPE_KEY);
        persist_keychain_ref(&store);
    }

    if let Some(token) = legacy_pat {
        let identity = fetch_github_user(&token).await.ok();
        let account = GitHubAccountMeta {
            id: format!("{KIND_TOKEN}-{}", uuid::Uuid::new_v4()),
            kind: KIND_TOKEN.to_string(),
            login: identity
                .as_ref()
                .map(|identity| identity.user.login.clone()),
            name: identity
                .as_ref()
                .and_then(|identity| identity.user.name.clone()),
            avatar_url: identity
                .as_ref()
                .map(|identity| identity.user.avatar_url.clone()),
            html_url: identity
                .as_ref()
                .map(|identity| identity.user.html_url.clone()),
            label: Some(DEFAULT_TOKEN_LABEL.to_string()),
            scopes: identity.and_then(|identity| identity.scopes),
            added_at: now_ms(),
        };
        let mut store = keychain.lock().map_err(|e| e.to_string())?;
        upsert_account(&mut store, account, &token)?;
        store.remove(LEGACY_PAT_KEY);
        persist_keychain_ref(&store);
    }

    Ok(true)
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// List all connected GitHub accounts (running the legacy migration first).
#[tauri::command]
pub async fn github_accounts_list(
    keychain: State<'_, KeychainState>,
) -> Result<GitHubAccountsState, String> {
    let _ = migrate_legacy_accounts(&keychain.0).await;
    let store = keychain.0.lock().map_err(|e| e.to_string())?;
    Ok(GitHubAccountsState {
        accounts: list_accounts(&store),
        active_account_id: active_account_id(&store),
    })
}

/// Step 1 of adding an OAuth account: start the device flow.
#[tauri::command]
pub async fn github_account_oauth_start() -> Result<super::github_oauth::DeviceFlowResponse, String>
{
    super::github_oauth::start_account_device_flow().await
}

/// Step 2 of adding an OAuth account: poll until GitHub authorizes, then store
/// the account metadata and token.
#[tauri::command]
pub async fn github_account_oauth_poll(
    keychain: State<'_, KeychainState>,
    device_code: String,
) -> Result<GitHubAccountMeta, String> {
    let response = super::github_oauth::poll_account_device_flow(&device_code).await?;
    let identity =
        fetch_github_user(&response.access_token)
            .await
            .map_err(|(status, message)| {
                if status == 401 {
                    "GitHub authorized the device but rejected the token. Try again.".to_string()
                } else {
                    message
                }
            })?;

    let account = GitHubAccountMeta {
        id: format!("{KIND_OAUTH}-{}", identity.user.id),
        kind: KIND_OAUTH.to_string(),
        login: Some(identity.user.login),
        name: identity.user.name,
        avatar_url: Some(identity.user.avatar_url),
        html_url: Some(identity.user.html_url),
        label: None,
        scopes: if response.scope.trim().is_empty() {
            identity.scopes
        } else {
            Some(response.scope.trim().to_string())
        },
        added_at: now_ms(),
    };

    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    let had_active = active_account_id(&store).is_some();
    upsert_account(&mut store, account.clone(), &response.access_token)?;
    if !had_active {
        set_active_account(&mut store, &account.id)?;
    }
    persist_keychain_ref(&store);
    Ok(account)
}

/// Add a manually provided personal access token as a named account.
#[tauri::command]
pub async fn github_account_add_token(
    keychain: State<'_, KeychainState>,
    label: String,
    token: String,
) -> Result<GitHubAccountMeta, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Enter a GitHub personal access token.".to_string());
    }
    let identity = match fetch_github_user(&token).await {
        Ok(identity) => Some(identity),
        Err((401, _)) => {
            return Err(
                "GitHub rejected this token (401). Check that it is valid and not expired."
                    .to_string(),
            )
        }
        Err(_) => None,
    };
    let account = GitHubAccountMeta {
        id: format!("{KIND_TOKEN}-{}", uuid::Uuid::new_v4()),
        kind: KIND_TOKEN.to_string(),
        login: identity
            .as_ref()
            .map(|identity| identity.user.login.clone()),
        name: identity
            .as_ref()
            .and_then(|identity| identity.user.name.clone()),
        avatar_url: identity
            .as_ref()
            .map(|identity| identity.user.avatar_url.clone()),
        html_url: identity
            .as_ref()
            .map(|identity| identity.user.html_url.clone()),
        label: Some(token_label(&label)),
        scopes: identity.and_then(|identity| identity.scopes),
        added_at: now_ms(),
    };

    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    let had_active = active_account_id(&store).is_some();
    upsert_account(&mut store, account.clone(), &token)?;
    if !had_active {
        set_active_account(&mut store, &account.id)?;
    }
    persist_keychain_ref(&store);
    Ok(account)
}

/// Re-read the account identity from the GitHub API (updates login/avatar and
/// token scopes). Fails when the token is invalid or revoked.
#[tauri::command]
pub async fn github_account_refresh(
    keychain: State<'_, KeychainState>,
    account_id: String,
) -> Result<GitHubAccountMeta, String> {
    let (token, mut account) = {
        let store = keychain.0.lock().map_err(|e| e.to_string())?;
        let account = list_accounts(&store)
            .into_iter()
            .find(|account| account.id == account_id)
            .ok_or_else(|| format!("GitHub account '{account_id}' is not connected."))?;
        let token = account_token(&store, &account_id)
            .ok_or_else(|| format!("GitHub account '{account_id}' has no stored token."))?;
        (token, account)
    };

    let identity = fetch_github_user(&token)
        .await
        .map_err(|(status, message)| {
            if status == 401 {
                format!("GitHub token for this account is no longer valid. Sign in again.")
            } else {
                message
            }
        })?;

    account.login = Some(identity.user.login);
    account.name = identity.user.name;
    account.avatar_url = Some(identity.user.avatar_url);
    account.html_url = Some(identity.user.html_url);
    if identity.scopes.is_some() {
        account.scopes = identity.scopes;
    }

    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    upsert_account(&mut store, account.clone(), &token)?;
    persist_keychain_ref(&store);
    Ok(account)
}

/// Select the account used by default for API and git operations.
#[tauri::command]
pub async fn github_account_switch(
    keychain: State<'_, KeychainState>,
    account_id: String,
) -> Result<(), String> {
    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    set_active_account(&mut store, &account_id)?;
    persist_keychain_ref(&store);
    Ok(())
}

/// Disconnect one account (token + metadata). When the active account is
/// removed, the first remaining account becomes active.
#[tauri::command]
pub async fn github_account_remove(
    keychain: State<'_, KeychainState>,
    account_id: String,
) -> Result<(), String> {
    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    remove_account(&mut store, &account_id)?;
    persist_keychain_ref(&store);
    Ok(())
}

/// Return the scopes granted to an account, if known.
#[tauri::command]
pub async fn github_account_scopes(
    keychain: State<'_, KeychainState>,
    account_id: Option<String>,
) -> Result<Option<String>, String> {
    let store = keychain.0.lock().map_err(|e| e.to_string())?;
    let accounts = list_accounts(&store);
    let selected = match account_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(requested) => accounts.iter().find(|account| account.id == requested),
        None => {
            let active = active_account_id(&store);
            active.and_then(|active| accounts.iter().find(|account| account.id == active))
        }
    };
    Ok(selected.and_then(|account| account.scopes.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_with(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    fn meta(id: &str, kind: &str, login: &str) -> GitHubAccountMeta {
        GitHubAccountMeta {
            id: id.to_string(),
            kind: kind.to_string(),
            login: Some(login.to_string()),
            name: None,
            avatar_url: None,
            html_url: None,
            label: None,
            scopes: None,
            added_at: 1,
        }
    }

    #[test]
    fn list_accounts_empty_when_missing_or_invalid() {
        let store = HashMap::new();
        assert!(list_accounts(&store).is_empty());
        let store = store_with(&[(ACCOUNTS_KEY, "not-json")]);
        assert!(list_accounts(&store).is_empty());
    }

    #[test]
    fn active_falls_back_to_first_account() {
        let mut store = HashMap::new();
        let accounts = vec![
            meta("oauth-1", KIND_OAUTH, "one"),
            meta("oauth-2", KIND_OAUTH, "two"),
        ];
        save_accounts(&mut store, &accounts).expect("save accounts");
        assert_eq!(active_account_id(&store), Some("oauth-1".to_string()));

        store.insert(ACTIVE_ACCOUNT_KEY.to_string(), "oauth-2".to_string());
        assert_eq!(active_account_id(&store), Some("oauth-2".to_string()));

        store.insert(ACTIVE_ACCOUNT_KEY.to_string(), "removed".to_string());
        assert_eq!(active_account_id(&store), Some("oauth-1".to_string()));
    }

    #[test]
    fn resolve_token_prefers_explicit_account() {
        let mut store = HashMap::new();
        let accounts = vec![
            meta("oauth-1", KIND_OAUTH, "one"),
            meta("oauth-2", KIND_OAUTH, "two"),
        ];
        save_accounts(&mut store, &accounts).expect("save accounts");
        store.insert(account_token_key("oauth-1"), "token-one".to_string());
        store.insert(account_token_key("oauth-2"), "token-two".to_string());

        let (id, token) = resolve_account_token(&store, Some("oauth-2")).expect("resolve explicit");
        assert_eq!(id, "oauth-2");
        assert_eq!(token, "token-two");

        let (id, token) = resolve_account_token(&store, None).expect("resolve active");
        assert_eq!(id, "oauth-1");
        assert_eq!(token, "token-one");

        assert!(resolve_account_token(&store, Some("missing")).is_err());
    }

    #[test]
    fn remove_account_updates_active_selection() {
        let mut store = HashMap::new();
        let accounts = vec![
            meta("oauth-1", KIND_OAUTH, "one"),
            meta("oauth-2", KIND_OAUTH, "two"),
        ];
        save_accounts(&mut store, &accounts).expect("save accounts");
        store.insert(account_token_key("oauth-1"), "token-one".to_string());
        store.insert(ACTIVE_ACCOUNT_KEY.to_string(), "oauth-1".to_string());

        assert!(remove_account(&mut store, "oauth-1").expect("remove"));
        assert_eq!(active_account_id(&store), Some("oauth-2".to_string()));
        assert!(account_token(&store, "oauth-1").is_none());
        assert!(!remove_account(&mut store, "oauth-1").expect("idempotent remove"));
    }

    #[test]
    fn account_token_ignores_blank_values() {
        let store = store_with(&[(&account_token_key("oauth-1"), "  ")]);
        assert!(account_token(&store, "oauth-1").is_none());
    }
}
