use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::process::Child;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State, Window};

use super::keychain::KeychainState;
use super::utils::cmd;

// ─── Codex Sidecar Commands ──────────────────────────────────────────────────
// Spawns the Bun-compiled codex-sidecar binary, sends a JSON request via
// stdin, and reads NDJSON events from stdout, emitting them as Tauri events
// (`codex:chunk`). Also exposes ChatGPT OAuth login helpers that drive the
// bundled Codex CLI (`codex login`), which caches credentials in
// `~/.codex/auth.json`.

#[derive(Debug, Deserialize)]
pub struct CodexRequest {
    pub request_id: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub prompt: String,
    pub api_key: Option<String>,
    pub cwd: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexChunk {
    pub request_id: String,
    #[serde(rename = "type")]
    pub chunk_type: String,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub call_id: Option<String>,
    pub stop_reason: Option<String>,
    pub error: Option<String>,
    pub done: bool,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CodexLoginStatus {
    pub authenticated: bool,
    pub method: Option<String>,
    pub has_api_key: bool,
}

#[derive(Debug, Serialize)]
pub struct CodexCliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Tracks live Codex sidecar processes so `codex_cancel` can kill them.
#[derive(Default)]
pub struct CodexRequestState(pub Arc<Mutex<HashMap<String, Child>>>);

/// Resolve the sidecar binary path relative to the app executable.
fn sidecar_path() -> std::path::PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    let binary_name = "codex-sidecar.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "codex-sidecar";

    exe_dir.join(binary_name)
}

/// Resolve the user-installed Codex CLI executable.
/// Search order:
///   1. system PATH — `codex.exe` (Windows) / `codex` (Unix), plus npm `.cmd`
///      shims resolved to the real platform binary
///   2. `~/.codex/bin` (official CLI installer)
///   3. ChatGPT/Codex desktop app bundled CLI (Windows:
///      `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`)
///   4. VS Code ChatGPT extension bundled CLI (Windows:
///      `~/.vscode/extensions/openai.chatgpt-*/bin/<triple>/codex.exe`)
///   5. legacy vendored runtime next to the app executable (pre-unbundling)
fn resolve_codex_cli() -> Option<std::path::PathBuf> {
    let exe = codex_exe_name();

    if let Some(path_var) = std::env::var_os("PATH") {
        if let Some(found) = find_executable_in_path(&path_var, exe) {
            return Some(found);
        }
        #[cfg(target_os = "windows")]
        if let Some(shim) = find_executable_in_path(&path_var, "codex.cmd") {
            if let Some(real) = resolve_npm_shim(&shim) {
                return Some(real);
            }
        }
    }

    let home_bin = dirs::home_dir()?.join(".codex").join("bin").join(exe);
    if home_bin.is_file() {
        return Some(home_bin);
    }

    #[cfg(target_os = "windows")]
    {
        let app_bin_root = dirs::data_local_dir()?
            .join("OpenAI")
            .join("Codex")
            .join("bin");
        if let Some(bundled) = find_codex_exe_in_dir(&app_bin_root) {
            return Some(bundled);
        }

        let ext_root = dirs::home_dir()?.join(".vscode").join("extensions");
        if let Some(ext) = find_vscode_codex_cli(&ext_root) {
            return Some(ext);
        }
    }

    let legacy = std::env::current_exe()
        .ok()?
        .parent()
        .map(|d| d.join("codex-cli-runtime").join("bin").join(exe))?;
    if legacy.is_file() {
        return Some(legacy);
    }

    None
}

/// Find the CLI bundled with the VS Code ChatGPT extension
/// (`<extensions>/openai.chatgpt-*/bin/<triple>/codex(.exe)`).
#[cfg(target_os = "windows")]
fn find_vscode_codex_cli(ext_root: &std::path::Path) -> Option<std::path::PathBuf> {
    let exe = codex_exe_name();
    let entries = std::fs::read_dir(ext_root).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("openai.chatgpt-") {
            continue;
        }
        let bin_root = entry.path().join("bin");
        let bin_entries = std::fs::read_dir(&bin_root).ok()?;
        for bin_entry in bin_entries.flatten() {
            let candidate = bin_entry.path().join(exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn codex_exe_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "codex.exe"
    } else {
        "codex"
    }
}

/// Look up an executable by name inside a PATH-style list of directories.
fn find_executable_in_path(path_var: &std::ffi::OsStr, name: &str) -> Option<std::path::PathBuf> {
    for dir in std::env::split_paths(path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Resolve the real Codex binary behind an npm `.cmd` shim
/// (`<npm-prefix>\codex.cmd` → `<npm-prefix>\node_modules\@openai\codex-win32-x64\vendor\<triple>\bin\codex.exe`).
#[cfg(target_os = "windows")]
fn resolve_npm_shim(shim: &std::path::Path) -> Option<std::path::PathBuf> {
    if !shim.file_name()?.to_string_lossy().ends_with(".cmd") {
        return None;
    }
    let vendor = shim
        .parent()?
        .join("node_modules")
        .join("@openai")
        .join("codex-win32-x64")
        .join("vendor");
    let entries = std::fs::read_dir(&vendor).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path().join("bin").join(codex_exe_name());
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Find `codex(.exe)` one level below `root` (versioned subdirectories).
fn find_codex_exe_in_dir(root: &std::path::Path) -> Option<std::path::PathBuf> {
    let exe = codex_exe_name();
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path().join(exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Path of the Codex CLI auth cache (`~/.codex/auth.json`).
fn codex_auth_file() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".codex")
        .join("auth.json")
}

/// Parse one NDJSON line from the sidecar into a `CodexChunk`.
/// Unparseable or unknown lines yield `None` (caller skips them).
fn parse_sidecar_event(line: &str, request_id: &str) -> Option<CodexChunk> {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;

    let event_type = event["type"].as_str()?.to_string();
    let is_done = event_type == "done" || event_type == "error";

    Some(CodexChunk {
        request_id: request_id.to_string(),
        chunk_type: event_type,
        content: event["content"].as_str().map(String::from),
        tool_name: event["toolName"].as_str().map(String::from),
        tool_input: event["toolInput"].as_str().map(String::from),
        call_id: event["callId"].as_str().map(String::from),
        stop_reason: event["stopReason"].as_str().map(String::from),
        error: event["error"].as_str().map(String::from),
        done: is_done,
        input_tokens: event["inputTokens"].as_i64(),
        output_tokens: event["outputTokens"].as_i64(),
        cache_read_tokens: event["cacheReadTokens"].as_i64(),
        reasoning_tokens: event["reasoningTokens"].as_i64(),
    })
}

#[tauri::command]
pub async fn codex_run(
    window: Window,
    keychain: State<'_, KeychainState>,
    active_requests: State<'_, CodexRequestState>,
    request: CodexRequest,
) -> Result<(), String> {
    let request_id = request.request_id.clone();

    // The Codex API key is optional — without it the bundled CLI uses the
    // ChatGPT login cached in ~/.codex/auth.json. The provider's key (sent
    // with the request) takes precedence; fall back to the keychain value.
    let api_key: Option<String> = {
        let store = keychain.0.lock().map_err(|e| e.to_string())?;
        request
            .api_key
            .clone()
            .or_else(|| store.get("hyscode:codex_api_key").cloned())
    };

    let window_clone = window.clone();
    let req_id = request_id.clone();
    let requests = active_requests.0.clone();

    tauri::async_runtime::spawn(async move {
        let emit_error = |error: String| {
            let _ = window_clone.emit(
                "codex:chunk",
                CodexChunk {
                    request_id: req_id.clone(),
                    chunk_type: "error".to_string(),
                    content: None,
                    tool_name: None,
                    tool_input: None,
                    call_id: None,
                    stop_reason: None,
                    error: Some(error),
                    done: true,
                    input_tokens: None,
                    output_tokens: None,
                    cache_read_tokens: None,
                    reasoning_tokens: None,
                },
            );
        };

        // Build the JSON payload for the sidecar
        let sidecar_input = serde_json::json!({
            "apiKey": api_key,
            "model": request.model,
            "systemPrompt": request.system_prompt,
            "prompt": request.prompt,
            "cwd": request.cwd,
            "reasoningEffort": request.reasoning_effort,
        });

        let input_json = match serde_json::to_string(&sidecar_input) {
            Ok(j) => j,
            Err(e) => {
                emit_error(format!("Failed to serialize request: {}", e));
                return;
            }
        };

        let sidecar_binary = sidecar_path();
        if !sidecar_binary.exists() {
            emit_error(format!(
                "Codex sidecar not found at: {}",
                sidecar_binary.display()
            ));
            return;
        }

        // Spawn the sidecar process
        let mut child = match cmd(&sidecar_binary)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                emit_error(format!("Failed to spawn sidecar: {}", e));
                return;
            }
        };

        // Register the child so codex_cancel can kill it.
        {
            let Ok(mut map) = requests.lock() else {
                let _ = child.kill();
                emit_error("Failed to lock request registry".to_string());
                return;
            };
            map.insert(req_id.clone(), child);
        }

        // Write request to stdin (re-borrow from the registry).
        {
            let Ok(mut map) = requests.lock() else {
                return;
            };
            if let Some(registered) = map.get_mut(&req_id) {
                if let Some(mut stdin) = registered.stdin.take() {
                    let _ = stdin.write_all(input_json.as_bytes());
                }
            }
        }

        // Read stdout line-by-line (NDJSON)
        {
            let stdout = {
                let Ok(mut map) = requests.lock() else {
                    return;
                };
                map.get_mut(&req_id).and_then(|c| c.stdout.take())
            };

            if let Some(stdout) = stdout {
                let reader = std::io::BufReader::new(stdout);

                for line in reader.lines() {
                    let line = match line {
                        Ok(l) => l,
                        Err(e) => {
                            emit_error(format!("Read error: {}", e));
                            break;
                        }
                    };

                    if line.trim().is_empty() {
                        continue;
                    }

                    let Some(chunk) = parse_sidecar_event(&line, &req_id) else {
                        continue;
                    };
                    let is_done = chunk.done;

                    let _ = window_clone.emit("codex:chunk", chunk);

                    if is_done {
                        break;
                    }
                }
            }
        }

        // Remove and reap the child process.
        let child = {
            let Ok(mut map) = requests.lock() else {
                return;
            };
            map.remove(&req_id)
        };
        if let Some(mut c) = child {
            let _ = c.wait();
        }
    });

    Ok(())
}

/// Kill a running Codex sidecar request and emit a terminal error chunk.
#[tauri::command]
pub async fn codex_cancel(
    window: Window,
    active_requests: State<'_, CodexRequestState>,
    request_id: String,
) -> Result<(), String> {
    {
        let mut map = active_requests.0.lock().map_err(|e| e.to_string())?;
        if let Some(child) = map.get_mut(&request_id) {
            let _ = child.kill();
        }
    }

    let _ = window.emit(
        "codex:chunk",
        CodexChunk {
            request_id,
            chunk_type: "error".to_string(),
            content: None,
            tool_name: None,
            tool_input: None,
            call_id: None,
            stop_reason: None,
            error: Some("Cancelled by user".to_string()),
            done: true,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            reasoning_tokens: None,
        },
    );
    Ok(())
}

/// Start the ChatGPT OAuth browser flow via the user-installed Codex CLI
/// (`codex login`). Returns immediately; credentials land in
/// `~/.codex/auth.json` when the user completes the flow.
#[tauri::command]
pub async fn codex_login() -> Result<(), String> {
    let Some(cli_path) = resolve_codex_cli() else {
        return Err(
            "Codex CLI not found. Install it with: npm install -g @openai/codex".to_string(),
        );
    };

    tauri::async_runtime::spawn(async move {
        // The child is intentionally dropped: the login process continues in
        // the background while the browser flow completes.
        let _ = cmd(&cli_path).arg("login").spawn();
    });

    Ok(())
}

/// Report whether the user-installed Codex CLI is available (and its version).
#[tauri::command]
pub async fn codex_cli_status() -> Result<CodexCliStatus, String> {
    let Some(cli_path) = resolve_codex_cli() else {
        return Ok(CodexCliStatus {
            installed: false,
            path: None,
            version: None,
        });
    };

    let version = std::process::Command::new(&cli_path)
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|v| v.trim().to_string());

    Ok(CodexCliStatus {
        installed: true,
        path: Some(cli_path.display().to_string()),
        version,
    })
}

/// Report whether the Codex CLI has cached credentials and/or an API key.
#[tauri::command]
pub async fn codex_login_status(
    keychain: State<'_, KeychainState>,
) -> Result<CodexLoginStatus, String> {
    let has_api_key = {
        let store = keychain.0.lock().map_err(|e| e.to_string())?;
        store.contains_key("hyscode:codex_api_key")
    };

    let authenticated = codex_auth_file().exists();

    Ok(CodexLoginStatus {
        authenticated,
        method: if authenticated {
            Some("chatgpt".to_string())
        } else {
            None
        },
        has_api_key,
    })
}

/// Clear the cached ChatGPT login (deletes `~/.codex/auth.json`).
#[tauri::command]
pub async fn codex_logout() -> Result<(), String> {
    let auth_file = codex_auth_file();
    match std::fs::remove_file(&auth_file) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(line: &str) -> Option<CodexChunk> {
        parse_sidecar_event(line, "req-1")
    }

    #[test]
    fn parses_text_event() {
        let c = chunk(r#"{"type":"text","content":"hello"}"#).expect("parse");
        assert_eq!(c.chunk_type, "text");
        assert_eq!(c.content.as_deref(), Some("hello"));
        assert!(!c.done);
    }

    #[test]
    fn parses_tool_use_event() {
        let c = chunk(
            r#"{"type":"tool_use","callId":"c1","toolName":"shell","toolInput":"{\"command\":\"ls\"}"}"#,
        )
        .expect("parse");
        assert_eq!(c.chunk_type, "tool_use");
        assert_eq!(c.call_id.as_deref(), Some("c1"));
        assert_eq!(c.tool_name.as_deref(), Some("shell"));
        assert!(c.tool_input.as_deref().unwrap().contains("ls"));
    }

    #[test]
    fn parses_usage_event_with_tokens() {
        let c = chunk(
            r#"{"type":"usage","inputTokens":100,"outputTokens":50,"cacheReadTokens":40,"reasoningTokens":10}"#,
        )
        .expect("parse");
        assert_eq!(c.chunk_type, "usage");
        assert_eq!(c.input_tokens, Some(100));
        assert_eq!(c.output_tokens, Some(50));
        assert_eq!(c.cache_read_tokens, Some(40));
        assert_eq!(c.reasoning_tokens, Some(10));
    }

    #[test]
    fn marks_done_and_error_as_terminal() {
        let done = chunk(r#"{"type":"done","stopReason":"end_turn"}"#).expect("parse");
        assert!(done.done);
        assert_eq!(done.stop_reason.as_deref(), Some("end_turn"));

        let err = chunk(r#"{"type":"error","error":"boom"}"#).expect("parse");
        assert!(err.done);
        assert_eq!(err.error.as_deref(), Some("boom"));
    }

    #[test]
    fn parses_message_boundary_event() {
        let c = chunk(r#"{"type":"message_boundary"}"#).expect("parse");
        assert_eq!(c.chunk_type, "message_boundary");
        assert!(!c.done);
        assert!(c.content.is_none());
    }

    #[test]
    fn skips_garbage_lines() {
        assert!(chunk("not json").is_none());
        assert!(chunk(r#"{"no":"type"}"#).is_none());
        assert!(chunk("").is_none());
    }

    #[test]
    fn finds_executable_in_path_and_ignores_missing() {
        let dir = std::env::temp_dir().join(format!("hyscode-codex-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let exe_name = if cfg!(target_os = "windows") {
            "codex.exe"
        } else {
            "codex"
        };
        std::fs::write(dir.join(exe_name), b"#!/bin/sh").unwrap();
        std::fs::write(dir.join("other.exe"), b"x").unwrap();

        let path_var = std::env::join_paths([&dir]).expect("join paths");
        assert!(find_executable_in_path(&path_var, exe_name).is_some());
        assert!(find_executable_in_path(&path_var, "missing-tool").is_none());

        let empty_path = std::env::join_paths(std::iter::empty::<&str>()).expect("empty path");
        assert!(find_executable_in_path(&empty_path, exe_name).is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn finds_codex_one_level_deep_in_versioned_dirs() {
        let root =
            std::env::temp_dir().join(format!("hyscode-codex-dir-test-{}", std::process::id()));
        let versioned = root.join("d7e8094cfb76a267");
        std::fs::create_dir_all(&versioned).unwrap();

        let exe_name = if cfg!(target_os = "windows") {
            "codex.exe"
        } else {
            "codex"
        };
        std::fs::write(versioned.join(exe_name), b"#!/bin/sh").unwrap();
        std::fs::create_dir_all(root.join("other-version")).unwrap();

        assert!(find_codex_exe_in_dir(&root).is_some());
        assert!(find_codex_exe_in_dir(&root.join("does-not-exist")).is_none());
        assert!(find_codex_exe_in_dir(&root.join("other-version")).is_none());

        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_npm_shim_to_platform_binary() {
        let root =
            std::env::temp_dir().join(format!("hyscode-codex-shim-test-{}", std::process::id()));
        let vendor = root
            .join("node_modules")
            .join("@openai")
            .join("codex-win32-x64")
            .join("vendor")
            .join("x86_64-pc-windows-msvc")
            .join("bin");
        std::fs::create_dir_all(&vendor).unwrap();
        std::fs::write(vendor.join("codex.exe"), b"MZ fake exe").unwrap();

        let shim = root.join("codex.cmd");
        std::fs::write(&shim, "@echo off").unwrap();

        let resolved = resolve_npm_shim(&shim).expect("resolve");
        assert_eq!(resolved, vendor.join("codex.exe"));

        // Non-.cmd paths are not treated as shims.
        assert!(resolve_npm_shim(&root.join("codex.exe")).is_none());

        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn finds_vscode_extension_codex_cli() {
        let root =
            std::env::temp_dir().join(format!("hyscode-codex-vscode-test-{}", std::process::id()));
        let ext_bin = root
            .join("extensions")
            .join("openai.chatgpt-26.721.30844-win32-x64")
            .join("bin")
            .join("windows-x86_64");
        std::fs::create_dir_all(&ext_bin).unwrap();
        std::fs::write(ext_bin.join("codex.exe"), b"MZ fake exe").unwrap();
        // Unrelated extension with a codex.exe must be ignored.
        std::fs::create_dir_all(root.join("extensions").join("other.vendor").join("bin")).unwrap();
        std::fs::write(
            root.join("extensions")
                .join("other.vendor")
                .join("bin")
                .join("codex.exe"),
            b"MZ fake exe",
        )
        .unwrap();

        assert!(find_vscode_codex_cli(&root.join("extensions")).is_some());
        assert!(find_vscode_codex_cli(&root.join("missing")).is_none());

        std::fs::remove_dir_all(&root).ok();
    }
}
