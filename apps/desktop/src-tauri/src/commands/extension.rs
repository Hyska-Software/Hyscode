use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionMeta {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub publisher: String,
    pub path: String,
    pub enabled: bool,
    pub installed_at: String,
    pub manifest: Option<serde_json::Value>,
    pub icon: Option<String>,
    pub categories: Vec<String>,
    pub activation_events: Vec<String>,
    pub has_main: bool,
}

fn extensions_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hyscode").join("extensions")
}

fn state_file() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hyscode").join("extension-state.json")
}

/// Persisted per-extension state (enabled/disabled)
#[derive(Debug, Serialize, Deserialize, Default)]
struct ExtensionStates {
    states: std::collections::HashMap<String, bool>,
}

fn load_states() -> ExtensionStates {
    let path = state_file();
    if !path.exists() {
        return ExtensionStates::default();
    }
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => ExtensionStates::default(),
    }
}

fn save_states(states: &ExtensionStates) -> Result<(), String> {
    let path = state_file();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create state dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(states)
        .map_err(|e| format!("Failed to serialize state: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write state file: {}", e))?;
    Ok(())
}

fn load_icon_as_data_uri(icon_name: &str, ext_path: &PathBuf) -> Option<String> {
    // Basic security: reject paths that try to escape the extension directory.
    // The join result is canonicalized and must stay inside the canonical
    // extension dir (blocks `..`, absolute paths and symlink escapes).
    if icon_name.contains("..") || icon_name.contains('\0') {
        return None;
    }
    let canonical_ext_dir = ext_path.canonicalize().ok()?;
    let icon_path = ext_path.join(icon_name);
    let canonical_icon = icon_path.canonicalize().ok()?;
    if !canonical_icon.starts_with(&canonical_ext_dir) {
        return None;
    }
    if !canonical_icon.is_file() {
        return None;
    }

    let file_ext = canonical_icon.extension()?.to_str()?.to_lowercase();

    match file_ext.as_str() {
        "svg" => {
            // SVG is text — URL-encode as a compact data URI (no base64 overhead)
            let content = fs::read_to_string(&canonical_icon).ok()?;
            let encoded = urlencoding::encode(&content);
            Some(format!("data:image/svg+xml,{}", encoded))
        }
        "png" => {
            use base64::prelude::*;
            let bytes = fs::read(&canonical_icon).ok()?;
            Some(format!(
                "data:image/png;base64,{}",
                BASE64_STANDARD.encode(&bytes)
            ))
        }
        "jpg" | "jpeg" => {
            use base64::prelude::*;
            let bytes = fs::read(&canonical_icon).ok()?;
            Some(format!(
                "data:image/jpeg;base64,{}",
                BASE64_STANDARD.encode(&bytes)
            ))
        }
        _ => None,
    }
}

fn parse_manifest(
    manifest: &serde_json::Value,
    ext_path: &PathBuf,
) -> Result<ExtensionMeta, String> {
    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("extension.json missing 'name' field")?
        .to_string();

    // Validate name (alphanumeric, hyphens, underscores only)
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "Invalid extension name '{}': only alphanumeric, hyphens and underscores allowed",
            name
        ));
    }

    let display_name = manifest
        .get("displayName")
        .and_then(|v| v.as_str())
        .unwrap_or(&name)
        .to_string();

    let version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();

    let description = manifest
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let publisher = manifest
        .get("publisher")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let icon = manifest
        .get("icon")
        .and_then(|v| v.as_str())
        .and_then(|icon_name| load_icon_as_data_uri(icon_name, ext_path));

    let categories: Vec<String> = manifest
        .get("categories")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let activation_events: Vec<String> = manifest
        .get("activationEvents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let has_main = manifest.get("main").and_then(|v| v.as_str()).is_some();

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Load enabled state from persisted file
    let states = load_states();
    let enabled = states.states.get(&name).copied().unwrap_or(true);

    Ok(ExtensionMeta {
        name,
        display_name,
        version,
        description,
        publisher,
        path: ext_path.to_string_lossy().to_string(),
        enabled,
        installed_at: now,
        manifest: Some(manifest.clone()),
        icon,
        categories,
        activation_events,
        has_main,
    })
}

