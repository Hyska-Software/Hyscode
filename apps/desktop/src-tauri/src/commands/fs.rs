use super::utils::cmd;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FileStat {
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub path: String,
    pub line_number: usize,
    pub line_content: String,
}

pub const READ_CHUNK_LEN: u64 = 256 * 1024;
pub const READ_CHUNK_HARD_CAP: u64 = 512 * 1024 * 1024;
pub const BINARY_SNIFF_LEN: usize = 8192;

#[derive(Serialize)]
pub struct FileChunk {
    pub data: String,
    pub total_size: u64,
    pub is_binary: bool,
    pub finished: bool,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn read_file_chunk(path: String, offset: u64, length: u64) -> Result<FileChunk, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let total_size = metadata.len();
    if offset >= total_size {
        return Ok(FileChunk {
            data: String::new(),
            total_size,
            is_binary: false,
            finished: true,
        });
    }
    if length == 0 || length > READ_CHUNK_LEN || offset.saturating_add(length) > READ_CHUNK_HARD_CAP {
        return Err("Chunk out of range".to_string());
    }
    let remaining = total_size.saturating_sub(offset);
    let read_len = (length.min(remaining)) as usize;
    if read_len == 0 {
        return Ok(FileChunk {
            data: String::new(),
            total_size,
            is_binary: false,
            finished: true,
        });
    }
    let mut file = fs::File::open(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let mut bytes = vec![0u8; read_len];
    file.read_exact(&mut bytes)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let finished = offset.saturating_add(read_len as u64) >= total_size;
    match String::from_utf8(bytes) {
        Ok(data) => Ok(FileChunk {
            data,
            total_size,
            is_binary: false,
            finished,
        }),
        Err(err) => {
            let raw = err.as_bytes();
            let sniff_len = raw.len().min(BINARY_SNIFF_LEN);
            if raw[..sniff_len].contains(&0) {
                return Ok(FileChunk {
                    data: String::new(),
                    total_size,
                    is_binary: true,
                    finished: true,
                });
            }
            Ok(FileChunk {
                data: String::from_utf8_lossy(raw).into_owned(),
                total_size,
                is_binary: false,
                finished,
            })
        }
    }
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub fn create_file(path: String, content: Option<String>) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if path.exists() {
        return Err(format!("File already exists: {}", path.display()));
    }
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&path, content.unwrap_or_default())
        .map_err(|e| format!("Failed to create file: {}", e))
}

fn ensure_path_exists(path: &Path) -> Result<(), String> {
    if !path.exists() && fs::symlink_metadata(path).is_err() {
        return Err(format!("Path not found: {}", path.display()));
    }
    Ok(())
}

/// Permanently delete a file or directory on the blocking filesystem pool.
///
/// Recursive deletion can take a long time for large workspaces. Keeping it
/// off the Tauri async runtime prevents filesystem work from delaying commands
/// that need to keep the application responsive.
#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        ensure_path_exists(&path)?;
        remove_all_hardened(&path)
    })
    .await
    .map_err(|error| format!("Delete task failed: {}", error))?
}

/// Move a file or directory to the OS Trash / Recycle Bin.
///
/// Returns `Err("TRASH_UNAVAILABLE: ...")` when the platform trash cannot be
/// used (e.g. Linux without a Freedesktop trash backend). Callers should offer
/// a permanent delete as an explicit user-confirmed fallback in that case.
#[tauri::command]
pub async fn trash_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        ensure_path_exists(&path)?;
        trash::delete(&path).map_err(|e| format!("TRASH_UNAVAILABLE: {}", e))
    })
    .await
    .map_err(|error| format!("Trash task failed: {}", error))?
}

/// Clear the read-only flag recursively so deletes succeed on all platforms
/// (Windows file attributes, Unix permission bits).
fn clear_readonly_recursive(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to read metadata of {}: {}", path.display(), e))?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.permissions().readonly() {
        let perms = writable_permissions(&meta);
        fs::set_permissions(path, perms).map_err(|e| {
            format!(
                "Failed to clear read-only flag of {}: {}",
                path.display(),
                e
            )
        })?;
    }
    if meta.is_dir() {
        let entries = fs::read_dir(path)
            .map_err(|e| format!("Failed to read dir {}: {}", path.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            clear_readonly_recursive(&entry.path())?;
        }
    }
    Ok(())
}

