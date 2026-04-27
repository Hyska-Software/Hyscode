use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Holds a single PTY session: the master writer (stdin) and child process.
pub(crate) struct PtySession {
    pub(crate) writer: Box<dyn Write + Send>,
    pub(crate) master: Box<dyn MasterPty + Send>,
    #[allow(dead_code)]
    pub(crate) child: Box<dyn portable_pty::Child + Send>,
}

/// Tauri managed state: map of pty_id → PtySession.
pub struct PtyState(pub Mutex<HashMap<String, PtySession>>);

#[derive(Clone, Serialize, Deserialize)]
struct PtyDataPayload {
    pty_id: String,
    data: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct PtyExitPayload {
    pty_id: String,
    code: Option<u32>,
}

/// Detect the default shell for the current OS.
fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        // Prefer PowerShell 7+ (pwsh), fall back to Windows PowerShell
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
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Spawn a new PTY session. Returns its unique ID.
/// Output is streamed to the frontend via `pty:data` events.
#[tauri::command]
pub async fn pty_spawn(
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let shell_path = shell.unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(&shell_path);

    // Set working directory
    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    // Set extra environment variables
    if let Some(ref env_map) = env {
        for (k, v) in env_map {
            cmd.env(k, v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell `{shell_path}`: {e}"))?;

    // Drop the slave — we only need the master side
    drop(pair.slave);

    let pty_id = uuid::Uuid::new_v4().to_string();

    // Reader thread: reads PTY output and emits events to the frontend
    let reader_id = pty_id.clone();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — process exited
                Ok(n) => {
                    // Convert to string, replacing invalid UTF-8 with replacement char
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty:data",
                        PtyDataPayload {
                            pty_id: reader_id.clone(),
                            data: text,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // Notify frontend that the PTY exited
        let _ = app_clone.emit(
            "pty:exit",
            PtyExitPayload {
                pty_id: reader_id,
                code: None,
            },
        );
    });

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let session = PtySession {
        writer,
        master: pair.master,
        child,
    };

    state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .insert(pty_id.clone(), session);

    Ok(pty_id)
}

/// Write data (user keystrokes) to a PTY session.
#[tauri::command]
pub async fn pty_write(
    pty_id: String,
    data: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    let session = sessions
        .get_mut(&pty_id)
        .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write error: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

/// Resize a PTY session.
#[tauri::command]
pub async fn pty_resize(
    pty_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize error: {e}"))?;
    Ok(())
}

/// Check if a PTY session exists in state.
#[tauri::command]
pub async fn pty_exists(pty_id: String, state: State<'_, PtyState>) -> Result<bool, String> {
    let sessions = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(sessions.contains_key(&pty_id))
}

/// Kill a PTY session and remove it from state.
#[tauri::command]
pub async fn pty_kill(pty_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(mut session) = sessions.remove(&pty_id) {
        let _ = session.child.kill();
    }
    Ok(())
}
