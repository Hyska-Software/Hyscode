use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const DEFAULT_PTY_COLS: u16 = 80;
const DEFAULT_PTY_ROWS: u16 = 24;
const MAX_PTY_DIMENSION: u16 = 4096;

/// Authoritative state for one PTY. The process lifecycle and replay buffer live
/// here so mounting or unmounting a frontend terminal never owns the process.
pub(crate) struct PtySession {
    pub(crate) writer: Box<dyn Write + Send>,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) killer: Box<dyn ChildKiller + Send + Sync>,
    pub(crate) alive: bool,
    pub(crate) exit_code: Option<u32>,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) output: OutputBuffer,
}

pub(crate) struct OutputBuffer {
    pub(crate) sequence: u64,
    output: VecDeque<(u64, String)>,
    output_bytes: usize,
}

/// Tauri managed PTY registry. Arc allows reader/waiter threads to update the
/// same source of truth used by IPC health checks and snapshots.
pub struct PtyState(pub Arc<Mutex<HashMap<String, PtySession>>>);

#[derive(Clone, Serialize, Deserialize)]
struct PtyDataPayload {
    pty_id: String,
    sequence: u64,
    data: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct PtyExitPayload {
    pty_id: String,
    sequence: u64,
    code: Option<u32>,
}

#[derive(Clone, Serialize)]
pub struct PtySnapshot {
    data: String,
    from_sequence: u64,
    to_sequence: u64,
    truncated: bool,
    alive: bool,
    exit_code: Option<u32>,
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        if which_exists("pwsh.exe") {
            return "pwsh.exe".to_string();
        }
        "powershell.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

#[cfg(target_os = "windows")]
fn which_exists(name: &str) -> bool {
    use super::utils::cmd;
    cmd("where")
        .arg(name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

impl OutputBuffer {
    pub(crate) fn new() -> Self {
        Self {
            sequence: 0,
            output: VecDeque::new(),
            output_bytes: 0,
        }
    }

    pub(crate) fn append(&mut self, data: String) -> u64 {
        self.sequence += 1;
        let sequence = self.sequence;
        self.output_bytes += data.len();
        self.output.push_back((sequence, data));

        while self.output_bytes > MAX_OUTPUT_BYTES {
            if let Some((_, removed)) = self.output.pop_front() {
                self.output_bytes = self.output_bytes.saturating_sub(removed.len());
            } else {
                break;
            }
        }
        sequence
    }
}

#[tauri::command]
pub async fn pty_spawn(
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
    _interactive: Option<bool>,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<String, String> {
    let cols = normalize_dimension(cols, DEFAULT_PTY_COLS);
    let rows = normalize_dimension(rows, DEFAULT_PTY_ROWS);
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to open PTY: {error}"))?;

    let shell_path = shell.unwrap_or_else(default_shell);
    let mut command = CommandBuilder::new(&shell_path);
    if let Some(ref directory) = cwd {
        command.cwd(directory);
    }
    let mut environment = env.unwrap_or_default();
    environment
        .entry("TERM".to_string())
        .or_insert_with(|| "xterm-256color".to_string());
    environment
        .entry("COLORTERM".to_string())
        .or_insert_with(|| "truecolor".to_string());
    environment
        .entry("TERM_PROGRAM".to_string())
        .or_insert_with(|| "HysCode".to_string());
    for (key, value) in &environment {
        command.env(key, value);
    }

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to spawn shell `{shell_path}`: {error}"))?;
    drop(pair.slave);

    let pty_id = uuid::Uuid::new_v4().to_string();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Failed to clone PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Failed to take PTY writer: {error}"))?;
    let killer = child.clone_killer();
    let (reader_done_tx, reader_done_rx) = mpsc::channel();

    state
        .0
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?
        .insert(
            pty_id.clone(),
            PtySession {
                writer,
                master: pair.master,
                killer,
                alive: true,
                exit_code: None,
                cols,
                rows,
                output: OutputBuffer::new(),
            },
        );

    let reader_id = pty_id.clone();
    let reader_state = Arc::clone(&state.0);
    let reader_app = app.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    let data = String::from_utf8_lossy(&buffer[..length]).to_string();
                    let sequence = reader_state.lock().ok().and_then(|mut sessions| {
                        sessions
                            .get_mut(&reader_id)
                            .map(|session| session.output.append(data.clone()))
                    });
                    if let Some(sequence) = sequence {
                        let _ = reader_app.emit(
                            "pty:data",
                            PtyDataPayload {
                                pty_id: reader_id.clone(),
                                sequence,
                                data,
                            },
                        );
                    }
                }
            }
        }
        let _ = reader_done_tx.send(());
    });

    let waiter_id = pty_id.clone();
    let waiter_state = Arc::clone(&state.0);
    std::thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code());
        // A child can exit before the PTY reader has committed its last bytes.
        // Give that reader a bounded drain window before publishing the exit
        // event; the snapshot path remains the fallback if the reader stalls.
        let _ = reader_done_rx.recv_timeout(Duration::from_millis(250));
        let sequence = waiter_state
            .lock()
            .ok()
            .and_then(|mut sessions| {
                sessions.get_mut(&waiter_id).map(|session| {
                    session.alive = false;
                    session.exit_code = exit_code;
                    session.output.sequence
                })
            })
            .unwrap_or_default();
        let _ = app.emit(
            "pty:exit",
            PtyExitPayload {
                pty_id: waiter_id,
                sequence,
                code: exit_code,
            },
        );
    });

    Ok(pty_id)
}