/// Permissions that allow deletion: on Unix add owner-write while preserving
/// all other mode bits (avoids the world-writable side effect of
/// `set_readonly(false)`); on Windows clear the read-only attribute.
fn writable_permissions(meta: &fs::Metadata) -> fs::Permissions {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::Permissions::from_mode(meta.permissions().mode() | 0o200)
    }
    #[cfg(not(unix))]
    {
        let mut perms = meta.permissions();
        perms.set_readonly(false);
        perms
    }
}

/// Permanent recursive delete that handles symlinks (never follows them into
/// the target) and read-only files/dirs on Windows, Linux and macOS.
fn remove_all_hardened(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to read metadata of {}: {}", path.display(), e))?;
    if meta.file_type().is_symlink() || meta.is_file() {
        let _ = fs::set_permissions(path, writable_permissions(&meta));
        return fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e));
    }

    // Most directories do not need permission preparation. Trying the native
    // recursive removal first avoids walking every entry twice on large trees.
    let delete_error = match fs::remove_dir_all(path) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };
    // Read-only entries are handled by the fallback below. Keeping this path
    // on every error preserves the hardened delete behavior on all platforms.

    // A failed recursive delete may have removed the last entries already.
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect directory {} after delete failure: {}",
                path.display(),
                error
            ));
        }
    }

    clear_readonly_recursive(path)?;
    fs::remove_dir_all(path).map_err(|error| {
        format!(
            "Failed to delete directory (initial attempt: {}; retry: {})",
            delete_error, error
        )
    })
}

#[tauri::command]
pub fn list_dir(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String> {
    let show_hidden = show_hidden.unwrap_or(false);
    let path = PathBuf::from(&path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Always skip heavy build/dependency directories
        if name == "node_modules" || name == "target" {
            continue;
        }

        // Skip hidden entries unless explicitly requested
        if !show_hidden && name.starts_with('.') {
            continue;
        }

        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

    Ok(entries)
}

#[tauri::command]
pub fn stat_path(path: String) -> Result<FileStat, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("Path not found: {}", path.display()));
    }

    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(FileStat {
        path: path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        size: metadata.len(),
        modified,
    })
}

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".turbo",
];

const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "svg", "woff", "woff2", "ttf", "otf", "eot", "mp3",
    "mp4", "avi", "mov", "zip", "tar", "gz", "rar", "7z", "pdf", "exe", "dll", "so", "dylib", "o",
    "a", "wasm", "lock",
];

fn is_binary_file(name: &str) -> bool {
    if let Some(ext) = name.rsplit('.').next() {
        BINARY_EXTENSIONS.contains(&ext.to_lowercase().as_str())
    } else {
        false
    }
}

