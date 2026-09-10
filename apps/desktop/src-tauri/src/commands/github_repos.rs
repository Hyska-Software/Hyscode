use super::keychain::KeychainState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;

const GITHUB_API: &str = "https://api.github.com";
const MAX_LIST_REPOS_PAGES: u32 = 10;
const REPOS_PER_PAGE: u32 = 100;
const ORGS_PER_PAGE: u32 = 100;
const SEARCH_PER_PAGE: u32 = 50;

// ── Serializable types (mirrored in apps/desktop/src/lib/tauri-invoke.ts) ────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
    pub html_url: String,
}

/// Result of `GET /user` with the token scopes reported by GitHub's
/// `x-oauth-scopes` response header (absent for fine-grained tokens).
#[derive(Debug, Clone)]
pub struct GitHubUserIdentity {
    pub user: GitHubUser,
    pub scopes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubOwner {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub html_url: String,
    pub clone_url: String,
    pub ssh_url: String,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    pub default_branch: String,
    pub owner: GitHubOwner,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubOrg {
    pub login: String,
    pub avatar_url: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubSearchResponse {
    items: Vec<GitHubRepo>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Resolve the token used for GitHub API calls for an account. When
/// `account_id` is absent the active account is used.
pub fn resolve_github_token(
    keychain: &Arc<Mutex<HashMap<String, String>>>,
    account_id: Option<&str>,
) -> Result<String, String> {
    let store = keychain.lock().map_err(|e| e.to_string())?;
    super::github_accounts::resolve_account_token(&store, account_id).map(|(_, token)| token)
}

/// Fetch the authenticated user (and token scopes). `Err` carries the HTTP
/// status so callers can distinguish revoked tokens (401) from other errors.
pub async fn fetch_github_user(token: &str) -> Result<GitHubUserIdentity, (u16, String)> {
    let client = api_client().map_err(|message| (0, message))?;
    let resp = client
        .get(format!("{GITHUB_API}/user"))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "HysCode/1.0")
        .send()
        .await
        .map_err(|e| (0, format!("GitHub API request failed: {}", e)))?;
    let status = resp.status();
    let scopes = resp
        .headers()
        .get("x-oauth-scopes")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let body = resp
        .bytes()
        .await
        .map_err(|e| (status.as_u16(), format!("Failed to read response: {}", e)))?;
    if !status.is_success() {
        return Err((status.as_u16(), api_error_message(status, &body)));
    }
    let user = serde_json::from_slice(&body)
        .map_err(|e| (status.as_u16(), format!("Failed to parse response: {}", e)))?;
    Ok(GitHubUserIdentity { user, scopes })
}

fn api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))
}

fn api_error_message(status: reqwest::StatusCode, body: &[u8]) -> String {
    let body_str = String::from_utf8_lossy(body);
    let msg = serde_json::from_str::<serde_json::Value>(&body_str)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|message| message.as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| body_str.to_string());
    if status == reqwest::StatusCode::UNAUTHORIZED {
        format!(
            "GitHub authentication failed ({}). Please sign in again in Settings → Git.",
            status.as_u16()
        )
    } else {
        format!("GitHub API error ({}): {}", status.as_u16(), msg)
    }
}

async fn get_json<T: serde::de::DeserializeOwned>(token: &str, url: &str) -> Result<T, String> {
    let client = api_client()?;
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "HysCode/1.0")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;
    let status = resp.status();
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(api_error_message(status, &body));
    }
    serde_json::from_slice(&body).map_err(|e| format!("Failed to parse response: {}", e))
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Get the authenticated GitHub user for an account (active by default), or
/// `None` when no account is connected or the stored token was revoked.
#[tauri::command]
pub async fn github_account_user(
    keychain: State<'_, KeychainState>,
    account_id: Option<String>,
) -> Result<Option<GitHubUser>, String> {
    let token = match resolve_github_token(&keychain.0, account_id.as_deref()) {
        Ok(token) => token,
        Err(_) => return Ok(None),
    };
    match fetch_github_user(&token).await {
        Ok(identity) => Ok(Some(identity.user)),
        Err((401, _)) => Ok(None),
        Err((_, message)) => Err(message),
    }
}

