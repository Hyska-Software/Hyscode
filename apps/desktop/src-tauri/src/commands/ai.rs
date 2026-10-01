use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{Emitter, State, Window};
use url::Url;

use super::github_oauth::ensure_copilot_token;
use super::keychain::KeychainState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamRequest {
    /// Unique request ID for correlating events
    pub request_id: String,
    /// Provider ID: "anthropic", "openai", "gemini", "ollama", "openrouter"
    pub provider: String,
    /// HTTP method. Only provider-supported GET and POST routes are accepted.
    pub method: String,
    /// Provider endpoint URL. The backend validates the origin before loading credentials.
    pub url: String,
    /// HTTP headers (without auth — auth is injected from keychain)
    pub headers: std::collections::HashMap<String, String>,
    /// JSON request body as string
    pub body: String,
    /// Timeout in milliseconds (default 120000)
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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

fn build_ai_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

/// Get the keychain key name for a provider's API key
fn provider_key_name(provider: &str) -> String {
    format!("hyscode:{}_api_key", provider)
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 128
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("AI request ID must be 1-128 ASCII letters, digits, '-' or '_'.".to_string());
    }
    Ok(())
}

fn validate_ai_destination(
    provider: &str,
    method: &str,
    raw_url: &str,
) -> Result<(Url, Method), String> {
    let url = Url::parse(raw_url).map_err(|error| format!("Invalid AI endpoint URL: {error}"))?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("AI endpoint URLs cannot contain credentials or fragments.".to_string());
    }

    let parsed_method = Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("Unsupported AI HTTP method: {method}"))?;
    if parsed_method != Method::GET && parsed_method != Method::POST {
        return Err(format!("Unsupported AI HTTP method: {method}"));
    }

    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let port = url.port_or_known_default();
    let path = url.path();
    let is_gemini_route = |prefix: &str| {
        path.strip_prefix(prefix)
            .and_then(|model| model.strip_suffix(":streamGenerateContent"))
            .is_some_and(|model| {
                !model.is_empty()
                    && model.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
                    })
            })
            && parsed_method == Method::POST
    };
    let (origin_allowed, route_allowed) = match provider {
        "anthropic" => (
            url.scheme() == "https" && host == "api.anthropic.com" && port == Some(443),
            path == "/v1/messages" && parsed_method == Method::POST,
        ),
        "openai" => (
            url.scheme() == "https" && host == "api.openai.com" && port == Some(443),
            matches!(path, "/v1/chat/completions" | "/v1/responses")
                && parsed_method == Method::POST,
        ),
        "gemini" => (
            url.scheme() == "https"
                && host == "generativelanguage.googleapis.com"
                && port == Some(443),
            is_gemini_route("/v1beta/models/"),
        ),
        "openrouter" => (
            url.scheme() == "https" && host == "openrouter.ai" && port == Some(443),
            (path == "/api/v1/models" && parsed_method == Method::GET)
                || (path == "/api/v1/chat/completions" && parsed_method == Method::POST),
        ),
        "github-copilot" => (
            url.scheme() == "https" && host == "api.githubcopilot.com" && port == Some(443),
            path == "/chat/completions" && parsed_method == Method::POST,
        ),
        "opencode-zen" => (
            url.scheme() == "https" && host == "opencode.ai" && port == Some(443),
            matches!(
                path,
                "/zen/v1/chat/completions" | "/zen/v1/responses" | "/zen/v1/messages"
            ) && parsed_method == Method::POST
                || (path == "/zen/v1/models" && parsed_method == Method::GET)
                || is_gemini_route("/zen/v1/models/"),
        ),
        "opencode-go" => (
            url.scheme() == "https" && host == "opencode.ai" && port == Some(443),
            matches!(
                path,
                "/zen/go/v1/chat/completions" | "/zen/go/v1/responses" | "/zen/go/v1/messages"
            ) && parsed_method == Method::POST
                || (path == "/zen/go/v1/models" && parsed_method == Method::GET),
        ),
        "ollama" => (
            url.scheme() == "http"
                && matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]")
                && port == Some(11434),
            (path == "/api/tags" && parsed_method == Method::GET)
                || (path == "/api/chat" && parsed_method == Method::POST),
        ),
        _ => return Err(format!("Unsupported AI provider: {provider}")),
    };

    if !origin_allowed {
        return Err(format!(
            "AI endpoint origin is not allowed for provider '{provider}'."
        ));
    }
    if !route_allowed {
        return Err(format!(
            "AI endpoint route or HTTP method is not allowed for provider '{provider}'."
        ));
    }

    let gemini_endpoint =
        provider == "gemini" || (provider == "opencode-zen" && path.starts_with("/zen/v1/models/"));
    if gemini_endpoint {
        let query_is_expected = url.query_pairs().count() == 1
            && url
                .query_pairs()
                .any(|(key, value)| key == "alt" && value == "sse");
        if !query_is_expected {
            return Err(
                "Gemini stream URLs must use only the 'alt=sse' query parameter.".to_string(),
            );
        }
    } else if url.query().is_some() {
        return Err("AI endpoint URLs cannot contain query parameters.".to_string());
    }

    Ok((url, parsed_method))
}