#[tauri::command]
pub fn search_files(
    root: String,
    query: String,
    is_regex: Option<bool>,
    max_results: Option<usize>,
    show_hidden: Option<bool>,
) -> Result<Vec<SearchResult>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }

    let use_regex = is_regex.unwrap_or(false);
    let limit = max_results.unwrap_or(200);
    let show_hidden = show_hidden.unwrap_or(false);
    let mut results = Vec::new();

    // Pre-compile regex if requested
    let regex_opt = if use_regex {
        match regex::Regex::new(&query) {
            Ok(re) => Some(re),
            Err(e) => return Err(format!("Invalid regex: {}", e)),
        }
    } else {
        None
    };

    fn walk(
        dir: &PathBuf,
        query: &str,
        regex_opt: &Option<regex::Regex>,
        results: &mut Vec<SearchResult>,
        limit: usize,
        show_hidden: bool,
    ) -> std::io::Result<()> {
        if results.len() >= limit {
            return Ok(());
        }

        let entries = fs::read_dir(dir)?;
        for entry in entries {
            if results.len() >= limit {
                break;
            }
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();

            if (!show_hidden && name.starts_with('.')) || IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }

            let path = entry.path();
            let ft = entry.file_type()?;

            if ft.is_dir() {
                walk(&path, query, regex_opt, results, limit, show_hidden)?;
            } else if ft.is_file() && !is_binary_file(&name) {
                if let Ok(content) = fs::read_to_string(&path) {
                    for (i, line) in content.lines().enumerate() {
                        if results.len() >= limit {
                            break;
                        }
                        let matched = if let Some(ref re) = regex_opt {
                            re.is_match(line)
                        } else {
                            line.to_lowercase().contains(&query.to_lowercase())
                        };
                        if matched {
                            results.push(SearchResult {
                                path: path.to_string_lossy().to_string(),
                                line_number: i + 1,
                                line_content: line.trim().to_string(),
                            });
                        }
                    }
                }
            }
        }
        Ok(())
    }

    walk(
        &root_path,
        &query,
        &regex_opt,
        &mut results,
        limit,
        show_hidden,
    )
    .map_err(|e| format!("Search error: {}", e))?;

    Ok(results)
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    let from_path = PathBuf::from(&from);
    let to_path = PathBuf::from(&to);

    if !from_path.exists() && fs::symlink_metadata(&from_path).is_err() {
        return Err(format!("Source path not found: {}", from));
    }
    if to_path.exists() || fs::symlink_metadata(&to_path).is_ok() {
        return Err(format!("Destination already exists: {}", to));
    }
    if let Some(name) = to_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }

    fs::rename(&from_path, &to_path).map_err(|e| format!("Failed to rename: {}", e))
}

/// Returns true when `child` equals `parent` or is nested inside it.
/// On Windows the comparison is case-insensitive and separator-agnostic so
/// that "C:\A" vs "c:/a/b" is detected; elsewhere `Path::starts_with` is used.
fn is_within_dir(child: &Path, parent: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        fn norm(p: &Path) -> String {
            p.to_string_lossy()
                .replace('/', "\\")
                .trim_end_matches('\\')
                .to_lowercase()
        }
        let c = norm(child);
        let p = norm(parent);
        c == p || c.starts_with(&format!("{}\\", p))
    }
    #[cfg(not(target_os = "windows"))]
    {
        child.starts_with(parent)
    }
}

fn is_cross_device_error(e: &std::io::Error) -> bool {
    match e.raw_os_error() {
        #[cfg(target_os = "windows")]
        Some(code) => code == 17, // ERROR_NOT_SAME_DEVICE
        #[cfg(target_os = "macos")]
        Some(code) => code == 18, // EXDEV
        #[cfg(target_os = "linux")]
        Some(code) => code == 18, // EXDEV
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Some(_) => false,
        None => false,
    }
}

/// Move a file or directory, working across volumes/drives.
///
/// Same-device moves use an atomic `rename`. Cross-device moves
/// (`C:` -> `D:`, `/` -> `/mnt`, ...) fall back to copy + permanent delete.
/// The destination must not exist; callers are expected to auto-rename first.
#[tauri::command]
pub fn move_path(from: String, to: String) -> Result<(), String> {
    let from_path = PathBuf::from(&from);
    let to_path = PathBuf::from(&to);

    if !from_path.exists() && fs::symlink_metadata(&from_path).is_err() {
        return Err(format!("Source path not found: {}", from));
    }
    if to_path.exists() || fs::symlink_metadata(&to_path).is_ok() {
        return Err(format!("Destination already exists: {}", to));
    }
    if is_within_dir(&to_path, &from_path) {
        return Err("Cannot move a folder into itself".to_string());
    }
    if let Some(name) = to_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }

    match fs::rename(&from_path, &to_path) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device_error(&e) => {
            copy_path_inner(&from_path, &to_path)?;
            remove_all_hardened(&from_path)?;
            Ok(())
        }
        Err(e) => Err(format!("Failed to move: {}", e)),
    }
}

/// Join a parent directory and a child name using the OS separator.
/// Validates the child name and avoids any frontend separator guessing.
#[tauri::command]
pub fn join_path(parent: String, name: String) -> Result<String, String> {
    validate_file_name(&name)?;
    Ok(PathBuf::from(&parent)
        .join(&name)
        .to_string_lossy()
        .to_string())
}

