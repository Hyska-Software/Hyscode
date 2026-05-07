use std::process::Command;

/// Create a `Command` that will **not** open a visible console window on Windows.
pub fn cmd(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

/// Run an arbitrary program with arguments, capture stdout+stderr.
/// Returns `Ok(stdout)` on success (exit code 0), `Err(stderr)` on failure.
#[tauri::command]
pub async fn shell_exec(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let mut command = cmd(&program);
    for arg in &args {
        command.arg(arg);
    }
    if let Some(dir) = &cwd {
        command.current_dir(dir);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("{}{}", stdout, stderr))
    }
}