fn validate_ai_headers(headers: &std::collections::HashMap<String, String>) -> Result<(), String> {
    const BLOCKED_HEADERS: &[&str] = &[
        "authorization",
        "x-api-key",
        "x-goog-api-key",
        "proxy-authorization",
        "cookie",
        "host",
        "connection",
        "content-length",
        "transfer-encoding",
    ];
    if let Some(name) = headers.keys().find(|name| {
        BLOCKED_HEADERS
            .iter()
            .any(|blocked| name.eq_ignore_ascii_case(blocked))
    }) {
        return Err(format!(
            "The AI transport does not accept the '{name}' header."
        ));
    }
    Ok(())
}

/// Get the auth header for a provider
fn get_auth_header(provider: &str, api_key: &str, url: &str) -> (String, String) {
    match provider {
        "anthropic" => ("x-api-key".to_string(), api_key.to_string()),
        "gemini" => {
            // Gemini accepts its API key through a request header.
            ("x-goog-api-key".to_string(), api_key.to_string())
        }
        "github-copilot" => {
            // Copilot uses Bearer token with the short-lived Copilot token
            ("Authorization".to_string(), format!("Bearer {}", api_key))
        }
        // OpenCode Zen/Go expose an Anthropic-compatible /v1/messages endpoint
        // (MiniMax, Qwen, Claude models) that authenticates with x-api-key,
        // while the OpenAI-compatible endpoints use Authorization: Bearer.
        "opencode-zen" | "opencode-go" if url.ends_with("/v1/messages") => {
            ("x-api-key".to_string(), api_key.to_string())
        }
        // OpenAI, OpenRouter, and others use Bearer token
        _ => ("Authorization".to_string(), format!("Bearer {}", api_key)),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_stream_request(
    window: Window,
    keychain: State<'_, KeychainState>,
    active_requests: State<'_, AiRequestState>,
    request: AiStreamRequest,
) -> Result<(), String> {
    let request_id = request.request_id.clone();
    validate_request_id(&request_id)?;
    let (target_url, method) =
        validate_ai_destination(&request.provider, &request.method, &request.url)?;
    validate_ai_headers(&request.headers)?;
    if method == Method::GET && !request.body.is_empty() {
        return Err("GET requests cannot include a body.".to_string());
    }
    let timeout_ms = request.timeout_ms.unwrap_or(120_000).clamp(1_000, 600_000);

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
        let client = match build_ai_client() {
            Ok(client) => client,
            Err(error) => {
                let _ = window_clone.emit(
                    "ai:chunk",
                    AiStreamChunk {
                        request_id: req_id,
                        data: String::new(),
                        done: true,
                        error: Some(format!("Could not configure HTTP client: {error}")),
                        status_code: None,
                        retry_after_ms: None,
                        error_kind: Some("connection".to_string()),
                        error_phase: Some("connecting".to_string()),
                    },
                );
                return;
            }
        };
        let timeout = std::time::Duration::from_millis(timeout_ms);

        let mut current_api_key = api_key;

        let mut req_builder = client
            .request(method.clone(), target_url.clone())
            .timeout(timeout);

        // Add user-provided headers
        for (key, value) in &request.headers {
            req_builder = req_builder.header(key.as_str(), value.as_str());
        }

        // OpenCode Go/Zen require an identifiable User-Agent (generic or
        // missing UAs are flagged as abusive) plus `x-opencode-session` for
        // prompt-cache optimization (may error starting 09/06). The TS
        // providers already send both; browsers forbid User-Agent so the
        // desktop transport guarantees the fallback here.
        let has_user_agent = request
            .headers
            .keys()
            .any(|k| k.eq_ignore_ascii_case("user-agent"));
        if !has_user_agent {
            req_builder = req_builder.header("User-Agent", "HysCode");
        }

        // Inject auth header from keychain
        if let Some(ref key) = current_api_key {
            let (header_name, header_value) = get_auth_header(&request.provider, key, &request.url);
            req_builder = req_builder.header(header_name.as_str(), header_value.as_str());
        }

        if !request.body.is_empty() {
            req_builder = req_builder.body(request.body.clone());
        }

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
                    let mut retry_builder = client
                        .request(method.clone(), target_url.clone())
                        .timeout(timeout);
                    for (key, value) in &request.headers {
                        retry_builder = retry_builder.header(key.as_str(), value.as_str());
                    }
                    if !has_user_agent {
                        retry_builder = retry_builder.header("User-Agent", "HysCode");
                    }
                    if let Some(ref key) = current_api_key {
                        let (header_name, header_value) =
                            get_auth_header(&request.provider, key, &request.url);
                        retry_builder =
                            retry_builder.header(header_name.as_str(), header_value.as_str());
                    }
                    if !request.body.is_empty() {
                        retry_builder = retry_builder.body(request.body.clone());
                    }
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

        if (300..400).contains(&status) {
            let _ = window_clone.emit(
                "ai:chunk",
                AiStreamChunk {
                    request_id: req_id,
                    data: String::new(),
                    done: true,
                    error: Some(
                        "HTTP redirects are blocked by the AI credential proxy.".to_string(),
                    ),
                    status_code: Some(status),
                    retry_after_ms: None,
                    error_kind: Some("unknown".to_string()),
                    error_phase: Some("connecting".to_string()),
                },
            );
            return;
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
        if active.contains_key(&request_id) {
            task.abort();
            return Err(format!("AI request ID is already active: {request_id}"));
        }
        active.insert(request_id, task);
    }
    let _ = start_tx.send(());

    Ok(())
}

/// Cancel an in-progress streaming request.
/// Currently this just signals — actual cancellation depends on the reqwest client.
#[tauri::command(rename_all = "camelCase")]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_provider_routes_with_the_expected_http_methods() {
        for (provider, method, url) in [
            (
                "opencode-zen",
                "GET",
                "https://opencode.ai/zen/v1/models",
            ),
            (
                "openrouter",
                "GET",
                "https://openrouter.ai/api/v1/models",
            ),
            (
                "openai",
                "POST",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "gemini",
                "POST",
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
            ),
            (
                "opencode-zen",
                "POST",
                "https://opencode.ai/zen/v1/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
            ),
            ("ollama", "GET", "http://localhost:11434/api/tags"),
        ] {
            assert!(
                validate_ai_destination(provider, method, url).is_ok(),
                "expected allowed request: {method} {url} as {provider}"
            );
        }
    }

    #[test]
    fn rejects_credential_forwarding_to_wrong_origins_or_redirect_inputs() {
        for (provider, method, url) in [
            (
                "openai",
                "POST",
                "https://attacker.example/v1/chat/completions",
            ),
            (
                "openai",
                "POST",
                "https://api.openai.com.attacker.example/v1/chat/completions",
            ),
            (
                "openai",
                "POST",
                "https://api.openai.com:8443/v1/chat/completions",
            ),
            (
                "openai",
                "POST",
                "https://user:pass@api.openai.com/v1/chat/completions",
            ),
            (
                "openai",
                "POST",
                "https://api.openai.com/v1/chat/completions#fragment",
            ),
            (
                "openai",
                "GET",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "ollama",
                "POST",
                "http://192.168.1.10:11434/api/chat",
            ),
            (
                "gemini",
                "POST",
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?key=secret",
            ),
        ] {
            assert!(
                validate_ai_destination(provider, method, url).is_err(),
                "expected denied request: {method} {url} as {provider}"
            );
        }
    }

    #[test]
    fn refuses_caller_supplied_credentials_and_transport_headers() {
        for name in [
            "Authorization",
            "x-api-key",
            "X-Goog-Api-Key",
            "Cookie",
            "Host",
            "Proxy-Authorization",
        ] {
            let headers =
                std::collections::HashMap::from([(name.to_string(), "value".to_string())]);
            assert!(
                validate_ai_headers(&headers).is_err(),
                "accepted blocked header {name}"
            );
        }
        assert!(validate_ai_headers(&std::collections::HashMap::from([(
            "content-type".to_string(),
            "application/json".to_string(),
        )]))
        .is_ok());
    }

    #[test]
    fn validates_request_ids_before_using_them_as_event_keys() {
        assert!(validate_request_id("ai-123_ab").is_ok());
        assert!(validate_request_id("").is_err());
        assert!(validate_request_id("../secret").is_err());
        assert!(validate_request_id(&"a".repeat(129)).is_err());
    }

    #[test]
    fn credential_transport_client_does_not_follow_redirects() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::{Duration, Instant};

        let listener = TcpListener::bind("127.0.0.1:0").expect("mock listener should bind");
        let address = listener.local_addr().expect("listener address");
        let server = std::thread::spawn(move || {
            let (mut first, _) = listener.accept().expect("first request should arrive");
            let mut request = [0_u8; 2048];
            let _ = first.read(&mut request);
            first
                .write_all(
                    format!(
                        "HTTP/1.1 302 Found\r\nLocation: http://{address}/redirect-target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .expect("redirect response should be written");
            drop(first);

            listener
                .set_nonblocking(true)
                .expect("listener should become nonblocking");
            let deadline = Instant::now() + Duration::from_millis(150);
            let mut followed_redirect = false;
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut second, _)) => {
                        followed_redirect = true;
                        let _ = second.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("redirect probe accept failed: {error}"),
                }
            }
            followed_redirect
        });

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test Tokio runtime should build");
        let response = runtime
            .block_on(async {
                build_ai_client()
                    .expect("AI HTTP client should build")
                    .get(format!("http://{address}/provider"))
                    .timeout(Duration::from_secs(2))
                    .send()
                    .await
            })
            .expect("the redirect response should be returned directly");

        assert_eq!(response.status().as_u16(), 302);
        assert!(!server.join().expect("mock server should join"));
    }
}
