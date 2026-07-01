use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{Emitter, State, Window};

use super::github_oauth::ensure_copilot_token;
use super::keychain::KeychainState;

#[derive(Debug, Deserialize)]
pub struct AiStreamRequest {
    /// Unique request ID for correlating events
    pub request_id: String,
    /// Provider ID: "anthropic", "openai", "gemini", "ollama", "openrouter"
    pub provider: String,
    /// Full URL to POST to
    pub url: String,
    /// HTTP headers (without auth — auth is injected from keychain)
    pub headers: std::collections::HashMap<String, String>,
    /// JSON request body as string
    pub body: String,
    /// Timeout in milliseconds (default 120000)
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiStreamChunk {
    pub request_id: String,
    pub data: String,
    pub done: bool,
    pub error: Option<String>,
    pub status_code: Option<u16>,
    pub retry_after_ms: Option<u64>,
    pub error_kind: Option<String>,
    pub error_phase: Option<String>,
}

#[derive(Default)]
pub struct AiRequestState(
    pub std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, JoinHandle<()>>>>,
);

struct ActiveRequestCleanup {
    requests: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, JoinHandle<()>>>>,
    request_id: String,
}

impl Drop for ActiveRequestCleanup {
    fn drop(&mut self) {
        if let Ok(mut active) = self.requests.lock() {
            active.remove(&self.request_id);
        }
    }
}

fn classify_transport_error(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connection"
    } else if error.is_body() || error.is_decode() {
        "stream_interrupted"
    } else {
        "connection"
    }
}

fn retry_after_ms(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<f64>().ok())
        .map(|seconds| (seconds * 1000.0) as u64)
}

/// Get the keychain key name for a provider's API key
fn provider_key_name(provider: &str) -> String {
    format!("hyscode:{}_api_key", provider)
}

/// Get the auth header for a provider
fn get_auth_header(provider: &str, api_key: &str) -> (String, String) {
    match provider {
        "anthropic" => ("x-api-key".to_string(), api_key.to_string()),
        "gemini" => {
            // Gemini uses query parameter, not header. Return empty header.
            ("x-goog-api-key".to_string(), api_key.to_string())
        }
        "github-copilot" => {
            // Copilot uses Bearer token with the short-lived Copilot token
            ("Authorization".to_string(), format!("Bearer {}", api_key))
        }
        // OpenAI, OpenRouter, and others use Bearer token
        _ => ("Authorization".to_string(), format!("Bearer {}", api_key)),
    }
}

