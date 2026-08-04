use anyhow::{anyhow, Context, Result};
use crossterm::event::{
    DisableBracketedPaste, EnableBracketedPaste, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Terminal;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Stdout, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

mod input;
mod pty;

use input::InputEvent;
use pty::PtyManager;

const MAX_TRANSCRIPT_CHARS: usize = 16_000;

struct BridgeClient {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    messages: Receiver<Value>,
    next_id: u64,
    host_response_id: AtomicU64,
    pty: PtyManager,
}

impl BridgeClient {
    fn start() -> Result<Self> {
        let repo_root = env::var_os("HYSCODE_REPO_ROOT")
            .map(PathBuf::from)
            .unwrap_or(env::current_dir().context("could not determine the current directory")?);
        let (program, args, working_directory) = resolve_bridge_command(&repo_root)?;
        let mut child = Command::new(&program)
            .args(args)
            .current_dir(working_directory)
            .env("HYSCODE_REPO_ROOT", &repo_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| {
                format!(
                    "failed to start the HysCode runtime bridge: {}",
                    program.display()
                )
            })?;
        let stdin = child
            .stdin
            .take()
            .context("runtime bridge stdin was unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("runtime bridge stdout was unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("runtime bridge stderr was unavailable")?;
        let (sender, messages) = mpsc::channel::<Value>();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if let Some(message) = parse_bridge_line(&line) {
                    if sender.send(message).is_err() {
                        break;
                    }
                }
            }
        });
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(|line| line.ok()) {
                eprintln!("[hyscode-runtime] {line}");
            }
        });
        let stdin = Arc::new(Mutex::new(stdin));
        let event_stdin = Arc::clone(&stdin);
        let event_id = Arc::new(AtomicU64::new(1));
        let event_counter = Arc::clone(&event_id);
        let callback = Arc::new(move |event: &str, payload: Value| {
            let id = format!(
                "host-event-{}",
                event_counter.fetch_add(1, Ordering::Relaxed)
            );
            let request = json!({
                "id": id,
                "method": "host_event",
                "params": { "event": event, "payload": payload },
            });
            if let Err(error) = write_bridge_message(&event_stdin, request) {
                eprintln!("[hyscode-runtime] failed to forward PTY event: {error}");
            }
        });
        Ok(Self {
            child,
            stdin,
            messages,
            next_id: 1,
            host_response_id: AtomicU64::new(event_id.load(Ordering::Relaxed)),
            pty: PtyManager::new(callback),
        })
    }

    fn request(&mut self, method: &str, params: Value) -> Result<String> {
        let id = format!("tui-{}", self.next_id);
        self.next_id += 1;
        let request = json!({ "id": id, "method": method, "params": params });
        write_bridge_message(&self.stdin, request)?;
        Ok(id)
    }

    fn try_receive(&self) -> Option<Value> {
        self.messages.try_recv().ok()
    }

    fn receive(&self, timeout: Duration) -> Option<Value> {
        self.messages.recv_timeout(timeout).ok()
    }

    fn is_running(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_none()
    }

    fn stop(&mut self) {
        self.pty.shutdown();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    fn handle_host_request(&mut self, message: &Value) -> Result<()> {
        let payload = message
            .get("payload")
            .context("host request payload was missing")?;
        let request_id = payload
            .get("requestId")
            .and_then(Value::as_str)
            .context("host request id was missing")?;
        let method = payload
            .get("method")
            .and_then(Value::as_str)
            .context("host request method was missing")?;
        let params = payload.get("params").unwrap_or(&Value::Null);
        let response = match self.pty.handle(method, params) {
            Ok(result) => json!({
                "id": format!("host-response-{}", self.host_response_id.fetch_add(1, Ordering::Relaxed)),
                "method": "host_response",
                "params": { "requestId": request_id, "ok": true, "result": result },
            }),
            Err(error) => json!({
                "id": format!("host-response-{}", self.host_response_id.fetch_add(1, Ordering::Relaxed)),
                "method": "host_response",
                "params": { "requestId": request_id, "ok": false, "error": error.to_string() },
            }),
        };
        write_bridge_message(&self.stdin, response)
    }
}

fn write_bridge_message(stdin: &Arc<Mutex<ChildStdin>>, message: Value) -> Result<()> {
    let line = serde_json::to_string(&message)?;
    let mut stdin = stdin
        .lock()
        .map_err(|error| anyhow!("bridge stdin lock failed: {error}"))?;
    writeln!(stdin, "{line}")?;
    stdin.flush()?;
    Ok(())
}

fn resolve_bridge_command(repo_root: &Path) -> Result<(PathBuf, Vec<String>, PathBuf)> {
    if let Some(configured) = env::var_os("HYSCODE_TUI_BRIDGE") {
        let path = PathBuf::from(configured);
        let parent = path.parent().unwrap_or(repo_root).to_path_buf();
        return Ok((path, Vec::new(), parent));
    }

    let executable_directory = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| repo_root.to_path_buf());
    let executable_names = if cfg!(windows) {
        vec!["hyscode-tui-bridge.exe", "hyscode-tui-bridge"]
    } else {
        vec!["hyscode-tui-bridge"]
    };
    for name in executable_names {
        let candidate = executable_directory.join(name);
        if candidate.is_file() {
            return Ok((candidate, Vec::new(), executable_directory));
        }
    }

    let source = repo_root
        .join("packages")
        .join("tui-runtime")
        .join("src")
        .join("main.ts");
    if source.is_file() {
        return Ok((
            PathBuf::from("bun"),
            vec![source.to_string_lossy().to_string()],
            repo_root.to_path_buf(),
        ));
    }
    Err(anyhow!(
        "could not find a packaged bridge or packages/tui-runtime/src/main.ts"
    ))
}