/// Install from a folder (existing behavior)
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_install(source_path: String) -> Result<ExtensionMeta, String> {
    let source = PathBuf::from(&source_path);

    let manifest_path = source.join("extension.json");
    if !manifest_path.exists() {
        return Err("No extension.json found in the given folder.".to_string());
    }

    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read extension.json: {}", e))?;

    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Invalid extension.json: {}", e))?;

    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("extension.json missing 'name' field")?
        .to_string();

    let dest = extensions_dir().join(&name);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("Failed to remove existing extension: {}", e))?;
    }

    copy_dir_recursive(&source, &dest)
        .map_err(|e| format!("Failed to copy extension files: {}", e))?;

    let mut meta = parse_manifest(&manifest, &dest)?;
    meta.enabled = true;

    // Persist enabled state
    let mut states = load_states();
    states.states.insert(meta.name.clone(), true);
    save_states(&states)?;

    Ok(meta)
}

/// Install from a .zip or .rar archive file
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_install_zip(zip_path: String) -> Result<ExtensionMeta, String> {
    let archive_file = PathBuf::from(&zip_path);
    if !archive_file.exists() {
        return Err("Archive file not found.".to_string());
    }

    let temp_dir = extensions_dir().join("__temp_install__");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("Failed to clean temp dir: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Extract (ZIP or RAR, detected by magic bytes)
    if let Err(e) = extract_archive_to_dir(&archive_file, &temp_dir) {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(e);
    }

    // Find extension.json at root or one level deep
    let manifest_path = find_extension_json(&temp_dir).ok_or_else(|| {
        let _ = fs::remove_dir_all(&temp_dir);
        "No extension.json found in archive.".to_string()
    })?;

    let ext_root = manifest_path
        .parent()
        .ok_or("extension.json has no parent directory")?
        .to_path_buf();

    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read extension.json: {}", e))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Invalid extension.json: {}", e))?;

    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("extension.json missing 'name' field")?
        .to_string();

    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Invalid extension name '{}': only alphanumeric, hyphens and underscores allowed",
            name
        ));
    }

    let dest = extensions_dir().join(&name);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("Failed to remove existing extension: {}", e))?;
    }

    if ext_root == temp_dir {
        fs::rename(&temp_dir, &dest).map_err(|e| format!("Failed to move extension: {}", e))?;
    } else {
        fs::rename(&ext_root, &dest).map_err(|e| format!("Failed to move extension: {}", e))?;
        let _ = fs::remove_dir_all(&temp_dir);
    }

    let mut meta = parse_manifest(&manifest, &dest)?;
    meta.enabled = true;

    let mut states = load_states();
    states.states.insert(meta.name.clone(), true);
    save_states(&states)?;

    Ok(meta)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn extension_uninstall(name: String) -> Result<(), String> {
    // Validate name to prevent path traversal
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid extension name.".to_string());
    }

    let dir = extensions_dir().join(&name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove extension: {}", e))?;
    }

    // Remove from state
    let mut states = load_states();
    states.states.remove(&name);
    save_states(&states)?;

    Ok(())
}

/// Toggle extension enabled/disabled, persists to disk
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_toggle(name: String, enabled: bool) -> Result<(), String> {
    let mut states = load_states();
    states.states.insert(name, enabled);
    save_states(&states)?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn extension_list() -> Result<Vec<ExtensionMeta>, String> {
    let dir = extensions_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create extensions dir: {}", e))?;
        return Ok(vec![]);
    }

    let states = load_states();
    let mut extensions = Vec::new();

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to list extensions dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Skip temp install dir
        if path
            .file_name()
            .map(|n| n == "__temp_install__")
            .unwrap_or(false)
        {
            continue;
        }

        let manifest_path = path.join("extension.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_str = match fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let manifest: serde_json::Value = match serde_json::from_str(&manifest_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match parse_manifest(&manifest, &path) {
            Ok(mut meta) => {
                // Override enabled from persisted state
                if let Some(&enabled) = states.states.get(&meta.name) {
                    meta.enabled = enabled;
                }
                extensions.push(meta);
            }
            Err(_) => continue,
        }
    }

    // Sort by display name
    extensions.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });

    Ok(extensions)
}

fn resolve_extension_asset(name: &str, asset_path: &str) -> Result<PathBuf, String> {
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid extension name.".to_string());
    }

    let full_path = extensions_dir().join(name).join(asset_path);

    // Ensure asset_path doesn't escape the extension dir
    let canonical_ext_dir = extensions_dir()
        .join(name)
        .canonicalize()
        .map_err(|e| format!("Extension not found: {}", e))?;

    let canonical_asset = full_path
        .canonicalize()
        .map_err(|e| format!("Asset not found: {}", e))?;

    if !canonical_asset.starts_with(&canonical_ext_dir) {
        return Err("Access denied: path traversal detected.".to_string());
    }

    Ok(canonical_asset)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn extension_read_asset(name: String, asset_path: String) -> Result<String, String> {
    let canonical_asset = resolve_extension_asset(&name, &asset_path)?;
    fs::read_to_string(&canonical_asset).map_err(|e| format!("Failed to read asset: {}", e))
}

