use super::utils::cmd;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

/// Cache of user PATH directories read from the Windows registry.
/// Tauri GUI apps only inherit the system PATH; this supplements it with
/// entries the user added via shell profiles or the Control Panel.
#[cfg(target_os = "windows")]
static WINDOWS_USER_PATH_DIRS: OnceLock<Vec<std::path::PathBuf>> = OnceLock::new();

/// Return (and lazily initialise) the list of directories from the current
/// user's PATH as stored in `HKCU\Environment`.  Called at most once per
/// process lifetime.
#[cfg(target_os = "windows")]
fn windows_user_path_dirs() -> &'static Vec<std::path::PathBuf> {
    WINDOWS_USER_PATH_DIRS.get_or_init(|| {
        use std::collections::HashSet;
        use std::path::PathBuf;

        let Ok(output) = cmd("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Environment]::GetEnvironmentVariable('Path','User')",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        else {
            return Vec::new();
        };

        if !output.status.success() {
            return Vec::new();
        }

        let text = String::from_utf8_lossy(&output.stdout);
        let mut seen = HashSet::new();
        let mut dirs = Vec::new();
        for part in text.trim().split(';') {
            let part = part.trim().trim_matches('"');
            if part.is_empty() {
                continue;
            }
            let key = part.to_lowercase();
            if seen.insert(key) {
                dirs.push(PathBuf::from(part));
            }
        }
        dirs
    })
}

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
    // Windows refuses to launch binaries whose final path component is a
    // reparse point when the host process enforces RedirectionGuard
    // (ERROR_UNTRUSTED_MOUNT_POINT, os error 448). Resolve symlinks and rustup
    // proxies to a real binary before spawning.
    let resolved = resolve_spawnable_command(&command, &resolved, &resolved_root);
    println!("[lsp_start] resolved={resolved}");

    let mut child = match spawn_lsp_process(&resolved, &args, &resolved_root) {
        Ok(child) => child,
        Err(error) if error.raw_os_error() == Some(ERROR_UNTRUSTED_MOUNT_POINT) => {
            // Re-resolve once in case the first pass missed a reparse point,
            // then report an actionable error if it still fails.
            let retry_path = resolve_spawnable_command(&command, &resolved, &resolved_root);
            if retry_path != resolved {
                spawn_lsp_process(&retry_path, &args, &resolved_root)
                    .map_err(|retry_error| untrusted_mount_error(&command, &retry_error))?
            } else {
                return Err(untrusted_mount_error(&command, &error));
            }
        }
        Err(error) => {
            return Err(format!(
                "Failed to spawn LSP process '{}': {}",
                command, error
            ))
        }
    };

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
    let mut processes = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    processes.insert(server_id.clone(), LspProcess { child, stdin });

    Ok(LspStartResult {
        server_id,
        root_path: resolved_root,
    })
}

/// Windows `ERROR_UNTRUSTED_MOUNT_POINT` (`STATUS_UNTRUSTED_MOUNT_POINT`).
/// Raised by `CreateProcess` when the host process enforces RedirectionGuard and
/// the executable path ends in a reparse point created by a non-admin process.
const ERROR_UNTRUSTED_MOUNT_POINT: i32 = 448;

/// Build and spawn the LSP process. On Windows `.cmd`/`.bat` wrappers are
/// executed via `cmd.exe /C` because `std::process::Command` cannot spawn them
/// directly. PATH is extended with the rustup toolchain bin directory and the
/// user PATH from the registry.
fn spawn_lsp_process(resolved: &str, args: &[String], root: &str) -> std::io::Result<Child> {
    #[cfg(target_os = "windows")]
    let (program, extra_args): (&str, Vec<String>) =
        if resolved.to_ascii_lowercase().ends_with(".cmd")
            || resolved.to_ascii_lowercase().ends_with(".bat")
        {
            ("cmd", vec!["/C".to_string(), resolved.to_string()])
        } else {
            (resolved, Vec::new())
        };

    #[cfg(not(target_os = "windows"))]
    let (program, extra_args): (&str, Vec<String>) = (resolved, Vec::new());

    let mut child_cmd = cmd(program);
    child_cmd
        .args(&extra_args)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_child_path(&mut child_cmd, resolved);

    child_cmd.spawn()
}

/// Extend the child PATH with the rustup toolchain bin directory (so nested
/// `cargo`/`rustc` calls bypass the `.cargo/bin` proxy symlinks) and the user
/// PATH read from the Windows registry (GUI apps launched from the taskbar only
/// inherit the system PATH).
fn apply_child_path(child_cmd: &mut Command, resolved: &str) {
    #[cfg(target_os = "windows")]
    {
        let mut prefix: Vec<String> = Vec::new();
        if let Some(bin_dir) = rustup_toolchain_bin_dir(resolved) {
            prefix.push(bin_dir);
        }
        prefix.extend(
            windows_user_path_dirs()
                .iter()
                .map(|p| p.to_string_lossy().to_string()),
        );
        if prefix.is_empty() {
            return;
        }
        let current_path = std::env::var("PATH").unwrap_or_default();
        let merged = if current_path.is_empty() {
            prefix.join(";")
        } else {
            format!("{};{}", prefix.join(";"), current_path)
        };
        child_cmd.env("PATH", merged);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (child_cmd, resolved);
    }
}

