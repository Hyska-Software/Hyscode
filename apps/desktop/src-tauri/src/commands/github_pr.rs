use super::git::{open_repo, run_git_cli, GitRemoteInfo};
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

/// Create a pull request on GitHub using the dedicated repository token.
#[tauri::command]
pub async fn github_create_pull_request(
    keychain: State<'_, KeychainState>,
    repo_path: String,
    mut payload: CreatePullRequestPayload,
    base_remote: String,
    head_remote: String,
) -> Result<PullRequestResult, String> {
    // 1. Resolve the explicitly selected base/head GitHub remotes.
    let (base_remote_url, head_remote_url) = {
        let repo = open_repo(&repo_path)?;
        let base = repo
            .find_remote(&base_remote)
            .map_err(|e| format!("Base remote '{base_remote}' was not found: {e}"))?
            .url()
            .map(String::from)
            .ok_or_else(|| format!("Base remote '{base_remote}' has no URL"))?;
        let head = repo
            .find_remote(&head_remote)
            .map_err(|e| format!("Head remote '{head_remote}' was not found: {e}"))?
            .url()
            .map(String::from)
            .ok_or_else(|| format!("Head remote '{head_remote}' has no URL"))?;
        (base, head)
    };

    let (base_owner, repo_name) = parse_github_remote_url(&base_remote_url).ok_or_else(|| {
        format!("Only github.com remotes support pull requests: {base_remote_url}")
    })?;
    let (head_owner, head_repo_name) =
        parse_github_remote_url(&head_remote_url).ok_or_else(|| {
            format!("Only github.com remotes support pull requests: {head_remote_url}")
        })?;
    if repo_name != head_repo_name {
        return Err(format!(
            "The selected base and head remotes point to different repository names ('{repo_name}' and '{head_repo_name}')"
        ));
    }
    let head_branch = payload.head.rsplit(':').next().unwrap_or(&payload.head);
    if base_owner == head_owner && payload.base == head_branch {
        return Err("The pull request base and head must be different".to_string());
    }
    run_git_cli(
        &repo_path,
        [
            "ls-remote",
            "--exit-code",
            "--heads",
            head_remote.as_str(),
            format!("refs/heads/{head_branch}").as_str(),
        ],
    )
    .map_err(|_| {
        format!(
            "Branch '{head_branch}' is not published on remote '{head_remote}'. Publish it before creating the pull request."
        )
    })?;
    if head_owner != base_owner && !payload.head.contains(':') {
        payload.head = format!("{head_owner}:{}", payload.head);
    }

    // 2. A repository-scoped token is distinct from Copilot authentication.
    let token = {
        let store = keychain.0.lock().map_err(|e| e.to_string())?;
        store
            .get("hyscode:github_token")
            .cloned()
            .ok_or("No repository GitHub token found. Add one in Settings → Git.")?
    };

    // 3. Build request
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let api_url = format!(
        "https://api.github.com/repos/{}/{}/pulls",
        base_owner, repo_name
    );

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

/// Check if the dedicated repository GitHub token is available.
#[tauri::command]
pub async fn github_has_token(keychain: State<'_, KeychainState>) -> Result<bool, String> {
    let store = keychain.0.lock().map_err(|e| e.to_string())?;
    Ok(store.contains_key("hyscode:github_token"))
}

#[tauri::command]
pub async fn github_remove_token(keychain: State<'_, KeychainState>) -> Result<(), String> {
    let mut store = keychain.0.lock().map_err(|e| e.to_string())?;
    store.remove("hyscode:github_token");
    super::keychain::persist_keychain_ref(&store);
    Ok(())
}