/// Read an extension asset without assuming it is UTF-8 text.
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_read_asset_base64(
    name: String,
    asset_path: String,
) -> Result<String, String> {
    use base64::prelude::*;

    let canonical_asset = resolve_extension_asset(&name, &asset_path)?;
    let bytes = fs::read(&canonical_asset).map_err(|e| format!("Failed to read asset: {}", e))?;
    Ok(BASE64_STANDARD.encode(bytes))
}

/// Get the extension directory path for the frontend to know where extensions live
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_get_dir() -> Result<String, String> {
    let dir = extensions_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create extensions dir: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), std::io::Error> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

// ── Git-based Extension Install/Update ──────────────────────────────────────

use std::collections::HashMap;

/// Where cloned extension repos are stored (separate from installed extensions).
fn git_clones_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hyscode").join("extensions-git")
}

fn git_sources_file() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hyscode").join("extension-git-sources.json")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionGitSource {
    pub extension_name: String,
    pub repo_url: String,
    pub branch: String,
    pub local_clone_path: String,
    pub local_commit_sha: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct ExtensionGitSources {
    sources: HashMap<String, ExtensionGitSource>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpdateInfo {
    pub extension_name: String,
    pub repo_url: String,
    pub current_sha: String,
    pub remote_sha: String,
    pub has_update: bool,
}

fn load_git_sources() -> ExtensionGitSources {
    let path = git_sources_file();
    if !path.exists() {
        return ExtensionGitSources::default();
    }
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => ExtensionGitSources::default(),
    }
}

fn save_git_sources(sources: &ExtensionGitSources) -> Result<(), String> {
    let path = git_sources_file();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create git sources dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(sources)
        .map_err(|e| format!("Failed to serialize git sources: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write git sources file: {}", e))?;
    Ok(())
}

/// Run a git CLI command and return stdout, or an error with stderr.
fn run_git(args: &[&str], cwd: Option<&PathBuf>) -> Result<String, String> {
    let mut command = super::utils::cmd("git");
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let output = command
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git exited with code {:?}", output.status.code())
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Normalize a git URL: add https:// scheme if missing, strip trailing .git.
/// SECURITY: delegates scheme validation to `git_backend::validate_clone_url`
/// — `file://` URLs and local paths are rejected (fail-closed).
fn normalize_git_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Validation: git URL cannot be empty".to_string());
    }
    // Reject local paths before any scheme handling: absolute paths, Windows
    // drive prefixes (`C:...`), home/parent-relative forms.
    let bytes = trimmed.as_bytes();
    let looks_like_path = trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.starts_with('.')
        || trimmed.starts_with('~')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':');
    if looks_like_path {
        return Err(format!("Validation: git URL not allowed: '{trimmed}'"));
    }
    let with_scheme = if trimmed.contains("://") {
        // Explicit scheme: validate as-is (notably, `file://` is rejected and
        // must NOT be masked by prepending `https://`).
        trimmed.to_string()
    } else if trimmed.starts_with("git@") || trimmed.starts_with("gh:") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };
    let validated = super::git_backend::validate_clone_url(&with_scheme)?;
    // Strip trailing .git for storage consistency (git clone works with or without it)
    Ok(validated.trim_end_matches(".git").to_string())
}