/// Validate a single file/folder name for the running OS.
/// Returns `Ok(())` when valid, `Err(message)` describing the problem.
#[tauri::command]
pub fn validate_name(name: String) -> Result<(), String> {
    validate_file_name(&name)
}

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn validate_file_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if name.contains('\0') || name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain `/`, `\\` or null characters".to_string());
    }
    if name.len() > 255 {
        return Err("Name is too long (max 255 characters)".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if name
            .chars()
            .any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || (c as u32) < 0x20)
        {
            return Err(
                "Name cannot contain any of the following characters: < > : \" / \\ | ? *"
                    .to_string(),
            );
        }
        if name.ends_with(' ') || name.ends_with('.') {
            return Err("Name cannot end with a space or a dot".to_string());
        }
        let stem = name.split('.').next().unwrap_or(name).to_uppercase();
        if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
            return Err(format!("\"{}\" is a reserved name on Windows", stem));
        }
    }

    Ok(())
}

/// Recursively search for files matching a glob-like pattern.
/// Supports: `*` (any chars except `/`), `**` (any path segments), `?` (single char).
#[tauri::command]
pub fn find_files(
    base_path: String,
    pattern: String,
    max_results: Option<usize>,
    show_hidden: Option<bool>,
) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&base_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", base_path));
    }

    let limit = max_results.unwrap_or(50).min(200);
    let show_hidden = show_hidden.unwrap_or(false);
    let mut results = Vec::new();

    // Convert glob pattern to regex
    let regex_pattern = glob_to_regex(&pattern);
    let re = regex::Regex::new(&regex_pattern)
        .map_err(|e| format!("Invalid pattern \"{}\": {}", pattern, e))?;

    fn walk_find(
        dir: &PathBuf,
        root: &PathBuf,
        re: &regex::Regex,
        results: &mut Vec<String>,
        limit: usize,
        show_hidden: bool,
    ) -> std::io::Result<()> {
        if results.len() >= limit {
            return Ok(());
        }
        let entries = fs::read_dir(dir)?;
        for entry in entries {
            if results.len() >= limit {
                break;
            }
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();

            if (!show_hidden && name.starts_with('.')) || IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }

            let path = entry.path();
            let ft = entry.file_type()?;

            // Get path relative to root for matching
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            if ft.is_dir() {
                walk_find(&path, root, re, results, limit, show_hidden)?;
            } else if ft.is_file() {
                // Match against relative path and also just the filename
                if re.is_match(&rel) || re.is_match(&name) {
                    results.push(path.to_string_lossy().to_string());
                }
            }
        }
        Ok(())
    }

    walk_find(&root, &root, &re, &mut results, limit, show_hidden)
        .map_err(|e| format!("Find error: {}", e))?;

    results.sort();
    Ok(results)
}

/// Convert a simple glob pattern to a regex string.
fn glob_to_regex(pattern: &str) -> String {
    let mut regex = String::from("(?i)"); // case-insensitive
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '*' => {
                if i + 1 < chars.len() && chars[i + 1] == '*' {
                    // ** matches any path segments
                    if i + 2 < chars.len() && chars[i + 2] == '/' {
                        regex.push_str("(.*/)?");
                        i += 3;
                    } else {
                        regex.push_str(".*");
                        i += 2;
                    }
                } else {
                    // * matches anything except /
                    regex.push_str("[^/]*");
                    i += 1;
                }
            }
            '?' => {
                regex.push_str("[^/]");
                i += 1;
            }
            '.' | '(' | ')' | '+' | '|' | '^' | '$' | '{' | '}' | '[' | ']' => {
                regex.push('\\');
                regex.push(chars[i]);
                i += 1;
            }
            _ => {
                regex.push(chars[i]);
                i += 1;
            }
        }
    }

    format!("^{}$", regex)
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    let dir_path = PathBuf::from(&path);
    if dir_path.exists() {
        return Err(format!("Directory already exists: {}", path));
    }
    if let Some(name) = dir_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }
    fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

