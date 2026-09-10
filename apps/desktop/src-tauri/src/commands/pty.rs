use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const DEFAULT_PTY_COLS: u16 = 80;
const DEFAULT_PTY_ROWS: u16 = 24;
const MAX_PTY_DIMENSION: u16 = 4096;
const CHILD_STOP_CONFIRM_TIMEOUT_MS: u64 = 2_000;
const CHILD_STOP_POLL_MS: u64 = 25;
const READER_DRAIN_GRACE_MS: u64 = 250;

#[cfg(target_os = "windows")]
mod win_job {
    use std::io;
    use std::os::windows::io::RawHandle;
    use std::sync::Arc;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    #[derive(Clone)]
    pub(crate) struct JobHandle(Arc<JobInner>);

    struct JobInner(HANDLE);

    unsafe impl Send for JobInner {}
    unsafe impl Sync for JobInner {}

    impl Drop for JobInner {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    pub(crate) fn create_kill_on_close_job() -> io::Result<JobHandle> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = JobHandle(Arc::new(JobInner(handle)));
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(limits).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    pub(crate) fn assign_process(job: &JobHandle, process: RawHandle) -> io::Result<()> {
        let assigned = unsafe { AssignProcessToJobObject((job.0).0, process.cast()) };
        if assigned == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub(crate) fn terminate_job(job: &JobHandle) {
        unsafe { TerminateJobObject((job.0).0, 1) };
    }
}

#[cfg(not(target_os = "windows"))]
mod win_job {
    #[derive(Clone)]
    pub(crate) struct JobHandle;

    pub(crate) fn terminate_job(_job: &JobHandle) {}
}

/// Incremental UTF-8 decoder that retains an incomplete trailing sequence so
/// multi-byte glyphs split across PTY reads are never replaced with U+FFFD.
struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    fn push(&mut self, bytes: &[u8]) -> String {
        if self.pending.is_empty() {
            if let Ok(text) = std::str::from_utf8(bytes) {
                return text.to_string();
            }
        }
        self.pending.extend_from_slice(bytes);
        self.take_complete()
    }

    fn take_complete(&mut self) -> String {
        let mut output = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    output.push_str(text);
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    let invalid = error.error_len();
                    if valid > 0 {
                        output.push_str(
                            std::str::from_utf8(&self.pending[..valid]).unwrap_or_default(),
                        );
                    }
                    match invalid {
                        Some(length) => {
                            output.push('\u{FFFD}');
                            self.pending.drain(..valid + length);
                        }
                        None => {
                            self.pending.drain(..valid);
                            return output;
                        }
                    }
                }
            }
        }
        self.pending.clear();
        output
    }

    fn flush(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let text = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        text
    }
}

/// Authoritative state for one PTY. The process lifecycle and replay buffer live
/// here so mounting or unmounting a frontend terminal never owns the process.
pub(crate) struct PtySession {
    pub(crate) writer_tx: mpsc::Sender<Vec<u8>>,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) killer: Box<dyn ChildKiller + Send + Sync>,
    pub(crate) child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    pub(crate) job: Option<win_job::JobHandle>,
    pub(crate) alive: bool,
    pub(crate) exit_code: Option<u32>,
    pub(crate) failure: Option<PtyRuntimeFailure>,
    pub(crate) exit_emitted: bool,
    pub(crate) stop_confirmed: bool,
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
pub(crate) struct PtyExitPayload {
    pub(crate) pty_id: String,
    pub(crate) sequence: u64,
    pub(crate) code: Option<u32>,
    pub(crate) failure: Option<PtyRuntimeFailure>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PtyRuntimeFailure {
    pub(crate) operation: String,
    pub(crate) message: String,
}

#[derive(Clone, Serialize)]
pub struct PtyStopResult {
    status: String,
    failures: Vec<PtyRuntimeFailure>,
}

#[derive(Clone, Serialize)]
pub struct PtySnapshot {
    data: String,
    from_sequence: u64,
    to_sequence: u64,
    truncated: bool,
    alive: bool,
    exit_code: Option<u32>,
    failure: Option<PtyRuntimeFailure>,
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
        let configured = std::env::var("SHELL").unwrap_or_default();
        if is_supported_posix_shell(&configured) {
            configured
        } else {
            "/bin/bash".to_string()
        }
    }
}