/// Find extension.json at root or one level deep inside `dir`.
fn find_extension_json(dir: &PathBuf) -> Option<PathBuf> {
    let root = dir.join("extension.json");
    if root.exists() {
        return Some(root);
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let candidate = p.join("extension.json");
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Extract a ZIP or RAR archive into `dest`, auto-detected by magic bytes.
fn extract_archive_to_dir(
    archive_path: &std::path::Path,
    dest: &std::path::Path,
) -> Result<(), String> {
    let header = {
        let mut buf = [0u8; 8];
        let mut f =
            fs::File::open(archive_path).map_err(|e| format!("Failed to open archive: {}", e))?;
        use std::io::Read;
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("Failed to read archive header: {}", e))?;
        buf[..n].to_vec()
    };

    if header.starts_with(&[0x50, 0x4B]) {
        // ZIP magic: PK
        extract_zip_to_dir(archive_path, dest)
    } else if header.starts_with(b"Rar!") {
        // RAR magic: Rar! (RAR4 + RAR5)
        extract_rar_to_dir(archive_path, dest)
    } else {
        Err("Unknown archive format. Only .zip and .rar archives are supported.".to_string())
    }
}

fn extract_zip_to_dir(zip_path: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let canonical_dest = dest
        .canonicalize()
        .map_err(|e| format!("Cannot resolve extraction dir: {}", e))?;
    let file = fs::File::open(zip_path).map_err(|e| format!("Failed to open ZIP: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP archive: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry #{}: {}", i, e))?;

        let entry_path = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };

        let out_path = dest.join(&entry_path);
        // Defense-in-depth: `enclosed_name()` already rejects traversal, but
        // re-verify against the canonical dest in case of symlink races.
        let normalized = canonical_dest.join(&entry_path);
        if !normalized.starts_with(&canonical_dest) {
            return Err(format!(
                "Archive entry escapes the destination: '{}'",
                entry_path.display()
            ));
        }

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("Failed to create dir: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir: {}", e))?;
            }
            let mut outfile =
                fs::File::create(&out_path).map_err(|e| format!("Failed to create file: {}", e))?;
            io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }
    Ok(())
}

fn find_7zip() -> Option<std::path::PathBuf> {
    // Check PATH first
    if let Ok(out) = std::process::Command::new("7z").arg("i").output() {
        if out.status.success() {
            return Some(std::path::PathBuf::from("7z"));
        }
    }
    // Common Windows install paths
    let candidates = [
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Some(std::path::PathBuf::from(c));
        }
    }
    None
}

fn extract_rar_to_dir(rar_path: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("Failed to create extraction dir: {}", e))?;
    // Canonicalize once so external extractors (7-Zip) and `extract_to` both
    // operate on the resolved destination (no `..`/symlink ambiguity).
    let canonical_dest = dest
        .canonicalize()
        .map_err(|e| format!("Cannot resolve extraction dir: {}", e))?;

    // Prefer 7-Zip (reliable on Windows for RAR4 and RAR5)
    if let Some(sz) = find_7zip() {
        let dest_arg = format!("-o{}", canonical_dest.to_string_lossy());
        let out = std::process::Command::new(&sz)
            .args(["x", rar_path.to_str().unwrap_or(""), &dest_arg, "-y"])
            .output()
            .map_err(|e| format!("Failed to run 7-Zip: {}", e))?;

        if out.status.success() {
            return Ok(());
        }
        let detail = String::from_utf8_lossy(&out.stdout);
        return Err(format!("7-Zip extraction failed:\n{}", detail.trim()));
    }

    // Fallback: unrar crate (bundles RARLab C++ library)
    let path_str = rar_path.to_str().ok_or("RAR path contains invalid UTF-8")?;
    let dest_raw = dest
        .to_str()
        .ok_or("Destination path contains invalid UTF-8")?;
    // Unrar C++ library requires a trailing path separator on Windows
    let dest_str = if dest_raw.ends_with('\\') || dest_raw.ends_with('/') {
        dest_raw.to_string()
    } else {
        format!("{}\\", dest_raw)
    };

    let mut cur = unrar::Archive::new(path_str)
        .open_for_processing()
        .map_err(|e| format!("Failed to open RAR archive: {}", e))?;

    let mut idx = 0u32;
    loop {
        match cur.read_header() {
            Err(e) => return Err(format!("Failed to read RAR (after {} entries): {}", idx, e)),
            Ok(None) => break,
            Ok(Some(entry)) => {
                idx += 1;
                let fname = entry.entry().filename.clone();
                // SECURITY: RAR entries are attacker-controlled paths. Reject
                // absolute paths and `..` segments before handing them to the
                // extractor (zip path is already covered by `enclosed_name`).
                let fname_path = std::path::Path::new(&fname);
                if fname_path.is_absolute()
                    || fname_path.components().any(|c| {
                        matches!(
                            c,
                            std::path::Component::ParentDir
                                | std::path::Component::RootDir
                                | std::path::Component::Prefix(_)
                        )
                    })
                {
                    return Err(format!(
                        "RAR entry escapes the destination: '{}'",
                        fname_path.display()
                    ));
                }
                let parent = dest.join(&fname);
                let parent = parent.parent().unwrap_or(dest);
                fs::create_dir_all(parent).ok();

                cur = entry.extract_to(&dest_str).map_err(|e| {
                    format!(
                        "RAR entry #{} ({:?}) → '{}': {} \
                     (hint: install 7-Zip for better RAR support)",
                        idx, fname, dest_str, e
                    )
                })?;
            }
        }
    }
    Ok(())
}

