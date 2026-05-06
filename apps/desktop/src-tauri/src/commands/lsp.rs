use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Stdio};
use std::sync::Mutex;
use serde::Serialize;
use tauri::{Emitter, Manager};
use super::utils::cmd;

#[derive(Serialize)]
pub struct LspStartResult {
    pub server_id: String,
    pub root_path: String,
}

pub struct LspProcess {
    pub child: Child,
    pub stdin: Option<std::process::ChildStdin>,
}

pub struct LspState(pub Mutex<HashMap<String, LspProcess>>);

#[tauri::command]
pub async fn lsp_start(
    id: String,
    command: String,
    args: Vec<String>,
    root_path: String,
    file_path: Option<String>,
    app: tauri::AppHandle,
) -> Result<LspStartResult, String> {
    let resolved_root = resolve_lsp_root(&root_path, file_path.as_deref(), &command);
    println!("[lsp_start] id={id} command={command} args={args:?} root_path={root_path} resolved_root={resolved_root}");
    // Resolve the full path to the command if it's not directly on PATH.
    let resolved = resolve_lsp_command(&command);
    println!("[lsp_start] resolved={resolved}");

    // On Windows, .cmd/.bat wrappers must be executed via cmd.exe /C
    // because std::process::Command cannot spawn them directly.
    #[cfg(target_os = "windows")]
    let (program, extra_args): (&str, Vec<String>) =
        if resolved.to_ascii_lowercase().ends_with(".cmd")
            || resolved.to_ascii_lowercase().ends_with(".bat")
        {
            ("cmd", vec!["/C".to_string(), resolved.clone()])
        } else {
            (&resolved, vec![])
        };

    #[cfg(not(target_os = "windows"))]
    let (program, extra_args): (&str, Vec<String>) = (&resolved, vec![]);

    let mut child = cmd(program)
        .args(&extra_args)
        .args(&args)
        .current_dir(&resolved_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn LSP process '{}': {}", command, e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture stdout from LSP process")?;

    let stdin = child.stdin.take();

    let server_id = id.clone();

    // Spawn a thread to read LSP stdout and emit events
    let app_handle = app.clone();
    let reader_id = id.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut headers = String::new();

        loop {
            headers.clear();

            // Read headers until empty line
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => return, // EOF
                    Err(_) => return,
                    Ok(_) => {}
                }

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break;
                }

                if let Some(len_str) = trimmed.strip_prefix("Content-Length: ") {
                    if let Ok(len) = len_str.parse::<usize>() {
                        content_length = len;
                    }
                }
            }

            if content_length == 0 {
                continue;
            }

            // Read body
            let mut body = vec![0u8; content_length];
            match std::io::Read::read_exact(&mut reader, &mut body) {
                Ok(_) => {}
                Err(_) => return,
            }

            let body_str = match String::from_utf8(body) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let event_name = format!("lsp:message:{}", reader_id);
            let _ = app_handle.emit(&event_name, body_str);
        }
    });

    // Store the process
    let state = app.state::<LspState>();
    let mut processes = state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    processes.insert(
        server_id.clone(),
        LspProcess {
            child,
            stdin,
        },
    );

    Ok(LspStartResult {
        server_id,
        root_path: resolved_root,
    })
}

