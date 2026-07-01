use serde::{Deserialize, Serialize};
use tauri::{Emitter, State, Window};

use super::keychain::KeychainState;
use super::utils::cmd;

// ─── Claude Agent Sidecar Command ─────────────────────────────────────────────
// Spawns the Bun-compiled claude-agent sidecar binary, sends a JSON request
// via stdin, and reads NDJSON events from stdout, emitting them as Tauri events.

#[derive(Debug, Deserialize)]
pub struct ClaudeAgentRequest {
    pub request_id: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub messages: Vec<ClaudeAgentMessage>,
    pub max_turns: Option<u32>,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ClaudeAgentMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeAgentChunk {
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
}

#[tauri::command]
pub async fn claude_agent_run(
    window: Window,
    keychain: State<'_, KeychainState>,
    request: ClaudeAgentRequest,
) -> Result<(), String> {
    let request_id = request.request_id.clone();

    // Get Anthropic API key from keychain
    let api_key = {
        let store = keychain.0.lock().map_err(|e| e.to_string())?;
        store
            .get("hyscode:anthropic_api_key")
            .cloned()
            .ok_or_else(|| "No Anthropic API key configured for Claude Agent".to_string())?
    };

    let window_clone = window.clone();
    let req_id = request_id.clone();

    tauri::async_runtime::spawn(async move {
        // Build the JSON payload for the sidecar
        let sidecar_input = serde_json::json!({
            "apiKey": api_key,
            "model": request.model,
            "systemPrompt": request.system_prompt,
            "messages": request.messages,
            "maxTurns": request.max_turns,
            "cwd": request.cwd,
        });

        let input_json = match serde_json::to_string(&sidecar_input) {
            Ok(j) => j,
            Err(e) => {
                let _ = window_clone.emit(
                    "agent:chunk",
                    ClaudeAgentChunk {
                        request_id: req_id,
                        chunk_type: "error".to_string(),
                        content: None,
                        tool_name: None,
                        tool_input: None,
                        call_id: None,
                        stop_reason: None,
                        error: Some(format!("Failed to serialize request: {}", e)),
                        done: true,
                    },
                );
                return;
            }
        };

        // Locate the sidecar binary relative to the app
        let sidecar_path = {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_default();

            #[cfg(target_os = "windows")]
            let binary_name = "claude-agent.exe";
            #[cfg(not(target_os = "windows"))]
            let binary_name = "claude-agent";

            exe_dir.join(binary_name)
        };

        if !sidecar_path.exists() {
            let _ = window_clone.emit(
                "agent:chunk",
                ClaudeAgentChunk {
                    request_id: req_id,
                    chunk_type: "error".to_string(),
                    content: None,
                    tool_name: None,
                    tool_input: None,
                    call_id: None,
                    stop_reason: None,
                    error: Some(format!(
                        "Claude Agent sidecar not found at: {}",
                        sidecar_path.display()
                    )),
                    done: true,
                },
            );
            return;
        }

        // Spawn the sidecar process
        let mut child = match cmd(&sidecar_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = window_clone.emit(
                    "agent:chunk",
                    ClaudeAgentChunk {
                        request_id: req_id,
                        chunk_type: "error".to_string(),
                        content: None,
                        tool_name: None,
                        tool_input: None,
                        call_id: None,
                        stop_reason: None,
                        error: Some(format!("Failed to spawn sidecar: {}", e)),
                        done: true,
                    },
                );
                return;
            }
        };

        // Write request to stdin
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(input_json.as_bytes());
            // Close stdin to signal EOF
            drop(stdin);
        }

        // Read stdout line-by-line (NDJSON)
        if let Some(stdout) = child.stdout.take() {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        let _ = window_clone.emit(
                            "agent:chunk",
                            ClaudeAgentChunk {
                                request_id: req_id.clone(),
                                chunk_type: "error".to_string(),
                                content: None,
                                tool_name: None,
                                tool_input: None,
                                call_id: None,
                                stop_reason: None,
                                error: Some(format!("Read error: {}", e)),
                                done: true,
                            },
                        );
                        break;
                    }
                };

                if line.trim().is_empty() {
                    continue;
                }

                // Parse the NDJSON event from sidecar
                let event: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let event_type = event["type"].as_str().unwrap_or("unknown").to_string();
                let is_done = event_type == "done" || event_type == "error";

                let chunk = ClaudeAgentChunk {
                    request_id: req_id.clone(),
                    chunk_type: event_type,
                    content: event["content"].as_str().map(String::from),
                    tool_name: event["toolName"].as_str().map(String::from),
                    tool_input: event["toolInput"].as_str().map(String::from),
                    call_id: event["callId"].as_str().map(String::from),
                    stop_reason: event["stopReason"].as_str().map(String::from),
                    error: event["error"].as_str().map(String::from),
                    done: is_done,
                };

                let _ = window_clone.emit("agent:chunk", chunk);

                if is_done {
                    break;
                }
            }
        }

        // Wait for process exit
        let _ = child.wait();
    });

    Ok(())
}

/// Cancel a running Claude Agent sidecar request.
#[tauri::command]
pub async fn claude_agent_cancel(window: Window, request_id: String) -> Result<(), String> {
    let _ = window.emit(
        "agent:chunk",
        ClaudeAgentChunk {
            request_id,
            chunk_type: "error".to_string(),
            content: None,
            tool_name: None,
            tool_input: None,
            call_id: None,
            stop_reason: None,
            error: Some("Cancelled by user".to_string()),
            done: true,
        },
    );
    Ok(())
}