/// Install an extension from a public git repository.
/// Clones the repo, locates extension.json, installs into extensions dir, and records the git source.
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_install_git(
    repo_url: String,
    branch: Option<String>,
) -> Result<ExtensionMeta, String> {
    let url = normalize_git_url(&repo_url)?;
    if let Some(branch) = branch.as_deref().filter(|value| !value.trim().is_empty()) {
        // `git clone -b` value position: full ref validation (leading-dash
        // would become a clone flag).
        super::git_backend::validate_git_ref(branch.trim())?;
    }

    let clones_dir = git_clones_dir();
    fs::create_dir_all(&clones_dir)
        .map_err(|e| format!("Failed to create git clones dir: {}", e))?;

    // Use a temporary name for the initial clone based on the last path segment
    let url_name: String = url
        .trim_end_matches('/')
        .split('/')
        .last()
        .unwrap_or("extension")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let temp_clone_dir = clones_dir.join(format!("__clone_tmp_{}", url_name));

    // Remove stale temp dir if present
    if temp_clone_dir.exists() {
        fs::remove_dir_all(&temp_clone_dir)
            .map_err(|e| format!("Failed to clean temp clone dir: {}", e))?;
    }

    // Clone the repo (shallow, 1 commit deep)
    let mut clone_args = vec!["clone", "--depth", "1"];
    let branch_str; // keep alive
    if let Some(ref b) = branch {
        clone_args.extend_from_slice(&["-b"]);
        branch_str = b.clone();
        clone_args.push(&branch_str);
    }
    let url_ref = url.as_str();
    let temp_str = temp_clone_dir.to_string_lossy().to_string();
    clone_args.push(url_ref);
    clone_args.push(&temp_str);

    run_git(&clone_args, None)?;

    // Find extension.json
    let manifest_path =
        find_extension_json(&temp_clone_dir).ok_or("No extension.json found in repository.")?;

    let _ext_root = manifest_path
        .parent()
        .ok_or("extension.json has no parent directory")?
        .to_path_buf();

    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read extension.json: {}", e))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Invalid extension.json: {}", e))?;

    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("extension.json missing 'name' field")?
        .to_string();

    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        let _ = fs::remove_dir_all(&temp_clone_dir);
        return Err(format!(
            "Invalid extension name '{}': only alphanumeric, hyphens and underscores allowed",
            name
        ));
    }

    // Move cloned repo to permanent location: ~/.hyscode/extensions-git/{name}
    let final_clone_dir = clones_dir.join(&name);
    if final_clone_dir.exists() {
        fs::remove_dir_all(&final_clone_dir)
            .map_err(|e| format!("Failed to remove existing clone: {}", e))?;
    }
    fs::rename(&temp_clone_dir, &final_clone_dir)
        .map_err(|e| format!("Failed to move clone to final location: {}", e))?;

    // Re-derive manifest path inside final location
    let final_manifest_path =
        find_extension_json(&final_clone_dir).ok_or("extension.json disappeared after move.")?;
    let final_ext_root = final_manifest_path
        .parent()
        .ok_or("extension.json has no parent directory")?
        .to_path_buf();

    // Get current commit SHA
    let sha_output = run_git(&["rev-parse", "HEAD"], Some(&final_clone_dir)).unwrap_or_default();
    let commit_sha = sha_output.trim().to_string();

    // Detect the actual default branch name
    let actual_branch = run_git(
        &["rev-parse", "--abbrev-ref", "HEAD"],
        Some(&final_clone_dir),
    )
    .unwrap_or_default();
    let actual_branch = actual_branch.trim().to_string();
    let resolved_branch = if actual_branch.is_empty() {
        branch.unwrap_or_else(|| "HEAD".to_string())
    } else {
        actual_branch
    };

    // Install: copy to ~/.hyscode/extensions/{name}
    let dest = extensions_dir().join(&name);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("Failed to remove existing extension: {}", e))?;
    }
    copy_dir_recursive(&final_ext_root, &dest)
        .map_err(|e| format!("Failed to copy extension files: {}", e))?;

    // Re-read manifest from installed location
    let installed_manifest_str = fs::read_to_string(dest.join("extension.json"))
        .map_err(|e| format!("Failed to read installed extension.json: {}", e))?;
    let installed_manifest: serde_json::Value = serde_json::from_str(&installed_manifest_str)
        .map_err(|e| format!("Invalid installed extension.json: {}", e))?;

    let mut meta = parse_manifest(&installed_manifest, &dest)?;
    meta.enabled = true;

    // Persist enabled state
    let mut states = load_states();
    states.states.insert(meta.name.clone(), true);
    save_states(&states)?;

    // Persist git source record
    let mut git_sources = load_git_sources();
    git_sources.sources.insert(
        name.clone(),
        ExtensionGitSource {
            extension_name: name.clone(),
            repo_url: url.clone(),
            branch: resolved_branch,
            local_clone_path: final_clone_dir.to_string_lossy().to_string(),
            local_commit_sha: commit_sha,
        },
    );
    save_git_sources(&git_sources)?;

    Ok(meta)
}

