use anyhow::{Context, Result};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

const MAX_OUTPUT_BYTES: usize = 512_000;

type EventCallback = Arc<dyn Fn(&str, Value) + Send + Sync>;
type SessionHandle = Arc<Mutex<PtySession>>;

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    alive: bool,
    exit_code: Option<i64>,
    output: OutputBuffer,
}

struct OutputBuffer {
    sequence: u64,
    chunks: VecDeque<(u64, String)>,
    bytes: usize,
}

impl OutputBuffer {
    fn new() -> Self {
        Self {
            sequence: 0,
            chunks: VecDeque::new(),
            bytes: 0,
        }
    }

    fn append(&mut self, data: String) -> u64 {
        self.sequence += 1;
        let sequence = self.sequence;
        self.bytes += data.len();
        self.chunks.push_back((sequence, data));
        while self.bytes > MAX_OUTPUT_BYTES && self.chunks.len() > 1 {
            if let Some((_, removed)) = self.chunks.pop_front() {
                self.bytes = self.bytes.saturating_sub(removed.len());
            }
        }
        sequence
    }
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    callback: EventCallback,
    next_id: AtomicU64,
}

impl PtyManager {
    pub fn new(callback: EventCallback) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            callback,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn handle(&self, method: &str, params: &Value) -> Result<Value> {
        match method {
            "pty_spawn" => self.spawn(params),
            "pty_write" => {
                self.write(
                    pty_id(params),
                    params
                        .get("data")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                )?;
                Ok(Value::Null)
            }
            "pty_resize" => {
                self.resize(
                    pty_id(params),
                    number(params, "cols", 120) as u16,
                    number(params, "rows", 32) as u16,
                )?;
                Ok(Value::Null)
            }
            "pty_kill" => {
                self.kill(pty_id(params))?;
                Ok(Value::Null)
            }
            "pty_interrupt" => {
                self.interrupt(pty_id(params))?;
                Ok(Value::Null)
            }
            "pty_exists" => Ok(Value::Bool(self.exists(pty_id(params))?)),
            "pty_snapshot" => {
                Ok(self.snapshot(pty_id(params), number(params, "afterSequence", 0))?)
            }
            _ => anyhow::bail!("Unsupported Rust PTY method: {method}"),
        }
    }

    pub fn shutdown(&self) {
        let ids = self
            .sessions
            .lock()
            .map(|sessions| sessions.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for id in ids {
            let _ = self.kill(&id);
        }
    }

    fn spawn(&self, params: &Value) -> Result<Value> {
        let requested_id = params
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty());
        let id = requested_id
            .map(str::to_string)
            .unwrap_or_else(|| format!("pty-{}", self.next_id.fetch_add(1, Ordering::Relaxed)));
        let shell = params
            .get("shell")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(default_shell);
        let cols = number(params, "cols", 120) as u16;
        let rows = number(params, "rows", 32) as u16;
        let pty = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to open a native PTY")?;
        let mut command = CommandBuilder::new(shell);
        if let Some(cwd) = params
            .get("cwd")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            command.cwd(cwd);
        }
        if let Some(args) = params.get("args").and_then(Value::as_array) {
            for arg in args.iter().filter_map(Value::as_str) {
                command.arg(arg);
            }
        }
        if let Some(env) = params.get("env").and_then(Value::as_object) {
            for (key, value) in env {
                if let Some(value) = value.as_str() {
                    command.env(key, value);
                }
            }
        }