/// Like list_dir but includes hidden entries (files/dirs starting with '.')
/// Used by the skills loader to scan ~/.agents/skills/ etc.
#[tauri::command]
pub fn list_dir_all(path: String) -> Result<Vec<FileEntry>, String> {
    let path = PathBuf::from(&path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

// ── File System Watcher ──────────────────────────────────────────────────────

pub struct FsWatcherState(pub Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
pub struct FsChangeEvent {
    pub kind: String, // "create" | "modify" | "remove" | "rename"
    pub paths: Vec<String>,
}

fn event_kind_to_string(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(_) => Some("modify"),
        EventKind::Remove(_) => Some("remove"),
        _ => None,
    }
}

#[tauri::command]
pub fn fs_watch(
    path: String,
    app: AppHandle,
    state: tauri::State<'_, FsWatcherState>,
) -> Result<(), String> {
    let mut watchers = state.0.lock().map_err(|e| e.to_string())?;

    // If already watching this path, do nothing
    if watchers.contains_key(&path) {
        return Ok(());
    }

    let watch_path = PathBuf::from(&path);
    if !watch_path.exists() {
        return Err(format!("Path not found: {}", path));
    }

    let app_handle = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if let Some(kind_str) = event_kind_to_string(&event.kind) {
                    let paths: Vec<String> = event
                        .paths
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    let _ = app_handle.emit(
                        "fs:changed",
                        FsChangeEvent {
                            kind: kind_str.to_string(),
                            paths,
                        },
                    );
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    watchers.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub fn fs_unwatch(path: String, state: tauri::State<'_, FsWatcherState>) -> Result<(), String> {
    let mut watchers = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut watcher) = watchers.remove(&path) {
        let watch_path = PathBuf::from(&path);
        let _ = watcher.unwatch(&watch_path);
    }
    Ok(())
}

#[tauri::command]
pub fn copy_path(from: String, to: String) -> Result<(), String> {
    let from_path = PathBuf::from(&from);
    let to_path = PathBuf::from(&to);
    if !from_path.exists() && fs::symlink_metadata(&from_path).is_err() {
        return Err(format!("Source not found: {}", from));
    }
    if to_path.exists() || fs::symlink_metadata(&to_path).is_ok() {
        return Err(format!("Destination already exists: {}", to));
    }
    if let Some(name) = to_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }
    copy_path_inner(&from_path, &to_path)
}

fn copy_path_inner(from_path: &PathBuf, to_path: &PathBuf) -> Result<(), String> {
    let meta = fs::symlink_metadata(from_path)
        .map_err(|e| format!("Failed to read metadata of {}: {}", from_path.display(), e))?;
    if meta.file_type().is_symlink() {
        return copy_symlink(from_path, to_path);
    }
    if meta.is_dir() {
        if is_within_dir(to_path, from_path) {
            return Err("Cannot copy a folder into itself".to_string());
        }
        copy_dir_recursive(from_path, to_path)
    } else {
        if let Some(parent) = to_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        fs::copy(from_path, to_path)
            .map(|_| ())
            .map_err(|e| format!("Failed to copy file: {}", e))?;
        copy_permissions(from_path, to_path);
        Ok(())
    }
}

/// Replicate a symlink instead of following it (prevents infinite loops on
/// cyclic links and preserves link semantics on every platform).
fn copy_symlink(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    let target =
        fs::read_link(src).map_err(|e| format!("Failed to read link {}: {}", src.display(), e))?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        // Decide the symlink kind from the link target when possible.
        let is_dir = src.is_dir();
        if is_dir {
            std::os::windows::fs::symlink_dir(&target, dst)
        } else {
            std::os::windows::fs::symlink_file(&target, dst)
        }
        .map_err(|e| format!("Failed to copy symlink: {}", e))
    }
    #[cfg(target_os = "macos")]
    {
        std::os::unix::fs::symlink(&target, dst)
            .map_err(|e| format!("Failed to copy symlink: {}", e))
    }
    #[cfg(target_os = "linux")]
    {
        std::os::unix::fs::symlink(&target, dst)
            .map_err(|e| format!("Failed to copy symlink: {}", e))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Copying symlinks is not supported on this platform".to_string())
    }
}

/// Best-effort permission preservation (Unix mode bits; no-op elsewhere).
fn copy_permissions(src: &Path, dst: &Path) {
    if let (Ok(src_meta), Ok(dst_meta)) = (fs::metadata(src), fs::metadata(dst)) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = src_meta.permissions().mode();
            let _ = fs::set_permissions(dst, fs::Permissions::from_mode(mode));
        }
        #[cfg(not(unix))]
        {
            let _ = (src_meta, dst_meta);
        }
    }
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    // Fail instead of silently merging when the destination already exists;
    // callers auto-rename to a unique name before invoking.
    if dst.exists() || fs::symlink_metadata(dst).is_ok() {
        return Err(format!("Destination already exists: {}", dst.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir: {}", e))?;
    let entries = fs::read_dir(src).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read entry type: {}", e))?;
        if file_type.is_symlink() {
            copy_symlink(&src_path, &dst_path)?;
        } else if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy: {}", e))?;
            copy_permissions(&src_path, &dst_path);
        }
    }
    copy_permissions(src, dst);
    Ok(())
}