/// Check all git-sourced extensions for available updates.
/// Runs `git ls-remote` to compare remote HEAD SHA with locally stored SHA.
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_check_git_updates() -> Result<Vec<GitUpdateInfo>, String> {
    let sources = load_git_sources();
    let mut results = Vec::new();

    for (_, source) in &sources.sources {
        // `git ls-remote <url> HEAD` returns "<sha>\tHEAD"
        let ls_remote = run_git(&["ls-remote", &source.repo_url, "HEAD"], None);
        let remote_sha = match ls_remote {
            Ok(output) => output
                .lines()
                .next()
                .and_then(|line| line.split('\t').next())
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            Err(_) => {
                // Network unavailable or repo gone — skip without failing
                results.push(GitUpdateInfo {
                    extension_name: source.extension_name.clone(),
                    repo_url: source.repo_url.clone(),
                    current_sha: source.local_commit_sha.clone(),
                    remote_sha: source.local_commit_sha.clone(),
                    has_update: false,
                });
                continue;
            }
        };

        let has_update = !remote_sha.is_empty() && remote_sha != source.local_commit_sha;

        results.push(GitUpdateInfo {
            extension_name: source.extension_name.clone(),
            repo_url: source.repo_url.clone(),
            current_sha: source.local_commit_sha.clone(),
            remote_sha: remote_sha.clone(),
            has_update,
        });
    }

    Ok(results)
}

/// Update a git-sourced extension by pulling the latest commit and re-installing.
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_update_git(extension_name: String) -> Result<ExtensionMeta, String> {
    // Validate name
    if !extension_name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid extension name.".to_string());
    }

    let mut git_sources = load_git_sources();
    let source = git_sources
        .sources
        .get(&extension_name)
        .cloned()
        .ok_or_else(|| {
            format!(
                "Extension '{}' is not a git-sourced extension.",
                extension_name
            )
        })?;

    let clone_dir = PathBuf::from(&source.local_clone_path);
    if !clone_dir.exists() {
        return Err(format!(
            "Clone directory not found: {}. Try re-installing the extension.",
            source.local_clone_path
        ));
    }

    // Pull latest changes
    run_git(&["pull"], Some(&clone_dir))?;

    // Get new commit SHA
    let sha_output = run_git(&["rev-parse", "HEAD"], Some(&clone_dir)).unwrap_or_default();
    let new_sha = sha_output.trim().to_string();

    // Find extension root inside clone (may be one folder deep)
    let manifest_path =
        find_extension_json(&clone_dir).ok_or("No extension.json found in cloned repository.")?;
    let ext_root = manifest_path
        .parent()
        .ok_or("extension.json has no parent directory")?
        .to_path_buf();

    // Re-install: copy to ~/.hyscode/extensions/{name}
    let dest = extensions_dir().join(&extension_name);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("Failed to remove old extension: {}", e))?;
    }
    copy_dir_recursive(&ext_root, &dest)
        .map_err(|e| format!("Failed to copy updated extension: {}", e))?;

    // Re-read manifest
    let manifest_str = fs::read_to_string(dest.join("extension.json"))
        .map_err(|e| format!("Failed to read updated extension.json: {}", e))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Invalid updated extension.json: {}", e))?;

    let meta = parse_manifest(&manifest, &dest)?;

    // Update stored SHA
    if let Some(entry) = git_sources.sources.get_mut(&extension_name) {
        entry.local_commit_sha = new_sha;
    }
    save_git_sources(&git_sources)?;

    Ok(meta)
}

/// Return all tracked git sources (so the frontend knows which extensions are git-sourced).
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_get_git_sources() -> Result<Vec<ExtensionGitSource>, String> {
    let sources = load_git_sources();
    Ok(sources.sources.into_values().collect())
}