#[tauri::command]
pub async fn ai_stream_request(
    window: Window,
    keychain: State<'_, KeychainState>,
    active_requests: State<'_, AiRequestState>,
    request: AiStreamRequest,
) -> Result<(), String> {
    let request_id = request.request_id.clone();

    // Get API key from keychain (ollama doesn't need one)
    let api_key = if request.provider == "ollama" {
        None
    } else {
        let key_name = provider_key_name(&request.provider);
        let key = {
            let store = keychain.0.lock().map_err(|e| e.to_string())?;
            let key = store.get(&key_name).cloned();
            // For github-copilot, also try the token key directly
            if key.is_none() && request.provider == "github-copilot" {
                store.get("hyscode:github_copilot_token").cloned()
            } else {
                key
            }
        }; // lock released here

        // For Copilot, if the short-lived token is missing but we have an access token,
        // regenerate it on-the-fly instead of failing immediately.
        let key = if key.is_none() && request.provider == "github-copilot" {
            match ensure_copilot_token(keychain.0.clone()).await {
                Ok(token) => Some(token),
                Err(e) => {
                    eprintln!(
                        "[ai_stream_request] Copilot token regeneration failed: {}",
                        e
                    );
                    None
                }
            }
        } else {
            key
        };

        if key.is_none() {
            let _ = window.emit(
                "ai:chunk",
                AiStreamChunk {
                    request_id: request_id.clone(),
                    data: String::new(),
                    done: true,
                    error: Some(format!(
                        "No API key configured for provider '{}'",
                        request.provider
                    )),
                    status_code: None,
                    retry_after_ms: None,
                    error_kind: Some("authentication".to_string()),
                    error_phase: Some("configuration".to_string()),
                },
            );
            return Ok(());
        }
        key
    };

    // Spawn async task to handle streaming
    let window_clone = window.clone();
    let req_id = request_id.clone();
    let keychain_arc = keychain.0.clone();
    let requests = active_requests.0.clone();
    let cleanup_requests = requests.clone();
    let cleanup_id = request_id.clone();
    let (start_tx, start_rx) = tokio::sync::oneshot::channel::<()>();

    let task = tauri::async_runtime::spawn(async move {
        let _ = start_rx.await;
        let _cleanup = ActiveRequestCleanup {
            requests: cleanup_requests,
            request_id: cleanup_id,
        };
        let client = reqwest::Client::new();
        let timeout = std::time::Duration::from_millis(request.timeout_ms.unwrap_or(120_000));

        let mut current_api_key = api_key;

        let mut req_builder = client.post(&request.url).timeout(timeout);

        // Add user-provided headers
        for (key, value) in &request.headers {
            req_builder = req_builder.header(key.as_str(), value.as_str());
        }

        // Inject auth header from keychain
        if let Some(ref key) = current_api_key {
            let (header_name, header_value) = get_auth_header(&request.provider, key);
            req_builder = req_builder.header(header_name.as_str(), header_value.as_str());
        }

        req_builder = req_builder.body(request.body.clone());

        // Make the request
        let mut response = match req_builder.send().await {
            Ok(resp) => resp,
            Err(e) => {
                let _ = window_clone.emit(
                    "ai:chunk",
                    AiStreamChunk {
                        request_id: req_id,
                        data: String::new(),
                        done: true,
                        error: Some(format!("HTTP request failed: {}", e)),
                        status_code: None,
                        retry_after_ms: None,
                        error_kind: Some(classify_transport_error(&e).to_string()),
                        error_phase: Some("connecting".to_string()),
                    },
                );
                return;
            }
        };

        let mut status = response.status().as_u16();

        // If Copilot returns 401, the short-lived token may have expired.
        // Automatically refresh it and retry once.
        if status == 401 && request.provider == "github-copilot" {
            match ensure_copilot_token(keychain_arc).await {
                Ok(new_token) => {
                    current_api_key = Some(new_token);
                    let mut retry_builder = client.post(&request.url).timeout(timeout);
                    for (key, value) in &request.headers {
                        retry_builder = retry_builder.header(key.as_str(), value.as_str());
                    }
                    if let Some(ref key) = current_api_key {
                        let (header_name, header_value) = get_auth_header(&request.provider, key);
                        retry_builder =
                            retry_builder.header(header_name.as_str(), header_value.as_str());
                    }
                    retry_builder = retry_builder.body(request.body.clone());
                    if let Ok(retry_resp) = retry_builder.send().await {
                        response = retry_resp;
                        status = response.status().as_u16();
                    }
                }
                Err(e) => {
                    eprintln!("[ai_stream_request] Copilot token refresh failed: {}", e);
                }
            }
        }

        if status >= 400 {
            let retry_after = retry_after_ms(&response);
            let error_body = response.text().await.unwrap_or_default();
            let _ = window_clone.emit(
                "ai:chunk",
                AiStreamChunk {
                    request_id: req_id,
                    data: error_body,
                    done: true,
                    error: Some(format!("HTTP {}", status)),
                    status_code: Some(status),
                    retry_after_ms: retry_after,
                    error_kind: Some(
                        match status {
                            401 | 403 => "authentication",
                            429 => "rate_limit",
                            408 => "timeout",
                            500..=599 => "unavailable",
                            _ => "unknown",
                        }
                        .to_string(),
                    ),
                    error_phase: Some("connecting".to_string()),
                },
            );
            return;
        }

        // Stream the response body in chunks
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    let _ = window_clone.emit(
                        "ai:chunk",
                        AiStreamChunk {
                            request_id: req_id.clone(),
                            data: text,
                            done: false,
                            error: None,
                            status_code: Some(status),
                            retry_after_ms: None,
                            error_kind: None,
                            error_phase: None,
                        },
                    );
                }
                Err(e) => {
                    let _ = window_clone.emit(
                        "ai:chunk",
                        AiStreamChunk {
                            request_id: req_id.clone(),
                            data: String::new(),
                            done: true,
                            error: Some(format!("Stream read error: {}", e)),
                            status_code: Some(status),
                            retry_after_ms: None,
                            error_kind: Some(classify_transport_error(&e).to_string()),
                            error_phase: Some("streaming".to_string()),
                        },
                    );
                    return;
                }
            }
        }

        // Stream completed
        let _ = window_clone.emit(
            "ai:chunk",
            AiStreamChunk {
                request_id: req_id,
                data: String::new(),
                done: true,
                error: None,
                status_code: Some(status),
                retry_after_ms: None,
                error_kind: None,
                error_phase: None,
            },
        );
    });

    {
        let mut active = requests.lock().map_err(|error| error.to_string())?;
        active.insert(request_id, task);
    }
    let _ = start_tx.send(());

    Ok(())
}

/// Cancel an in-progress streaming request.
/// Currently this just signals — actual cancellation depends on the reqwest client.
#[tauri::command]
pub async fn ai_stream_cancel(
    window: Window,
    active_requests: State<'_, AiRequestState>,
    request_id: String,
) -> Result<(), String> {
    let task = active_requests
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&request_id);
    if let Some(task) = task {
        task.abort();
    }
    let _ = window.emit(
        "ai:chunk",
        AiStreamChunk {
            request_id,
            data: String::new(),
            done: true,
            error: Some("Cancelled by user".to_string()),
            status_code: None,
            retry_after_ms: None,
            error_kind: Some("cancelled".to_string()),
            error_phase: Some("streaming".to_string()),
        },
    );
    Ok(())
}
