use super::git::{open_repo, GitRemoteInfo};
use super::keychain::KeychainState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePullRequestPayload {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub head: String,
    pub base: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GitHubPullRequestResponse {
    html_url: String,
    number: u64,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PullRequestResult {
    pub url: String,
    pub number: u64,
}

fn parse_github_remote_url(url: &str) -> Option<(String, String)> {
    // Handle HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
    if let Some(rest) = url.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = rest.trim_end_matches(".git").split('/').collect();
        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }
    // Handle SSH: git@github.com:owner/repo.git or git@github.com:owner/repo
    if let Some(rest) = url.strip_prefix("git@github.com:") {
        let parts: Vec<&str> = rest.trim_end_matches(".git").split('/').collect();
        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }
    // Handle git://github.com/owner/repo.git
    if let Some(rest) = url.strip_prefix("git://github.com/") {
        let parts: Vec<&str> = rest.trim_end_matches(".git").split('/').collect();
        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }
    None
}

/// Get GitHub remote info from a local git repo.
/// Returns the remote URL and parsed owner/repo.
#[tauri::command]
pub fn git_remote_info(repo_path: String) -> Result<GitRemoteInfo, String> {
    let repo = open_repo(&repo_path)?;
    let remotes = repo
        .remotes()
        .map_err(|e| format!("Remotes error: {}", e))?;

    for name in remotes.iter().flatten() {
        if name == "origin" {
            if let Ok(remote) = repo.find_remote(name) {
                if let Some(url) = remote.url() {
                    return Ok(GitRemoteInfo {
                        name: name.to_string(),
                        url: url.to_string(),
                    });
                }
            }
        }
    }

    // Fallback: return first remote
    for name in remotes.iter().flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            if let Some(url) = remote.url() {
                return Ok(GitRemoteInfo {
                    name: name.to_string(),
                    url: url.to_string(),
                });
            }
        }
    }

    Err("No remote found".to_string())
}

/// Create a pull request on GitHub using the stored GitHub access token.
/// Falls back to a user-provided token if no Copilot token is available.
#[tauri::command]
pub async fn github_create_pull_request(
    keychain: State<'_, KeychainState>,
    repo_path: String,
    payload: CreatePullRequestPayload,
) -> Result<PullRequestResult, String> {
    // 1. Discover repo and get remote URL
    let remote_url = {
        let repo = open_repo(&repo_path)?;
        let remotes = repo
            .remotes()
            .map_err(|e| format!("Remotes error: {}", e))?;
        remotes
            .iter()
            .flatten()
            .find_map(|name| {
                repo.find_remote(name)
                    .ok()
                    .and_then(|r| r.url().map(String::from))
            })
            .ok_or("No remote configured")?
    };

    let (owner, repo_name) = parse_github_remote_url(&remote_url)
        .ok_or_else(|| format!("Cannot parse GitHub remote URL: {}", remote_url))?;

    // 2. Get GitHub token from keychain (prefer copilot access token, fallback to generic github token)
    let token = {
        let store = keychain.0.lock().map_err(|e| e.to_string())?;
        store
            .get("hyscode:github_copilot_access_token")
            .cloned()
            .or_else(|| store.get("hyscode:github_token").cloned())
            .ok_or(
                "No GitHub token found. Please authenticate via Settings → GitHub or add a token.",
            )?
    };

    // 3. Build request
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let api_url = format!("https://api.github.com/repos/{}/{}/pulls", owner, repo_name);

    let resp = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "HysCode/1.0")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to create PR: {}", e))?;

    let status = resp.status();
    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        let body_str = String::from_utf8_lossy(&body_bytes);
        // Try to extract GitHub error message
        let msg = if let Ok(err) = serde_json::from_str::<serde_json::Value>(&body_str) {
            err.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or(&body_str)
                .to_string()
        } else {
            body_str.to_string()
        };
        return Err(format!("GitHub API error ({}): {}", status.as_u16(), msg));
    }

    let pr: GitHubPullRequestResponse = serde_json::from_slice(&body_bytes)
        .map_err(|e| format!("Failed to parse PR response: {}", e))?;

    Ok(PullRequestResult {
        url: pr.html_url,
        number: pr.number,
    })
}

/// Store a generic GitHub personal access token in the keychain.
#[tauri::command]
pub async fn github_set_token(
    keychain: State<'_, KeychainState>,
    token: String,
) -> Result<(), String> {
    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    store.insert("hyscode:github_token".to_string(), token);
    super::keychain::persist_keychain_ref(&store);
    Ok(())
}

/// Check if a GitHub token (copilot or generic) is available.
#[tauri::command]
pub async fn github_has_token(keychain: State<'_, KeychainState>) -> Result<bool, String> {
    let store = keychain.0.lock().map_err(|e| e.to_string())?;
    Ok(store.contains_key("hyscode:github_copilot_access_token")
        || store.contains_key("hyscode:github_token"))
}