/// List repositories of an account, paginated (up to 1000).
#[tauri::command]
pub async fn github_list_repos(
    keychain: State<'_, KeychainState>,
    account_id: Option<String>,
    affiliation: Option<String>,
    visibility: Option<String>,
) -> Result<Vec<GitHubRepo>, String> {
    let token = resolve_github_token(&keychain.0, account_id.as_deref())?;
    let mut repos = Vec::new();
    for page in 1..=MAX_LIST_REPOS_PAGES {
        let mut query = vec![
            format!("per_page={}", REPOS_PER_PAGE),
            format!("page={}", page),
        ];
        if let Some(affiliation) = affiliation
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            query.push(format!("affiliation={}", affiliation));
        }
        if let Some(visibility) = visibility
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            query.push(format!("visibility={}", visibility));
        }
        let url = format!("{GITHUB_API}/user/repos?{}", query.join("&"));
        let batch: Vec<GitHubRepo> = get_json(&token, &url).await?;
        let count = batch.len();
        repos.extend(batch);
        if count < REPOS_PER_PAGE as usize {
            break;
        }
    }
    Ok(repos)
}

/// List the organizations an account belongs to (active by default).
#[tauri::command]
pub async fn github_list_orgs(
    keychain: State<'_, KeychainState>,
    account_id: Option<String>,
) -> Result<Vec<GitHubOrg>, String> {
    let token = resolve_github_token(&keychain.0, account_id.as_deref())?;
    let url = format!("{GITHUB_API}/user/orgs?per_page={}", ORGS_PER_PAGE);
    get_json(&token, &url).await
}

/// Search public GitHub repositories.
#[tauri::command]
pub async fn github_search_repos(
    keychain: State<'_, KeychainState>,
    account_id: Option<String>,
    query: String,
) -> Result<Vec<GitHubRepo>, String> {
    let token = resolve_github_token(&keychain.0, account_id.as_deref())?;
    let url = format!(
        "{GITHUB_API}/search/repositories?q={}&per_page={}",
        urlencoding::encode(&query),
        SEARCH_PER_PAGE
    );
    let response: GitHubSearchResponse = get_json(&token, &url).await?;
    Ok(response.items)
}

/// Create a repository (account or organization) and return its info.
#[tauri::command]
pub async fn github_create_repo(
    keychain: State<'_, KeychainState>,
    account_id: Option<String>,
    name: String,
    description: Option<String>,
    private: bool,
    org: Option<String>,
) -> Result<GitHubRepo, String> {
    let token = resolve_github_token(&keychain.0, account_id.as_deref())?;
    let url = match org.as_deref().filter(|value| !value.trim().is_empty()) {
        Some(org) => format!("{GITHUB_API}/orgs/{}/repos", org.trim()),
        None => format!("{GITHUB_API}/user/repos"),
    };

    let mut payload = serde_json::Map::new();
    payload.insert("name".to_string(), serde_json::Value::String(name));
    payload.insert("private".to_string(), serde_json::Value::Bool(private));
    payload.insert("auto_init".to_string(), serde_json::Value::Bool(false));
    if let Some(description) = description.filter(|value| !value.trim().is_empty()) {
        payload.insert(
            "description".to_string(),
            serde_json::Value::String(description),
        );
    }

    let client = api_client()?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "HysCode/1.0")
        .json(&serde_json::Value::Object(payload))
        .send()
        .await
        .map_err(|e| format!("Failed to create repository: {}", e))?;
    let status = resp.status();
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(api_error_message(status, &body));
    }
    serde_json::from_slice(&body).map_err(|e| format!("Failed to parse response: {}", e))
}
