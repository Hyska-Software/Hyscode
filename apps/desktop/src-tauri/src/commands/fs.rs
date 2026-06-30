use super::utils::cmd;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&path, content.unwrap_or_default())
        .map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("Path not found: {}", path.display()));
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    }
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

    if !from_path.exists() {
        return Err(format!("Source path not found: {}", from));
    }
    if to_path.exists() {
        return Err(format!("Destination already exists: {}", to));
    }

    fs::rename(&from_path, &to_path).map_err(|e| format!("Failed to rename: {}", e))
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
    if !from_path.exists() {
        return Err(format!("Source not found: {}", from));
    }
    if from_path.is_dir() {
        copy_dir_recursive(&from_path, &to_path)
    } else {
        if let Some(parent) = to_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        fs::copy(&from_path, &to_path)
            .map(|_| ())
            .map_err(|e| format!("Failed to copy file: {}", e))
    }
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir: {}", e))?;
    let entries = fs::read_dir(src).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy: {}", e))?;
        }
    }
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