#[derive(Clone, Copy)]
enum TranscriptKind {
    User,
    Assistant,
    Thinking,
    Tool,
    Result,
    System,
    Error,
}

struct TranscriptItem {
    kind: TranscriptKind,
    text: String,
}

#[derive(Clone)]
enum Interaction {
    Approval {
        request_id: String,
        tool_name: String,
        description: String,
        risk: String,
    },
    ModeSwitch {
        request_id: String,
        from: String,
        to: String,
        reason: String,
    },
    Question {
        request_id: String,
        title: String,
        question: String,
    },
}

struct CliOptions {
    workspace: PathBuf,
    provider: Option<String>,
    model: Option<String>,
    mode: Option<String>,
    config_path: Option<String>,
}

struct App {
    bridge: BridgeClient,
    transcript: VecDeque<TranscriptItem>,
    input: String,
    input_cursor: usize,
    input_history: Vec<String>,
    history_index: Option<usize>,
    workspace: String,
    project_id: String,
    provider: String,
    model: String,
    mode: String,
    status: String,
    running: bool,
    should_quit: bool,
    interaction: Option<Interaction>,
    scroll: u16,
    last_error: Option<String>,
    pending_requests: HashMap<String, String>,
    current_session_id: Option<String>,
    last_user_message: Option<String>,
    config_path: Option<String>,
}

impl App {
    fn new(bridge: BridgeClient, options: &CliOptions, workspace: String) -> Self {
        Self {
            bridge,
            transcript: VecDeque::new(),
            input: String::new(),
            input_cursor: 0,
            input_history: Vec::new(),
            history_index: None,
            workspace,
            project_id: String::new(),
            provider: options.provider.clone().unwrap_or_default(),
            model: options.model.clone().unwrap_or_default(),
            mode: options.mode.clone().unwrap_or_else(|| "chat".to_string()),
            status: "Starting shared runtime…".to_string(),
            running: false,
            should_quit: false,
            interaction: None,
            scroll: 0,
            last_error: None,
            pending_requests: HashMap::new(),
            current_session_id: None,
            last_user_message: None,
            config_path: options.config_path.clone(),
        }
    }

