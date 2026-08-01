use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use super::keychain::KeychainState;

// ─── GitHub OAuth Device Flow ─────────────────────────────────────────────────
// Implements the GitHub Device Flow for authenticating with GitHub Copilot.
//
// Flow:
// 1. `github_oauth_start` → POST to GitHub with client_id, get device_code + user_code
// 2. User visits verification_uri and enters user_code
// 3. `github_oauth_poll` → POST to GitHub to check if user authorized, get access_token
// 4. Store access_token in keychain as `hyscode:github_copilot_access_token`
// 5. `github_copilot_ensure_token` → Exchange access_token for short-lived Copilot API token
// 6. Store Copilot token as `hyscode:github_copilot_token` for use by the AI proxy

#[derive(Debug, Serialize)]
pub struct DeviceFlowResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub scope: String,
}

#[derive(Debug, Deserialize)]
struct GitHubDeviceResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct GitHubTokenResponse {
    access_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CopilotTokenResponse {
    token: String,
    expires_at: i64,
}

// The GitHub Copilot VS Code extension client ID — this is the only client ID
// that GitHub allows to call copilot_internal/v2/token. It is intentionally
// public and used by all third-party Copilot-compatible editors.
const COPILOT_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";

// The HysCode OAuth App client ID (Device Flow). Public by design — the device
// flow uses a public client, no client secret is required.
const HYSCODE_GITHUB_CLIENT_ID: &str = "Ov23liocJmHgYeWjn8MU";

// Scopes required for full repository operations:
// - `repo`        : clone/publish/push/pull public and private repositories
// - `read:user`   : fetch the authenticated user profile
// - `workflow`    : push changes to `.github/workflows/*` files (GitHub refuses
//                   workflow updates from OAuth tokens without this scope)
const GITHUB_ACCOUNT_SCOPE: &str = "repo read:user workflow";

// ── Shared device flow helpers ───────────────────────────────────────────────

async fn start_device_flow(client_id: &str, scope: &str) -> Result<DeviceFlowResponse, String> {
    let client = reqwest::Client::new();

    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", scope)])
        .send()
        .await
        .map_err(|e| format!("Failed to start device flow: {}", e))?;

    let status = resp.status();

    if !status.is_success() {
        return Err(format!(
            "GitHub device flow failed with HTTP status {}",
            status.as_u16()
        ));
    }

    let data: GitHubDeviceResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse device flow response: {}", e))?;

    Ok(DeviceFlowResponse {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        expires_in: data.expires_in,
        interval: data.interval,
    })
}

async fn poll_device_flow(
    client_id: &str,
    device_code: &str,
) -> Result<OAuthTokenResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to poll OAuth: {}", e))?;

    let status = resp.status();

    if !status.is_success() {
        return Err(format!(
            "GitHub OAuth polling failed with HTTP status {}",
            status.as_u16()
        ));
    }

    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read poll response body: {}", e))?;
    let data: GitHubTokenResponse = serde_json::from_slice(&body_bytes)
        .map_err(|e| format!("Failed to parse OAuth response: {}", e))?;

    if let Some(ref err) = data.error {
        return Err(match err.as_str() {
            "authorization_pending" => "authorization_pending".to_string(),
            "slow_down" => "slow_down".to_string(),
            "expired_token" => "Device code expired. Please restart the auth flow.".to_string(),
            "access_denied" => "User denied access.".to_string(),
            _ => data
                .error_description
                .clone()
                .unwrap_or_else(|| err.clone()),
        });
    }

    let access_token = data.access_token.ok_or("No access_token in response")?;
    let token_type = data.token_type.unwrap_or_else(|| "bearer".to_string());
    let scope = data.scope.clone().unwrap_or_default();

    Ok(OAuthTokenResponse {
        access_token,
        token_type,
        scope,
    })
}

/// Step 1: Start the GitHub OAuth Device Flow.
/// Returns device_code, user_code, and verification_uri for the user.
#[tauri::command]
pub async fn github_oauth_start() -> Result<DeviceFlowResponse, String> {
    eprintln!(
        "[CopilotAuth] github_oauth_start called with client_id: {}...",
        &COPILOT_CLIENT_ID[..COPILOT_CLIENT_ID.len().min(8)]
    );
    let result = start_device_flow(COPILOT_CLIENT_ID, "copilot read:user").await;
    eprintln!("[CopilotAuth] github_oauth_start completed");
    result
}

