use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ── GitHub API response types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubCompareAuthor {
    name: String,
    date: String,
}

#[derive(Debug, Deserialize)]
struct GitHubCompareCommitDetail {
    message: String,
    author: GitHubCompareAuthor,
}

#[derive(Debug, Deserialize)]
struct GitHubCompareCommit {
    sha: String,
    commit: GitHubCompareCommitDetail,
    html_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubCompareResponse {
    commits: Vec<GitHubCompareCommit>,
}

// ── Public types returned to frontend ────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub body: String,
    pub published_at: String,
    pub asset_url: String,
    pub asset_name: String,
    pub asset_size: u64,
    pub current_version: String,
    pub commits: Vec<CommitInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percent: f32,
}

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_RELEASES_BASE: &str = "https://api.github.com/repos/hyskasoftware/Hyscode/releases";

const USER_AGENT: &str = "HysCode-Updater";

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Select the correct asset for the current platform.
fn select_platform_asset(assets: &[GitHubAsset]) -> Option<&GitHubAsset> {
    let target_extensions: &[&str] = if cfg!(target_os = "windows") {
        &[".exe", ".msi"]
    } else if cfg!(target_os = "macos") {
        &[".dmg"]
    } else {
        // Linux
        &[".AppImage", ".deb"]
    };

    for ext in target_extensions {
        if let Some(asset) = assets.iter().find(|a| a.name.ends_with(ext)) {
            return Some(asset);
        }
    }
    None
}

/// Parse a version string, stripping an optional leading 'v'.
fn parse_version(s: &str) -> Result<semver::Version, String> {
    let cleaned = s.strip_prefix('v').unwrap_or(s);
    semver::Version::parse(cleaned).map_err(|e| format!("Invalid version '{}': {}", s, e))
}

/// Validate that a download URL comes from GitHub.
fn is_safe_download_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("https://objects.githubusercontent.com/")
}