    fn initialize(&mut self) -> Result<()> {
        self.last_error = None;
        let request_id = self.bridge.request(
            "initialize",
            json!({
                "workspacePath": self.workspace,
                "projectId": self.project_id,
                "agentType": self.mode,
                "providerId": self.provider,
                "modelId": self.model,
                "configPath": self.config_path,
            }),
        )?;
        self.pending_requests
            .insert(request_id.clone(), "initialize".to_string());
        let deadline = Instant::now() + Duration::from_secs(60);
        while Instant::now() < deadline {
            let Some(message) = self.bridge.receive(Duration::from_millis(250)) else {
                continue;
            };
            let response_id = message
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string);
            let is_response = message.get("type").and_then(Value::as_str) == Some("response");
            self.handle_message(message);
            if is_response && response_id.as_deref() == Some(request_id.as_str()) {
                if self.last_error.is_some() {
                    return Err(anyhow!(self
                        .last_error
                        .clone()
                        .unwrap_or_else(|| "runtime initialization failed".to_string())));
                }
                return Ok(());
            }
        }
        Err(anyhow!("timed out while initializing the shared runtime"))
    }

    fn handle_message(&mut self, message: Value) {
        match message.get("type").and_then(Value::as_str) {
            Some("response") => self.handle_response(&message),
            Some("event")
                if message.get("event").and_then(Value::as_str) == Some("host_request") =>
            {
                if let Err(error) = self.bridge.handle_host_request(&message) {
                    self.push(
                        TranscriptKind::Error,
                        format!("PTY host request failed: {error}"),
                    );
                }
            }
            Some("event") => self.handle_event(&message),
            _ => {}
        }
    }

    fn handle_response(&mut self, message: &Value) {
        let request_id = message
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let request_method = self.pending_requests.remove(&request_id);
        if message.get("ok").and_then(Value::as_bool) == Some(false) {
            let error = message
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("runtime request failed");
            self.last_error = Some(error.to_string());
            self.push(TranscriptKind::Error, error.to_string());
            self.status = "Runtime request failed".to_string();
            self.running = false;
            return;
        }
        self.last_error = None;
        let result = message.get("result").unwrap_or(&Value::Null);
        match request_method.as_deref() {
            Some("initialize") | Some("set_mode") | Some("set_config") | Some("project_switch") => {
                self.apply_runtime_ready(result)
            }
            Some("session_list") => self.apply_session_list(result),
            Some("project_list") => self.apply_project_list(result),
            Some("diagnostics") => self.apply_diagnostics(result),
            Some("session_load") | Some("session_new") => {
                self.apply_session(result);
                if request_method.as_deref() == Some("session_new") {
                    self.status = "New session".to_string();
                }
            }
            Some("send_message") => self.running = false,
            _ => {}
        }
    }

    fn handle_event(&mut self, message: &Value) {
        let event = message
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = message.get("payload").unwrap_or(&Value::Null);
        match event {
            "runtime_ready" => self.apply_runtime_ready(payload),
            "harness_event" => self.apply_harness_event(payload),
            "interaction" => self.apply_interaction(payload),
            "diagnostic" => {
                let level = payload
                    .get("level")
                    .and_then(Value::as_str)
                    .unwrap_or("info");
                let text = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if level == "error" {
                    self.push(TranscriptKind::Error, text.to_string());
                } else if !text.is_empty() {
                    self.status = text.to_string();
                }
            }
            "session_updated" => self.apply_session(payload),
            "fatal" => {
                let text = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("runtime bridge failed");
                self.push(TranscriptKind::Error, text.to_string());
                self.last_error = Some(text.to_string());
                self.running = false;
            }
            _ => {}
        }
    }

    fn apply_runtime_ready(&mut self, payload: &Value) {
        self.workspace = payload
            .get("workspacePath")
            .and_then(Value::as_str)
            .unwrap_or(&self.workspace)
            .to_string();
        self.project_id = payload
            .get("projectId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.mode = payload
            .get("activeAgentType")
            .and_then(Value::as_str)
            .unwrap_or("chat")
            .to_string();
        self.provider = payload
            .get("activeProviderId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.model = payload
            .get("activeModelId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.status = if self.provider.is_empty() {
            "No configured provider".to_string()
        } else {
            "Ready".to_string()
        };
        if let Some(session) = payload.get("session") {
            self.apply_session(session);
        }
    }

    fn apply_session(&mut self, session: &Value) {
        let Some(session_id) = session.get("id").and_then(Value::as_str) else {
            return;
        };
        self.current_session_id = Some(session_id.to_string());
        self.transcript.clear();
        if let Some(messages) = session.get("messages").and_then(Value::as_array) {
            for message in messages {
                self.apply_session_message(message);
            }
        }
        self.scroll = 0;
    }

    fn apply_session_message(&mut self, message: &Value) {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(blocks) = message.get("content").and_then(Value::as_array) else {
            return;
        };
        if role == "user" {
            let text = blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                self.last_user_message = Some(text.clone());
                self.push(TranscriptKind::User, text);
            }
            return;
        }
        self.apply_transcript_blocks(&Value::Array(blocks.clone()));
    }

    fn apply_session_list(&mut self, result: &Value) {
        let Some(sessions) = result.as_array() else {
            return;
        };
        if sessions.is_empty() {
            self.push(
                TranscriptKind::System,
                "No saved sessions for this workspace.".to_string(),
            );
            return;
        }
        for session in sessions {
            let id = session
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let title = session
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled");
            let count = session
                .get("messageCount")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            self.push(
                TranscriptKind::System,
                format!("{id} · {title} · {count} messages"),
            );
        }
    }

    fn apply_project_list(&mut self, result: &Value) {
        let Some(projects) = result.as_array() else {
            self.push(
                TranscriptKind::Error,
                "Project list response was invalid".to_string(),
            );
            return;
        };
        if projects.is_empty() {
            self.push(TranscriptKind::System, "No saved projects.".to_string());
            return;
        }
        for project in projects {
            self.push(TranscriptKind::System, format_project_summary(project));
        }
    }

    fn apply_diagnostics(&mut self, result: &Value) {
        let Some(diagnostics) = result.as_array() else {
            self.push(
                TranscriptKind::Error,
                "Diagnostics response was invalid".to_string(),
            );
            return;
        };
        if diagnostics.is_empty() {
            self.push(TranscriptKind::System, "No diagnostics found.".to_string());
            return;
        }
        for diagnostic in diagnostics {
            let (kind, text) = format_diagnostic(diagnostic);
            self.push(kind, text);
        }
    }

    fn apply_harness_event(&mut self, payload: &Value) {
        match payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "turn_start" => {
                self.running = true;
                let iteration = payload
                    .get("iteration")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.status = format!("Working · iteration {iteration}");
            }
            "stream_chunk" => self.apply_stream_chunk(payload.get("chunk").unwrap_or(&Value::Null)),
            "transcript_message" => {
                self.apply_transcript_blocks(payload.get("blocks").unwrap_or(&Value::Null))
            }
            "assistant_segment_end" => self.push(TranscriptKind::Assistant, String::new()),
            "tool_call_start" => {
                let name = payload
                    .get("toolName")
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                let input = payload.get("input").map(format_json).unwrap_or_default();
                self.push(TranscriptKind::Tool, format!("{name} {input}"));
            }
            "tool_call_result" => {
                let name = payload
                    .get("toolName")
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                let result = payload.get("result").map(format_json).unwrap_or_default();
                self.push(TranscriptKind::Result, format!("{name} → {result}"));
            }
            "terminal_progress" => {
                let progress = payload
                    .get("progress")
                    .and_then(|value| value.get("chunk"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !progress.is_empty() {
                    self.append_last(TranscriptKind::Tool, progress);
                }
            }
            "retry_scheduled" => {
                let attempt = payload.get("attempt").and_then(Value::as_u64).unwrap_or(0);
                self.status = format!("Retry scheduled · attempt {attempt}");
            }
            "connection_state_changed" => {
                self.status = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| {
                        payload
                            .get("state")
                            .and_then(Value::as_str)
                            .unwrap_or("connection state changed")
                    })
                    .to_string();
            }
            "turn_recoverable_error" => {
                self.status =
                    "Recoverable provider error — use /retry or send a follow-up".to_string()
            }
            "turn_end" => {
                self.running = false;
                self.status = payload
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("complete")
                    .to_string();
            }
            "context_overflow" => {
                self.status = "Context was compacted to fit the model budget".to_string()
            }
            _ => {}
        }
    }

    fn apply_stream_chunk(&mut self, chunk: &Value) {
        match chunk
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "text_delta" => self.append_last(
                TranscriptKind::Assistant,
                chunk
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
            "thinking_delta" => self.append_last(
                TranscriptKind::Thinking,
                chunk
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
            "tool_call_start" => {
                let name = chunk.get("name").and_then(Value::as_str).unwrap_or("tool");
                self.push(TranscriptKind::Tool, format!("{name} (provider tool call)"));
            }
            "error" => {
                let error = chunk
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("provider stream failed");
                self.push(TranscriptKind::Error, error.to_string());
            }
            _ => {}
        }
    }

    fn apply_transcript_blocks(&mut self, blocks: &Value) {
        let Some(blocks) = blocks.as_array() else {
            return;
        };
        for block in blocks {
            match block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "text" => self.append_last(
                    TranscriptKind::Assistant,
                    block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                ),
                "thinking" => self.append_last(
                    TranscriptKind::Thinking,
                    block
                        .get("thinking")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                ),
                "tool_call" => self.push(
                    TranscriptKind::Tool,
                    format!(
                        "{} {}",
                        block.get("name").and_then(Value::as_str).unwrap_or("tool"),
                        format_json(block.get("input").unwrap_or(&Value::Null))
                    ),
                ),
                "tool_result" => self.push(
                    TranscriptKind::Result,
                    block
                        .get("output")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                ),
                _ => {}
            }
        }
    }

    fn apply_interaction(&mut self, payload: &Value) {
        let kind = payload
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match kind {
            "approval" => {
                let tool = payload.get("toolCall").unwrap_or(&Value::Null);
                self.interaction = Some(Interaction::Approval {
                    request_id: payload
                        .get("requestId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    tool_name: tool
                        .get("toolName")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string(),
                    description: tool
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    risk: tool
                        .get("riskLevel")
                        .and_then(Value::as_str)
                        .unwrap_or("moderate")
                        .to_string(),
                });
                self.status = "Approval required · y allow · n deny · t trust tool".to_string();
            }
            "mode_switch" => {
                self.interaction = Some(Interaction::ModeSwitch {
                    request_id: payload
                        .get("requestId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    from: payload
                        .get("fromMode")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    to: payload
                        .get("toMode")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    reason: payload
                        .get("reason")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                });
                self.status = "Mode switch requested · y allow · n deny".to_string();
            }
            "question" => {
                let question = payload
                    .get("questions")
                    .and_then(Value::as_array)
                    .and_then(|items| items.first())
                    .and_then(|item| item.get("question"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.interaction = Some(Interaction::Question {
                    request_id: payload
                        .get("requestId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    title: payload
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("Agent question")
                        .to_string(),
                    question: question.to_string(),
                });
                self.status = "Agent is waiting for an answer".to_string();
            }
            _ => {}
        }
    }

    fn handle_key(&mut self, key: KeyEvent) -> Result<()> {
        if key.kind == KeyEventKind::Release {
            return Ok(());
        }
        let key = normalize_input_key(key);
        if let Some(interaction) = self.interaction.clone() {
            return self.handle_interaction_key(key, &interaction);
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) {
            match key.code {
                KeyCode::Char('c') => {
                    if self.running {
                        self.send_simple("cancel", json!({}))?;
                        self.status = "Cancellation requested".to_string();
                    } else if self.input.is_empty() {
                        self.should_quit = true;
                    } else {
                        self.input.clear();
                        self.input_cursor = 0;
                    }
                }
                KeyCode::Char('u') => {
                    self.input.clear();
                    self.input_cursor = 0;
                }
                KeyCode::Char('w') => delete_previous_word(&mut self.input, &mut self.input_cursor),
                _ => {}
            }
            return Ok(());
        }
        match key.code {
            KeyCode::Enter => self.submit_input()?,
            KeyCode::Esc => {
                if self.running {
                    self.send_simple("cancel", json!({}))?;
                    self.status = "Cancellation requested".to_string();
                } else {
                    self.input.clear();
                    self.input_cursor = 0;
                }
            }
            KeyCode::Char(character) => self.insert_char(character),
            KeyCode::Backspace => self.delete_previous_char(),
            KeyCode::Delete => self.delete_next_char(),
            KeyCode::Left => self.input_cursor = self.input_cursor.saturating_sub(1),
            KeyCode::Right => {
                self.input_cursor = (self.input_cursor + 1).min(self.input.chars().count())
            }
            KeyCode::Home => self.input_cursor = 0,
            KeyCode::End => self.input_cursor = self.input.chars().count(),
            KeyCode::Up => self.history_previous(),
            KeyCode::Down => self.history_next(),
            KeyCode::PageUp => self.scroll = self.scroll.saturating_add(5),
            KeyCode::PageDown => self.scroll = self.scroll.saturating_sub(5),
            _ => {}
        }
        Ok(())
    }

    fn handle_paste(&mut self, text: &str) {
        for character in text.chars() {
            self.insert_char(if character == '\r' || character == '\n' {
                ' '
            } else {
                character
            });
        }
    }

    fn handle_interaction_key(&mut self, key: KeyEvent, interaction: &Interaction) -> Result<()> {
        match interaction {
            Interaction::Approval { request_id, tool_name, .. } => match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') => self.resolve_interaction(request_id, json!({ "requestId": request_id, "approved": true }))?,
                KeyCode::Char('n') | KeyCode::Char('N') => self.resolve_interaction(request_id, json!({ "requestId": request_id, "approved": false }))?,
                KeyCode::Char('t') | KeyCode::Char('T') => self.resolve_interaction(request_id, json!({ "requestId": request_id, "approved": true, "trustTool": true, "toolName": tool_name }))?,
                _ => {}
            },
            Interaction::ModeSwitch { request_id, .. } => match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') => self.resolve_interaction(request_id, json!({ "requestId": request_id, "approved": true }))?,
                KeyCode::Char('n') | KeyCode::Char('N') => self.resolve_interaction(request_id, json!({ "requestId": request_id, "approved": false }))?,
                _ => {}
            },
            Interaction::Question { request_id, .. } => {
                if key.code == KeyCode::Enter {
                    let answer = std::mem::take(&mut self.input);
                    self.input_cursor = 0;
                    self.resolve_interaction(request_id, json!({ "requestId": request_id, "answers": [{ "id": "answer", "answer": answer }] }))?;
                } else if let KeyCode::Char(character) = key.code { self.insert_char(character); }
                else if key.code == KeyCode::Backspace { self.delete_previous_char(); }
                else if key.code == KeyCode::Delete { self.delete_next_char(); }
                else if key.code == KeyCode::Left { self.input_cursor = self.input_cursor.saturating_sub(1); }
                else if key.code == KeyCode::Right { self.input_cursor = (self.input_cursor + 1).min(self.input.chars().count()); }
                else if key.code == KeyCode::Home { self.input_cursor = 0; }
                else if key.code == KeyCode::End { self.input_cursor = self.input.chars().count(); }
            }
        }
        Ok(())
    }

    fn submit_input(&mut self) -> Result<()> {
        let input = self.input.trim().to_string();
        self.input.clear();
        self.input_cursor = 0;
        self.history_index = None;
        if input.is_empty() || self.running {
            return Ok(());
        }
        self.input_history.push(input.clone());
        if input.starts_with('/') {
            return self.command(input);
        }
        self.last_user_message = Some(input.clone());
        self.push(TranscriptKind::User, input.clone());
        self.send_simple("send_message", json!({ "message": input }))?;
        self.running = true;
        self.status = "Working…".to_string();
        Ok(())
    }

    fn insert_char(&mut self, character: char) {
        let byte_index = self
            .input
            .char_indices()
            .nth(self.input_cursor)
            .map(|(index, _)| index)
            .unwrap_or(self.input.len());
        self.input.insert(byte_index, character);
        self.input_cursor += 1;
    }

    fn delete_previous_char(&mut self) {
        if self.input_cursor == 0 {
            return;
        }
        let start = self
            .input
            .char_indices()
            .nth(self.input_cursor - 1)
            .map(|(index, _)| index);
        let end = self
            .input
            .char_indices()
            .nth(self.input_cursor)
            .map(|(index, _)| index)
            .unwrap_or(self.input.len());
        if let Some(start) = start {
            self.input.replace_range(start..end, "");
            self.input_cursor -= 1;
        }
    }

    fn delete_next_char(&mut self) {
        let Some(start) = self
            .input
            .char_indices()
            .nth(self.input_cursor)
            .map(|(index, _)| index)
        else {
            return;
        };
        let end = self
            .input
            .char_indices()
            .nth(self.input_cursor + 1)
            .map(|(index, _)| index)
            .unwrap_or(self.input.len());
        self.input.replace_range(start..end, "");
    }

    fn command(&mut self, input: String) -> Result<()> {
        let mut parts = input.split_whitespace();
        let command = parts.next().unwrap_or_default();
        match command {
            "/help" => self.push(TranscriptKind::System, "/mode <chat|build|review|debug|plan> · /model <provider> <model> · /projects · /project <path> · /new · /sessions · /load <id> · /diagnostics [path] · /retry · /cancel · /quit".to_string()),
            "/mode" => {
                let mode = parts.next().unwrap_or("chat");
                self.send_simple("set_mode", json!({ "agentType": mode }))?;
                self.mode = mode.to_string();
                self.status = format!("Mode set to {mode}");
            }
            "/model" => {
                let provider = parts.next().unwrap_or_default();
                let model = parts.collect::<Vec<_>>().join(" ");
                self.send_simple("set_config", json!({ "providerId": provider, "modelId": model }))?;
                self.provider = provider.to_string();
                self.model = model;
            }
            "/new" => {
                self.send_simple("session_new", json!({}))?;
                self.transcript.clear();
                self.last_user_message = None;
                self.status = "New session".to_string();
            }
            "/sessions" => { self.send_simple("session_list", json!({}))?; self.status = "Session list requested".to_string(); }
            "/projects" => { self.send_simple("project_list", json!({}))?; self.status = "Project list requested".to_string(); }
            "/project" => {
                let project = command_argument(&input, "/project");
                if project.is_empty() {
                    self.push(TranscriptKind::System, "Usage: /project <workspace-path>".to_string());
                } else {
                    self.send_simple("project_switch", json!({ "workspacePath": project }))?;
                    self.status = format!("Switching project to {project}");
                }
            }
            "/load" => {
                let id = parts.next().unwrap_or_default();
                if id.is_empty() { self.push(TranscriptKind::System, "Usage: /load <session-id>".to_string()); }
                else { self.send_simple("session_load", json!({ "id": id }))?; self.status = format!("Loading session {id}"); }
            }
            "/cancel" => { self.send_simple("cancel", json!({}))?; self.status = "Cancellation requested".to_string(); }
            "/diagnostics" => {
                let file = command_argument(&input, "/diagnostics");
                self.send_simple("diagnostics", if file.is_empty() { json!({}) } else { json!({ "path": file }) })?;
                self.status = "Diagnostics requested".to_string();
            }
            "/quit" | "/exit" => self.should_quit = true,
            "/retry" => {
                if let Some(message) = self.last_user_message.clone() {
                    self.send_simple("send_message", json!({ "message": message }))?;
                    self.running = true;
                } else { self.push(TranscriptKind::System, "There is no previous user message to retry.".to_string()); }
            }
            _ => self.push(TranscriptKind::System, format!("Unknown command: {command}. Use /help.")),
        }
        Ok(())
    }

    fn send_simple(&mut self, method: &str, params: Value) -> Result<()> {
        self.last_error = None;
        let request_id = self.bridge.request(method, params)?;
        self.pending_requests.insert(request_id, method.to_string());
        Ok(())
    }

    fn resolve_interaction(&mut self, request_id: &str, params: Value) -> Result<()> {
        self.send_simple("resolve_interaction", params)?;
        self.interaction = None;
        self.input.clear();
        self.input_cursor = 0;
        self.status = format!("Interaction resolved: {request_id}");
        Ok(())
    }

    fn history_previous(&mut self) {
        if self.input_history.is_empty() {
            return;
        }
        let next = self
            .history_index
            .map_or(self.input_history.len().saturating_sub(1), |index| {
                index.saturating_sub(1)
            });
        self.history_index = Some(next);
        self.input = self.input_history[next].clone();
        self.input_cursor = self.input.chars().count();
    }

    fn history_next(&mut self) {
        let Some(index) = self.history_index else {
            return;
        };
        if index + 1 >= self.input_history.len() {
            self.history_index = None;
            self.input.clear();
            self.input_cursor = 0;
        } else {
            self.history_index = Some(index + 1);
            self.input = self.input_history[index + 1].clone();
            self.input_cursor = self.input.chars().count();
        }
    }

    fn push(&mut self, kind: TranscriptKind, text: String) {
        if text.is_empty() {
            return;
        }
        self.transcript.push_back(TranscriptItem { kind, text });
        while self.transcript.len() > 500 {
            self.transcript.pop_front();
        }
        self.scroll = 0;
    }

    fn append_last(&mut self, kind: TranscriptKind, text: &str) {
        if text.is_empty() {
            return;
        }
        if let Some(last) = self.transcript.back_mut() {
            if std::mem::discriminant(&last.kind) == std::mem::discriminant(&kind) {
                last.text.push_str(text);
                if last.text.len() > MAX_TRANSCRIPT_CHARS {
                    last.text = last.text[last.text.len() - MAX_TRANSCRIPT_CHARS..].to_string();
                }
                return;
            }
        }
        self.push(kind, text.to_string());
    }

    fn draw(&mut self, terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
        terminal.draw(|frame| {
            let layout = Layout::default()
                .direction(Direction::Vertical)
                .constraints(
                    [
                        Constraint::Length(2),
                        Constraint::Min(4),
                        Constraint::Length(3),
                    ]
                    .as_ref(),
                )
                .split(frame.area());
            let header = Paragraph::new(Line::from(vec![
                Span::styled(
                    " HysCode ",
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(format!(
                    "  {}  ·  {}  ·  {}",
                    self.mode,
                    if self.provider.is_empty() {
                        "no provider"
                    } else {
                        &self.provider
                    },
                    if self.model.is_empty() {
                        "no model"
                    } else {
                        &self.model
                    }
                )),
            ]))
            .block(
                Block::default()
                    .borders(Borders::BOTTOM)
                    .border_style(Style::default().fg(Color::DarkGray)),
            );
            frame.render_widget(header, layout[0]);

            let transcript_area = layout[1];
            let lines = self.transcript_lines(transcript_area.width.saturating_sub(2));
            let transcript = Paragraph::new(Text::from(lines))
                .scroll((self.scroll, 0))
                .wrap(Wrap { trim: false })
                .block(
                    Block::default()
                        .title(" Conversation ")
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(Color::DarkGray)),
                );
            frame.render_widget(transcript, transcript_area);

            let input_title = if self.interaction.is_some() {
                " Response "
            } else {
                " Message · Enter send · Ctrl-C cancel/quit · /help "
            };
            let input = Paragraph::new(self.input.as_str()).block(
                Block::default()
                    .title(input_title)
                    .borders(Borders::ALL)
                    .border_style(if self.interaction.is_some() {
                        Style::default().fg(Color::Yellow)
                    } else {
                        Style::default().fg(Color::Cyan)
                    }),
            );
            frame.render_widget(input, layout[2]);
            let cursor_x = layout[2].x + 1 + self.input_cursor as u16;
            frame.set_cursor_position((
                cursor_x.min(layout[2].right().saturating_sub(1)),
                layout[2].y + 1,
            ));

            if let Some(interaction) = &self.interaction {
                self.draw_interaction(frame, interaction, frame.area());
            }
        })?;
        Ok(())
    }

    fn transcript_lines(&self, width: u16) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        for item in &self.transcript {
            let (prefix, color) = match item.kind {
                TranscriptKind::User => ("you", Color::Green),
                TranscriptKind::Assistant => ("agent", Color::Cyan),
                TranscriptKind::Thinking => ("thinking", Color::Magenta),
                TranscriptKind::Tool => ("tool", Color::Yellow),
                TranscriptKind::Result => ("result", Color::Gray),
                TranscriptKind::System => ("system", Color::Blue),
                TranscriptKind::Error => ("error", Color::Red),
            };
            lines.push(Line::from(Span::styled(
                format!("{prefix}> {}", item.text),
                Style::default().fg(color),
            )));
            if item.text.len() > usize::from(width).saturating_mul(2) {
                lines.push(Line::from("  …"));
            }
        }
        lines
    }

    fn draw_interaction(&self, frame: &mut ratatui::Frame, interaction: &Interaction, area: Rect) {
        let height = match interaction {
            Interaction::Question { .. } => 7,
            _ => 6,
        };
        let width = area.width.saturating_sub(8).min(100);
        let x = area.x + area.width.saturating_sub(width) / 2;
        let y = area.y + area.height.saturating_sub(height + 4) / 2;
        let popup = Rect {
            x,
            y,
            width,
            height,
        };
        frame.render_widget(Clear, popup);
        let text = match interaction {
            Interaction::Approval { tool_name, description, risk, .. } => format!("Approval required\n\nTool: {tool_name}\nRisk: {risk}\n{description}\n\ny allow · n deny · t allow and trust"),
            Interaction::ModeSwitch { from, to, reason, .. } => format!("Agent mode switch\n\n{from} → {to}\n{reason}\n\ny allow · n deny"),
            Interaction::Question { title, question, .. } => format!("{title}\n\n{question}\n\nType the answer below and press Enter"),
        };
        let widget = Paragraph::new(text).wrap(Wrap { trim: true }).block(
            Block::default()
                .title(" Agent interaction ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Yellow)),
        );
        frame.render_widget(widget, popup);
    }

    fn poll_bridge(&mut self) {
        while let Some(message) = self.bridge.try_receive() {
            self.handle_message(message);
        }
        if !self.bridge.is_running() && !self.should_quit {
            self.push(
                TranscriptKind::Error,
                "Runtime bridge exited unexpectedly".to_string(),
            );
            self.should_quit = true;
        }
    }
}

fn run_app(mut app: App) -> Result<()> {
    if let Err(error) = app.initialize() {
        app.bridge.stop();
        return Err(error);
    }
    enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableBracketedPaste)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let result = (|| -> Result<()> {
        loop {
            app.poll_bridge();
            app.draw(&mut terminal)?;
            if app.should_quit {
                break;
            }
            if let Some(input_event) = input::poll(Duration::from_millis(50))? {
                match input_event {
                    InputEvent::Key(key) => app.handle_key(key)?,
                    InputEvent::Paste(text) => app.handle_paste(&text),
                }
            }
        }
        Ok(())
    })();
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        DisableBracketedPaste,
        LeaveAlternateScreen
    )?;
    terminal.show_cursor()?;
    app.bridge.stop();
    result
}

fn normalize_input_key(mut key: KeyEvent) -> KeyEvent {
    if key.code == KeyCode::Char('/') {
        // AltGr is reported as Ctrl+Alt by some Windows keyboard layouts. It is still a text
        // character here, not one of the TUI's control shortcuts.
        key.modifiers
            .remove(KeyModifiers::CONTROL | KeyModifiers::ALT);
    }
    key
}

fn delete_previous_word(input: &mut String, cursor: &mut usize) {
    while *cursor > 0
        && input
            .chars()
            .nth(*cursor - 1)
            .is_some_and(char::is_whitespace)
    {
        remove_char_before_cursor(input, cursor);
    }
    while *cursor > 0
        && input
            .chars()
            .nth(*cursor - 1)
            .is_some_and(|character| !character.is_whitespace())
    {
        remove_char_before_cursor(input, cursor);
    }
}

fn remove_char_before_cursor(input: &mut String, cursor: &mut usize) {
    if *cursor == 0 {
        return;
    }
    let start = input
        .char_indices()
        .nth(*cursor - 1)
        .map(|(index, _)| index);
    let end = input
        .char_indices()
        .nth(*cursor)
        .map(|(index, _)| index)
        .unwrap_or(input.len());
    if let Some(start) = start {
        input.replace_range(start..end, "");
        *cursor -= 1;
    }
}

fn command_argument(input: &str, command: &str) -> String {
    input
        .strip_prefix(command)
        .unwrap_or_default()
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn format_project_summary(project: &Value) -> String {
    let path = project
        .get("workspacePath")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let sessions = project
        .get("sessionCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    format!("{path} · {sessions} session(s)")
}

fn format_diagnostic(diagnostic: &Value) -> (TranscriptKind, String) {
    let file = diagnostic
        .get("file")
        .and_then(Value::as_str)
        .unwrap_or("workspace");
    let line = diagnostic.get("line").and_then(Value::as_u64).unwrap_or(1);
    let column = diagnostic.get("col").and_then(Value::as_u64).unwrap_or(1);
    let severity = diagnostic
        .get("severity")
        .and_then(Value::as_str)
        .unwrap_or("error");
    let message = diagnostic
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("diagnostic");
    let kind = if severity == "error" {
        TranscriptKind::Error
    } else {
        TranscriptKind::System
    };
    (
        kind,
        format!("{file}:{line}:{column} [{severity}] {message}"),
    )
}

fn parse_bridge_line(line: &str) -> Option<Value> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    serde_json::from_str(line).ok()
}

fn format_json(value: &Value) -> String {
    let text = serde_json::to_string(value).unwrap_or_else(|_| "<unserializable>".to_string());
    if text.chars().count() > 2000 {
        format!("{}…", text.chars().take(2000).collect::<String>())
    } else {
        text
    }
}

fn parse_args() -> Result<Option<CliOptions>> {
    let mut arguments = env::args().skip(1);
    let mut workspace = None;
    let mut provider = None;
    let mut model = None;
    let mut mode = None;
    let mut config_path = None;

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "-h" | "--help" => {
                println!(
                    "HysCode TUI\n\nUsage: hyscode-tui [workspace] [options]\n\nOptions:\n  -h, --help                 Show this help\n  -V, --version              Show the client version\n      --provider <id>        Override the shared active provider\n      --model <id>           Override the shared active model\n      --mode <mode>           Start in chat, build, review, debug, or plan mode\n      --config <path>         Read the shared settings JSON from this path\n\nThe TUI uses the same HysCode harness, providers, MCP servers, keychain, and\nagent modes as the desktop client."
                );
                return Ok(None);
            }
            "-V" | "--version" => {
                println!("hyscode-tui {}", env!("CARGO_PKG_VERSION"));
                return Ok(None);
            }
            "--provider" => {
                provider = Some(arguments.next().context("--provider requires a value")?)
            }
            "--model" => model = Some(arguments.next().context("--model requires a value")?),
            "--mode" => mode = Some(arguments.next().context("--mode requires a value")?),
            "--config" => {
                config_path = Some(arguments.next().context("--config requires a value")?)
            }
            "--workspace" => {
                workspace = Some(PathBuf::from(
                    arguments.next().context("--workspace requires a path")?,
                ))
            }
            value if value.starts_with('-') => {
                return Err(anyhow!("unknown option: {value}. Use --help for usage."))
            }
            value if workspace.is_none() => workspace = Some(PathBuf::from(value)),
            value => {
                return Err(anyhow!(
                    "unexpected argument: {value}. Use --help for usage."
                ))
            }
        }
    }

    Ok(Some(CliOptions {
        workspace: workspace.unwrap_or(env::current_dir()?),
        provider,
        model,
        mode,
        config_path,
    }))
}