/// Step 2: Poll GitHub to check if user has authorized the device.
/// Returns the access_token on success, or an error with "authorization_pending" if still waiting.
#[tauri::command]
pub async fn github_oauth_poll(
    keychain: State<'_, KeychainState>,
    device_code: String,
) -> Result<OAuthTokenResponse, String> {
    eprintln!("[CopilotAuth] github_oauth_poll called");

    let resp = poll_device_flow(COPILOT_CLIENT_ID, &device_code).await?;

    eprintln!(
        "[CopilotAuth] github_oauth_poll SUCCESS — scope: {:?}, token_type: {}",
        resp.scope, resp.token_type
    );

    // Store the long-lived access token in keychain
    {
        let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
        store.insert(
            "hyscode:github_copilot_access_token".to_string(),
            resp.access_token.clone(),
        );
        super::keychain::persist_keychain_ref(&store);
        eprintln!("[CopilotAuth] github_oauth_poll — access_token stored in keychain");
    }

    Ok(resp)
}

/// Exchange the long-lived GitHub access token for a short-lived Copilot API token.
/// Can be called directly with an Arc to the keychain (used by ai_stream_request retry).
pub async fn ensure_copilot_token(
    keychain: Arc<Mutex<HashMap<String, String>>>,
) -> Result<String, String> {
    // Read the long-lived access token
    let access_token = {
        let store = keychain.lock().map_err(|e| e.to_string())?;
        let has_token = store.contains_key("hyscode:github_copilot_access_token");
        eprintln!(
            "[CopilotAuth] ensure_copilot_token — keychain has access_token: {}",
            has_token
        );
        store
            .get("hyscode:github_copilot_access_token")
            .cloned()
            .ok_or_else(|| "No GitHub access token. Please authenticate first.".to_string())?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Verify the token is valid and check Copilot subscription status
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "GithubCopilot/1.138.0")
        .header("Accept", "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Failed to verify GitHub token: {}", e))?;
    let user_status = user_resp.status();
    let user_body = user_resp.text().await.unwrap_or_default();
    eprintln!(
        "[CopilotAuth] ensure_copilot_token — /user status: {}",
        user_status
    );
    if !user_status.is_success() {
        return Err(format!(
            "GitHub token is invalid ({}): {}",
            user_status.as_u16(),
            user_body
        ));
    }

    eprintln!("[CopilotAuth] ensure_copilot_token — calling copilot_internal/v2/token");
    let resp = client
        .get("https://api.github.com/copilot_internal/v2/token")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "GithubCopilot/1.138.0")
        .header("Accept", "*/*")
        .header("editor-version", "vscode/1.85.0")
        .header("editor-plugin-version", "copilot/1.138.0")
        .header("openai-intent", "copilot-ghost")
        .header("x-github-api-version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Failed to get Copilot token: {}", e))?;

    let status = resp.status();
    eprintln!("[CopilotAuth] ensure_copilot_token HTTP status: {}", status);

    if !status.is_success() {
        let status_u16 = status.as_u16();
        eprintln!("[CopilotAuth] ensure_copilot_token failed ({status_u16})");
        if status_u16 == 401 {
            // Access token is invalid/revoked — clear it
            let mut store = keychain.lock().map_err(|e| e.to_string())?;
            store.remove("hyscode:github_copilot_access_token");
            store.remove("hyscode:github_copilot_token");
            super::keychain::persist_keychain_ref(&store);
            return Err("GitHub access token is invalid. Please re-authenticate.".to_string());
        }
        return Err(format!("Copilot token exchange failed ({status_u16})"));
    }

    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read Copilot token response body: {}", e))?;
    let data: CopilotTokenResponse = serde_json::from_slice(&body_bytes)
        .map_err(|e| format!("Failed to parse Copilot token: {}", e))?;

    // Store the short-lived Copilot API token
    {
        let mut store = keychain.lock().map_err(|e| e.to_string())?;
        store.insert(
            "hyscode:github_copilot_token".to_string(),
            data.token.clone(),
        );
        super::keychain::persist_keychain_ref(&store);
        eprintln!(
            "[CopilotAuth] ensure_copilot_token — Copilot token stored, expires_at: {}",
            data.expires_at
        );
    }

    eprintln!("[CopilotAuth] ensure_copilot_token SUCCESS");
    Ok(data.token)
}

