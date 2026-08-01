// ─── Git Backend ─────────────────────────────────────────────────────────────
// Execution strategies for git operations.
//
// The seam between the two adapters is explicit here:
//   - Reads (status, diff, log, blame) go through libgit2 — in-process, fast.
//   - Writes and remote operations go through the `git` CLI so user hooks,
//     credential helpers and GitHub auth keep working.
// Commands in `git.rs` stay thin and delegate to this module; `github_pr.rs`
// re-uses the CLI adapter for its own plumbing.

use super::keychain::KeychainState;
use super::utils::cmd;
use git2::{Delta, Diff, Repository, StatusOptions};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

// ── Serializable types ──────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct GitFile {
    pub path: String,
    pub absolute_path: String,
    pub status: String, // "M" | "A" | "D" | "R" | "C" | "T"
    pub old_path: Option<String>,
}

#[derive(Serialize)]
pub struct GitStatusResult {
    pub staged: Vec<GitFile>,
    pub unstaged: Vec<GitFile>,
    pub untracked: Vec<GitFile>,
    pub conflicts: Vec<GitFile>,
}

#[derive(Serialize)]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
}

// ── Repository helpers (libgit2 adapter) ────────────────────────────────────

pub fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::discover(path).map_err(|e| format!("Git error: {}", e))
}

pub fn worktree_root(repo: &Repository) -> Result<&Path, String> {
    repo.workdir()
        .ok_or_else(|| "Bare repositories are not supported".to_string())
}

pub fn delta_to_status(delta: Delta) -> &'static str {
    match delta {
        Delta::Added => "A",
        Delta::Deleted => "D",
        Delta::Modified => "M",
        Delta::Renamed => "R",
        Delta::Copied => "C",
        Delta::Typechange => "T",
        _ => "M",
    }
}

/// Reject repository-relative paths that escape the worktree (absolute paths,
/// parent traversal, drive prefixes).
pub fn validate_repo_relative_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if path.trim().is_empty() || candidate.is_absolute() {
        return Err(format!("Invalid repository-relative path: '{path}'"));
    }
    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!("Path escapes the repository worktree: '{path}'"));
    }
    Ok(candidate.to_path_buf())
}

fn normalize_separators(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

fn path_equals(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// Normalize a user-supplied path to a repository-relative path.
///
/// Accepts both repo-relative paths and absolute paths that resolve inside
/// the worktree (the agent resolves inputs to absolute paths for containment
/// before invoking). Rejects anything that escapes the worktree, so callers
/// never need a second, weaker check. Idempotent for repo-relative input.
pub fn normalize_repo_relative_path(repo: &Repository, path: &str) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("Invalid repository-relative path: ''".to_string());
    }
    if !Path::new(path).is_absolute() {
        validate_repo_relative_path(path)?;
        return Ok(path.to_string());
    }

    let worktree = normalize_separators(&worktree_root(repo)?.to_string_lossy());
    let worktree = worktree.trim_end_matches(['\\', '/']);
    let candidate = normalize_separators(path);
    let candidate = candidate.trim_end_matches(['\\', '/']);
    let prefix = format!("{worktree}\\");
    let inside = candidate
        .get(..prefix.len())
        .is_some_and(|head| path_equals(head, &prefix));
    if !inside {
        return Err(format!("Path escapes the repository worktree: '{path}'"));
    }
    Ok(candidate[prefix.len()..].to_string())
}

pub fn absolute_worktree_path(repo: &Repository, path: &str) -> Result<String, String> {
    let relative = validate_repo_relative_path(path)?;
    Ok(worktree_root(repo)?
        .join(relative)
        .to_string_lossy()
        .to_string())
}

pub fn git_file(
    repo: &Repository,
    path: String,
    status: &str,
    old_path: Option<String>,
) -> Result<GitFile, String> {
    Ok(GitFile {
        absolute_path: absolute_worktree_path(repo, &path)?,
        path,
        status: status.to_string(),
        old_path,
    })
}

pub fn collect_status(repo: &Repository) -> Result<GitStatusResult, String> {
    let mut result = GitStatusResult {
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        conflicts: Vec::new(),
    };

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Status error: {e}"))?;

    for entry in statuses.iter() {
        let path = entry
            .path()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Git returned a status entry without a path".to_string())?
            .to_string();
        let status = entry.status();

        if status.is_conflicted() {
            result.conflicts.push(git_file(repo, path, "U", None)?);
            continue;
        }

        let staged = if status.is_index_new() {
            Some(("A", None))
        } else if status.is_index_modified() {
            Some(("M", None))
        } else if status.is_index_deleted() {
            Some(("D", None))
        } else if status.is_index_renamed() {
            let old_path = entry.head_to_index().and_then(|delta| {
                delta
                    .old_file()
                    .path()
                    .map(|value| value.to_string_lossy().to_string())
            });
            Some(("R", old_path))
        } else if status.is_index_typechange() {
            Some(("T", None))
        } else {
            None
        };
        if let Some((kind, old_path)) = staged {
            result
                .staged
                .push(git_file(repo, path.clone(), kind, old_path)?);
        }

        let unstaged = if status.is_wt_modified() {
            Some(("M", None))
        } else if status.is_wt_deleted() {
            Some(("D", None))
        } else if status.is_wt_renamed() {
            let old_path = entry.index_to_workdir().and_then(|delta| {
                delta
                    .old_file()
                    .path()
                    .map(|value| value.to_string_lossy().to_string())
            });
            Some(("R", old_path))
        } else if status.is_wt_typechange() {
            Some(("T", None))
        } else {
            None
        };
        if let Some((kind, old_path)) = unstaged {
            result
                .unstaged
                .push(git_file(repo, path.clone(), kind, old_path)?);
        }

        if status.is_wt_new() {
            result.untracked.push(git_file(repo, path, "?", None)?);
        }
    }

    Ok(result)
}