fn main() -> Result<()> {
    let Some(options) = parse_args()? else {
        return Ok(());
    };
    let workspace =
        fs::canonicalize(&options.workspace).context("workspace path does not exist")?;
    let bridge = BridgeClient::start()?;
    let app = App::new(bridge, &options, workspace.to_string_lossy().to_string());
    run_app(app)
}

#[cfg(test)]
mod tests {
    use super::{
        command_argument, delete_previous_word, format_diagnostic, format_json,
        format_project_summary, normalize_input_key, parse_bridge_line, TranscriptKind,
    };
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use serde_json::json;

    #[test]
    fn parses_only_non_empty_valid_ndjson_frames() {
        assert!(parse_bridge_line("").is_none());
        assert!(parse_bridge_line("not json").is_none());
        assert_eq!(
            parse_bridge_line(" {\"type\":\"response\"} ")
                .and_then(|value| value.get("type").cloned()),
            Some(json!("response"))
        );
    }

    #[test]
    fn preserves_quoted_command_arguments_and_unicode_word_deletion() {
        assert_eq!(
            command_argument("/project \"C:/A Project\"", "/project"),
            "C:/A Project"
        );
        let mut input = "Olá mundo  ".to_string();
        let mut cursor = input.chars().count();
        delete_previous_word(&mut input, &mut cursor);
        assert_eq!(input, "Olá ");
        assert_eq!(cursor, 4);
    }

    #[test]
    fn projects_diagnostics_into_renderable_transcript_values() {
        assert_eq!(
            format_project_summary(&json!({ "workspacePath": "C:/workspace", "sessionCount": 3 })),
            "C:/workspace · 3 session(s)"
        );
        let (kind, message) = format_diagnostic(
            &json!({ "file": "src/lib.rs", "line": 4, "col": 8, "severity": "error", "message": "mismatched types" }),
        );
        assert!(matches!(kind, TranscriptKind::Error));
        assert_eq!(message, "src/lib.rs:4:8 [error] mismatched types");
        assert!(format_json(&json!({ "message": "ok" })).contains("ok"));
    }

    #[test]
    fn keeps_slash_as_text_even_when_the_layout_reports_altgr_control() {
        let key = normalize_input_key(KeyEvent::new(
            KeyCode::Char('/'),
            KeyModifiers::CONTROL | KeyModifiers::ALT,
        ));
        assert_eq!(key.code, KeyCode::Char('/'));
        assert!(!key.modifiers.contains(KeyModifiers::CONTROL));
        assert!(!key.modifiers.contains(KeyModifiers::ALT));
    }
}
