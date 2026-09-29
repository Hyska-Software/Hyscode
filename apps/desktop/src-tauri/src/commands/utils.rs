use std::path::PathBuf;
use std::process::Command;

/// Binaries the generic `shell_exec` bridge is allowed to launch.
///
/// SECURITY: `shell_exec` is reachable from extension/JS code, so it must
/// never become a generic process-spawn gadget. Interactive shells belong in
/// the PTY layer (`pty_spawn`); one-shot tool CLIs go through this allowlist.
/// First-party sidecars (`codex-sidecar`, `claude-agent`) have dedicated
/// commands (`codex_run`, `claude_agent_run`) and are intentionally NOT listed
/// here. To add a binary, extend this list AND the `shell_exec` unit tests.
const ALLOWED_BINARIES: &[&str] = &["git", "node", "npm", "bun", "spectralang", "spectra-lsp"];

/// Validate a requested program name: bare file name only (no directories,
/// no separators, no parent traversal) and present in `ALLOWED_BINARIES`.
/// Comparison is case-insensitive on Windows, exact elsewhere.
fn validate_program(program: &str) -> Result<String, String> {
    if program.trim().is_empty() {
        return Err("Validation: program name cannot be empty".to_string());
    }
    if program.contains('/') || program.contains('\\') || program.contains('\0') {
        return Err("Validation: program must be a bare binary name".to_string());
    }
    if program.contains("..") {
        return Err("Validation: program must be a bare binary name".to_string());
    }
    // Reject anything that looks like a path (drive prefix, extension tricks
    // such as `git.exe` masquerading are handled by the allowlist below).
    let path = PathBuf::from(program);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if file_name != program {
        return Err("Validation: program must be a bare binary name".to_string());
    }
    let allowed = ALLOWED_BINARIES.iter().any(|candidate| {
        #[cfg(target_os = "windows")]
        {
            candidate.eq_ignore_ascii_case(program)
        }
        #[cfg(not(target_os = "windows"))]
        {
            *candidate == program
        }
    });
    if !allowed {
        return Err(format!(
            "Validation: binary not allowed: '{program}' (allowed: {})",
            ALLOWED_BINARIES.join(", ")
        ));
    }
    Ok(program.to_string())
}

/// Validate an optional working directory: it must exist, be a directory,
/// and canonicalize cleanly (resolves symlinks and `..` segments).
/// Canonicalized temp directories are always accepted; any other existing
/// directory is treated as a user workspace root. Filesystem roots are
/// rejected. Full workspace-root containment (frontend-declared roots) is a
/// follow-up once a workspace registry exists in the backend.
fn validate_cwd(cwd: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(dir) = cwd else {
        return Ok(None);
    };
    if dir.trim().is_empty() {
        return Err("Validation: cwd cannot be empty".to_string());
    }
    if dir.contains('\0') {
        return Err("Validation: cwd contains invalid characters".to_string());
    }
    let canonical = std::fs::canonicalize(dir)
        .map_err(|e| format!("Validation: cwd is not accessible: '{dir}': {e}"))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Validation: cwd is not a directory: '{}'",
            canonical.display()
        ));
    }
    if is_filesystem_root(&canonical) {
        return Err("Validation: cwd cannot be a filesystem root".to_string());
    }
    Ok(Some(canonical))
}

fn is_filesystem_root(path: &std::path::Path) -> bool {
    if let Some(home) = dirs::home_dir() {
        // Compare canonical forms: Windows verbatim (`\\?\`) prefixes would
        // otherwise defeat the string comparison.
        let is_home = std::fs::canonicalize(&home)
            .map(|canonical_home| path == canonical_home)
            .unwrap_or(false)
            || path == home;
        if is_home {
            return true;
        }
    }
    // A path with no parent (or whose parent is itself) is a filesystem root
    // (`/`, `C:\`). `components().count() <= 1` covers prefix-only paths.
    match path.parent() {
        None => true,
        Some(parent) => parent.as_os_str().is_empty() || parent == path,
    }
}

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

/// Run an allowlisted program with arguments, capture stdout+stderr.
/// Returns `Ok(stdout)` on success (exit code 0), `Err(stderr)` on failure.
///
/// SECURITY: `program` must be a bare name in `ALLOWED_BINARIES`; `cwd`, when
/// given, must be an existing directory (canonicalized, never a filesystem
/// root). Anything else fails with a `Validation:` error.
#[tauri::command(rename_all = "camelCase")]
pub async fn shell_exec(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let program = validate_program(&program)?;
    let cwd = validate_cwd(cwd.as_deref())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_binaries_outside_allowlist() {
        for binary in ["sh", "cmd", "powershell", "pwsh", "python", "ffmpeg", ""] {
            assert!(
                validate_program(binary).is_err(),
                "expected rejection: '{binary}'"
            );
        }
        for binary in ["git", "node", "npm", "bun", "spectralang", "spectra-lsp"] {
            assert!(
                validate_program(binary).is_ok(),
                "expected allowlist hit: '{binary}'"
            );
        }
    }

    #[test]
    fn rejects_path_like_programs() {
        for binary in [
            "../git",
            "sub/git",
            "C:\\Windows\\System32\\cmd.exe",
            "/bin/sh",
            "git.exe ",
            "..",
            "git/../sh",
        ] {
            assert!(
                validate_program(binary).is_err(),
                "expected rejection: '{binary}'"
            );
        }
    }

    #[test]
    fn validates_cwd_exists_and_is_not_root() {
        assert!(validate_cwd(None).is_ok());
        assert!(validate_cwd(Some("")).is_err());
        assert!(validate_cwd(Some("/nonexistent-hyscode-cwd-xyz")).is_err());
        assert!(validate_cwd(Some(std::env::temp_dir().to_str().unwrap())).is_ok());
        #[cfg(target_os = "windows")]
        assert!(validate_cwd(Some("C:\\")).is_err());
        #[cfg(not(target_os = "windows"))]
        assert!(validate_cwd(Some("/")).is_err());
    }
}