/// Return the `bin` directory of a rustup toolchain when `resolved` points inside
/// `.../.rustup/toolchains/<toolchain>/bin/...`.
#[cfg(target_os = "windows")]
fn rustup_toolchain_bin_dir(resolved: &str) -> Option<String> {
    let bin_dir = std::path::Path::new(resolved).parent()?;
    if !bin_dir
        .file_name()
        .map(|name| name.eq_ignore_ascii_case("bin"))
        .unwrap_or(false)
    {
        return None;
    }
    let toolchain_dir = bin_dir.parent()?;
    let toolchains_dir = toolchain_dir.parent()?;
    if !toolchains_dir
        .file_name()
        .map(|name| name.eq_ignore_ascii_case("toolchains"))
        .unwrap_or(false)
    {
        return None;
    }
    Some(bin_dir.to_string_lossy().to_string())
}

/// Resolve a Windows reparse point (file symlink / shim) to a path that
/// `CreateProcess` can traverse. rustup proxies (`rust-analyzer.exe ->
/// rustup.exe`) are resolved through `rustup which` because canonicalizing them
/// would yield `rustup.exe` and lose the argv0-based proxy identity. Other
/// symlinks are canonicalized to their final target.
fn resolve_spawnable_command(command: &str, resolved: &str, root: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

        let path = std::path::Path::new(resolved);
        let is_reparse = std::fs::symlink_metadata(path)
            .map(|meta| meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
            .unwrap_or(false);
        if !is_reparse {
            return resolved.to_string();
        }

        if is_rustup_proxy(path) {
            if let Some(real_binary) = rustup_which(path, command, root) {
                return real_binary;
            }
            // Do not canonicalize a proxy: that resolves to rustup.exe and the
            // proxy would no longer know which tool it must run.
            return resolved.to_string();
        }

        if let Ok(canonical) = std::fs::canonicalize(path) {
            let text = canonical.to_string_lossy();
            return if let Some(stripped) = text.strip_prefix(r"\\?\") {
                stripped.to_string()
            } else {
                text.to_string()
            };
        }
        resolved.to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (command, root);
        resolved.to_string()
    }
}