fn is_supported_posix_shell(shell: &str) -> bool {
    matches!(
        Path::new(shell).file_name().and_then(|name| name.to_str()),
        Some("bash" | "sh" | "zsh" | "dash")
    )
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

/// Terminates the PTY process tree. The `kill()` result is intentionally ignored
/// because portable-pty 0.8.x/0.9.x invert the `TerminateProcess` result on
/// Windows; liveness is always confirmed through `try_wait` instead.
fn terminate_session_child(session: &mut PtySession) {
    if let Some(job) = &session.job {
        win_job::terminate_job(job);
    }
    let _ = session.killer.kill();
}

pub(crate) fn record_reader_failure(
    state: &Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: &str,
    failure: PtyRuntimeFailure,
) -> Option<PtyExitPayload> {
    let mut sessions = state.lock().ok()?;
    let session = sessions.get_mut(pty_id)?;
    if session.exit_emitted {
        return None;
    }
    session.stop_confirmed = false;
    session.alive = false;
    terminate_session_child(session);
    session.failure = Some(failure);
    session.exit_emitted = true;
    Some(PtyExitPayload {
        pty_id: pty_id.to_string(),
        sequence: session.output.sequence,
        code: session.exit_code,
        failure: session.failure.clone(),
    })
}

pub(crate) fn record_waiter_exit(
    state: &Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: &str,
    exit_code: Option<u32>,
    failure: Option<PtyRuntimeFailure>,
) -> Option<PtyExitPayload> {
    let mut sessions = state.lock().ok()?;
    let session = sessions.get_mut(pty_id)?;
    if session.exit_emitted {
        let mut conflicting_exit = false;
        if let Some(next_code) = exit_code {
            if let Some(existing_code) = session.exit_code {
                if existing_code != next_code {
                    let message = format!(
                        "Conflicting terminal exit codes: {existing_code} and {next_code}."
                    );
                    if let Some(existing_failure) = session.failure.as_mut() {
                        existing_failure.message =
                            format!("{} {message}", existing_failure.message);
                    } else {
                        session.failure = Some(PtyRuntimeFailure {
                            operation: "event".to_string(),
                            message,
                        });
                    }
                    conflicting_exit = true;
                }
            } else {
                session.exit_code = Some(next_code);
            }
        }
        let has_failure = failure.is_some();
        if let Some(next_failure) = failure {
            if next_failure.operation == "wait" {
                terminate_session_child(session);
            }
            if let Some(existing_failure) = session.failure.as_mut() {
                if existing_failure.operation != next_failure.operation
                    || existing_failure.message != next_failure.message
                {
                    existing_failure.message =
                        format!("{} {}", existing_failure.message, next_failure.message);
                }
            } else {
                session.failure = Some(next_failure);
            }
            session.stop_confirmed = false;
        }
        if !conflicting_exit && !has_failure {
            session.stop_confirmed = true;
        }
        return None;
    }
    if failure
        .as_ref()
        .is_some_and(|item| item.operation == "wait")
    {
        terminate_session_child(session);
    }
    session.alive = false;
    session.exit_code = exit_code;
    session.stop_confirmed = failure
        .as_ref()
        .map(|item| item.operation != "wait")
        .unwrap_or(true);
    session.failure = failure;
    session.exit_emitted = true;
    Some(PtyExitPayload {
        pty_id: pty_id.to_string(),
        sequence: session.output.sequence,
        code: session.exit_code,
        failure: session.failure.clone(),
    })
}

fn record_operation_failure(
    session: &mut PtySession,
    pty_id: &str,
    operation: &str,
    message: String,
) -> Option<PtyExitPayload> {
    session.alive = false;
    session.stop_confirmed = false;
    terminate_session_child(session);
    if session.failure.is_none() {
        session.failure = Some(PtyRuntimeFailure {
            operation: operation.to_string(),
            message,
        });
    }
    if session.exit_emitted {
        return None;
    }
    session.exit_emitted = true;
    Some(PtyExitPayload {
        pty_id: pty_id.to_string(),
        sequence: session.output.sequence,
        code: session.exit_code,
        failure: session.failure.clone(),
    })
}

fn record_session_operation_failure(
    state: &Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: &str,
    operation: &str,
    message: String,
) -> Option<PtyExitPayload> {
    let mut sessions = state.lock().ok()?;
    let session = sessions.get_mut(pty_id)?;
    record_operation_failure(session, pty_id, operation, message)
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
    environment
        .entry("TERM_PROGRAM_VERSION".to_string())
        .or_insert_with(|| app.package_info().version.to_string());
    for (key, value) in &environment {
        command.env(key, value);
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to spawn shell `{shell_path}`: {error}"))?;

    register_pty_session(pair, child, cols, rows, app, Arc::clone(&state.0))
}

fn emit_pty_event<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(error) = app.emit(event, payload) {
        eprintln!("[terminal-runtime] Failed to publish {event}: {error}");
    }
}

fn cleanup_untracked_child(
    child: &mut Box<dyn Child + Send + Sync>,
    killer: &mut Box<dyn ChildKiller + Send + Sync>,
) -> Result<(), String> {
    let _ = killer.kill();
    let deadline = Instant::now() + Duration::from_millis(CHILD_STOP_CONFIRM_TIMEOUT_MS);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {}
            Err(error) => return Err(format!("Child stop confirmation failed: {error}")),
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Child did not exit within {CHILD_STOP_CONFIRM_TIMEOUT_MS}ms."
            ));
        }
        std::thread::sleep(Duration::from_millis(CHILD_STOP_POLL_MS));
    }
}

fn cleanup_spawn_failure(
    child: &mut Box<dyn Child + Send + Sync>,
    killer: &mut Box<dyn ChildKiller + Send + Sync>,
    failure: String,
) -> String {
    match cleanup_untracked_child(child, killer) {
        Ok(()) => failure,
        Err(cleanup_failure) => format!("{failure} Cleanup: {cleanup_failure}"),
    }
}

fn cleanup_shared_child(
    child: &Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    killer: &mut Box<dyn ChildKiller + Send + Sync>,
) -> Result<(), String> {
    let _ = killer.kill();
    match confirm_child_exit(child, CHILD_STOP_CONFIRM_TIMEOUT_MS) {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(format!(
            "Child did not exit within {CHILD_STOP_CONFIRM_TIMEOUT_MS}ms."
        )),
        Err(failure) => Err(failure.message),
    }
}