/// Validate that an installer path is in the system temp directory and has an expected extension.
fn is_safe_installer_path(path: &std::path::Path) -> bool {
    let temp = std::env::temp_dir();
    if !path.starts_with(&temp) {
        return false;
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    matches!(ext, "exe" | "msi" | "dmg" | "AppImage" | "deb")
}

/// Fetch commit history between two tags using GitHub Compare API.
async fn fetch_commits_between(
    client: &reqwest::Client,
    base_tag: &str,
    head_tag: &str,
) -> Result<Vec<CommitInfo>, String> {
    let url = format!(
        "https://api.github.com/repos/hyskasoftware/Hyscode/compare/{}...{}",
        base_tag, head_tag
    );
    let response = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch compare: {}", e))?;

    if !response.status().is_success() {
        // 404 usually means no common ancestor or tags not found — return empty list
        return Ok(Vec::new());
    }

    let compare: GitHubCompareResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse compare JSON: {}", e))?;

    let commits = compare
        .commits
        .into_iter()
        .map(|c| CommitInfo {
            sha: c.sha.chars().take(7).collect(),
            message: c
                .commit
                .message
                .lines()
                .next()
                .unwrap_or(&c.commit.message)
                .to_string(),
            author: c.commit.author.name,
            date: c
                .commit
                .author
                .date
                .split('T')
                .next()
                .unwrap_or(&c.commit.author.date)
                .to_string(),
            url: c.html_url,
        })
        .collect();

    Ok(commits)
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Check the GitHub releases API for a newer version.
/// `channel`: "stable" uses /releases/latest; "pre-release" scans recent releases for the
/// highest semver (stable or pre-release).
/// Returns `None` if up to date or no releases found.
#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    channel: Option<String>,
) -> Result<Option<ReleaseInfo>, String> {
    let is_prerelease = channel.as_deref() == Some("pre-release");
    let client = reqwest::Client::new();

    // Use the Tauri bundle version (from tauri.conf.json) as the authoritative
    // current version. This is what users see in the OS and what release tags must match.
    let current_version = app.package_info().version.clone();

    // For pre-release channel, fetch the full list (up to 20 releases) and pick the
    // candidate with the highest semver — stable or pre-release.
    // For stable, use /releases/latest which GitHub guarantees excludes pre-releases.
    let release = if is_prerelease {
        let url = format!("{}?per_page=20", GITHUB_RELEASES_BASE);
        let response = client
            .get(&url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch releases: {}", e))?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!("GitHub API returned status {}", status.as_u16()));
        }

        let releases: Vec<GitHubRelease> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse releases JSON: {}", e))?;

        if releases.is_empty() {
            return Ok(None);
        }

        // Pick the release with the highest semver that also has a compatible platform asset.
        let best = releases
            .into_iter()
            .filter_map(|r| {
                let version = parse_version(&r.tag_name).ok()?;
                // Only consider releases that have a downloadable asset for this platform.
                select_platform_asset(&r.assets)?;
                Some((version, r))
            })
            .max_by(|(a, _), (b, _)| a.cmp(b));

        match best {
            Some((_, r)) => r,
            None => return Ok(None),
        }
    } else {
        let url = format!("{}/latest", GITHUB_RELEASES_BASE);
        let response = client
            .get(&url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch releases: {}", e))?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!("GitHub API returned status {}", status.as_u16()));
        }

        response
            .json::<GitHubRelease>()
            .await
            .map_err(|e| format!("Failed to parse release JSON: {}", e))?
    };

    let remote_version = parse_version(&release.tag_name)?;

    if remote_version <= current_version {
        return Ok(None);
    }

    let asset = select_platform_asset(&release.assets)
        .ok_or_else(|| "No compatible installer found in this release".to_string())?;

    // Fetch commit history between current version and the new release
    let base_tag = format!("v{}", current_version);
    let commits = fetch_commits_between(&client, &base_tag, &release.tag_name)
        .await
        .unwrap_or_default();

    Ok(Some(ReleaseInfo {
        version: release.tag_name.clone(),
        body: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        asset_url: asset.browser_download_url.clone(),
        asset_name: asset.name.clone(),
        asset_size: asset.size,
        current_version: current_version.to_string(),
        commits,
    }))
}

/// Download the update installer, streaming progress events to the frontend.
/// Returns the path to the downloaded installer file.
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    asset_url: String,
    asset_name: String,
) -> Result<String, String> {
    // Security: only allow downloads from GitHub domains
    if !is_safe_download_url(&asset_url) {
        return Err("Download URL is not from a trusted domain".to_string());
    }

    let client = reqwest::Client::new();

    let response = client
        .get(&asset_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status {}",
            response.status().as_u16()
        ));
    }

    let total = response.content_length().unwrap_or(0);
    let dest = std::env::temp_dir().join(&asset_name);

    let mut file =
        std::fs::File::create(&dest).map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emitted_percent: i32 = -1;

    use std::io::Write;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write to file: {}", e))?;

        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f32 / total as f32) * 100.0
        } else {
            0.0
        };

        // Emit progress at most every 1% to avoid flooding the event bus
        let rounded = percent as i32;
        if rounded > last_emitted_percent {
            last_emitted_percent = rounded;
            let _ = app.emit(
                "update:progress",
                DownloadProgress {
                    downloaded,
                    total,
                    percent,
                },
            );
        }
    }

    // Final 100% event
    let _ = app.emit(
        "update:progress",
        DownloadProgress {
            downloaded,
            total,
            percent: 100.0,
        },
    );

    Ok(dest.to_string_lossy().to_string())
}

/// Launch the downloaded installer and exit the application.
#[tauri::command]
pub async fn updater_install(app: AppHandle, installer_path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&installer_path);

    // Security: ensure the path is in temp dir and has a valid extension
    if !is_safe_installer_path(&path) {
        return Err("Invalid installer path".to_string());
    }

    if !path.exists() {
        return Err("Installer file not found".to_string());
    }

    // Launch the installer
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open installer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext == "AppImage" {
            // Make AppImage executable
            let mut perms = std::fs::metadata(&path)
                .map_err(|e| format!("Failed to read permissions: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms)
                .map_err(|e| format!("Failed to set permissions: {}", e))?;
            std::process::Command::new(&path)
                .spawn()
                .map_err(|e| format!("Failed to launch AppImage: {}", e))?;
        } else {
            // .deb — open with system handler
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open installer: {}", e))?;
        }
    }

    // Exit the application so the installer can replace the binary
    app.exit(0);
    Ok(())
}