/// Open the OS file manager and highlight/select the given path.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path not found: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        cmd("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        cmd("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open on the parent directory
        let target = if p.is_dir() {
            p
        } else {
            p.parent().unwrap_or(&p).to_path_buf()
        };
        cmd("xdg-open")
            .arg(target.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    Ok(())
}

/// Open a file or folder with the OS default application
/// ("Open With > Default Application" in the explorer).
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() && fs::symlink_metadata(&p).is_err() {
        return Err(format!("Path not found: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        // `start` takes the window title as its first quoted argument.
        cmd("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        cmd("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        cmd("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_blank_names() {
        assert!(validate_file_name("").is_err());
        assert!(validate_file_name("   ").is_err());
        assert!(validate_file_name("ok.txt").is_ok());
    }

    #[test]
    fn rejects_separators_and_null_bytes() {
        assert!(validate_file_name("a/b").is_err());
        assert!(validate_file_name("a\\b").is_err());
        assert!(validate_file_name("a\0b").is_err());
        assert!(validate_file_name("plain-name_1.2").is_ok());
    }

    #[test]
    fn rejects_overlong_names() {
        let long = "a".repeat(256);
        assert!(validate_file_name(&long).is_err());
        assert!(validate_file_name(&"a".repeat(255)).is_ok());
    }

    #[test]
    fn detects_move_into_self() {
        assert!(is_within_dir(
            &PathBuf::from("/a/b/c"),
            &PathBuf::from("/a/b")
        ));
        assert!(is_within_dir(
            &PathBuf::from("/a/b"),
            &PathBuf::from("/a/b")
        ));
        assert!(!is_within_dir(
            &PathBuf::from("/a/b2"),
            &PathBuf::from("/a/b")
        ));
        assert!(!is_within_dir(
            &PathBuf::from("/a/b"),
            &PathBuf::from("/a/b/c")
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detects_move_into_self_case_insensitive_on_windows() {
        assert!(is_within_dir(
            &PathBuf::from("C:\\A\\b"),
            &PathBuf::from("c:/a")
        ));
        assert!(!is_within_dir(
            &PathBuf::from("C:\\AB"),
            &PathBuf::from("C:\\A")
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_windows_reserved_and_illegal_names() {
        for reserved in ["CON", "con.txt", "NUL", "COM1", "lpt9.dat"] {
            assert!(validate_file_name(reserved).is_err(), "{}", reserved);
        }
        for illegal in [
            "a<b", "a>b", "a:b", "a\"b", "a|b", "a?b", "a*b", "trail. ", "trail.",
        ] {
            assert!(validate_file_name(illegal).is_err(), "{}", illegal);
        }
        assert!(validate_file_name("normal file (1).txt").is_ok());
    }

    #[test]
    fn open_and_trash_reject_missing_paths_without_side_effects() {
        assert!(open_path("/nonexistent-hyscode-path-xyz".to_string()).is_err());
        assert!(tauri::async_runtime::block_on(trash_path(
            "/nonexistent-hyscode-path-xyz".to_string(),
        ))
        .is_err());
    }

    #[test]
    fn delete_path_removes_nested_directory_on_blocking_pool() {
        let base =
            std::env::temp_dir().join(format!("hyscode-fs-test-{}-delete", std::process::id()));
        let target = base.join("large-tree");
        let nested = target.join("nested");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&nested).unwrap();
        for index in 0..128 {
            fs::write(nested.join(format!("file-{index}.txt")), b"data").unwrap();
        }

        let result =
            tauri::async_runtime::block_on(delete_path(target.to_string_lossy().to_string()));

        assert!(result.is_ok());
        assert!(!target.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn move_and_copy_refuse_existing_destination() {
        let base = std::env::temp_dir().join(format!("hyscode-fs-test-{}-move", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("src")).unwrap();
        fs::write(base.join("src").join("a.txt"), b"hi").unwrap();
        fs::write(base.join("dest.txt"), b"taken").unwrap();

        assert!(move_path(
            base.join("src").join("a.txt").to_string_lossy().to_string(),
            base.join("dest.txt").to_string_lossy().to_string(),
        )
        .is_err());
        assert!(copy_path(
            base.join("src").join("a.txt").to_string_lossy().to_string(),
            base.join("dest.txt").to_string_lossy().to_string(),
        )
        .is_err());

        // Move into itself is refused.
        assert!(move_path(
            base.join("src").to_string_lossy().to_string(),
            base.join("src").join("inner").to_string_lossy().to_string(),
        )
        .is_err());

        // A real move works and the source is gone afterwards.
        assert!(move_path(
            base.join("src").join("a.txt").to_string_lossy().to_string(),
            base.join("src").join("b.txt").to_string_lossy().to_string(),
        )
        .is_ok());
        assert!(!base.join("src").join("a.txt").exists());
        assert!(base.join("src").join("b.txt").exists());

        // join_path produces a usable child path.
        let joined = join_path(
            base.join("src").to_string_lossy().to_string(),
            "c.txt".to_string(),
        )
        .unwrap();
        assert_eq!(
            joined,
            base.join("src").join("c.txt").to_string_lossy().to_string()
        );

        let _ = fs::remove_dir_all(&base);
    }
    #[test]
    fn read_file_chunk_returns_head_and_tail() {
        let base = std::env::temp_dir().join(format!("hyscode-fs-test-{}-chunk", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let file = base.join("big.txt");
        let expected = "line\n".repeat(100_000);
        fs::write(&file, expected.as_bytes()).unwrap();
        let path = file.to_string_lossy().to_string();

        let head = read_file_chunk(path.clone(), 0, READ_CHUNK_LEN).unwrap();
        assert!(!head.is_binary);
        assert_eq!(head.total_size, expected.len() as u64);
        assert!(!head.finished);
        assert_eq!(head.data.len(), READ_CHUNK_LEN as usize);

        let tail = read_file_chunk(path.clone(), READ_CHUNK_LEN, READ_CHUNK_LEN).unwrap();
        assert!(!tail.is_binary);
        assert!(tail.finished);

        let mut reassembled = head.data;
        reassembled.push_str(&tail.data);
        assert_eq!(reassembled, expected);
        assert_eq!(read_file(path).unwrap(), expected);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn read_file_chunk_flags_null_bytes_binary() {
        let base = std::env::temp_dir().join(format!("hyscode-fs-test-{}-binary", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let file = base.join("blob.bin");
        fs::write(&file, [0x00, 0xFF, b'a']).unwrap();

        let chunk =
            read_file_chunk(file.to_string_lossy().to_string(), 0, READ_CHUNK_LEN).unwrap();
        assert!(chunk.is_binary);
        assert!(chunk.data.is_empty());
        assert!(chunk.finished);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn read_file_chunk_offset_past_end_returns_finished_empty() {
        let base = std::env::temp_dir().join(format!("hyscode-fs-test-{}-past-end", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let file = base.join("small.txt");
        fs::write(&file, b"hi").unwrap();
        let path = file.to_string_lossy().to_string();

        let chunk = read_file_chunk(path, 1024, READ_CHUNK_LEN).unwrap();
        assert!(chunk.data.is_empty());
        assert!(!chunk.is_binary);
        assert!(chunk.finished);

        assert!(read_file_chunk("/nonexistent-hyscode-path-xyz".to_string(), 0, 128).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