fn attach_child_job(child: &(dyn Child + Send + Sync)) -> Option<win_job::JobHandle> {
    #[cfg(target_os = "windows")]
    {
        let job = match win_job::create_kill_on_close_job() {
            Ok(job) => job,
            Err(error) => {
                eprintln!("[terminal-runtime] Failed to create PTY job object: {error}");
                return None;
            }
        };
        match child.as_raw_handle() {
            Some(handle) => match win_job::assign_process(&job, handle) {
                Ok(()) => Some(job),
                Err(error) => {
                    eprintln!("[terminal-runtime] Failed to assign PTY child to job: {error}");
                    None
                }
            },
            None => None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = child;
        None
    }
}

fn append_pty_output(
    state: &Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: &str,
    app: &AppHandle,
    data: String,
) -> bool {
    let sequence = match state.lock() {
        Ok(mut sessions) => match sessions.get_mut(pty_id) {
            Some(session) => Some(session.output.append(data.clone())),
            None => None,
        },
        Err(_) => None,
    };
    let Some(sequence) = sequence else {
        return false;
    };
    if let Err(error) = app.emit(
        "pty:data",
        PtyDataPayload {
            pty_id: pty_id.to_string(),
            sequence,
            data,
        },
    ) {
        let message = format!("Failed to publish PTY data: {error}");
        if let Some(payload) = record_session_operation_failure(state, pty_id, "event", message) {
            emit_pty_event(app, "pty:exit", payload);
        }
        return false;
    }
    true
}

pub(crate) fn register_pty_session(
    pair: portable_pty::PtyPair,
    mut child: Box<dyn Child + Send + Sync>,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: Arc<Mutex<HashMap<String, PtySession>>>,
) -> Result<String, String> {
    let pty_id = uuid::Uuid::new_v4().to_string();
    let portable_pty::PtyPair { master, slave } = pair;
    drop(slave);
    let mut killer = child.clone_killer();
    let mut reader = match master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            return Err(cleanup_spawn_failure(
                &mut child,
                &mut killer,
                format!("Failed to clone PTY reader: {error}"),
            ));
        }
    };
    let writer = match master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            return Err(cleanup_spawn_failure(
                &mut child,
                &mut killer,
                format!("Failed to take PTY writer: {error}"),
            ));
        }
    };
    let job = attach_child_job(child.as_ref());
    let child = Arc::new(Mutex::new(child));
    let (writer_tx, writer_rx) = mpsc::channel::<Vec<u8>>();
    let mut sessions = match state.lock() {
        Ok(sessions) => sessions,
        Err(error) => {
            let failure = format!("Lock error: {error}");
            return Err(match cleanup_shared_child(&child, &mut killer) {
                Ok(()) => failure,
                Err(cleanup_failure) => format!("{failure} Cleanup: {cleanup_failure}"),
            });
        }
    };
    sessions.insert(
        pty_id.clone(),
        PtySession {
            writer_tx,
            master,
            killer,
            child: Arc::clone(&child),
            job,
            alive: true,
            exit_code: None,
            failure: None,
            exit_emitted: false,
            stop_confirmed: false,
            cols,
            rows,
            output: OutputBuffer::new(),
        },
    );
    drop(sessions);

    let writer_state = Arc::clone(&state);
    let writer_app = app.clone();
    let writer_id = pty_id.clone();
    std::thread::spawn(move || {
        let mut writer = writer;
        while let Ok(bytes) = writer_rx.recv() {
            if let Err(error) = writer.write_all(&bytes) {
                let message = format!("Write error: {error}");
                if let Some(payload) =
                    record_session_operation_failure(&writer_state, &writer_id, "write", message)
                {
                    emit_pty_event(&writer_app, "pty:exit", payload);
                }
                break;
            }
        }
    });

    let (reader_done_tx, reader_done_rx) = mpsc::channel::<Option<PtyRuntimeFailure>>();
    let reader_id = pty_id.clone();
    let reader_state = Arc::clone(&state);
    let reader_app = app.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut chunker = Utf8Chunker::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let tail = chunker.flush();
                    if !tail.is_empty() {
                        append_pty_output(&reader_state, &reader_id, &reader_app, tail);
                    }
                    let _ = reader_done_tx.send(None);
                    break;
                }
                Err(error) => {
                    let tail = chunker.flush();
                    if !tail.is_empty() {
                        append_pty_output(&reader_state, &reader_id, &reader_app, tail);
                    }
                    let failure = PtyRuntimeFailure {
                        operation: "reader".to_string(),
                        message: format!("PTY reader failed: {error}"),
                    };
                    let _ = reader_done_tx.send(Some(failure));
                    break;
                }
                Ok(length) => {
                    let data = chunker.push(&buffer[..length]);
                    if data.is_empty() {
                        continue;
                    }
                    if !append_pty_output(&reader_state, &reader_id, &reader_app, data) {
                        break;
                    }
                }
            }
        }
    });

    let waiter_child = Arc::clone(&child);
    let waiter_id = pty_id.clone();
    let waiter_state = Arc::clone(&state);
    std::thread::spawn(move || {
        let mut reader_event: Option<Option<PtyRuntimeFailure>> = None;
        let mut reader_failure_recorded = false;
        let mut reader_failure_deadline: Option<Instant> = None;
        let (exit_code, wait_failure) = loop {
            match waiter_child.try_lock() {
                Ok(mut child) => match child.try_wait() {
                    Ok(Some(status)) => break (Some(status.exit_code()), None),
                    Err(error) => {
                        break (
                            None,
                            Some(PtyRuntimeFailure {
                                operation: "wait".to_string(),
                                message: format!("PTY wait failed: {error}"),
                            }),
                        )
                    }
                    Ok(None) => {}
                },
                Err(std::sync::TryLockError::Poisoned(_)) => {
                    break (
                        None,
                        Some(PtyRuntimeFailure {
                            operation: "wait".to_string(),
                            message: "PTY child state lock was poisoned.".to_string(),
                        }),
                    )
                }
                Err(std::sync::TryLockError::WouldBlock) => {}
            }

            if reader_event.is_none() {
                match reader_done_rx.try_recv() {
                    Ok(event) => {
                        reader_event = Some(event);
                        reader_failure_deadline = Some(Instant::now() + Duration::from_millis(250));
                    }
                    Err(mpsc::TryRecvError::Disconnected) => {
                        reader_event = Some(None);
                        reader_failure_deadline = Some(Instant::now() + Duration::from_millis(250));
                    }
                    Err(mpsc::TryRecvError::Empty) => {}
                }
            }

            if let Some(deadline) = reader_failure_deadline {
                if Instant::now() >= deadline {
                    if !reader_failure_recorded {
                        let mut child_exit_code = None;
                        let mut child_wait_failure = None;
                        let mut child_busy = false;
                        match waiter_child.try_lock() {
                            Ok(mut child) => match child.try_wait() {
                                Ok(Some(status)) => child_exit_code = Some(status.exit_code()),
                                Ok(None) => {}
                                Err(error) => {
                                    child_wait_failure = Some(PtyRuntimeFailure {
                                        operation: "wait".to_string(),
                                        message: format!("PTY wait failed: {error}"),
                                    });
                                }
                            },
                            Err(std::sync::TryLockError::Poisoned(_)) => {
                                child_wait_failure = Some(PtyRuntimeFailure {
                                    operation: "wait".to_string(),
                                    message: "PTY child state lock was poisoned.".to_string(),
                                });
                            }
                            Err(std::sync::TryLockError::WouldBlock) => child_busy = true,
                        }
                        if let Some(code) = child_exit_code {
                            break (Some(code), None);
                        }
                        if let Some(wait_failure) = child_wait_failure {
                            break (None, Some(wait_failure));
                        }
                        if child_busy {
                            reader_failure_deadline =
                                Some(Instant::now() + Duration::from_millis(25));
                            continue;
                        }
                        let failure = reader_event
                            .as_ref()
                            .and_then(|event| event.clone())
                            .unwrap_or_else(|| PtyRuntimeFailure {
                                operation: "reader".to_string(),
                                message: "PTY reader closed before the child exited.".to_string(),
                            });
                        if let Some(payload) =
                            record_reader_failure(&waiter_state, &waiter_id, failure)
                        {
                            emit_pty_event(&app, "pty:exit", payload);
                        }
                        reader_failure_recorded = true;
                        reader_failure_deadline = Some(Instant::now() + Duration::from_millis(250));
                    } else {
                        break (
                            None,
                            Some(PtyRuntimeFailure {
                                operation: "wait".to_string(),
                                message: "PTY did not exit after the reader failed.".to_string(),
                            }),
                        );
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        };

        if reader_event.is_none() {
            reader_event = reader_done_rx
                .recv_timeout(Duration::from_millis(READER_DRAIN_GRACE_MS))
                .ok();
        }
        if !reader_failure_recorded && exit_code.is_none() && wait_failure.is_none() {
            if let Some(Some(failure)) = reader_event.as_ref().cloned() {
                if let Some(payload) = record_reader_failure(&waiter_state, &waiter_id, failure) {
                    emit_pty_event(&app, "pty:exit", payload);
                }
            }
        }
        if let Some(payload) =
            record_waiter_exit(&waiter_state, &waiter_id, exit_code, wait_failure)
        {
            emit_pty_event(&app, "pty:exit", payload);
        }
    });

    Ok(pty_id)
}

#[tauri::command]
pub async fn pty_write(
    pty_id: String,
    data: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    enqueue_write(&state.0, &pty_id, data.as_bytes())
}

fn enqueue_write(
    state: &Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: &str,
    data: &[u8],
) -> Result<(), String> {
    let sender = {
        let sessions = state
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        let session = sessions
            .get(pty_id)
            .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
        if !session.alive {
            return Err(format!("PTY session is not running: {pty_id}"));
        }
        session.writer_tx.clone()
    };
    sender
        .send(data.to_vec())
        .map_err(|_| format!("PTY session is not running: {pty_id}"))
}

#[tauri::command]
pub async fn pty_resize(
    pty_id: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    resize_pty(&pty_id, cols, rows, &app, state)
}

fn resize_pty(
    pty_id: &str,
    cols: u16,
    rows: u16,
    app: &AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let cols = normalize_dimension(Some(cols), DEFAULT_PTY_COLS);
    let rows = normalize_dimension(Some(rows), DEFAULT_PTY_ROWS);
    let (result, payload) = {
        let mut sessions = state
            .0
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        let session = sessions
            .get_mut(pty_id)
            .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
        if !session.alive {
            (Err(format!("PTY session is not running: {pty_id}")), None)
        } else if session.cols == cols && session.rows == rows {
            (Ok(()), None)
        } else {
            match session.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            }) {
                Ok(()) => {
                    session.cols = cols;
                    session.rows = rows;
                    (Ok(()), None)
                }
                Err(error) => {
                    let message = format!("Resize error: {error}");
                    let payload =
                        record_operation_failure(session, pty_id, "event", message.clone());
                    (Err(message), payload)
                }
            }
        }
    };
    if let Some(payload) = payload {
        emit_pty_event(app, "pty:exit", payload);
    }
    result
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
    match sessions.get(&pty_id) {
        None => Ok(false),
        Some(session) if let Some(failure) = &session.failure => Err(format!(
            "PTY session {pty_id} has a lifecycle failure [{}]: {}",
            failure.operation, failure.message
        )),
        Some(session) if !session.alive && !session.stop_confirmed => {
            Err(format!("PTY session {pty_id} liveness is unconfirmed."))
        }
        Some(session) => Ok(session.alive),
    }
}