        let mut child = pty
            .slave
            .spawn_command(command)
            .context("failed to spawn PTY process")?;
        drop(pty.slave);
        let reader = pty
            .master
            .try_clone_reader()
            .context("failed to clone PTY reader")?;
        let writer = pty
            .master
            .take_writer()
            .context("failed to take PTY writer")?;
        let killer = child.clone_killer();
        let session = Arc::new(Mutex::new(PtySession {
            writer,
            master: pty.master,
            killer,
            alive: true,
            exit_code: None,
            output: OutputBuffer::new(),
        }));
        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|error| anyhow::anyhow!("PTY registry lock failed: {error}"))?;
            if sessions.contains_key(&id) {
                anyhow::bail!("PTY session already exists: {id}");
            }
            sessions.insert(id.clone(), Arc::clone(&session));
        }

        let reader_session = Arc::clone(&session);
        let reader_callback = Arc::clone(&self.callback);
        let reader_id = id.clone();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0_u8; 4096];
            while let Ok(read) = reader.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                let data = String::from_utf8_lossy(&buffer[..read]).to_string();
                let sequence = reader_session
                    .lock()
                    .ok()
                    .map(|mut session| session.output.append(data.clone()));
                if let Some(sequence) = sequence {
                    reader_callback(
                        "pty:data",
                        json!({ "pty_id": reader_id, "sequence": sequence, "data": data }),
                    );
                }
            }
        });

        let waiter_session = Arc::clone(&session);
        let waiter_callback = Arc::clone(&self.callback);
        let waiter_id = id.clone();
        thread::spawn(move || {
            let exit_code = child
                .wait()
                .ok()
                .map(|status| i64::from(status.exit_code()));
            let sequence = waiter_session
                .lock()
                .ok()
                .map(|mut session| {
                    session.alive = false;
                    session.exit_code = exit_code;
                    session.output.sequence
                })
                .unwrap_or_default();
            waiter_callback(
                "pty:exit",
                json!({ "pty_id": waiter_id, "sequence": sequence, "code": exit_code }),
            );
        });

        Ok(Value::String(id))
    }

    fn write(&self, id: &str, data: &str) -> Result<()> {
        let session = self.session(id)?;
        let mut session = session
            .lock()
            .map_err(|error| anyhow::anyhow!("PTY session lock failed: {error}"))?;
        if !session.alive {
            anyhow::bail!("PTY session is not running: {id}");
        }
        session
            .writer
            .write_all(data.as_bytes())
            .context("failed to write to PTY")?;
        session.writer.flush().context("failed to flush PTY")?;
        Ok(())
    }

    fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        self.session(id)?
            .lock()
            .map_err(|error| anyhow::anyhow!("PTY session lock failed: {error}"))?
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to resize PTY")?;
        Ok(())
    }

    fn interrupt(&self, id: &str) -> Result<()> {
        self.write(id, "\u{3}")
    }

    fn kill(&self, id: &str) -> Result<()> {
        let session = self.session(id)?;
        let mut session = session
            .lock()
            .map_err(|error| anyhow::anyhow!("PTY session lock failed: {error}"))?;
        if session.alive {
            match session.killer.kill() {
                Ok(()) => {}
                // portable-pty 0.8 reads GetLastError before checking the
                // successful TerminateProcess result on Windows. Treat the
                // resulting zero-code error as the successful termination it
                // represents, while preserving real OS failures.
                Err(error) if error.raw_os_error() == Some(0) => {}
                Err(error) => return Err(error).context("failed to terminate PTY process"),
            }
        }
        Ok(())
    }

    fn exists(&self, id: &str) -> Result<bool> {
        Ok(self
            .session(id)?
            .lock()
            .map_err(|error| anyhow::anyhow!("PTY session lock failed: {error}"))?
            .alive)
    }

    fn snapshot(&self, id: &str, after_sequence: u64) -> Result<Value> {
        let session = self.session(id)?;
        let session = session
            .lock()
            .map_err(|error| anyhow::anyhow!("PTY session lock failed: {error}"))?;
        let selected: Vec<&(u64, String)> = session
            .output
            .chunks
            .iter()
            .filter(|(sequence, _)| *sequence > after_sequence)
            .collect();
        let data = selected
            .iter()
            .map(|(_, data)| data.as_str())
            .collect::<String>();
        let from_sequence = selected
            .first()
            .map(|(sequence, _)| *sequence)
            .unwrap_or(after_sequence);
        let truncated = session
            .output
            .chunks
            .front()
            .is_some_and(|(sequence, _)| *sequence > after_sequence + 1);
        Ok(json!({
            "data": data,
            "from_sequence": from_sequence,
            "to_sequence": session.output.sequence,
            "truncated": truncated,
            "alive": session.alive,
            "exit_code": session.exit_code,
        }))
    }

    fn session(&self, id: &str) -> Result<SessionHandle> {
        self.sessions
            .lock()
            .map_err(|error| anyhow::anyhow!("PTY registry lock failed: {error}"))?
            .get(id)
            .cloned()
            .with_context(|| format!("PTY session not found: {id}"))
    }
}

fn pty_id(params: &Value) -> &str {
    params
        .get("ptyId")
        .or_else(|| params.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn number(params: &Value, name: &str, fallback: u64) -> u64 {
    params
        .get(name)
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
        .clamp(1, u16::MAX as u64)
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("ComSpec").unwrap_or_else(|_| "powershell.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::PtyManager;
    use serde_json::json;
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn owns_a_real_pty_with_resize_snapshot_and_interrupt_lifecycle() {
        let (events, receiver) = mpsc::channel::<(String, serde_json::Value)>();
        let manager = PtyManager::new(Arc::new(move |event, payload| {
            let _ = events.send((event.to_string(), payload));
        }));
        let shell = if cfg!(windows) {
            std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        };
        let id = manager
            .handle(
                "pty_spawn",
                &json!({ "id": "pty-fixture", "shell": shell, "cols": 80, "rows": 24 }),
            )
            .expect("PTY should spawn")
            .as_str()
            .expect("PTY id should be a string")
            .to_string();
        manager
            .handle(
                "pty_resize",
                &json!({ "ptyId": id, "cols": 120, "rows": 40 }),
            )
            .expect("PTY should resize");
        let command = if cfg!(windows) {
            "echo HYS_TUI_NATIVE_PTY\r\n"
        } else {
            "printf HYS_TUI_NATIVE_PTY\n"
        };
        manager
            .handle(
                "pty_write",
                &json!({ "ptyId": "pty-fixture", "data": command }),
            )
            .expect("PTY should accept input");

        let mut output = String::new();
        for _ in 0..50 {
            let snapshot = manager
                .handle(
                    "pty_snapshot",
                    &json!({ "ptyId": "pty-fixture", "afterSequence": 0 }),
                )
                .expect("PTY snapshot should work");
            output = snapshot
                .get("data")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string();
            if output.contains("HYS_TUI_NATIVE_PTY") {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            output.contains("HYS_TUI_NATIVE_PTY"),
            "PTY output was: {output:?}"
        );
        manager
            .handle("pty_interrupt", &json!({ "ptyId": id }))
            .expect("PTY should accept interrupt");
        manager
            .handle("pty_kill", &json!({ "ptyId": "pty-fixture" }))
            .expect("PTY should terminate");
        for _ in 0..50 {
            if manager
                .handle("pty_exists", &json!({ "ptyId": "pty-fixture" }))
                .expect("PTY health check should work")
                == serde_json::Value::Bool(false)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(
            manager
                .handle("pty_exists", &json!({ "ptyId": "pty-fixture" }))
                .unwrap(),
            serde_json::Value::Bool(false)
        );
        assert!(receiver.try_iter().any(|(event, _)| event == "pty:data"));
        manager.shutdown();
    }
}