/// Remove the git source record when an extension is uninstalled.
/// Call this alongside extension_uninstall if the extension was git-sourced.
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_remove_git_source(extension_name: String) -> Result<(), String> {
    if !extension_name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid extension name.".to_string());
    }

    let mut sources = load_git_sources();
    if let Some(source) = sources.sources.remove(&extension_name) {
        // Also remove the local clone
        let clone_dir = PathBuf::from(&source.local_clone_path);
        if clone_dir.exists() {
            let _ = fs::remove_dir_all(&clone_dir);
        }
        save_git_sources(&sources)?;
    }

    Ok(())
}

// ── Store Install ─────────────────────────────────────────────────────────────

/// Hosts allowed to serve extension store archives. Store metadata comes from
/// the GitHub API, whose `download_url` values point at `raw.githubusercontent`.
const STORE_ALLOWED_HOSTS: &[&str] = &[
    "raw.githubusercontent.com",
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "codeload.github.com",
    "registry.hyscode.dev",
];

/// 50 MiB cap for a single store download (extracted extensions are small;
/// anything larger is rejected before it can exhaust memory/disk).
const MAX_STORE_DOWNLOAD_BYTES: usize = 50 * 1024 * 1024;

/// Validate a store download URL: `https://` only, allowlisted host, no
/// userinfo, no `..` segments, no control characters.
fn validate_store_download_url(raw: &str) -> Result<url::Url, String> {
    if raw.trim().is_empty() {
        return Err("Validation: download URL cannot be empty".to_string());
    }
    if raw.contains("..") || raw.chars().any(|c| c.is_control()) {
        return Err("Validation: download URL contains invalid characters".to_string());
    }
    let parsed =
        url::Url::parse(raw).map_err(|e| format!("Validation: invalid download URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Validation: download URL must use https://".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Validation: download URL must not contain credentials".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Validation: download URL has no host".to_string())?;
    let allowed = STORE_ALLOWED_HOSTS
        .iter()
        .any(|candidate| host.eq_ignore_ascii_case(candidate));
    if !allowed {
        return Err(format!("Validation: download host not allowed: '{host}'"));
    }
    Ok(parsed)
}

/// Verify an optional expected SHA-256 (hex, case-insensitive) against bytes.
fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let expected = expected.trim().to_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Validation: expected_sha256 must be 64 hex characters".to_string());
    }
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected {
        return Err("Download hash mismatch: expected_sha256 does not match".to_string());
    }
    Ok(())
}