fn snapshot_for_session(session: &PtySession, after_sequence: Option<u64>) -> PtySnapshot {
    let requested = after_sequence.unwrap_or_default();
    let full_snapshot = after_sequence.is_none() || requested == 0;
    let first_available = session
        .output
        .output
        .front()
        .map(|(sequence, _)| *sequence)
        .unwrap_or(session.output.sequence);
    let selected = session
        .output
        .output
        .iter()
        .filter(|(sequence, _)| full_snapshot || *sequence > requested)
        .collect::<Vec<_>>();
    let data = selected
        .iter()
        .map(|(_, chunk)| chunk.as_str())
        .collect::<String>();
    let from_sequence = if full_snapshot {
        0
    } else {
        selected
            .first()
            .map(|(sequence, _)| *sequence)
            .unwrap_or(requested.min(session.output.sequence))
    };
    PtySnapshot {
        data,
        from_sequence,
        to_sequence: session.output.sequence,
        truncated: snapshot_is_truncated(requested, first_available),
        alive: session.alive,
        exit_code: session.exit_code,
        failure: session.failure.clone(),
    }
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
    Ok(snapshot_for_session(session, after_sequence))
}

fn snapshot_is_truncated(requested: u64, first_available: u64) -> bool {
    first_available.saturating_sub(requested) > 1
}