pub fn list_remotes(repo: &Repository) -> Result<Vec<GitRemoteInfo>, String> {
    let remotes = repo.remotes().map_err(|e| format!("Remotes error: {e}"))?;
    Ok(remotes
        .iter()
        .flatten()
        .filter_map(|name| {
            repo.find_remote(name).ok().map(|remote| GitRemoteInfo {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
            })
        })
        .collect())
}

// ── Diff-to-text (libgit2 adapter) ──────────────────────────────────────────

/// Accumulate patch lines into a string, capping the collected text at
/// `max_bytes` while still counting every printed byte (for truncation notes).
/// Non-UTF-8 content is skipped and flagged instead of corrupting the output.
pub struct PatchTextAccumulator {
    pub output: String,
    pub total_bytes: usize,
    pub invalid_utf8: bool,
    max_bytes: usize,
}

impl PatchTextAccumulator {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            output: String::new(),
            total_bytes: 0,
            invalid_utf8: false,
            max_bytes,
        }
    }

    pub fn line(&mut self, origin: char, content: &[u8]) {
        if matches!(origin, '+' | '-' | ' ') {
            self.total_bytes = self.total_bytes.saturating_add(origin.len_utf8());
            if self.output.len() < self.max_bytes {
                self.output.push(origin);
            }
        }
        self.total_bytes = self.total_bytes.saturating_add(content.len());
        match std::str::from_utf8(content) {
            Ok(text) => append_bounded_utf8(&mut self.output, text, self.max_bytes),
            Err(_) => self.invalid_utf8 = true,
        }
    }
}

fn append_bounded_utf8(output: &mut String, value: &str, maximum_bytes: usize) {
    let remaining = maximum_bytes.saturating_sub(output.len());
    if remaining == 0 {
        return;
    }
    let mut boundary = remaining.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    output.push_str(&value[..boundary]);
}

/// Print a diff in unified patch format, capping the collected text at
/// `max_bytes`. Returns `(collected, total_bytes, invalid_utf8)`.
pub fn diff_patch_text(diff: &Diff<'_>, max_bytes: usize) -> Result<(String, usize, bool), String> {
    let mut accumulator = PatchTextAccumulator::new(max_bytes);
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        accumulator.line(line.origin(), line.content());
        true
    })
    .map_err(|e| format!("Diff print error: {}", e))?;
    Ok((
        accumulator.output,
        accumulator.total_bytes,
        accumulator.invalid_utf8,
    ))
}

// ── CLI adapter ─────────────────────────────────────────────────────────────

fn run_git_command<I, S>(command: &mut Command, repo_path: &str, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = command
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(stderr.trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run a `git` CLI command without auth injection (local operations only).
pub fn run_git_cli<I, S>(repo_path: &str, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    run_git_command(&mut cmd("git"), repo_path, args)
}

fn is_github_https_url(url: &str) -> bool {
    url.starts_with("https://github.com/") || url.starts_with("http://github.com/")
}

fn github_extraheader(token: &str) -> String {
    // GitHub's git smart HTTP endpoint requires HTTP Basic auth — Bearer tokens
    // are only accepted by the REST API (api.github.com). The `x-access-token`
    // username is the standard pattern used by GitHub Actions and CI systems.
    use base64::Engine as _;
    let credentials =
        base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{token}"));
    format!("Authorization: Basic {credentials}")
}

fn remote_url(repo_path: &str, remote_name: &str) -> Option<String> {
    let repo = open_repo(repo_path).ok()?;
    let remote = repo.find_remote(remote_name).ok()?;
    remote.url().map(String::from)
}

/// Inject the stored GitHub token as an `http.extraheader` when the target
/// remote points at github.com. Keeps private-repository auth working without
/// persisting credentials in the repository config. Non-GitHub URLs (or a
/// missing token) leave the command untouched.
pub fn inject_github_auth(command: &mut Command, url: &str, token: Option<&str>) {
    if is_github_https_url(url) {
        if let Some(token) = token.filter(|value| !value.is_empty()) {
            command
                .arg("-c")
                .arg(format!("http.extraheader={}", github_extraheader(token)));
        }
    }
}

/// Run a `git` CLI command, injecting the stored GitHub token as an
/// `http.extraheader` when the target remote points at github.com.
pub fn run_git_cli_with_github_auth(
    keychain: &KeychainState,
    repo_path: &str,
    remote_hint: Option<&str>,
    args: Vec<String>,
) -> Result<String, String> {
    let mut command = cmd("git");

    let remote_name = remote_hint.map(String::from).or_else(|| {
        run_git_cli(
            repo_path,
            [
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
        .ok()
        .map(|upstream| upstream.trim().split('/').next().unwrap_or("").to_string())
        .filter(|name| !name.is_empty())
    });

    let token = super::github_repos::github_token_option(&keychain.0);
    if let Some(url) = remote_name
        .as_deref()
        .and_then(|name| remote_url(repo_path, name))
    {
        inject_github_auth(&mut command, &url, token.as_deref());
    }

    run_git_command(&mut command, repo_path, args)
}