/// Download and install an extension from the Hyscode Extensions store.
/// Downloads the package from the given URL, detects the archive format
/// (ZIP supported; RAR returns a clear error), extracts, and installs.
///
/// SECURITY: the URL must be `https://` on an allowlisted host, the download
/// is capped at 50 MiB with a 30 s timeout, and `expected_sha256` is verified
/// before extraction whenever the store provides it. Installs without a hash
/// emit a warning (the store API does not publish archive hashes yet — see
/// `StoreItem.sha256` on the frontend); once the store publishes hashes the
/// parameter must become mandatory.
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_install_from_store(
    download_url: String,
    expected_sha256: Option<String>,
) -> Result<ExtensionMeta, String> {
    validate_store_download_url(&download_url)?;
    let expected_sha256 = expected_sha256
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(expected) = expected_sha256 {
        if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Validation: expected_sha256 must be 64 hex characters".to_string());
        }
    } else {
        eprintln!("[extension] installing without expected_sha256 (store hash not published yet)");
    }
    // Unique temp dir per install to avoid collisions
    let ts = chrono::Utc::now().timestamp_millis();
    let temp_dir = extensions_dir().join(format!("__temp_store_{}__", ts));

    let cleanup = |dir: &PathBuf| {
        let _ = fs::remove_dir_all(dir);
    };

    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Download the archive (30 s timeout, 50 MiB streaming cap)
    let client = reqwest::Client::builder()
        .user_agent("HysCode-ExtensionStore/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client.get(&download_url).send().await.map_err(|e| {
        cleanup(&temp_dir);
        format!("Download failed: {}", e)
    })?;

    if !response.status().is_success() {
        cleanup(&temp_dir);
        return Err(format!(
            "Download failed with HTTP status {}",
            response.status()
        ));
    }

    if response
        .content_length()
        .is_some_and(|len| len > MAX_STORE_DOWNLOAD_BYTES as u64)
    {
        cleanup(&temp_dir);
        return Err("Download exceeds the 50 MiB limit.".to_string());
    }

    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            cleanup(&temp_dir);
            format!("Failed to read download: {}", e)
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_STORE_DOWNLOAD_BYTES {
            cleanup(&temp_dir);
            return Err("Download exceeds the 50 MiB limit.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    if bytes.len() < 8 {
        cleanup(&temp_dir);
        return Err("Downloaded file is too small to be a valid archive.".to_string());
    }

    if let Some(expected) = expected_sha256 {
        if let Err(e) = verify_sha256(&bytes, expected) {
            cleanup(&temp_dir);
            return Err(e);
        }
    }

    // Save archive and extract (ZIP or RAR, auto-detected by magic bytes)
    let pkg_path = temp_dir.join("package.archive");
    fs::write(&pkg_path, &bytes).map_err(|e| {
        cleanup(&temp_dir);
        format!("Failed to save download: {}", e)
    })?;

    let extract_dir = temp_dir.join("extracted");
    fs::create_dir_all(&extract_dir).map_err(|e| {
        cleanup(&temp_dir);
        format!("Failed to create extract dir: {}", e)
    })?;

    if let Err(e) = extract_archive_to_dir(&pkg_path, &extract_dir) {
        cleanup(&temp_dir);
        return Err(e);
    }

    // Locate extension.json (root or one level deep)
    let manifest_path = find_extension_json(&extract_dir).ok_or_else(|| {
        cleanup(&temp_dir);
        "No extension.json found in archive.".to_string()
    })?;

    let ext_root = manifest_path
        .parent()
        .ok_or("extension.json has no parent directory")?
        .to_path_buf();

    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read extension.json: {}", e))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Invalid extension.json: {}", e))?;

    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("extension.json missing 'name' field")?
        .to_string();

    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        cleanup(&temp_dir);
        return Err(format!(
            "Invalid extension name '{}': only alphanumeric, hyphens and underscores allowed",
            name
        ));
    }

    // Install: replace existing if present
    let dest = extensions_dir().join(&name);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("Failed to remove existing extension: {}", e))?;
    }

    if ext_root == extract_dir {
        fs::rename(&extract_dir, &dest).map_err(|e| format!("Failed to move extension: {}", e))?;
    } else {
        fs::rename(&ext_root, &dest).map_err(|e| format!("Failed to move extension: {}", e))?;
    }
    cleanup(&temp_dir);

    let mut meta = parse_manifest(&manifest, &dest)?;
    meta.enabled = true;

    let mut states = load_states();
    states.states.insert(meta.name.clone(), true);
    save_states(&states)?;

    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_download_url_allows_github_hosts_only() {
        for valid in [
            "https://raw.githubusercontent.com/org/repo/main/ext.zip",
            "https://api.github.com/repos/org/repo/zipball/main",
            "https://github.com/org/repo/releases/download/v1/ext.zip",
            "https://objects.githubusercontent.com/abc123",
            "https://registry.hyscode.dev/ext.zip",
        ] {
            assert!(validate_store_download_url(valid).is_ok(), "{valid}");
        }
        for invalid in [
            "",
            "http://raw.githubusercontent.com/org/repo/ext.zip",
            "https://evil.com/ext.zip",
            "https://raw.githubusercontent.com.evil.com/ext.zip",
            "https://user:pass@raw.githubusercontent.com/ext.zip",
            "file:///tmp/ext.zip",
            "https://raw.githubusercontent.com/../escape.zip",
        ] {
            assert!(validate_store_download_url(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn sha256_verification_accepts_matching_hex() {
        let bytes = b"extension-bytes";
        let expected = format!("{:x}", Sha256::digest(bytes));
        assert!(verify_sha256(bytes, &expected).is_ok());
        assert!(verify_sha256(bytes, &expected.to_uppercase()).is_ok());
        assert!(verify_sha256(bytes, &"0".repeat(64)).is_err());
        assert!(verify_sha256(bytes, "short").is_err());
    }

    #[test]
    fn git_url_normalization_rejects_file_urls() {
        assert!(normalize_git_url("https://github.com/org/repo.git").is_ok());
        assert!(normalize_git_url("git@github.com:org/repo.git").is_ok());
        assert!(normalize_git_url("github.com/org/repo").is_ok());
        assert!(normalize_git_url("file:///tmp/repo.git").is_err());
        assert!(normalize_git_url("/tmp/repo").is_err());
        assert!(normalize_git_url("").is_err());
    }
}