#[cfg(target_os = "windows")]
fn is_rustup_proxy(path: &std::path::Path) -> bool {
    std::fs::read_link(path)
        .ok()
        .and_then(|target| {
            target
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .map(|name| {
            name.eq_ignore_ascii_case("rustup.exe") || name.eq_ignore_ascii_case("rustup-init.exe")
        })
        .unwrap_or(false)
}

/// Ask rustup for the real binary behind a proxy. Runs with `root` as the
/// working directory so `rust-toolchain.toml` overrides are honored.
#[cfg(target_os = "windows")]
fn rustup_which(proxy_path: &std::path::Path, command: &str, root: &str) -> Option<String> {
    let adjacent = proxy_path.parent()?.join("rustup.exe");
    let rustup = if adjacent.is_file() {
        adjacent
    } else {
        let output = cmd("where").arg("rustup.exe").output().ok()?;
        if !output.status.success() {
            return None;
        }
        let first = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|line| line.trim())
            .find(|line| !line.is_empty())?
            .to_string();
        std::path::PathBuf::from(first)
    };
    if !rustup.is_file() {
        return None;
    }

    let mut rustup_cmd = cmd(&rustup);
    rustup_cmd.args(["which", command]);
    if std::path::Path::new(root).is_dir() {
        rustup_cmd.current_dir(root);
    }
    let output = rustup_cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let real_binary = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if real_binary.is_empty() || !std::path::Path::new(&real_binary).is_file() {
        return None;
    }
    Some(real_binary)
}

fn untrusted_mount_error(command: &str, error: &std::io::Error) -> String {
    format!(
        "Failed to spawn LSP process '{}': {}. Windows blocked a symlink or junction in the \
         binary path (RedirectionGuard/untrusted mount point). Point the server to a real \
         binary path or set a custom path in Settings > Language Servers.",
        command, error
    )
}

#[tauri::command]
pub async fn lsp_send(id: String, content: String, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<LspState>();
    let mut processes = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    let process = processes
        .get_mut(&id)
        .ok_or(format!("LSP process '{}' not found", id))?;

    let stdin = process.stdin.as_mut().ok_or("LSP stdin not available")?;

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
    let mut processes = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(mut process) = processes.remove(&id) {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }

    Ok(())
}

#[tauri::command]
pub async fn lsp_list_active(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<LspState>();
    let processes = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    Ok(processes.keys().cloned().collect())
}

/// Returns true if `command` looks like an explicit path (absolute or contains
/// path separators) rather than a bare binary name.
fn is_explicit_path(command: &str) -> bool {
    std::path::Path::new(command).is_absolute() || command.contains('/') || command.contains('\\')
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
            push_dir_candidates(
                &mut v,
                base.join("nvim-data").join("mason").join("bin"),
                command,
            );
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
        push_dir_candidates(
            &mut v,
            PathBuf::from(r"C:\ProgramData\chocolatey\bin"),
            command,
        );
        // GOPATH (may be a semicolon-separated list)
        if let Ok(gopath) = std::env::var("GOPATH") {
            for p in std::env::split_paths(&gopath) {
                push_dir_candidates(&mut v, p.join("bin"), command);
            }
        }
        // LLVM suite (clangd, clang-format, etc.)
        push_dir_candidates(&mut v, PathBuf::from(r"C:\Program Files\LLVM\bin"), command);
        push_dir_candidates(
            &mut v,
            PathBuf::from(r"C:\Program Files (x86)\LLVM\bin"),
            command,
        );
        // Flutter / Dart SDK – common install locations
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(&profile);
            push_dir_candidates(&mut v, p.join("flutter").join("bin"), command);
            push_dir_candidates(&mut v, p.join("fvm").join("default").join("bin"), command);
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(&local);
            push_dir_candidates(&mut v, base.join("flutter").join("bin"), command);
            // Windows App Execution Aliases (e.g. ruby-lsp, gem-installed tools)
            push_dir_candidates(&mut v, base.join("Microsoft").join("WindowsApps"), command);
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
            h.join(".config")
                .join("yarn")
                .join("global")
                .join("node_modules")
                .join(".bin"),
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
            h.join(".local")
                .join("share")
                .join("nvim")
                .join("mason")
                .join("bin"),
            command,
        );
        // SDKMAN (jdtls / Java tooling)
        push_dir_candidates(
            &mut v,
            h.join(".sdkman")
                .join("candidates")
                .join("jdtls")
                .join("current")
                .join("bin"),
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

    // 3. Scan user PATH from the Windows registry.
    //    GUI apps launched from the taskbar or a shortcut only inherit the
    //    system PATH, missing entries the user added via Control Panel or a
    //    shell profile.  The cached registry read is done at most once.
    #[cfg(target_os = "windows")]
    {
        for dir in windows_user_path_dirs() {
            let mut candidates = Vec::new();
            push_dir_candidates(&mut candidates, dir.clone(), &command);
            for p in candidates {
                if p.is_file() {
                    return Ok(true);
                }
            }
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
                    .or_else(|| {
                        lines
                            .iter()
                            .find(|p| p.to_ascii_lowercase().ends_with(".cmd"))
                    })
                    .or_else(|| {
                        lines
                            .iter()
                            .find(|p| p.to_ascii_lowercase().ends_with(".bat"))
                    })
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

    // Also scan user PATH from the Windows registry (same logic as lsp_probe_server)
    #[cfg(target_os = "windows")]
    {
        for dir in windows_user_path_dirs() {
            let mut candidates = Vec::new();
            push_dir_candidates(&mut candidates, dir.clone(), command);
            // Prefer .exe, then .cmd, then .bat
            let found = candidates
                .iter()
                .find(|p| {
                    p.is_file()
                        && p.extension()
                            .map_or(false, |e| e.eq_ignore_ascii_case("exe"))
                })
                .or_else(|| {
                    candidates.iter().find(|p| {
                        p.is_file()
                            && p.extension()
                                .map_or(false, |e| e.eq_ignore_ascii_case("cmd"))
                    })
                })
                .or_else(|| {
                    candidates.iter().find(|p| {
                        p.is_file()
                            && p.extension()
                                .map_or(false, |e| e.eq_ignore_ascii_case("bat"))
                    })
                })
                .or_else(|| candidates.iter().find(|p| p.is_file()));
            if let Some(p) = found {
                return p.to_string_lossy().to_string();
            }
        }
    }

    // Last resort: return command as-is and let the OS try
    command.to_string()
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn rustup_toolchain_bin_dir_detects_toolchain_binary() {
        let path =
            r"C:\Users\dev\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\rust-analyzer.exe";
        assert_eq!(
            super::rustup_toolchain_bin_dir(path).as_deref(),
            Some(r"C:\Users\dev\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rustup_toolchain_bin_dir_ignores_non_toolchain_paths() {
        assert_eq!(
            super::rustup_toolchain_bin_dir(r"C:\tools\bin\rust-analyzer.exe"),
            None
        );
        assert_eq!(
            super::rustup_toolchain_bin_dir(r"C:\Users\dev\.cargo\bin\rustup.exe"),
            None
        );
    }

    #[test]
    fn resolve_spawnable_command_keeps_real_files() {
        let current = std::env::current_exe().expect("current_exe");
        let path = current.to_string_lossy().to_string();
        assert_eq!(super::resolve_spawnable_command("probe", &path, "."), path);
    }
}