#[tauri::command]
pub async fn lsp_send(id: String, content: String, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<LspState>();
    let mut processes = state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let process = processes
        .get_mut(&id)
        .ok_or(format!("LSP process '{}' not found", id))?;

    let stdin = process
        .stdin
        .as_mut()
        .ok_or("LSP stdin not available")?;

    let header = format!("Content-Length: {}\r\n\r\n", content.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| format!("Failed to write header: {}", e))?;
    stdin
        .write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write content: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn lsp_stop(id: String, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<LspState>();
    let mut processes = state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(mut process) = processes.remove(&id) {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }

    Ok(())
}

#[tauri::command]
pub async fn lsp_list_active(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<LspState>();
    let processes = state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(processes.keys().cloned().collect())
}

/// Returns true if `command` looks like an explicit path (absolute or contains
/// path separators) rather than a bare binary name.
fn is_explicit_path(command: &str) -> bool {
    std::path::Path::new(command).is_absolute()
        || command.contains('/')
        || command.contains('\\')
}

/// Push candidate paths for a directory into `v`.
/// On Windows this adds `.exe`, `.cmd`, `.bat`, and plain variants (in that order).
/// On Unix this adds only the plain name.
fn push_dir_candidates(v: &mut Vec<std::path::PathBuf>, dir: std::path::PathBuf, command: &str) {
    #[cfg(target_os = "windows")]
    {
        v.push(dir.join(format!("{}.exe", command)));
        v.push(dir.join(format!("{}.cmd", command)));
        v.push(dir.join(format!("{}.bat", command)));
        v.push(dir.join(command));
    }
    #[cfg(not(target_os = "windows"))]
    {
        v.push(dir.join(command));
    }
}

/// Build an ordered list of fallback candidate paths for a bare command name,
/// covering all common package-manager global bin directories on the current OS.
/// Callers should check `is_file()` (not just `exists()`) on each entry.
fn lsp_candidate_paths(command: &str) -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut v: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // npm global (%APPDATA%\npm)
        if let Ok(appdata) = std::env::var("APPDATA") {
            let base = PathBuf::from(&appdata);
            push_dir_candidates(&mut v, base.join("npm"), command);
            // Yarn global (alternate location)
            push_dir_candidates(&mut v, base.join("Yarn").join("bin"), command);
            // pip --user: %APPDATA%\Python\Python*\Scripts (newest version first)
            let python_base = base.join("Python");
            if let Ok(entries) = std::fs::read_dir(&python_base) {
                let mut python_dirs: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .map(|e| e.path())
                    .collect();
                python_dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
                for dir in python_dirs {
                    push_dir_candidates(&mut v, dir.join("Scripts"), command);
                }
            }
        }
        // pnpm / Yarn / nvim-mason (%LOCALAPPDATA%)
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(&local);
            push_dir_candidates(&mut v, base.join("pnpm"), command);
            push_dir_candidates(&mut v, base.join("Yarn").join("bin"), command);
            push_dir_candidates(&mut v, base.join("nvim-data").join("mason").join("bin"), command);
        }
        // USERPROFILE-based managers
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(&profile);
            push_dir_candidates(&mut v, p.join(".cargo").join("bin"), command);
            push_dir_candidates(&mut v, p.join("go").join("bin"), command);
            push_dir_candidates(&mut v, p.join(".dotnet").join("tools"), command);
            push_dir_candidates(&mut v, p.join("scoop").join("shims"), command);
            push_dir_candidates(&mut v, p.join(".volta").join("bin"), command);
            push_dir_candidates(&mut v, p.join(".local").join("bin"), command);
        }
        // Chocolatey system-wide
        push_dir_candidates(&mut v, PathBuf::from(r"C:\ProgramData\chocolatey\bin"), command);
        // GOPATH (may be a semicolon-separated list)
        if let Ok(gopath) = std::env::var("GOPATH") {
            for p in std::env::split_paths(&gopath) {
                push_dir_candidates(&mut v, p.join("bin"), command);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let h = std::path::PathBuf::from(&home);

        // Cargo (rust-analyzer, etc.)
        push_dir_candidates(&mut v, h.join(".cargo").join("bin"), command);
        // Go (gopls, etc.)
        push_dir_candidates(&mut v, h.join("go").join("bin"), command);
        if let Ok(gopath) = std::env::var("GOPATH") {
            for p in std::env::split_paths(&gopath) {
                v.push(p.join("bin").join(command));
            }
        }
        // pip --user / pipx
        push_dir_candidates(&mut v, h.join(".local").join("bin"), command);
        // dotnet tools (csharp-ls)
        push_dir_candidates(&mut v, h.join(".dotnet").join("tools"), command);
        // Yarn classic
        push_dir_candidates(&mut v, h.join(".yarn").join("bin"), command);
        push_dir_candidates(
            &mut v,
            h.join(".config").join("yarn").join("global").join("node_modules").join(".bin"),
            command,
        );
        // npm global (default prefix)
        push_dir_candidates(&mut v, h.join(".npm-global").join("bin"), command);
        // pnpm global
        push_dir_candidates(&mut v, h.join(".local").join("share").join("pnpm"), command);
        // Volta
        push_dir_candidates(&mut v, h.join(".volta").join("bin"), command);
        // asdf shims
        push_dir_candidates(&mut v, h.join(".asdf").join("shims"), command);
        // rbenv shims (ruby-lsp)
        push_dir_candidates(&mut v, h.join(".rbenv").join("shims"), command);
        // nvim Mason LSP manager
        push_dir_candidates(
            &mut v,
            h.join(".local").join("share").join("nvim").join("mason").join("bin"),
            command,
        );
        // SDKMAN (jdtls / Java tooling)
        push_dir_candidates(
            &mut v,
            h.join(".sdkman").join("candidates").join("jdtls").join("current").join("bin"),
            command,
        );
        // System paths (Homebrew Apple Silicon first, then standard Unix)
        v.push(std::path::PathBuf::from("/opt/homebrew/bin").join(command));
        v.push(std::path::PathBuf::from("/usr/local/bin").join(command));
        v.push(std::path::PathBuf::from("/usr/bin").join(command));
        v.push(std::path::PathBuf::from("/snap/bin").join(command));
        // nvm: prefer NVM_BIN env var, otherwise scan versions sorted descending
        if let Ok(nvm_bin) = std::env::var("NVM_BIN") {
            v.push(std::path::PathBuf::from(nvm_bin).join(command));
        } else {
            let nvm_versions = h.join(".nvm").join("versions").join("node");
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut versions: Vec<std::path::PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .map(|e| e.path())
                    .collect();
                // Sort descending so the most recent Node version is checked first
                versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
                for vdir in versions {
                    v.push(vdir.join("bin").join(command));
                }
            }
        }
        // fnm
        push_dir_candidates(
            &mut v,
            h.join(".fnm").join("aliases").join("default").join("bin"),
            command,
        );
    }

    v
}