#[tauri::command]
pub async fn pty_interrupt(pty_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    enqueue_write(&state.0, &pty_id, b"\x03")
}

#[derive(Clone, Serialize)]
pub struct PtyDiagnostics {
    conpty_source: String,
    conpty_path: Option<String>,
}

#[tauri::command]
pub async fn pty_diagnostics() -> Result<PtyDiagnostics, String> {
    Ok(collect_pty_diagnostics())
}

#[cfg(target_os = "windows")]
fn collect_pty_diagnostics() -> PtyDiagnostics {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleFileNameW, GetModuleHandleW};

    let module: Vec<u16> = "conpty.dll\0".encode_utf16().collect();
    let handle = unsafe { GetModuleHandleW(module.as_ptr()) };
    if handle.is_null() {
        return PtyDiagnostics {
            conpty_source: "inbox".to_string(),
            conpty_path: None,
        };
    }
    let mut buffer = vec![0u16; 1024];
    let length = unsafe { GetModuleFileNameW(handle, buffer.as_mut_ptr(), buffer.len() as u32) };
    let conpty_path = if length == 0 {
        None
    } else {
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    };
    PtyDiagnostics {
        conpty_source: "sideloaded".to_string(),
        conpty_path,
    }
}

#[cfg(not(target_os = "windows"))]
fn collect_pty_diagnostics() -> PtyDiagnostics {
    PtyDiagnostics {
        conpty_source: "posix".to_string(),
        conpty_path: None,
    }
}

fn confirm_child_exit(
    child: &Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    timeout_ms: u64,
) -> Result<Option<u32>, PtyRuntimeFailure> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        match child.try_lock() {
            Ok(mut child) => match child.try_wait() {
                Ok(Some(status)) => return Ok(Some(status.exit_code())),
                Ok(None) => {}
                Err(error) => {
                    return Err(PtyRuntimeFailure {
                        operation: "wait".to_string(),
                        message: format!("PTY stop confirmation failed: {error}"),
                    });
                }
            },
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return Err(PtyRuntimeFailure {
                    operation: "wait".to_string(),
                    message: "PTY child state lock was poisoned.".to_string(),
                });
            }
            Err(std::sync::TryLockError::WouldBlock) => {}
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(CHILD_STOP_POLL_MS));
    }
}

fn stop_child(
    killer: &mut Box<dyn ChildKiller + Send + Sync>,
    child: &Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    job: Option<&win_job::JobHandle>,
    timeout_ms: u64,
) -> (&'static str, Option<PtyRuntimeFailure>, Option<u32>) {
    if let Some(job) = job {
        win_job::terminate_job(job);
    }
    let _ = killer.kill();
    match confirm_child_exit(child, timeout_ms) {
        Ok(Some(code)) => ("stopped", None, Some(code)),
        Ok(None) => (
            "unknown",
            Some(PtyRuntimeFailure {
                operation: "kill".to_string(),
                message: format!("Kill signal sent, but PTY did not exit within {timeout_ms}ms."),
            }),
            None,
        ),
        Err(failure) => ("unknown", Some(failure), None),
    }
}