#[tauri::command]
pub async fn pty_write(
    pty_id: String,
    data: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let mut sessions = state
        .0
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    let session = sessions
        .get_mut(&pty_id)
        .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
    if !session.alive {
        return Err(format!("PTY session is not running: {pty_id}"));
    }
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Write error: {error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("Flush error: {error}"))
}

#[tauri::command]
pub async fn pty_resize(
    pty_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let mut sessions = state
        .0
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    let session = sessions
        .get_mut(&pty_id)
        .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
    let cols = normalize_dimension(Some(cols), DEFAULT_PTY_COLS);
    let rows = normalize_dimension(Some(rows), DEFAULT_PTY_ROWS);
    if session.cols == cols && session.rows == rows {
        return Ok(());
    }
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Resize error: {error}"))?;
    session.cols = cols;
    session.rows = rows;
    Ok(())
}

fn normalize_dimension(value: Option<u16>, fallback: u16) -> u16 {
    value.unwrap_or(fallback).clamp(1, MAX_PTY_DIMENSION)
}

#[tauri::command]
pub async fn pty_exists(pty_id: String, state: State<'_, PtyState>) -> Result<bool, String> {
    let sessions = state
        .0
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    Ok(sessions.get(&pty_id).is_some_and(|session| session.alive))
}

#[tauri::command]
pub async fn pty_snapshot(
    pty_id: String,
    after_sequence: Option<u64>,
    state: State<'_, PtyState>,
) -> Result<PtySnapshot, String> {
    let sessions = state
        .0
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
    let requested = after_sequence.unwrap_or_default();
    let first_available = session
        .output
        .output
        .front()
        .map(|(sequence, _)| *sequence)
        .unwrap_or(session.output.sequence);
    let data = session
        .output
        .output
        .iter()
        .filter(|(sequence, _)| *sequence > requested)
        .map(|(_, chunk)| chunk.as_str())
        .collect::<String>();
    Ok(PtySnapshot {
        data,
        from_sequence: first_available,
        to_sequence: session.output.sequence,
        truncated: snapshot_is_truncated(requested, first_available),
        alive: session.alive,
        exit_code: session.exit_code,
    })
}

fn snapshot_is_truncated(requested: u64, first_available: u64) -> bool {
    first_available.saturating_sub(requested) > 1
}

#[tauri::command]
pub async fn pty_interrupt(pty_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    pty_write(pty_id, "\u{3}".to_string(), state).await
}

#[tauri::command]
pub async fn pty_kill(pty_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut sessions = state
        .0
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    if let Some(mut session) = sessions.remove(&pty_id) {
        session
            .killer
            .kill()
            .map_err(|error| format!("Kill error: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_buffer_is_bounded_and_monotonic() {
        let mut output = OutputBuffer::new();
        assert_eq!(output.append("first".into()), 1);
        assert_eq!(output.append("second".into()), 2);
        assert_eq!(output.sequence, 2);

        output.append("x".repeat(MAX_OUTPUT_BYTES));
        assert!(output.output_bytes <= MAX_OUTPUT_BYTES);
        assert_eq!(output.output.len(), 1);
    }

    #[test]
    fn terminal_dimensions_are_positive_and_bounded() {
        assert_eq!(
            normalize_dimension(None, DEFAULT_PTY_COLS),
            DEFAULT_PTY_COLS
        );
        assert_eq!(normalize_dimension(Some(0), DEFAULT_PTY_COLS), 1);
        assert_eq!(
            normalize_dimension(Some(u16::MAX), DEFAULT_PTY_COLS),
            MAX_PTY_DIMENSION
        );
    }

    #[test]
    fn snapshot_truncation_is_reported_even_for_a_full_replay() {
        assert!(!snapshot_is_truncated(0, 0));
        assert!(!snapshot_is_truncated(0, 1));
        assert!(snapshot_is_truncated(0, 2));
        assert!(!snapshot_is_truncated(5, 6));
        assert!(snapshot_is_truncated(5, 7));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_pty_streams_output_and_reports_exit_code() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open PTY");
        let mut command = CommandBuilder::new("cmd.exe");
        command.args(["/D", "/Q", "/C", "echo HYSCODE_PTY_OK & exit /b 7"]);
        let mut child = pair.slave.spawn_command(command).expect("spawn command");
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("clone reader");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let status = loop {
            if let Some(status) = child.try_wait().expect("poll command") {
                break status;
            }
            if std::time::Instant::now() >= deadline {
                child.kill().expect("kill timed-out command");
                panic!("PTY command did not exit within 10 seconds");
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        };
        drop(pair.master);
        let mut output = String::new();
        reader.read_to_string(&mut output).expect("read output");

        assert!(
            output.contains("HYSCODE_PTY_OK"),
            "PTY output was: {output}"
        );
        assert_eq!(status.exit_code(), 7);
    }
}