/// Check if a command exists on the system PATH or in common package manager
/// global bin directories. Returns true if the command is found.
#[tauri::command]
pub async fn lsp_probe_server(command: String) -> Result<bool, String> {
    // Explicit path: just test whether the file exists
    if is_explicit_path(&command) {
        return Ok(std::path::Path::new(&command).is_file());
    }

    // 1. Try PATH via `where` (Windows) / `which` (Unix)
    #[cfg(target_os = "windows")]
    let path_found = cmd("where")
        .arg(&command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    #[cfg(not(target_os = "windows"))]
    let path_found = cmd("which")
        .arg(&command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if path_found {
        return Ok(true);
    }

    // 2. Fallback: scan common package-manager / tool-manager bin directories
    for p in lsp_candidate_paths(&command) {
        if p.is_file() {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Resolve the correct workspace root for an LSP server.
/// For rust-analyzer, walks up from the opened file to find Cargo.toml.
fn resolve_lsp_root(root_path: &str, file_path: Option<&str>, command: &str) -> String {
    let is_rust = command == "rust-analyzer" || command.contains("rust-analyzer");
    if is_rust {
        // 1. Try to find Cargo.toml starting from the opened file.
        if let Some(fp) = file_path {
            let mut path = std::path::PathBuf::from(fp);
            while let Some(parent) = path.parent() {
                if parent.join("Cargo.toml").exists() {
                    return parent.to_string_lossy().to_string();
                }
                path = parent.to_path_buf();
            }
        }
        // 2. Fallback: check the provided root_path.
        let root = std::path::PathBuf::from(root_path);
        if root.join("Cargo.toml").exists() {
            return root_path.to_string();
        }
    }
    root_path.to_string()
}

/// Resolve an LSP command to its full executable path.
/// Checks PATH first; falls back to common package-manager bin directories.
fn resolve_lsp_command(command: &str) -> String {
    // Explicit paths are used as-is (no extension appending, no PATH lookup)
    if is_explicit_path(command) {
        return command.to_string();
    }

    // On Windows `where` may return multiple lines; pick the best extension.
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = cmd("where")
            .arg(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let lines: Vec<&str> = stdout
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .collect();
                // Prefer .exe, then .cmd, then .bat (ordered passes), then first result
                let preferred = lines
                    .iter()
                    .find(|p| p.to_ascii_lowercase().ends_with(".exe"))
                    .or_else(|| lines.iter().find(|p| p.to_ascii_lowercase().ends_with(".cmd")))
                    .or_else(|| lines.iter().find(|p| p.to_ascii_lowercase().ends_with(".bat")))
                    .or_else(|| lines.first());
                if let Some(path) = preferred {
                    return path.to_string();
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = cmd("which")
            .arg(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first) = stdout.lines().next() {
                    let trimmed = first.trim();
                    if !trimmed.is_empty() {
                        return trimmed.to_string();
                    }
                }
            }
        }
    }

    // Fallback: walk the same candidate list used by lsp_probe_server
    for p in lsp_candidate_paths(command) {
        if p.is_file() {
            return p.to_string_lossy().to_string();
        }
    }

    // Last resort: return command as-is and let the OS try
    command.to_string()
}
