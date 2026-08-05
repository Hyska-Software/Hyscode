use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub col: usize,
    pub severity: String,
    pub message: String,
    pub source: String,
}

#[derive(Debug)]
struct CommandOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Clone, Copy)]
enum Provider {
    Cargo,
    TypeScript,
    Python,
}

#[derive(Debug)]
struct ProviderProject {
    provider: Provider,
    root: PathBuf,
}

#[tauri::command]
pub async fn get_diagnostics(
    workspace_path: String,
    path: Option<String>,
) -> Result<Vec<Diagnostic>, String> {
    let workspace = validate_workspace(&workspace_path)?;
    let requested = path
        .as_deref()
        .map(|value| resolve_requested_path(&workspace, value))
        .transpose()?;
    let providers = providers_for(&workspace, requested.as_deref())?;

    let mut diagnostics = Vec::new();
    for project in providers {
        let mut provider_diagnostics = match project.provider {
            Provider::Cargo => run_cargo(&project.root, requested.as_deref()).await?,
            Provider::TypeScript => run_typescript(&project.root, requested.as_deref()).await?,
            Provider::Python => run_python(&project.root, requested.as_deref()).await?,
        };
        diagnostics.append(&mut provider_diagnostics);
    }

    sort_and_deduplicate(&mut diagnostics);
    Ok(diagnostics)
}

fn validate_workspace(raw_path: &str) -> Result<PathBuf, String> {
    if raw_path.trim().is_empty() {
        return Err("Diagnostic workspace path cannot be empty.".to_string());
    }

    let path = Path::new(raw_path);
    let canonical = fs::canonicalize(path).map_err(|error| {
        format!(
            "Cannot access diagnostic workspace '{}': {error}",
            path.display()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "Diagnostic workspace '{}' is not a directory.",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn resolve_requested_path(workspace: &Path, raw_path: &str) -> Result<PathBuf, String> {
    if raw_path.trim().is_empty() {
        return Err("Diagnostic file path cannot be empty.".to_string());
    }

    let input = Path::new(raw_path);
    let candidate = if input.is_absolute() {
        input.to_path_buf()
    } else {
        workspace.join(input)
    };
    let resolved = if candidate.exists() {
        fs::canonicalize(&candidate).map_err(|error| {
            format!(
                "Cannot access diagnostic file '{}': {error}",
                candidate.display()
            )
        })?
    } else {
        let parent = candidate.parent().ok_or_else(|| {
            format!(
                "Cannot resolve diagnostic file path '{}'.",
                candidate.display()
            )
        })?;
        let canonical_parent = fs::canonicalize(parent).map_err(|error| {
            format!(
                "Cannot access diagnostic file directory '{}': {error}",
                parent.display()
            )
        })?;
        let file_name = candidate.file_name().ok_or_else(|| {
            format!(
                "Cannot resolve diagnostic file path '{}'.",
                candidate.display()
            )
        })?;
        canonical_parent.join(file_name)
    };

    if !is_within(workspace, &resolved) {
        return Err(format!(
            "Diagnostic file '{}' is outside the workspace.",
            resolved.display()
        ));
    }
    if resolved.exists() && !resolved.is_file() {
        return Err(format!(
            "Diagnostic path '{}' is not a file.",
            resolved.display()
        ));
    }
    Ok(resolved)
}

fn providers_for(
    workspace: &Path,
    requested: Option<&Path>,
) -> Result<Vec<ProviderProject>, String> {
    if let Some(path) = requested {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());

        return match extension.as_deref() {
            Some("py") | Some("pyw") | Some("pyi") => Ok(vec![ProviderProject {
                provider: Provider::Python,
                root: workspace.to_path_buf(),
            }]),
            Some("rs") => {
                require_project_provider(workspace, path, "Cargo.toml", Provider::Cargo, "Cargo")
            }
            Some("ts") | Some("tsx") | Some("js") | Some("jsx") | Some("mts") | Some("cts")
            | Some("mjs") | Some("cjs") => require_project_provider(
                workspace,
                path,
                "tsconfig.json",
                Provider::TypeScript,
                "TypeScript",
            ),
            _ => Ok(Vec::new()),
        };
    }

    let mut providers = Vec::new();
    for root in discover_project_roots(workspace, "Cargo.toml")? {
        providers.push(ProviderProject {
            provider: Provider::Cargo,
            root,
        });
    }
    for root in discover_project_roots(workspace, "tsconfig.json")? {
        providers.push(ProviderProject {
            provider: Provider::TypeScript,
            root,
        });
    }
    Ok(providers)
}

fn require_project_provider(
    workspace: &Path,
    requested: &Path,
    project_file: &str,
    provider: Provider,
    provider_name: &str,
) -> Result<Vec<ProviderProject>, String> {
    let Some(root) = nearest_project_root(workspace, requested, project_file) else {
        return Err(format!(
            "{provider_name} diagnostics requested, but '{}' was not found in workspace '{}'.",
            project_file,
            workspace.display()
        ));
    };
    Ok(vec![ProviderProject { provider, root }])
}

fn nearest_project_root(workspace: &Path, requested: &Path, project_file: &str) -> Option<PathBuf> {
    let start = if requested.is_dir() {
        requested
    } else {
        requested.parent().unwrap_or(workspace)
    };
    for ancestor in start.ancestors() {
        if !is_within(workspace, ancestor) {
            continue;
        }
        if ancestor.join(project_file).is_file() {
            return Some(ancestor.to_path_buf());
        }
        if paths_equal(ancestor, workspace) {
            break;
        }
    }
    None
}

fn discover_project_roots(workspace: &Path, project_file: &str) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    collect_project_roots(workspace, project_file, &mut roots)?;
    roots.sort_by_key(|path| comparable_path(path).len());

    let mut selected: Vec<PathBuf> = Vec::new();
    for root in roots {
        if selected.iter().any(|parent| is_within(parent, &root)) {
            continue;
        }
        selected.push(root);
    }
    selected.sort_by_key(|path| comparable_path(path));
    Ok(selected)
}

fn collect_project_roots(
    directory: &Path,
    project_file: &str,
    roots: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(|error| {
        format!(
            "Cannot inspect diagnostic workspace directory '{}': {error}",
            directory.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Cannot inspect an entry in diagnostic workspace '{}': {error}",
                directory.display()
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Cannot inspect diagnostic path '{}': {error}",
                path.display()
            )
        })?;
        if file_type.is_file()
            && path.file_name().and_then(|name| name.to_str()) == Some(project_file)
        {
            roots.push(directory.to_path_buf());
            continue;
        }
        if file_type.is_dir() && !is_ignored_directory(&path) {
            collect_project_roots(&path, project_file, roots)?;
        }
    }
    Ok(())
}

fn is_ignored_directory(path: &Path) -> bool {
    matches!(
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase())
            .as_deref(),
        Some(
            ".git"
                | ".hg"
                | ".svn"
                | "node_modules"
                | "target"
                | "dist"
                | "build"
                | ".turbo"
                | "coverage"
                | "__pycache__"
        )
    )
}