/// Step 3: Exchange the long-lived GitHub access token for a short-lived Copilot API token.
/// Called before each AI request to ensure the token is fresh.
#[tauri::command]
pub async fn github_copilot_ensure_token(
    keychain: State<'_, KeychainState>,
) -> Result<String, String> {
    eprintln!("[CopilotAuth] github_copilot_ensure_token called");
    ensure_copilot_token(keychain.0.clone()).await
}

/// Disconnect GitHub Copilot — remove all stored tokens.
#[tauri::command]
pub async fn github_copilot_disconnect(keychain: State<'_, KeychainState>) -> Result<(), String> {
    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    store.remove("hyscode:github_copilot_access_token");
    store.remove("hyscode:github_copilot_token");
    super::keychain::persist_keychain_ref(&store);
    Ok(())
}

/// Check if GitHub Copilot is authenticated (has a stored access token).
#[tauri::command]
pub async fn github_copilot_is_authenticated(
    keychain: State<'_, KeychainState>,
) -> Result<bool, String> {
    let store = keychain.0.lock().map_err(|e| e.to_string())?;
    Ok(store.contains_key("hyscode:github_copilot_access_token"))
}

// ─── GitHub Account (Device Flow) ────────────────────────────────────────────
// Full GitHub account login for repository operations. Uses the HysCode OAuth
// App client ID with `repo read:user` scopes. The token is stored as
// `hyscode:github_access_token` and reused by the GitHub REST commands.

/// Step 1: Start the device flow for the HysCode GitHub account.
#[tauri::command]
pub async fn github_account_oauth_start() -> Result<DeviceFlowResponse, String> {
    eprintln!("[GitHubAccount] github_account_oauth_start");
    start_device_flow(HYSCODE_GITHUB_CLIENT_ID, GITHUB_ACCOUNT_SCOPE).await
}

/// Step 2: Poll for authorization and store the account access token.
#[tauri::command]
pub async fn github_account_oauth_poll(
    keychain: State<'_, KeychainState>,
    device_code: String,
) -> Result<OAuthTokenResponse, String> {
    eprintln!("[GitHubAccount] github_account_oauth_poll");

    let resp = poll_device_flow(HYSCODE_GITHUB_CLIENT_ID, &device_code).await?;

    eprintln!(
        "[GitHubAccount] github_account_oauth_poll SUCCESS — scope: {:?}",
        resp.scope
    );

    {
        let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
        store.insert(
            "hyscode:github_access_token".to_string(),
            resp.access_token.clone(),
        );
        store.insert(
            "hyscode:github_access_scope".to_string(),
            resp.scope.clone(),
        );
        super::keychain::persist_keychain_ref(&store);
        eprintln!(
            "[GitHubAccount] access_token stored in keychain — scope: {:?}",
            resp.scope
        );
    }

    Ok(resp)
}

/// Check if the GitHub account is authenticated (has a stored access token).
#[tauri::command]
pub async fn github_account_is_authenticated(
    keychain: State<'_, KeychainState>,
) -> Result<bool, String> {
    let store = keychain.0.lock().map_err(|e| e.to_string())?;
    Ok(store.contains_key("hyscode:github_access_token"))
}

/// Return the scopes granted to the stored GitHub access token, if any.
#[tauri::command]
pub async fn github_account_scopes(
    keychain: State<'_, KeychainState>,
) -> Result<Option<String>, String> {
    let store = keychain.0.lock().map_err(|e| e.to_string())?;
    Ok(store.get("hyscode:github_access_scope").cloned())
}

/// Disconnect the GitHub account — remove the stored access token.
#[tauri::command]
pub async fn github_account_disconnect(keychain: State<'_, KeychainState>) -> Result<(), String> {
    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    store.remove("hyscode:github_access_token");
    store.remove("hyscode:github_access_scope");
    super::keychain::persist_keychain_ref(&store);
    Ok(())
}