fn commit_stop(
    session: &mut PtySession,
    pty_id: &str,
    status: &str,
    new_failure: Option<PtyRuntimeFailure>,
    exit_code: Option<u32>,
) -> (PtyStopResult, Option<PtyExitPayload>, bool) {
    session.alive = false;
    if let Some(code) = exit_code {
        session.exit_code = Some(code);
    }
    session.stop_confirmed = status == "stopped";
    if session.failure.is_none() {
        session.failure = new_failure.clone();
    }
    let mut failures = session.failure.clone().into_iter().collect::<Vec<_>>();
    if let Some(failure) = new_failure {
        if !failures.iter().any(|existing| {
            existing.operation == failure.operation && existing.message == failure.message
        }) {
            failures.push(failure);
        }
    }
    let payload = if session.exit_emitted {
        None
    } else {
        session.exit_emitted = true;
        Some(PtyExitPayload {
            pty_id: pty_id.to_string(),
            sequence: session.output.sequence,
            code: session.exit_code,
            failure: session.failure.clone(),
        })
    };
    (
        PtyStopResult {
            status: status.to_string(),
            failures,
        },
        payload,
        status == "stopped",
    )
}

#[tauri::command]
pub async fn pty_kill(
    pty_id: String,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<PtyStopResult, String> {
    let stop_context = {
        let sessions = state
            .0
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        let session = sessions
            .get(&pty_id)
            .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
        if !session.alive && session.stop_confirmed {
            None
        } else {
            Some((
                Arc::clone(&session.child),
                session.killer.clone_killer(),
                session.job.clone(),
            ))
        }
    };

    let Some((child, mut killer, job)) = stop_context else {
        let result = state
            .0
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?
            .get(&pty_id)
            .map(|session| PtyStopResult {
                status: "stopped".to_string(),
                failures: session.failure.clone().into_iter().collect(),
            })
            .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
        state
            .0
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?
            .remove(&pty_id);
        return Ok(result);
    };

    let (status, failure, exit_code) = stop_child(
        &mut killer,
        &child,
        job.as_ref(),
        CHILD_STOP_CONFIRM_TIMEOUT_MS,
    );
    let (kill_result, payload, should_remove) = {
        let mut sessions = state
            .0
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        let session = sessions
            .get_mut(&pty_id)
            .ok_or_else(|| format!("PTY session not found: {pty_id}"))?;
        commit_stop(session, &pty_id, status, failure, exit_code)
    };
    if let Some(payload) = payload {
        emit_pty_event(&app, "pty:exit", payload);
    }
    if should_remove {
        state
            .0
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?
            .remove(&pty_id);
    }
    Ok(kill_result)
}

#[cfg(test)]
mod tests {
    use portable_pty::ExitStatus;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[derive(Clone, Debug)]
    struct TestKiller {
        calls: Arc<AtomicUsize>,
        fails: bool,
    }

    impl ChildKiller for TestKiller {
        fn kill(&mut self) -> std::io::Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fails {
                Err(std::io::Error::other("synthetic kill failure"))
            } else {
                Ok(())
            }
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }
    #[derive(Debug)]
    struct TestChild {
        exit_code: Option<u32>,
    }

    impl ChildKiller for TestChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(TestKiller {
                calls: Arc::new(AtomicUsize::new(0)),
                fails: false,
            })
        }
    }

    impl Child for TestChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            Ok(self.exit_code.map(ExitStatus::with_exit_code))
        }

        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            Err(std::io::Error::other("synthetic wait failure"))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }

        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    type TestState = Arc<Mutex<HashMap<String, PtySession>>>;
    type TestWriter = mpsc::Receiver<Vec<u8>>;

    fn test_state_with_writer(
        calls: Arc<AtomicUsize>,
        fails: bool,
        exit_code: Option<u32>,
    ) -> (TestState, TestWriter) {
        let pair = native_pty_system()
            .openpty(PtySize::default())
            .expect("open PTY");
        let (writer_tx, writer_rx) = mpsc::channel();
        let session = PtySession {
            writer_tx,
            master: pair.master,
            killer: Box::new(TestKiller { calls, fails }),
            child: Arc::new(Mutex::new(
                Box::new(TestChild { exit_code }) as Box<dyn Child + Send + Sync>
            )),
            job: None,
            alive: true,
            exit_code: None,
            failure: None,
            exit_emitted: false,
            stop_confirmed: false,
            cols: DEFAULT_PTY_COLS,
            rows: DEFAULT_PTY_ROWS,
            output: OutputBuffer::new(),
        };
        (
            Arc::new(Mutex::new(HashMap::from([("test".to_string(), session)]))),
            writer_rx,
        )
    }

    fn test_state(calls: Arc<AtomicUsize>, fails: bool) -> Arc<Mutex<HashMap<String, PtySession>>> {
        let (state, writer_rx) = test_state_with_writer(calls, fails, None);
        std::mem::forget(writer_rx);
        state
    }
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
    fn unsupported_posix_defaults_are_not_used_with_bash_framing() {
        assert!(is_supported_posix_shell("/bin/bash"));
        assert!(is_supported_posix_shell("/bin/zsh"));
        assert!(is_supported_posix_shell("/bin/dash"));
        assert!(!is_supported_posix_shell("/usr/bin/fish"));
        assert!(!is_supported_posix_shell(""));
    }

    #[test]
    fn snapshot_truncation_is_reported_even_for_a_full_replay() {
        assert!(!snapshot_is_truncated(0, 0));
        assert!(!snapshot_is_truncated(0, 1));
        assert!(snapshot_is_truncated(0, 2));
        assert!(!snapshot_is_truncated(5, 6));
        assert!(snapshot_is_truncated(5, 7));
    }
    #[test]
    fn snapshots_retain_failure_for_full_and_incremental_reads() {
        let calls = Arc::new(AtomicUsize::new(0));
        let state = test_state(Arc::clone(&calls), false);
        {
            let mut sessions = state.lock().expect("state lock");
            let session = sessions.get_mut("test").expect("session");
            session.output.append("first".to_string());
            session.output.append("second".to_string());
            session.alive = false;
            session.failure = Some(PtyRuntimeFailure {
                operation: "reader".to_string(),
                message: "reader failed".to_string(),
            });
        }

        let sessions = state.lock().expect("state lock");
        let session = sessions.get("test").expect("session");
        let full = snapshot_for_session(session, None);
        let delta = snapshot_for_session(session, Some(1));

        assert_eq!(full.data, "firstsecond");
        assert_eq!(delta.data, "second");
        assert_eq!(
            full.failure.as_ref().map(|item| item.operation.as_str()),
            Some("reader")
        );
        assert_eq!(
            delta.failure.as_ref().map(|item| item.message.as_str()),
            Some("reader failed")
        );
        assert!(!full.alive);
        assert!(!delta.alive);
    }

    #[test]
    fn reader_failure_quarantines_session_and_emits_one_exit() {
        let calls = Arc::new(AtomicUsize::new(0));
        let state = test_state(Arc::clone(&calls), false);

        let payload = record_reader_failure(
            &state,
            "test",
            PtyRuntimeFailure {
                operation: "reader".to_string(),
                message: "reader closed unexpectedly".to_string(),
            },
        )
        .expect("reader failure should emit an exit");

        assert_eq!(
            payload.failure.as_ref().map(|item| item.operation.as_str()),
            Some("reader")
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        {
            let sessions = state.lock().expect("state lock");
            let session = sessions.get("test").expect("session");
            assert!(!session.alive);
            assert!(!session.stop_confirmed);
            assert!(session.failure.is_some());
        }
        assert!(record_waiter_exit(&state, "test", Some(17), None).is_none());
        {
            let sessions = state.lock().expect("state lock");
            let session = sessions.get("test").expect("session");
            assert_eq!(session.exit_code, Some(17));
            assert!(session.stop_confirmed);
        }
        assert!(record_waiter_exit(&state, "test", None, None).is_none());
    }
    #[test]
    fn waiter_failure_after_reader_failure_preserves_unknown_liveness() {
        let calls = Arc::new(AtomicUsize::new(0));
        let state = test_state(Arc::clone(&calls), false);

        record_reader_failure(
            &state,
            "test",
            PtyRuntimeFailure {
                operation: "reader".to_string(),
                message: "reader closed unexpectedly".to_string(),
            },
        )
        .expect("reader failure should emit an exit");

        assert!(record_waiter_exit(
            &state,
            "test",
            None,
            Some(PtyRuntimeFailure {
                operation: "wait".to_string(),
                message: "wait failed after reader failure".to_string(),
            }),
        )
        .is_none());

        let sessions = state.lock().expect("state lock");
        let session = sessions.get("test").expect("session");
        assert!(!session.stop_confirmed);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let failure = session.failure.as_ref().expect("merged failure");
        assert_eq!(failure.operation, "reader");
        assert!(failure.message.contains("wait failed after reader failure"));
    }

    #[test]
    fn wait_failure_retains_unknown_liveness_without_inverted_kill_errors() {
        let calls = Arc::new(AtomicUsize::new(0));
        let state = test_state(Arc::clone(&calls), true);

        let payload = record_waiter_exit(
            &state,
            "test",
            None,
            Some(PtyRuntimeFailure {
                operation: "wait".to_string(),
                message: "wait failed".to_string(),
            }),
        )
        .expect("wait failure should emit an exit");

        let failure = payload.failure.expect("failure payload");
        assert_eq!(failure.operation, "wait");
        assert_eq!(failure.message, "wait failed");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let session = state.lock().expect("state lock");
        let session = session.get("test").expect("session");
        assert!(!session.alive);
        assert!(!session.stop_confirmed);
        assert_eq!(session.exit_code, None);
    }

    #[test]
    fn stop_failure_keeps_session_quarantined_for_a_later_retry() {
        let calls = Arc::new(AtomicUsize::new(0));
        let state = test_state(Arc::clone(&calls), true);
        let (result, payload, should_remove) = {
            let mut sessions = state.lock().expect("state lock");
            let session = sessions.get_mut("test").expect("session");
            let job = session.job.clone();
            let child = Arc::clone(&session.child);
            let mut killer = session.killer.clone_killer();
            let (status, failure, exit_code) = stop_child(&mut killer, &child, job.as_ref(), 50);
            commit_stop(session, "test", status, failure, exit_code)
        };

        assert_eq!(result.status, "unknown");
        assert!(!should_remove);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(payload.is_some());
        let sessions = state.lock().expect("state lock");
        let session = sessions.get("test").expect("session");
        assert!(!session.alive);
        assert!(!session.stop_confirmed);
        assert!(session.failure.as_ref().is_some_and(|failure| {
            failure.operation == "kill" && failure.message.contains("did not exit within 50ms")
        }));
    }

    #[test]
    fn inverted_kill_error_still_reports_stopped_when_child_exited() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (state, writer_rx) = test_state_with_writer(Arc::clone(&calls), true, Some(23));
        std::mem::forget(writer_rx);
        let mut sessions = state.lock().expect("state lock");
        let session = sessions.get_mut("test").expect("session");
        let job = session.job.clone();
        let child = Arc::clone(&session.child);
        let mut killer = session.killer.clone_killer();

        let (status, failure, exit_code) = stop_child(&mut killer, &child, job.as_ref(), 50);

        assert_eq!(status, "stopped");
        assert!(failure.is_none());
        assert_eq!(exit_code, Some(23));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn utf8_chunker_preserves_sequences_split_across_reads() {
        let mut chunker = Utf8Chunker::new();

        assert_eq!(chunker.push(b"plain ascii"), "plain ascii");
        assert_eq!(chunker.push(&[0xE2, 0x94]), "");
        assert_eq!(chunker.push(&[0x80]), "\u{2500}");
        assert_eq!(chunker.push(b"a\xC3"), "a");
        assert_eq!(chunker.push(&[0xA9, b'b']), "\u{00E9}b");
        assert_eq!(chunker.flush(), "");
    }

    #[test]
    fn utf8_chunker_replaces_invalid_bytes_and_flushes_partial_tails() {
        let mut chunker = Utf8Chunker::new();
        assert_eq!(chunker.push(&[0xFF, b'a']), "\u{FFFD}a");

        let mut partial = Utf8Chunker::new();
        assert_eq!(partial.push(&[0xE2, 0x94]), "");
        assert_eq!(partial.flush(), "\u{FFFD}");
    }

    #[test]
    fn enqueue_write_hands_input_to_the_writer_channel() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (state, writer_rx) = test_state_with_writer(calls, false, None);

        enqueue_write(&state, "test", b"ls\r").expect("enqueue write");
        assert_eq!(writer_rx.recv().expect("writer input"), b"ls\r".to_vec());

        {
            let mut sessions = state.lock().expect("state lock");
            sessions.get_mut("test").expect("session").alive = false;
        }
        assert!(enqueue_write(&state, "test", b"x").is_err());
        assert!(enqueue_write(&state, "missing", b"x").is_err());
    }

    #[test]
    fn operation_failure_marks_session_dead_before_exit_publication() {
        let calls = Arc::new(AtomicUsize::new(0));
        let state = test_state(Arc::clone(&calls), false);
        let mut sessions = state.lock().expect("state lock");
        let session = sessions.get_mut("test").expect("session");

        let payload =
            record_operation_failure(session, "test", "write", "write failed".to_string())
                .expect("operation failure should emit an exit");

        assert_eq!(
            payload.failure.as_ref().map(|item| item.operation.as_str()),
            Some("write")
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!session.alive);
        assert!(!session.stop_confirmed);
        assert!(session.exit_emitted);
    }

    #[test]
    fn normal_wait_exit_is_confirmed_and_duplicate_exit_is_suppressed() {
        let calls = Arc::new(AtomicUsize::new(0));
        let state = test_state(Arc::clone(&calls), false);

        let payload = record_waiter_exit(&state, "test", Some(7), None)
            .expect("normal exit should emit an exit");
        assert_eq!(payload.code, Some(7));
        assert!(payload.failure.is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        assert!(record_waiter_exit(&state, "test", Some(9), None).is_none());
        let sessions = state.lock().expect("state lock");
        let session = sessions.get("test").expect("session");
        assert!(!session.alive);
        assert!(session.stop_confirmed);
        assert_eq!(session.exit_code, Some(7));
        assert!(session.failure.as_ref().is_some_and(|failure| {
            failure.operation == "event"
                && failure.message.contains("Conflicting terminal exit codes")
        }));
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn staged_conpty_is_sideloaded_when_available() {
        if !std::path::Path::new("conpty.dll").exists() {
            return;
        }
        let pair = native_pty_system()
            .openpty(PtySize::default())
            .expect("open PTY with staged conpty");
        drop(pair);
        let diagnostics = collect_pty_diagnostics();
        assert_eq!(diagnostics.conpty_source, "sideloaded");
        assert!(diagnostics.conpty_path.is_some());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn job_object_terminates_the_spawned_process_tree() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open PTY");
        let mut command = CommandBuilder::new("cmd.exe");
        command.args(["/D", "/Q", "/C", "ping -n 30 127.0.0.1 > NUL"]);
        let mut child = pair.slave.spawn_command(command).expect("spawn command");
        drop(pair.slave);

        let job = attach_child_job(child.as_ref()).expect("attach job object");
        win_job::terminate_job(&job);

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {}
                Err(error) => panic!("try_wait failed: {error}"),
            }
            assert!(
                Instant::now() < deadline,
                "job object did not terminate the process tree"
            );
            std::thread::sleep(Duration::from_millis(CHILD_STOP_POLL_MS));
        }
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