async fn run_cargo(
    project_root: &Path,
    requested: Option<&Path>,
) -> Result<Vec<Diagnostic>, String> {
    let args = vec![
        "check".to_string(),
        "--message-format=json".to_string(),
        "--workspace".to_string(),
    ];
    let output = run_command(
        "cargo",
        &args,
        project_root,
        Some(("CARGO_TERM_COLOR", "never")),
    )
    .await?;
    let mut diagnostics = parse_cargo_diagnostics(&output.stdout, project_root, requested);
    diagnostics.extend(parse_cargo_diagnostics(
        &output.stderr,
        project_root,
        requested,
    ));
    finish_provider("Cargo", &args, output, diagnostics)
}

async fn run_typescript(
    project_root: &Path,
    requested: Option<&Path>,
) -> Result<Vec<Diagnostic>, String> {
    let program = resolve_typescript_command(project_root);
    let args = vec![
        "--noEmit".to_string(),
        "--pretty".to_string(),
        "false".to_string(),
        "--project".to_string(),
        "tsconfig.json".to_string(),
    ];
    let output = run_command(&program, &args, project_root, None).await?;
    let combined = format!("{}\n{}", output.stdout, output.stderr);
    let diagnostics = parse_typescript_diagnostics(&combined, project_root, requested);
    finish_provider("TypeScript", &args, output, diagnostics)
}

async fn run_python(
    project_root: &Path,
    requested: Option<&Path>,
) -> Result<Vec<Diagnostic>, String> {
    let Some(requested) = requested else {
        return Ok(Vec::new());
    };
    let script = r#"import sys
source = sys.argv[1]
try:
    with open(source, "rb") as handle:
        compile(handle.read(), source, "exec")
except (SyntaxError, IndentationError) as error:
    line = error.lineno or 1
    column = error.offset or 1
    print(f"{source}:{line}:{column}: {type(error).__name__}: {error.msg}", file=sys.stderr)
    raise SystemExit(1)
"#;
    let args = vec![
        "-c".to_string(),
        script.to_string(),
        requested.to_string_lossy().into_owned(),
    ];
    let program = resolve_python_command(project_root);
    let output = run_command(&program, &args, project_root, None).await?;
    let combined = format!("{}\n{}", output.stdout, output.stderr);
    let diagnostics = parse_python_diagnostics(&combined, project_root, Some(requested));
    finish_provider("Python", &args, output, diagnostics)
}

async fn run_command(
    program: &str,
    args: &[String],
    cwd: &Path,
    environment: Option<(&str, &str)>,
) -> Result<CommandOutput, String> {
    let is_windows_wrapper = cfg!(target_os = "windows")
        && Path::new(program)
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
            });
    let mut command = if is_windows_wrapper {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/D", "/C"]).arg(program).args(args);
        cmd
    } else {
        let mut cmd = Command::new(program);
        cmd.args(args);
        cmd
    };

    command
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some((key, value)) = environment {
        command.env(key, value);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x0800_0000);
    }

    let output = timeout(COMMAND_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            format!(
                "Diagnostic command '{}' timed out after 120 seconds.",
                program
            )
        })?
        .map_err(|error| format!("Could not start diagnostic command '{}': {error}", program))?;

    Ok(CommandOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn finish_provider(
    provider: &str,
    args: &[String],
    output: CommandOutput,
    diagnostics: Vec<Diagnostic>,
) -> Result<Vec<Diagnostic>, String> {
    if !output.success && diagnostics.is_empty() {
        let detail = if output.stderr.trim().is_empty() {
            output.stdout.trim()
        } else {
            output.stderr.trim()
        };
        let detail = if detail.is_empty() {
            "the process exited without diagnostic output"
        } else {
            detail
        };
        return Err(format!(
            "{provider} diagnostics failed ({}): {detail}",
            args.join(" ")
        ));
    }
    Ok(diagnostics)
}

fn parse_cargo_diagnostics(
    text: &str,
    workspace: &Path,
    requested: Option<&Path>,
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("reason").and_then(Value::as_str) != Some("compiler-message") {
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let severity = match message.get("level").and_then(Value::as_str) {
            Some("error") => "error",
            Some("warning") => "warning",
            _ => continue,
        };
        let Some(span) = message
            .get("spans")
            .and_then(Value::as_array)
            .and_then(|spans| {
                spans
                    .iter()
                    .find(|span| span.get("is_primary").and_then(Value::as_bool) == Some(true))
                    .or_else(|| spans.first())
            })
        else {
            continue;
        };
        let Some(file_name) = span.get("file_name").and_then(Value::as_str) else {
            continue;
        };
        let Some(file) = resolve_output_file(workspace, file_name) else {
            continue;
        };
        if requested.is_some_and(|requested| !paths_equal(&file, requested)) {
            continue;
        }
        let line = span.get("line_start").and_then(Value::as_u64).unwrap_or(1) as usize;
        let col = span
            .get("column_start")
            .and_then(Value::as_u64)
            .unwrap_or(1) as usize;
        let message_text = message
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Rust compiler diagnostic")
            .to_string();
        diagnostics.push(Diagnostic {
            file: file.to_string_lossy().into_owned(),
            line: line.max(1),
            col: col.max(1),
            severity: severity.to_string(),
            message: message_text,
            source: "rustc".to_string(),
        });
    }
    diagnostics
}

fn parse_typescript_diagnostics(
    text: &str,
    workspace: &Path,
    requested: Option<&Path>,
) -> Vec<Diagnostic> {
    let Ok(paren_pattern) = Regex::new(
        r"^(?P<file>.+?)\((?P<line>\d+),(?P<col>\d+)\):\s*(?P<severity>error|warning)(?:\s+(?P<code>[A-Za-z]+\d+))?\s*:\s*(?P<message>.+)$",
    ) else {
        return Vec::new();
    };
    let Ok(colon_pattern) = Regex::new(
        r"^(?P<file>.+?):(?P<line>\d+):(?P<col>\d+)\s*-\s*(?P<severity>error|warning)(?:\s+(?P<code>[A-Za-z]+\d+))?\s*:\s*(?P<message>.+)$",
    ) else {
        return Vec::new();
    };

    let mut diagnostics = Vec::new();
    for line in text.lines() {
        let captures = paren_pattern
            .captures(line)
            .or_else(|| colon_pattern.captures(line));
        let Some(captures) = captures else {
            continue;
        };
        let Some(file_name) = captures.name("file").map(|value| value.as_str()) else {
            continue;
        };
        let Some(file) = resolve_output_file(workspace, file_name) else {
            continue;
        };
        if requested.is_some_and(|requested| !paths_equal(&file, requested)) {
            continue;
        }
        let line_number = captures
            .name("line")
            .and_then(|value| value.as_str().parse::<usize>().ok())
            .unwrap_or(1);
        let column = captures
            .name("col")
            .and_then(|value| value.as_str().parse::<usize>().ok())
            .unwrap_or(1);
        let Some(severity) = captures.name("severity").map(|value| value.as_str()) else {
            continue;
        };
        let message = captures
            .name("message")
            .map(|value| value.as_str().trim().to_string())
            .unwrap_or_else(|| "TypeScript diagnostic".to_string());
        let source = captures
            .name("code")
            .map(|value| value.as_str().to_string())
            .unwrap_or_else(|| "typescript".to_string());
        diagnostics.push(Diagnostic {
            file: file.to_string_lossy().into_owned(),
            line: line_number.max(1),
            col: column.max(1),
            severity: severity.to_string(),
            message,
            source,
        });
    }
    diagnostics
}

fn parse_python_diagnostics(
    text: &str,
    workspace: &Path,
    requested: Option<&Path>,
) -> Vec<Diagnostic> {
    let Ok(pattern) = Regex::new(
        r"^(?P<file>.*):(?P<line>\d+):(?P<col>\d+):\s*(?P<kind>[A-Za-z]+Error):\s*(?P<message>.+)$",
    ) else {
        return Vec::new();
    };
    let mut diagnostics = Vec::new();
    for line in text.lines() {
        let Some(captures) = pattern.captures(line) else {
            continue;
        };
        let Some(file_name) = captures.name("file").map(|value| value.as_str()) else {
            continue;
        };
        let Some(file) = resolve_output_file(workspace, file_name) else {
            continue;
        };
        if requested.is_some_and(|requested| !paths_equal(&file, requested)) {
            continue;
        }
        let line_number = captures
            .name("line")
            .and_then(|value| value.as_str().parse::<usize>().ok())
            .unwrap_or(1);
        let column = captures
            .name("col")
            .and_then(|value| value.as_str().parse::<usize>().ok())
            .unwrap_or(1);
        let kind = captures
            .name("kind")
            .map(|value| value.as_str())
            .unwrap_or("SyntaxError");
        let message = captures
            .name("message")
            .map(|value| value.as_str().trim().to_string())
            .unwrap_or_else(|| kind.to_string());
        diagnostics.push(Diagnostic {
            file: file.to_string_lossy().into_owned(),
            line: line_number.max(1),
            col: column.max(1),
            severity: "error".to_string(),
            message: format!("{kind}: {message}"),
            source: "python".to_string(),
        });
    }
    diagnostics
}

fn resolve_output_file(workspace: &Path, raw_file: &str) -> Option<PathBuf> {
    let trimmed = raw_file.trim();
    if trimmed.is_empty() || trimmed.starts_with('<') {
        return None;
    }
    let input = Path::new(trimmed);
    let candidate = if input.is_absolute() {
        input.to_path_buf()
    } else {
        workspace.join(input)
    };
    let resolved = if candidate.exists() {
        fs::canonicalize(&candidate).ok()?
    } else {
        candidate
    };
    is_within(workspace, &resolved).then_some(resolved)
}

fn resolve_typescript_command(workspace: &Path) -> String {
    find_local_tool(
        workspace,
        &[
            "node_modules/.bin/tsc.cmd",
            "node_modules/.bin/tsc",
            "node_modules/typescript/bin/tsc",
        ],
        "tsc",
    )
}

fn resolve_python_command(workspace: &Path) -> String {
    find_local_tool(
        workspace,
        &[
            "venv/Scripts/python.exe",
            ".venv/Scripts/python.exe",
            "venv/bin/python",
            ".venv/bin/python",
        ],
        "python",
    )
}

fn find_local_tool(workspace: &Path, relative_candidates: &[&str], fallback: &str) -> String {
    for ancestor in workspace.ancestors() {
        for relative in relative_candidates {
            let candidate = ancestor.join(relative);
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    fallback.to_string()
}

fn sort_and_deduplicate(diagnostics: &mut Vec<Diagnostic>) {
    diagnostics.sort_by(|left, right| {
        comparable_path(Path::new(&left.file))
            .cmp(&comparable_path(Path::new(&right.file)))
            .then(left.line.cmp(&right.line))
            .then(left.col.cmp(&right.col))
            .then(left.severity.cmp(&right.severity))
            .then(left.message.cmp(&right.message))
            .then(left.source.cmp(&right.source))
    });

    let mut seen = HashSet::new();
    diagnostics.retain(|diagnostic| {
        seen.insert(format!(
            "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
            comparable_path(Path::new(&diagnostic.file)),
            diagnostic.line,
            diagnostic.col,
            diagnostic.severity,
            diagnostic.message,
            diagnostic.source
        ))
    });
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    comparable_path(left) == comparable_path(right)
}

fn is_within(root: &Path, candidate: &Path) -> bool {
    let root = comparable_path(root);
    let candidate = comparable_path(candidate);
    if root == candidate {
        return true;
    }
    let prefix = if root.ends_with('/') {
        root
    } else {
        format!("{root}/")
    };
    candidate.starts_with(&prefix)
}

fn comparable_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    let value = if let Some(rest) = value.strip_prefix("//?/") {
        if let Some(unc_path) = rest.strip_prefix("UNC/") {
            format!("//{unc_path}")
        } else {
            rest.to_string()
        }
    } else {
        value
    };
    #[cfg(target_os = "windows")]
    {
        value.to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct TestWorkspace {
        path: PathBuf,
    }

    impl TestWorkspace {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn fixture_workspace() -> TestWorkspace {
        let suffix = format!(
            "hyscode-diagnostics-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        );
        let path = std::env::temp_dir().join(suffix);
        fs::create_dir_all(&path).expect("fixture workspace should be created");
        TestWorkspace { path }
    }

    #[test]
    fn parses_cargo_json_and_filters_by_file() {
        let workspace = fixture_workspace();
        let source = workspace.path().join("src").join("lib.rs");
        fs::create_dir_all(source.parent().expect("source parent")).expect("source directory");
        fs::File::create(&source).expect("source file");
        let payload = serde_json::json!({
            "reason": "compiler-message",
            "message": {
                "level": "error",
                "message": "expected `;`",
                "code": { "code": "E0308" },
                "spans": [{
                    "file_name": "src/lib.rs",
                    "line_start": 4,
                    "column_start": 7,
                    "is_primary": true
                }]
            }
        });

        let diagnostics =
            parse_cargo_diagnostics(&payload.to_string(), workspace.path(), Some(&source));

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].severity, "error");
        assert_eq!(diagnostics[0].source, "rustc");
        assert_eq!(diagnostics[0].line, 4);
        assert_eq!(diagnostics[0].col, 7);
    }

    #[test]
    fn parses_typescript_windows_style_output_with_spaces() {
        let workspace = fixture_workspace();
        let source = workspace.path().join("folder with spaces").join("app.ts");
        fs::create_dir_all(source.parent().expect("source parent")).expect("source directory");
        fs::File::create(&source).expect("source file");
        let output = format!(
            "{}(12,9): error TS2322: Type 'string' is not assignable to type 'number'.",
            source.display()
        );

        let diagnostics = parse_typescript_diagnostics(&output, workspace.path(), Some(&source));

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].source, "TS2322");
        assert_eq!(diagnostics[0].line, 12);
        assert_eq!(diagnostics[0].col, 9);
    }

    #[test]
    fn parses_python_output_without_creating_cache() {
        let workspace = fixture_workspace();
        let source = workspace.path().join("broken.py");
        let mut file = fs::File::create(&source).expect("source file");
        writeln!(file, "if True print('broken')").expect("source contents");
        let output = format!(
            "{}:1:8: SyntaxError: invalid syntax",
            source.to_string_lossy()
        );

        let diagnostics = parse_python_diagnostics(&output, workspace.path(), Some(&source));

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].severity, "error");
        assert_eq!(diagnostics[0].source, "python");
        assert!(!workspace.path().join("__pycache__").exists());
    }

    #[test]
    fn runs_python_syntax_check_without_creating_cache() {
        let workspace = fixture_workspace();
        let source = workspace.path().join("broken.py");
        let mut file = fs::File::create(&source).expect("source file");
        writeln!(file, "if True print('broken')").expect("source contents");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should be created");

        let result = runtime.block_on(get_diagnostics(
            workspace.path().to_string_lossy().into_owned(),
            Some(source.to_string_lossy().into_owned()),
        ));

        let diagnostics = result.expect("Python diagnostics should execute");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].source, "python");
        assert!(!workspace.path().join("__pycache__").exists());
    }

    #[test]
    fn discovers_nested_rust_and_typescript_projects_for_global_queries() {
        let workspace = fixture_workspace();
        let rust_root = workspace
            .path()
            .join("apps")
            .join("desktop")
            .join("src-tauri");
        let typescript_root = workspace.path().join("packages").join("ui");
        fs::create_dir_all(&rust_root).expect("Rust project directory");
        fs::create_dir_all(&typescript_root).expect("TypeScript project directory");
        fs::File::create(rust_root.join("Cargo.toml")).expect("Cargo manifest");
        fs::File::create(typescript_root.join("tsconfig.json")).expect("TypeScript config");

        let providers = providers_for(workspace.path(), None).expect("projects should be found");

        assert_eq!(providers.len(), 2);
        assert!(providers.iter().any(|project| {
            matches!(project.provider, Provider::Cargo) && paths_equal(&project.root, &rust_root)
        }));
        assert!(providers.iter().any(|project| {
            matches!(project.provider, Provider::TypeScript)
                && paths_equal(&project.root, &typescript_root)
        }));
    }

    #[test]
    fn propagates_provider_failures_when_no_diagnostic_was_parsed() {
        let error = finish_provider(
            "TypeScript",
            &["--project".to_string(), "tsconfig.json".to_string()],
            CommandOutput {
                success: false,
                stdout: String::new(),
                stderr: "Cannot find module 'typescript'.".to_string(),
            },
            Vec::new(),
        )
        .expect_err("provider failure must not become an empty result");

        assert!(error.contains("TypeScript diagnostics failed"));
        assert!(error.contains("Cannot find module"));
    }

    #[test]
    fn rejects_paths_outside_workspace_and_missing_project_configuration() {
        let workspace = fixture_workspace();
        let outside = workspace.path().join("..").join("outside.rs");
        assert!(resolve_requested_path(workspace.path(), &outside.to_string_lossy()).is_err());

        let source = workspace.path().join("main.rs");
        fs::File::create(&source).expect("source file");
        let error = providers_for(workspace.path(), Some(&source))
            .expect_err("Cargo config should be required");
        assert!(error.contains("Cargo.toml"));
    }

    #[test]
    fn deduplicates_and_sorts_multiple_provider_results() {
        let mut diagnostics = vec![
            Diagnostic {
                file: "src/lib.rs".to_string(),
                line: 2,
                col: 1,
                severity: "warning".to_string(),
                message: "second".to_string(),
                source: "cargo".to_string(),
            },
            Diagnostic {
                file: "src/lib.rs".to_string(),
                line: 1,
                col: 1,
                severity: "error".to_string(),
                message: "first".to_string(),
                source: "cargo".to_string(),
            },
            Diagnostic {
                file: "src/lib.rs".to_string(),
                line: 1,
                col: 1,
                severity: "error".to_string(),
                message: "first".to_string(),
                source: "cargo".to_string(),
            },
        ];

        sort_and_deduplicate(&mut diagnostics);

        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].line, 1);
        assert_eq!(diagnostics[1].line, 2);
    }
}
