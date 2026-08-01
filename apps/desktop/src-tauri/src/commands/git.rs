use super::git_backend::{
    collect_status, delta_to_status, diff_patch_text, inject_github_auth, list_remotes,
    normalize_repo_relative_path, run_git_cli_with_github_auth, worktree_root, GitFile,
    GitStatusResult, PatchTextAccumulator,
};
pub use super::git_backend::{open_repo, run_git_cli, GitRemoteInfo};
use super::keychain::KeychainState;
use git2::{BranchType, Delta, DiffOptions, ErrorCode, Patch, Repository, Sort};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::State;

// ── Serializable Types ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
}

#[derive(Serialize)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Serialize)]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
}

#[derive(Serialize)]
pub struct GitAheadBehind {
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Serialize)]
pub struct GitUpstreamInfo {
    pub reference: String,
    pub remote: Option<String>,
    pub branch: String,
}

#[derive(Serialize)]
pub struct GitRepositorySnapshot {
    pub repository_root: String,
    pub worktree_root: Option<String>,
    pub head_state: String,
    pub current_branch: Option<String>,
    pub head_oid: Option<String>,
    pub upstream: Option<GitUpstreamInfo>,
    pub ahead: usize,
    pub behind: usize,
    pub operation_state: String,
    pub remotes: Vec<GitRemoteInfo>,
    pub staged: Vec<GitFile>,
    pub unstaged: Vec<GitFile>,
    pub untracked: Vec<GitFile>,
    pub conflicts: Vec<GitFile>,
}

#[derive(Serialize)]
pub struct GitFileContent {
    pub original: String,
    pub modified: String,
}

#[derive(Serialize)]
pub struct GitDiffContent {
    pub original: Option<String>,
    pub modified: Option<String>,
    pub original_missing: bool,
    pub modified_missing: bool,
    pub is_binary: bool,
}

#[derive(Serialize, Clone)]
pub struct GitCommitContextFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub is_binary: bool,
    pub patch: Option<String>,
    pub patch_truncated: bool,
    pub patch_bytes_omitted: usize,
}

#[derive(Serialize)]
pub struct GitCommitContext {
    pub fingerprint: String,
    pub files: Vec<GitCommitContextFile>,
    pub patch_bytes_included: usize,
    pub patch_bytes_omitted: usize,
}

#[derive(Serialize)]
pub struct GitIdentityConfig {
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct CommitFileChange {
    pub path: String,
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize, Clone)]
pub struct GitBlameHunk {
    pub start_line: u32,
    pub lines_in_hunk: u32,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub short_hash: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct CommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub files: Vec<CommitFileChange>,
    pub total_insertions: u32,
    pub total_deletions: u32,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn repository_root(repo: &Repository) -> String {
    repo.path()
        .parent()
        .unwrap_or_else(|| repo.path())
        .to_string_lossy()
        .to_string()
}

const COMMIT_CONTEXT_PATCH_BUDGET: usize = 32 * 1024;
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

struct StagedContextFile {
    diff_index: usize,
    path: String,
    old_path: Option<String>,
    status: String,
    is_binary: bool,
    fingerprint_material: Vec<u8>,
}

fn update_fingerprint(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(FNV_PRIME);
    }
    *hash ^= 0xff;
    *hash = hash.wrapping_mul(FNV_PRIME);
}

fn staged_diff<'repo>(repo: &'repo Repository) -> Result<git2::Diff<'repo>, String> {
    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let mut diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, None)
        .map_err(|error| format!("Commit context diff error: {error}"))?;
    diff.find_similar(None)
        .map_err(|error| format!("Commit context rename detection error: {error}"))?;
    Ok(diff)
}

fn staged_context_files(diff: &git2::Diff<'_>) -> Result<(String, Vec<StagedContextFile>), String> {
    let mut files = Vec::with_capacity(diff.deltas().len());

    for index in 0..diff.deltas().len() {
        let delta = diff
            .get_delta(index)
            .ok_or_else(|| format!("Commit context delta {index} disappeared"))?;
        let status = delta_to_status(delta.status()).to_string();
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .ok_or_else(|| "Git returned a staged delta without a path".to_string())?
            .to_string_lossy()
            .to_string();
        let old_path = if delta.status() == Delta::Renamed || delta.status() == Delta::Copied {
            delta
                .old_file()
                .path()
                .map(|value| value.to_string_lossy().to_string())
        } else {
            None
        };

        let mut fingerprint_material = Vec::new();
        fingerprint_material.extend_from_slice(status.as_bytes());
        fingerprint_material.push(0xff);
        fingerprint_material.extend_from_slice(path.as_bytes());
        fingerprint_material.push(0xff);
        if let Some(value) = old_path.as_deref() {
            fingerprint_material.extend_from_slice(value.as_bytes());
        }
        fingerprint_material.push(0xff);
        fingerprint_material.extend_from_slice(delta.old_file().id().as_bytes());
        fingerprint_material.extend_from_slice(delta.new_file().id().as_bytes());

        let patch = Patch::from_diff(diff, index)
            .map_err(|error| format!("Commit context patch error for '{path}': {error}"))?;
        let is_binary =
            delta.old_file().is_binary() || delta.new_file().is_binary() || patch.is_none();

        files.push(StagedContextFile {
            diff_index: index,
            path,
            old_path,
            status,
            is_binary,
            fingerprint_material,
        });
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    let mut fingerprint = FNV_OFFSET_BASIS;
    for file in &files {
        update_fingerprint(&mut fingerprint, &file.fingerprint_material);
    }
    Ok((format!("{fingerprint:016x}"), files))
}

fn bounded_patch(
    diff: &git2::Diff<'_>,
    index: usize,
    maximum_bytes: usize,
    path: &str,
) -> Result<(Option<String>, usize), String> {
    let mut patch = match Patch::from_diff(diff, index)
        .map_err(|error| format!("Commit context patch error for '{path}': {error}"))?
    {
        Some(patch) => patch,
        None => return Ok((None, 0)),
    };
    let mut accumulator = PatchTextAccumulator::new(maximum_bytes);
    patch
        .print(&mut |_delta, _hunk, line| {
            accumulator.line(line.origin(), line.content());
            true
        })
        .map_err(|error| format!("Commit context patch error for '{path}': {error}"))?;

    if accumulator.invalid_utf8 {
        return Ok((None, 0));
    }
    let omitted = accumulator
        .total_bytes
        .saturating_sub(accumulator.output.len());
    Ok((Some(accumulator.output), omitted))
}

fn build_git_commit_context(repo: &Repository) -> Result<GitCommitContext, String> {
    let diff = staged_diff(repo)?;
    let (fingerprint, staged_files) = staged_context_files(&diff)?;
    let text_file_count = staged_files.iter().filter(|file| !file.is_binary).count();
    let per_file_budget = COMMIT_CONTEXT_PATCH_BUDGET
        .checked_div(text_file_count)
        .unwrap_or(0);
    let mut patch_bytes_included = 0;
    let mut patch_bytes_omitted = 0;

    let files = staged_files
        .into_iter()
        .map(|file| -> Result<GitCommitContextFile, String> {
            let (patch, omitted) = if file.is_binary {
                (None, 0)
            } else {
                bounded_patch(&diff, file.diff_index, per_file_budget, &file.path)?
            };
            let is_binary = file.is_binary || patch.is_none();
            let included = patch.as_ref().map_or(0, String::len);
            patch_bytes_included += included;
            patch_bytes_omitted += omitted;

            Ok(GitCommitContextFile {
                path: file.path,
                old_path: file.old_path,
                status: file.status,
                is_binary,
                patch,
                patch_truncated: omitted > 0,
                patch_bytes_omitted: omitted,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(GitCommitContext {
        fingerprint,
        files,
        patch_bytes_included,
        patch_bytes_omitted,
    })
}

fn repository_operation_state(repo: &Repository) -> &'static str {
    match repo.state() {
        git2::RepositoryState::Clean => "clean",
        git2::RepositoryState::Merge => "merging",
        git2::RepositoryState::Rebase
        | git2::RepositoryState::RebaseInteractive
        | git2::RepositoryState::RebaseMerge => "rebasing",
        git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
            "cherry-picking"
        }
        git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => "reverting",
        git2::RepositoryState::Bisect => "bisecting",
        git2::RepositoryState::ApplyMailbox | git2::RepositoryState::ApplyMailboxOrRebase => {
            "applying-mailbox"
        }
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn git_is_repo(path: String) -> bool {
    Repository::discover(&path).is_ok()
}

#[tauri::command]
pub fn git_init(path: String, initial_branch: Option<String>) -> Result<(), String> {
    let branch = initial_branch
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "main".to_string());
    run_git_cli(&path, ["init", "--initial-branch", branch.as_str()]).map(|_| ())
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatusResult, String> {
    let repo = open_repo(&repo_path)?;
    collect_status(&repo)
}

#[tauri::command]
pub fn git_repository_snapshot(repo_path: String) -> Result<GitRepositorySnapshot, String> {
    let repo = open_repo(&repo_path)?;
    let status = collect_status(&repo)?;
    let worktree = repo
        .workdir()
        .map(|path| path.to_string_lossy().to_string());

    let (head_state, current_branch, head_oid, upstream, ahead, behind) = match repo.head() {
        Ok(head) if head.is_branch() => {
            let branch_name = head.shorthand().map(String::from);
            let local_oid = head.target();
            let upstream = branch_name
                .as_deref()
                .and_then(|name| repo.find_branch(name, BranchType::Local).ok())
                .and_then(|branch| branch.upstream().ok())
                .and_then(|branch| {
                    let reference = branch.name().ok().flatten()?.to_string();
                    let shorthand = reference
                        .strip_prefix("refs/remotes/")
                        .unwrap_or(&reference)
                        .to_string();
                    let mut parts = shorthand.splitn(2, '/');
                    let remote = parts.next().map(String::from);
                    let remote_branch = parts.next().unwrap_or(&shorthand).to_string();
                    Some((
                        GitUpstreamInfo {
                            reference,
                            remote,
                            branch: remote_branch,
                        },
                        branch.get().target(),
                    ))
                });
            let (upstream_info, upstream_oid) = upstream
                .map(|(info, oid)| (Some(info), oid))
                .unwrap_or((None, None));
            let (ahead, behind) = match (local_oid, upstream_oid) {
                (Some(local), Some(remote)) => {
                    repo.graph_ahead_behind(local, remote).unwrap_or((0, 0))
                }
                _ => (0, 0),
            };
            (
                "branch".to_string(),
                branch_name,
                local_oid.map(|oid| oid.to_string()),
                upstream_info,
                ahead,
                behind,
            )
        }
        Ok(head) => (
            "detached".to_string(),
            None,
            head.target().map(|oid| oid.to_string()),
            None,
            0,
            0,
        ),
        Err(error) if error.code() == ErrorCode::UnbornBranch => {
            let branch_name = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|head| head.symbolic_target().map(String::from))
                .map(|reference| {
                    reference
                        .strip_prefix("refs/heads/")
                        .unwrap_or(&reference)
                        .to_string()
                });
            ("unborn".to_string(), branch_name, None, None, 0, 0)
        }
        Err(error) => return Err(format!("HEAD error: {error}")),
    };

    Ok(GitRepositorySnapshot {
        repository_root: repository_root(&repo),
        worktree_root: worktree,
        head_state,
        current_branch,
        head_oid,
        upstream,
        ahead,
        behind,
        operation_state: repository_operation_state(&repo).to_string(),
        remotes: list_remotes(&repo)?,
        staged: status.staged,
        unstaged: status.unstaged,
        untracked: status.untracked,
        conflicts: status.conflicts,
    })
}

// ── Diff Hunks ───────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct DiffHunkInfo {
    pub new_start: u32,
    pub new_lines: u32,
    pub old_lines: u32,
}

#[tauri::command]
pub fn git_diff_hunks(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<Vec<DiffHunkInfo>, String> {
    let repo = open_repo(&repo_path)?;
    let file_path = normalize_repo_relative_path(&repo, &file_path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| format!("Diff hunks error: {}", e))?;

    let mut hunks: Vec<DiffHunkInfo> = Vec::new();

    diff.foreach(
        &mut |_, _| true,
        None,
        Some(&mut |_delta, hunk| {
            hunks.push(DiffHunkInfo {
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                old_lines: hunk.old_lines(),
            });
            true
        }),
        None,
    )
    .map_err(|e| format!("Diff foreach error: {}", e))?;

    Ok(hunks)
}

const DEFAULT_DIFF_BUDGET: usize = 32 * 1024;

/// Unified diff of all staged changes (index vs HEAD) in a single pass,
/// capped at `DEFAULT_DIFF_BUDGET` bytes with a truncation note.
/// Kept for UI compatibility; new consumers use `git_uncommitted_diff`.
#[tauri::command]
pub fn git_diff_staged_all(repo_path: String) -> Result<String, String> {
    git_uncommitted_diff(repo_path, true, None)
}

/// Single-pass unified diff of uncommitted changes — index vs HEAD when
/// `staged`, worktree vs index otherwise — capped at `max_bytes` with a
/// truncation note. Replaces the agent's N+1 status + per-file diff loop.
#[tauri::command]
pub fn git_uncommitted_diff(
    repo_path: String,
    staged: bool,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let mut opts = DiffOptions::new();
    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| format!("Diff error: {}", e))?;

    let budget = max_bytes.unwrap_or(DEFAULT_DIFF_BUDGET);
    let (text, total_bytes, _invalid) = diff_patch_text(&diff, budget)?;
    if total_bytes > text.len() {
        return Ok(format!(
            "{text}\n... (diff truncated; {} bytes omitted)",
            total_bytes - text.len()
        ));
    }
    Ok(text)
}

#[tauri::command]
pub fn git_commit_context(repo_path: String) -> Result<GitCommitContext, String> {
    let repo = open_repo(&repo_path)?;
    build_git_commit_context(&repo)
}

#[tauri::command]
pub fn git_staged_fingerprint(repo_path: String) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let diff = staged_diff(&repo)?;
    staged_context_files(&diff).map(|(fingerprint, _)| fingerprint)
}

#[tauri::command]
pub fn git_diff_file(repo_path: String, file_path: String, staged: bool) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let file_path = normalize_repo_relative_path(&repo, &file_path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = if staged {
        // Diff index vs HEAD
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        // Diff workdir vs index
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| format!("Diff error: {}", e))?;

    let (text, _, _) = diff_patch_text(&diff, usize::MAX)?;
    Ok(text)
}

fn blob_bytes_from_head(repo: &Repository, file_path: &str) -> Result<Option<Vec<u8>>, String> {
    let head = match repo.head() {
        Ok(head) => head,
        Err(error) if error.code() == ErrorCode::UnbornBranch => return Ok(None),
        Err(error) => return Err(format!("HEAD error: {error}")),
    };
    let tree = head
        .peel_to_tree()
        .map_err(|error| format!("HEAD tree error: {error}"))?;
    let entry = match tree.get_path(Path::new(file_path)) {
        Ok(entry) => entry,
        Err(error) if error.code() == ErrorCode::NotFound => return Ok(None),
        Err(error) => return Err(format!("HEAD entry error: {error}")),
    };
    let blob = repo
        .find_blob(entry.id())
        .map_err(|error| format!("HEAD blob error: {error}"))?;
    Ok(Some(blob.content().to_vec()))
}

fn blob_bytes_from_index(
    repo: &Repository,
    file_path: &str,
    stage: i32,
) -> Result<Option<Vec<u8>>, String> {
    let index = repo
        .index()
        .map_err(|error| format!("Index error: {error}"))?;
    let entry = match index.get_path(Path::new(file_path), stage) {
        Some(entry) => entry,
        None => return Ok(None),
    };
    let blob = repo
        .find_blob(entry.id)
        .map_err(|error| format!("Index blob error: {error}"))?;
    Ok(Some(blob.content().to_vec()))
}

fn bytes_to_text(bytes: Option<Vec<u8>>) -> (Option<String>, bool, bool) {
    match bytes {
        None => (None, true, false),
        Some(content) => match String::from_utf8(content) {
            Ok(text) => (Some(text), false, false),
            Err(_) => (None, false, true),
        },
    }
}

#[tauri::command]
pub fn git_diff_content(
    repo_path: String,
    file_path: String,
    mode: String,
) -> Result<GitDiffContent, String> {
    let repo = open_repo(&repo_path)?;
    let file_path = normalize_repo_relative_path(&repo, &file_path)?;

    let (original_bytes, modified_bytes) = match mode.as_str() {
        "staged" => (
            blob_bytes_from_head(&repo, &file_path)?,
            blob_bytes_from_index(&repo, &file_path, 0)?,
        ),
        "unstaged" => {
            let full_path = worktree_root(&repo)?.join(&file_path);
            let modified = match std::fs::read(&full_path) {
                Ok(content) => Some(content),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(format!("Read working tree file failed: {error}")),
            };
            (blob_bytes_from_index(&repo, &file_path, 0)?, modified)
        }
        "conflict" => {
            let full_path = worktree_root(&repo)?.join(&file_path);
            let modified = match std::fs::read(&full_path) {
                Ok(content) => Some(content),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(format!("Read conflicted file failed: {error}")),
            };
            (blob_bytes_from_index(&repo, &file_path, 1)?, modified)
        }
        _ => return Err(format!("Unsupported diff content mode: '{mode}'")),
    };

    let (original, original_missing, original_binary) = bytes_to_text(original_bytes);
    let (modified, modified_missing, modified_binary) = bytes_to_text(modified_bytes);
    Ok(GitDiffContent {
        original,
        modified,
        original_missing,
        modified_missing,
        is_binary: original_binary || modified_binary,
    })
}

#[tauri::command]
pub fn git_file_content(
    repo_path: String,
    file_path: String,
    original_ref: Option<String>,
    modified_ref: Option<String>,
    base_branch: Option<String>,
) -> Result<GitFileContent, String> {
    let repo = open_repo(&repo_path)?;
    let file_path = normalize_repo_relative_path(&repo, &file_path)?;

    // Resolve the original reference. If it is the literal string "merge-base",
    // compute the merge-base between HEAD and the provided (or default) base branch.
    let original = match original_ref.as_deref() {
        Some("merge-base") => {
            let base_name = match base_branch {
                Some(name) => name,
                None => default_base_reference(&repo)?,
            };
            let mb = resolve_merge_base(&repo, &base_name)?;
            get_commit_content(&repo, mb, &file_path).unwrap_or_default()
        }
        Some(r) => get_ref_content(&repo, r, &file_path).unwrap_or_default(),
        None => get_head_content(&repo, &file_path).unwrap_or_default(),
    };

    // Resolve the modified reference. Defaults to the working directory.
    let modified = match modified_ref.as_deref() {
        Some(r) => get_ref_content(&repo, r, &file_path).unwrap_or_default(),
        None => {
            let workdir = repo.workdir().ok_or("No working directory")?;
            let full_path = workdir.join(&file_path);
            std::fs::read_to_string(&full_path).unwrap_or_default()
        }
    };

    Ok(GitFileContent { original, modified })
}

fn default_base_reference(repo: &Repository) -> Result<String, String> {
    let upstream = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(String::from))
        .and_then(|name| repo.find_branch(&name, BranchType::Local).ok())
        .and_then(|branch| branch.upstream().ok())
        .and_then(|branch| branch.name().ok().flatten().map(String::from));
    if let Some(reference) = upstream {
        return Ok(reference);
    }
    if let Some(local) = ["main", "master"]
        .into_iter()
        .find(|name| repo.revparse_single(name).is_ok())
    {
        return Ok(local.to_string());
    }
    repo.branches(Some(BranchType::Remote))
        .map_err(|error| format!("List remote branches failed: {error}"))?
        .flatten()
        .filter_map(|(branch, _)| branch.name().ok().flatten().map(String::from))
        .find(|name| name.ends_with("/main") || name.ends_with("/master"))
        .ok_or_else(|| {
            "Could not determine a base branch. Configure an upstream or choose a base branch."
                .to_string()
        })
}

fn resolve_merge_base(repo: &Repository, base_branch: &str) -> Result<git2::Oid, String> {
    let head = repo.head().map_err(|e| format!("HEAD error: {}", e))?;
    let head_commit = head
        .peel_to_commit()
        .map_err(|e| format!("HEAD peel error: {}", e))?;
    let base_obj = repo
        .revparse_single(base_branch)
        .map_err(|e| format!("Base branch '{}': {}", base_branch, e))?;
    let base_commit = base_obj
        .peel_to_commit()
        .map_err(|e| format!("Base peel error: {}", e))?;
    repo.merge_base(head_commit.id(), base_commit.id())
        .map_err(|e| format!("Merge base error: {}", e))
}

fn get_head_content(repo: &Repository, file_path: &str) -> Result<String, String> {
    let head = repo.head().map_err(|e| format!("HEAD error: {}", e))?;
    let tree = head
        .peel_to_tree()
        .map_err(|e| format!("Tree error: {}", e))?;
    get_tree_content(repo, &tree, file_path)
}

fn get_ref_content(repo: &Repository, reference: &str, file_path: &str) -> Result<String, String> {
    let obj = repo
        .revparse_single(reference)
        .map_err(|e| format!("Ref '{}' error: {}", reference, e))?;
    let tree = obj
        .peel_to_tree()
        .map_err(|e| format!("Tree error: {}", e))?;
    get_tree_content(repo, &tree, file_path)
}

fn get_commit_content(
    repo: &Repository,
    oid: git2::Oid,
    file_path: &str,
) -> Result<String, String> {
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit error: {}", e))?;
    let tree = commit.tree().map_err(|e| format!("Tree error: {}", e))?;
    get_tree_content(repo, &tree, file_path)
}

fn get_tree_content(
    repo: &Repository,
    tree: &git2::Tree,
    file_path: &str,
) -> Result<String, String> {
    let entry = tree
        .get_path(Path::new(file_path))
        .map_err(|e| format!("Entry error: {}", e))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Blob error: {}", e))?;
    String::from_utf8(blob.content().to_vec()).map_err(|e| format!("UTF-8 error: {}", e))
}

#[tauri::command]
pub fn git_add(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let repo = open_repo(&repo_path)?;
    let paths = paths
        .iter()
        .map(|path| normalize_repo_relative_path(&repo, path))
        .collect::<Result<Vec<_>, _>>()?;
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_cli(&repo_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_add_all(repo_path: String) -> Result<(), String> {
    run_git_cli(&repo_path, ["add", "-A", "--", "."]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;
    if paths.is_empty() {
        return Ok(());
    }
    let paths = paths
        .iter()
        .map(|path| normalize_repo_relative_path(&repo, path))
        .collect::<Result<Vec<_>, _>>()?;
    let unborn = repo
        .head()
        .err()
        .is_some_and(|error| error.code() == ErrorCode::UnbornBranch);
    let mut args = if unborn {
        vec![
            "rm".to_string(),
            "--cached".to_string(),
            "-r".to_string(),
            "--ignore-unmatch".to_string(),
            "--".to_string(),
        ]
    } else {
        vec![
            "restore".to_string(),
            "--staged".to_string(),
            "--".to_string(),
        ]
    };
    args.extend(paths);
    run_git_cli(&repo_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_discard(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;
    if paths.is_empty() {
        return Ok(());
    }
    let paths = paths
        .iter()
        .map(|path| normalize_repo_relative_path(&repo, path))
        .collect::<Result<Vec<_>, _>>()?;
    let untracked: HashSet<String> = collect_status(&repo)?
        .untracked
        .into_iter()
        .map(|file| file.path)
        .collect();
    let tracked: Vec<String> = paths
        .iter()
        .filter(|path| !untracked.contains(path.as_str()))
        .cloned()
        .collect();
    if !tracked.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--worktree".to_string(),
            "--".to_string(),
        ];
        args.extend(tracked);
        run_git_cli(&repo_path, &args)?;
    }
    for path in paths.into_iter().filter(|path| untracked.contains(path)) {
        let full_path = worktree_root(&repo)?.join(&path);
        let metadata = match std::fs::symlink_metadata(&full_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Inspect untracked path '{path}' failed: {error}")),
        };
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            std::fs::remove_dir_all(&full_path)
                .map_err(|error| format!("Delete untracked directory '{path}' failed: {error}"))?;
        } else {
            std::fs::remove_file(&full_path)
                .map_err(|error| format!("Delete untracked file '{path}' failed: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    commit_with_cli(&repo_path, &message, false)
}

#[tauri::command]
pub fn git_commit_amend(repo_path: String, message: String) -> Result<String, String> {
    commit_with_cli(&repo_path, &message, true)
}

fn commit_with_cli(repo_path: &str, message: &str, amend: bool) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Commit message is empty".to_string());
    }
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    args.extend(["-m", message]);
    run_git_cli(repo_path, args).map_err(|error| {
        if error.contains("Author identity unknown")
            || error.contains("Please tell me who you are")
            || error.contains("unable to auto-detect email address")
        {
            format!("{error}\nConfigure user.name and user.email in Git Settings.")
        } else {
            error
        }
    })?;
    Ok(run_git_cli(repo_path, ["rev-parse", "--short", "HEAD"])?
        .trim()
        .to_string())
}

#[tauri::command]
pub fn git_log(repo_path: String, limit: u32) -> Result<Vec<GitCommitInfo>, String> {
    let repo = open_repo(&repo_path)?;
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("Revwalk error: {}", e))?;
    revwalk
        .push_head()
        .map_err(|e| format!("Push head error: {}", e))?;
    revwalk
        .set_sorting(Sort::TIME)
        .map_err(|e| format!("Sort error: {}", e))?;

    let mut commits = Vec::new();
    for (i, oid_result) in revwalk.enumerate() {
        if i >= limit as usize {
            break;
        }
        let oid = oid_result.map_err(|e| format!("OID error: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Commit error: {}", e))?;

        let hash = oid.to_string();
        let short_hash = hash[..7.min(hash.len())].to_string();

        commits.push(GitCommitInfo {
            hash,
            short_hash,
            message: commit.message().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            email: commit.author().email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
        });
    }

    Ok(commits)
}

#[tauri::command]
pub fn git_log_file(
    repo_path: String,
    file_path: String,
    limit: u32,
) -> Result<Vec<GitCommitInfo>, String> {
    let repo = open_repo(&repo_path)?;
    let file_path = normalize_repo_relative_path(&repo, &file_path)?;
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("Revwalk error: {}", e))?;
    revwalk
        .push_head()
        .map_err(|e| format!("Push head error: {}", e))?;
    // Topological order guarantees children precede their parents, which the
    // rename-follow below depends on. Time-only sorting is unstable when
    // commits share a timestamp (same-second commits) and can process the
    // pre-rename commit before the rename, silently dropping history.
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| format!("Sort error: {}", e))?;

    let mut commits = Vec::new();
    let mut tracked_path = file_path;

    for oid_result in revwalk {
        if commits.len() >= limit as usize {
            break;
        }
        let oid = oid_result.map_err(|e| format!("OID error: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Commit error: {}", e))?;
        let tree = commit.tree().map_err(|e| format!("Tree error: {e}"))?;
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let mut options = DiffOptions::new();
        options.include_untracked(false).include_typechange(true);
        let mut diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))
            .map_err(|e| format!("File history diff error: {e}"))?;
        diff.find_similar(None)
            .map_err(|e| format!("File history rename detection failed: {e}"))?;
        let matching_deltas: Vec<_> = diff
            .deltas()
            .filter(|delta| {
                delta
                    .new_file()
                    .path()
                    .is_some_and(|path| path == Path::new(&tracked_path))
                    || delta
                        .old_file()
                        .path()
                        .is_some_and(|path| path == Path::new(&tracked_path))
            })
            .collect();

        if !matching_deltas.is_empty() {
            let hash = oid.to_string();
            let short_hash = hash[..7.min(hash.len())].to_string();
            commits.push(GitCommitInfo {
                hash,
                short_hash,
                message: commit.message().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("").to_string(),
                email: commit.author().email().unwrap_or("").to_string(),
                timestamp: commit.time().seconds(),
            });
            for delta in matching_deltas {
                if delta.status() == Delta::Renamed
                    && delta
                        .new_file()
                        .path()
                        .is_some_and(|path| path == Path::new(&tracked_path))
                {
                    if let Some(old_path) = delta.old_file().path() {
                        tracked_path = old_path.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    Ok(commits)
}

#[tauri::command]
pub fn git_branch_current(repo_path: String) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) => {
            if e.code() == ErrorCode::UnbornBranch {
                return Ok("main".to_string());
            }
            return Err(format!("Branch error: {}", e));
        }
    };

    if head.is_branch() {
        Ok(head.shorthand().unwrap_or("HEAD").to_string())
    } else {
        let oid = head.target().map(|o| o.to_string()[..7].to_string());
        Ok(format!("HEAD ({})", oid.unwrap_or_default()))
    }
}

#[tauri::command]
pub fn git_branch_list(repo_path: String) -> Result<Vec<GitBranchInfo>, String> {
    let repo = open_repo(&repo_path)?;
    let mut branches = Vec::new();

    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));

    // Local branches
    let local = repo
        .branches(Some(BranchType::Local))
        .map_err(|e| format!("Branch list error: {}", e))?;

    for branch_result in local {
        let (branch, _) = branch_result.map_err(|e| format!("Branch error: {}", e))?;
        let name = branch.name().ok().flatten().unwrap_or("").to_string();
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(String::from));

        branches.push(GitBranchInfo {
            is_current: current.as_deref() == Some(&name),
            name,
            is_remote: false,
            upstream,
        });
    }

    // Remote branches
    let remote = repo
        .branches(Some(BranchType::Remote))
        .map_err(|e| format!("Remote branch list error: {}", e))?;

    for branch_result in remote {
        let (branch, _) = branch_result.map_err(|e| format!("Branch error: {}", e))?;
        let name = branch.name().ok().flatten().unwrap_or("").to_string();
        branches.push(GitBranchInfo {
            name,
            is_current: false,
            is_remote: true,
            upstream: None,
        });
    }

    Ok(branches)
}

#[tauri::command]
pub fn git_branch_create(
    repo_path: String,
    name: String,
    checkout: bool,
    source: Option<String>,
) -> Result<(), String> {
    let mut args = if checkout {
        vec!["switch".to_string(), "-c".to_string(), name]
    } else {
        vec!["branch".to_string(), name]
    };
    if let Some(source) = source.filter(|value| !value.trim().is_empty()) {
        args.push(source);
    }
    run_git_cli(&repo_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_branch_delete(
    repo_path: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
    run_git_cli(&repo_path, ["branch", flag, name.as_str()]).map(|_| ())
}

#[tauri::command]
pub fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;
    let is_local = repo.find_branch(&branch, BranchType::Local).is_ok();
    let is_remote = repo.find_branch(&branch, BranchType::Remote).is_ok();
    if is_local {
        run_git_cli(&repo_path, ["switch", branch.as_str()]).map(|_| ())
    } else if is_remote {
        run_git_cli(&repo_path, ["switch", "--track", branch.as_str()]).map(|_| ())
    } else {
        Err(format!("Branch '{branch}' was not found"))
    }
}

#[tauri::command]
pub fn git_remote_list(repo_path: String) -> Result<Vec<GitRemoteInfo>, String> {
    let repo = open_repo(&repo_path)?;
    list_remotes(&repo)
}

#[tauri::command]
pub fn git_ahead_behind(repo_path: String) -> Result<GitAheadBehind, String> {
    let repo = open_repo(&repo_path)?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => {
            return Ok(GitAheadBehind {
                ahead: 0,
                behind: 0,
            })
        }
    };

    if !head.is_branch() {
        return Ok(GitAheadBehind {
            ahead: 0,
            behind: 0,
        });
    }

    let local_oid = head.target().ok_or("No HEAD target")?;

    let branch_name = head.shorthand().unwrap_or("");
    let branch = match repo.find_branch(branch_name, BranchType::Local) {
        Ok(b) => b,
        Err(_) => {
            return Ok(GitAheadBehind {
                ahead: 0,
                behind: 0,
            })
        }
    };

    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(_) => {
            return Ok(GitAheadBehind {
                ahead: 0,
                behind: 0,
            })
        }
    };

    let upstream_oid = upstream.get().target().ok_or("No upstream target")?;

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|e| format!("Ahead/behind error: {}", e))?;

    Ok(GitAheadBehind { ahead, behind })
}

#[tauri::command]
pub fn git_stash(
    repo_path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> Result<(), String> {
    let mut args = vec!["stash".to_string(), "push".to_string()];
    if include_untracked.unwrap_or(false) {
        args.push("--include-untracked".to_string());
    }
    if let Some(message) = message.filter(|value| !value.trim().is_empty()) {
        args.push("-m".to_string());
        args.push(message);
    }
    run_git_cli(&repo_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_stash_list(repo_path: String) -> Result<Vec<GitStashEntry>, String> {
    let mut repo = Repository::discover(&repo_path).map_err(|e| format!("Git error: {}", e))?;

    let mut stashes = Vec::new();
    repo.stash_foreach(|index, message, _oid| {
        stashes.push(GitStashEntry {
            index,
            message: message.to_string(),
        });
        true
    })
    .map_err(|e| format!("Stash list error: {}", e))?;

    Ok(stashes)
}

#[tauri::command]
pub fn git_stash_pop(repo_path: String, index: usize) -> Result<(), String> {
    let stash = format!("stash@{{{index}}}");
    run_git_cli(&repo_path, ["stash", "pop", stash.as_str()]).map(|_| ())
}

#[tauri::command]
pub fn git_stash_apply(repo_path: String, index: usize) -> Result<(), String> {
    let stash = format!("stash@{{{index}}}");
    run_git_cli(&repo_path, ["stash", "apply", stash.as_str()]).map(|_| ())
}

#[tauri::command]
pub fn git_config_identity(
    repo_path: Option<String>,
    scope: String,
) -> Result<GitIdentityConfig, String> {
    let cwd = repo_path.as_deref().unwrap_or(".");
    let scope_flag = match scope.as_str() {
        "local" => {
            if repo_path.is_none() {
                return Err("Open a repository to read local Git configuration".to_string());
            }
            "--local"
        }
        "global" => "--global",
        _ => return Err(format!("Unsupported Git config scope: '{scope}'")),
    };
    let read_value = |key: &str| {
        run_git_cli(cwd, ["config", scope_flag, "--get", key])
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    Ok(GitIdentityConfig {
        user_name: read_value("user.name"),
        user_email: read_value("user.email"),
    })
}

#[tauri::command]
pub fn git_config_set_identity(
    repo_path: Option<String>,
    scope: String,
    user_name: String,
    user_email: String,
) -> Result<(), String> {
    let cwd = repo_path.as_deref().unwrap_or(".");
    let scope_flag = match scope.as_str() {
        "local" => {
            if repo_path.is_none() {
                return Err("Open a repository to update local Git configuration".to_string());
            }
            "--local"
        }
        "global" => "--global",
        _ => return Err(format!("Unsupported Git config scope: '{scope}'")),
    };
    if user_name.trim().is_empty() || user_email.trim().is_empty() {
        return Err("Git user name and email are required".to_string());
    }
    run_git_cli(cwd, ["config", scope_flag, "user.name", user_name.trim()])?;
    run_git_cli(cwd, ["config", scope_flag, "user.email", user_email.trim()])?;
    Ok(())
}

// ── Commit Detail ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn git_commit_detail(repo_path: String, hash: String) -> Result<CommitDetail, String> {
    let repo = open_repo(&repo_path)?;
    let oid = git2::Oid::from_str(&hash).map_err(|e| format!("Invalid hash: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;

    let commit_tree = commit.tree().map_err(|e| format!("Tree error: {}", e))?;

    // Get parent tree (or empty tree for initial commit)
    let parent_tree = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(|e| format!("Parent error: {}", e))?
                .tree()
                .map_err(|e| format!("Parent tree error: {}", e))?,
        )
    } else {
        None
    };

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)
        .map_err(|e| format!("Diff error: {}", e))?;

    let stats = diff.stats().map_err(|e| format!("Stats error: {}", e))?;

    let mut files: Vec<CommitFileChange> = Vec::new();

    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let status = delta_to_status(delta.status()).to_string();

        // Get per-file stats by creating a scoped diff
        let mut per_file_opts = DiffOptions::new();
        per_file_opts.pathspec(&path);
        let per_file_diff = repo
            .diff_tree_to_tree(
                parent_tree.as_ref(),
                Some(&commit_tree),
                Some(&mut per_file_opts),
            )
            .ok();

        let (insertions, deletions) = per_file_diff
            .and_then(|d| d.stats().ok())
            .map(|s| (s.insertions() as u32, s.deletions() as u32))
            .unwrap_or((0, 0));

        files.push(CommitFileChange {
            path,
            status,
            insertions,
            deletions,
        });
    }

    let full_hash = oid.to_string();
    let short = full_hash[..7.min(full_hash.len())].to_string();
    let message = commit.message().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let email = commit.author().email().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();
    let total_insertions = stats.insertions() as u32;
    let total_deletions = stats.deletions() as u32;

    Ok(CommitDetail {
        hash: full_hash,
        short_hash: short,
        message,
        author,
        email,
        timestamp,
        files,
        total_insertions,
        total_deletions,
    })
}

#[tauri::command]
pub fn git_commit_file_diff(
    repo_path: String,
    hash: String,
    file_path: String,
) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let file_path = normalize_repo_relative_path(&repo, &file_path)?;
    let oid = git2::Oid::from_str(&hash).map_err(|e| format!("Invalid hash: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;

    let commit_tree = commit.tree().map_err(|e| format!("Tree error: {}", e))?;

    let parent_tree = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(|e| format!("Parent error: {}", e))?
                .tree()
                .map_err(|e| format!("Parent tree error: {}", e))?,
        )
    } else {
        None
    };

    let mut opts = DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), Some(&mut opts))
        .map_err(|e| format!("Diff error: {}", e))?;

    let (text, _, _) = diff_patch_text(&diff, usize::MAX)?;
    Ok(text)
}

// ── Git Graph ────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct GraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[tauri::command]
pub fn git_log_graph(repo_path: String, limit: u32) -> Result<Vec<GraphCommit>, String> {
    let repo = open_repo(&repo_path)?;
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("Revwalk error: {}", e))?;
    let mut pushed = HashSet::new();
    for reference in repo
        .references()
        .map_err(|e| format!("References error: {e}"))?
    {
        let reference = reference.map_err(|e| format!("Reference error: {e}"))?;
        // Direct refs can point at annotated tag objects (or another non-commit
        // object). Revwalk only accepts commit OIDs, so always peel the ref
        // before adding it to the walk and ignore refs that cannot resolve to a
        // commit.
        let commit_oid = reference
            .target()
            .and_then(|oid| repo.find_object(oid, None).ok())
            .and_then(|object| object.peel_to_commit().ok())
            .map(|commit| commit.id())
            .or_else(|| {
                reference
                    .peel(git2::ObjectType::Commit)
                    .ok()
                    .map(|object| object.id())
            });

        if let Some(oid) = commit_oid {
            if pushed.insert(oid) {
                revwalk
                    .push(oid)
                    .map_err(|e| format!("Push reference error: {e}"))?;
            }
        }
    }
    if pushed.is_empty() {
        return Ok(Vec::new());
    }
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| format!("Sort error: {}", e))?;

    // Collect all refs (branches + tags) → commit mapping
    let mut ref_map: HashMap<String, Vec<String>> = HashMap::new();

    // Local branches
    if let Ok(branches) = repo.branches(Some(BranchType::Local)) {
        for branch in branches.flatten() {
            let name = branch.0.name().ok().flatten().unwrap_or("").to_string();
            if let Some(target) = branch.0.get().target() {
                ref_map.entry(target.to_string()).or_default().push(name);
            }
        }
    }

    // Remote branches
    if let Ok(branches) = repo.branches(Some(BranchType::Remote)) {
        for branch in branches.flatten() {
            let name = branch.0.name().ok().flatten().unwrap_or("").to_string();
            if let Some(target) = branch.0.get().target() {
                ref_map.entry(target.to_string()).or_default().push(name);
            }
        }
    }

    // Tags
    if let Ok(tag_names) = repo.tag_names(None) {
        for tag_name in tag_names.iter().flatten() {
            if let Ok(tag_ref) = repo.find_reference(&format!("refs/tags/{}", tag_name)) {
                if let Some(target) = tag_ref.target() {
                    // Resolve annotated tag to actual commit
                    let oid = if let Ok(obj) = repo.find_object(target, None) {
                        obj.peel_to_commit().ok().map(|c| c.id())
                    } else {
                        None
                    };
                    if let Some(commit_oid) = oid {
                        ref_map
                            .entry(commit_oid.to_string())
                            .or_default()
                            .push(format!("tag:{}", tag_name));
                    } else {
                        ref_map
                            .entry(target.to_string())
                            .or_default()
                            .push(format!("tag:{}", tag_name));
                    }
                }
            }
        }
    }

    let mut commits = Vec::new();
    for (i, oid_result) in revwalk.enumerate() {
        if i >= limit as usize {
            break;
        }
        let oid = oid_result.map_err(|e| format!("OID error: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Commit error: {}", e))?;

        let hash = oid.to_string();
        let short_hash = hash[..7.min(hash.len())].to_string();

        let parents: Vec<String> = (0..commit.parent_count())
            .filter_map(|i| commit.parent(i).ok().map(|p| p.id().to_string()))
            .collect();

        let refs = ref_map.remove(&hash).unwrap_or_default();

        commits.push(GraphCommit {
            hash,
            short_hash,
            message: commit.message().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            email: commit.author().email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parents,
            refs,
        });
    }

    Ok(commits)
}

/// Clone a git repository into `target_path`, creating parent directories as
/// needed. For github.com HTTPS URLs, the stored GitHub token is injected so
/// private repositories can be cloned without extra credential configuration.
#[tauri::command]
pub fn git_clone(
    keychain: State<'_, KeychainState>,
    url: String,
    target_path: String,
    branch: Option<String>,
) -> Result<(), String> {
    let target = PathBuf::from(&target_path);
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "Invalid target path".to_string())?;
    if !parent.exists() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create target directory: {}", e))?;
    }

    let mut command = super::utils::cmd("git");
    inject_github_auth(
        &mut command,
        &url,
        super::github_repos::github_token_option(&keychain.0).as_deref(),
    );

    let mut args = vec!["clone".to_string()];
    if let Some(branch) = branch.filter(|value| !value.trim().is_empty()) {
        args.push("--branch".to_string());
        args.push(branch);
    }
    args.push(url);
    args.push(target_path.clone());

    let output = command
        .args(args)
        .current_dir(parent)
        .output()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(stderr.trim().to_string());
    }
    Ok(())
}

/// Add a git remote to the repository.
#[tauri::command]
pub fn git_remote_add(repo_path: String, name: String, url: String) -> Result<(), String> {
    run_git_cli(&repo_path, ["remote", "add", name.as_str(), url.as_str()]).map(|_| ())
}

/// Remove a git remote from the repository.
#[tauri::command]
pub fn git_remote_remove(repo_path: String, name: String) -> Result<(), String> {
    run_git_cli(&repo_path, ["remote", "remove", name.as_str()]).map(|_| ())
}

/// Change the URL of a git remote in the repository.
#[tauri::command]
pub fn git_remote_set_url(repo_path: String, name: String, url: String) -> Result<(), String> {
    run_git_cli(
        &repo_path,
        ["remote", "set-url", name.as_str(), url.as_str()],
    )
    .map(|_| ())
}

#[tauri::command]
pub fn git_push(
    keychain: State<'_, KeychainState>,
    repo_path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<String, String> {
    match (remote, branch) {
        (Some(remote), Some(branch)) => run_git_cli_with_github_auth(
            &keychain,
            &repo_path,
            Some(&remote),
            vec!["push".to_string(), remote.clone(), branch],
        ),
        (Some(remote), None) => run_git_cli_with_github_auth(
            &keychain,
            &repo_path,
            Some(&remote),
            vec!["push".to_string(), remote.clone()],
        ),
        (None, _) => {
            run_git_cli_with_github_auth(&keychain, &repo_path, None, vec!["push".to_string()])
        }
    }
}

#[tauri::command]
pub fn git_publish_branch(
    keychain: State<'_, KeychainState>,
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<String, String> {
    run_git_cli_with_github_auth(
        &keychain,
        &repo_path,
        Some(&remote),
        vec![
            "push".to_string(),
            "--set-upstream".to_string(),
            remote.clone(),
            branch,
        ],
    )
}

#[tauri::command]
pub fn git_pull(
    keychain: State<'_, KeychainState>,
    repo_path: String,
    remote: Option<String>,
) -> Result<String, String> {
    match remote {
        Some(remote) => run_git_cli_with_github_auth(
            &keychain,
            &repo_path,
            Some(&remote),
            vec!["pull".to_string(), remote.clone()],
        ),
        None => run_git_cli_with_github_auth(&keychain, &repo_path, None, vec!["pull".to_string()]),
    }
}

#[tauri::command]
pub fn git_fetch(
    keychain: State<'_, KeychainState>,
    repo_path: String,
    remote: Option<String>,
) -> Result<String, String> {
    match remote {
        Some(remote) => run_git_cli_with_github_auth(
            &keychain,
            &repo_path,
            Some(&remote),
            vec!["fetch".to_string(), remote.clone()],
        ),
        None => {
            run_git_cli_with_github_auth(&keychain, &repo_path, None, vec!["fetch".to_string()])
        }
    }
}

#[tauri::command]
pub fn git_fetch_all(
    keychain: State<'_, KeychainState>,
    repo_path: String,
    prune: Option<bool>,
) -> Result<String, String> {
    let mut args = vec!["fetch".to_string(), "--all".to_string()];
    if prune.unwrap_or(false) {
        args.push("--prune".to_string());
    }
    run_git_cli_with_github_auth(&keychain, &repo_path, None, args)
}

#[tauri::command]
pub fn git_merge(repo_path: String, branch: String) -> Result<String, String> {
    run_git_cli(&repo_path, ["merge", &branch])
}

#[tauri::command]
pub fn git_reset(repo_path: String, mode: String, target: String) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let obj = repo
        .revparse_single(&target)
        .map_err(|e| format!("Invalid target: {}", e))?;

    let kind = match mode.as_str() {
        "soft" => git2::ResetType::Soft,
        "mixed" => git2::ResetType::Mixed,
        "hard" => git2::ResetType::Hard,
        _ => git2::ResetType::Mixed,
    };

    repo.reset(&obj, kind, None)
        .map_err(|e| format!("Reset error: {}", e))?;

    Ok(format!("Reset {} to {}", mode, target))
}

#[tauri::command]
pub fn git_blame(
    repo_path: String,
    file_path: String,
    line: Option<u32>,
) -> Result<Vec<GitBlameHunk>, String> {
    let repo = open_repo(&repo_path)?;
    let file_path = normalize_repo_relative_path(&repo, &file_path)?;

    let mut opts = git2::BlameOptions::new();
    if let Some(l) = line {
        let min_line =
            std::num::NonZeroU32::new(l).unwrap_or_else(|| std::num::NonZeroU32::new(1).unwrap());
        opts.min_line(min_line.get() as usize);
        opts.max_line(min_line.get() as usize);
    }

    let blame = repo
        .blame_file(std::path::Path::new(&file_path), Some(&mut opts))
        .map_err(|e| format!("Blame error: {}", e))?;

    let mut hunks = Vec::new();
    for hunk in blame.iter() {
        let sig = hunk.final_signature();
        let author = sig.name().unwrap_or("").to_string();
        let email = sig.email().unwrap_or("").to_string();
        let when = sig.when();
        let timestamp = when.seconds();
        let commit_id = hunk.final_commit_id().to_string();
        let short_hash = commit_id[..8.min(commit_id.len())].to_string();
        let lines_in_hunk = hunk.lines_in_hunk() as u32;
        let start_line = hunk.final_start_line() as u32;

        let message = repo
            .find_commit(hunk.final_commit_id())
            .ok()
            .and_then(|c| c.message().map(|m| m.to_string()))
            .unwrap_or_default();

        hunks.push(GitBlameHunk {
            start_line,
            lines_in_hunk,
            author,
            email,
            timestamp,
            short_hash,
            message,
        });
    }

    Ok(hunks)
}

#[tauri::command]
pub fn git_tag_create(
    repo_path: String,
    name: String,
    message: Option<String>,
) -> Result<(), String> {
    if let Some(message) = message.filter(|value| !value.trim().is_empty()) {
        run_git_cli(
            &repo_path,
            ["tag", "-a", name.as_str(), "-m", message.as_str()],
        )?;
    } else {
        run_git_cli(&repo_path, ["tag", name.as_str()])?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_branch_changes(
    repo_path: String,
    base_branch: Option<String>,
) -> Result<Vec<GitFile>, String> {
    let repo = open_repo(&repo_path)?;
    let worktree = worktree_root(&repo)?.to_path_buf();
    let head = repo.head().map_err(|e| format!("HEAD error: {}", e))?;
    let head_commit = head
        .peel_to_commit()
        .map_err(|e| format!("HEAD peel error: {}", e))?;

    // Resolve the base reference. If none is provided, try common upstream/base
    // branch names in order of preference.
    let base_name = match base_branch {
        Some(name) => name,
        None => {
            let upstream = head
                .shorthand()
                .and_then(|name| repo.find_branch(name, BranchType::Local).ok())
                .and_then(|branch| branch.upstream().ok())
                .and_then(|branch| branch.name().ok().flatten().map(String::from));
            let local = ["main", "master"]
                .into_iter()
                .find(|name| repo.revparse_single(name).is_ok())
                .map(String::from);
            let remote = repo
                .branches(Some(BranchType::Remote))
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|(branch, _)| branch.name().ok().flatten().map(String::from))
                .find(|name| name.ends_with("/main") || name.ends_with("/master"));
            let found = upstream.or(local).or(remote);
            found.ok_or(
                "Could not determine base branch. Provide one or ensure main/master exists.",
            )?
        }
    };

    let base_obj = repo
        .revparse_single(&base_name)
        .map_err(|e| format!("Base branch '{}': {}", base_name, e))?;
    let base_commit = base_obj
        .peel_to_commit()
        .map_err(|e| format!("Base peel error: {}", e))?;

    let merge_base = repo
        .merge_base(head_commit.id(), base_commit.id())
        .map_err(|e| format!("Merge base error: {}", e))?;

    if merge_base == head_commit.id() {
        return Ok(Vec::new());
    }

    let mb_commit = repo
        .find_commit(merge_base)
        .map_err(|e| format!("Find merge-base commit: {}", e))?;

    let mb_tree = mb_commit
        .tree()
        .map_err(|e| format!("Merge-base tree: {}", e))?;
    let head_tree = head_commit
        .tree()
        .map_err(|e| format!("HEAD tree: {}", e))?;

    let mut diff_opts = DiffOptions::new();
    let diff = repo
        .diff_tree_to_tree(Some(&mb_tree), Some(&head_tree), Some(&mut diff_opts))
        .map_err(|e| format!("Diff error: {}", e))?;

    let mut files = Vec::new();
    diff.foreach(
        &mut |delta, _| {
            let status = delta_to_status(delta.status()).to_string();
            let (path, old_path) = match delta.status() {
                Delta::Renamed | Delta::Copied => {
                    let old = delta
                        .old_file()
                        .path()
                        .and_then(|p| p.to_str())
                        .map(|s| s.to_string());
                    let new = delta
                        .new_file()
                        .path()
                        .and_then(|p| p.to_str())
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                    (new, old)
                }
                _ => {
                    let path = delta
                        .new_file()
                        .path()
                        .and_then(|p| p.to_str())
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                    (path, None)
                }
            };
            if !path.is_empty() {
                files.push(GitFile {
                    absolute_path: worktree.join(&path).to_string_lossy().to_string(),
                    path,
                    status,
                    old_path,
                });
            }
            true
        },
        None,
        None,
        None,
    )
    .map_err(|e| format!("Diff foreach error: {}", e))?;

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::super::git_backend::validate_repo_relative_path;
    use super::*;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRepository {
        path: PathBuf,
    }

    impl TestRepository {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("hyscode-git-test-{}-{unique}", std::process::id()));
            std::fs::create_dir_all(&path).expect("create test repository");
            let repository = Self { path };
            repository.git(["init", "--initial-branch=main"]);
            repository.git(["config", "user.name", "HysCode Test"]);
            repository.git(["config", "user.email", "hyscode@example.invalid"]);
            repository
        }

        fn path_string(&self) -> String {
            self.path.to_string_lossy().to_string()
        }

        fn write(&self, relative: &str, contents: &[u8]) {
            let path = self.path.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("create file parent");
            }
            std::fs::write(path, contents).expect("write test file");
        }

        fn git<const N: usize>(&self, args: [&str; N]) -> String {
            let output = Command::new("git")
                .args(args)
                .current_dir(&self.path)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }

        fn commit_file(&self, path: &str, contents: &[u8], message: &str) {
            self.write(path, contents);
            self.git(["add", "--", path]);
            self.git(["commit", "-m", message]);
        }
    }

    impl Drop for TestRepository {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn pathspec_validation_rejects_absolute_and_parent_paths() {
        assert!(validate_repo_relative_path("../outside.txt").is_err());
        assert!(validate_repo_relative_path("nested/../../outside.txt").is_err());
        assert!(validate_repo_relative_path("C:\\outside.txt").is_err());
        assert!(validate_repo_relative_path("src/lib.rs").is_ok());
    }

    #[test]
    fn staged_and_unstaged_content_use_distinct_git_layers() {
        let repo = TestRepository::new();
        repo.commit_file("file.txt", b"head\n", "initial");
        repo.write("file.txt", b"index\n");
        repo.git(["add", "--", "file.txt"]);
        repo.write("file.txt", b"worktree\n");

        let staged =
            git_diff_content(repo.path_string(), "file.txt".into(), "staged".into()).unwrap();
        let unstaged =
            git_diff_content(repo.path_string(), "file.txt".into(), "unstaged".into()).unwrap();

        assert_eq!(staged.original.as_deref(), Some("head\n"));
        assert_eq!(staged.modified.as_deref(), Some("index\n"));
        assert_eq!(unstaged.original.as_deref(), Some("index\n"));
        assert_eq!(unstaged.modified.as_deref(), Some("worktree\n"));
    }

    #[test]
    fn commit_context_contains_only_staged_content_and_stable_fingerprint() {
        let repo = TestRepository::new();
        repo.commit_file("file.txt", b"head\n", "initial");
        repo.write("file.txt", b"index\n");
        repo.git(["add", "--", "file.txt"]);

        let staged_context = git_commit_context(repo.path_string()).unwrap();
        let staged_fingerprint = staged_context.fingerprint.clone();
        repo.write("file.txt", b"worktree only\n");
        let worktree_context = git_commit_context(repo.path_string()).unwrap();

        assert_eq!(staged_context.files.len(), 1);
        assert!(staged_context.files[0]
            .patch
            .as_deref()
            .is_some_and(|patch| patch.contains("+index")));
        assert!(!staged_context.files[0]
            .patch
            .as_deref()
            .is_some_and(|patch| patch.contains("worktree only")));
        assert_eq!(worktree_context.fingerprint, staged_fingerprint);

        repo.git(["add", "--", "file.txt"]);
        assert_ne!(
            git_staged_fingerprint(repo.path_string()).unwrap(),
            staged_fingerprint
        );
    }

    #[test]
    fn commit_context_represents_add_delete_rename_and_binary_without_absolute_paths() {
        let repo = TestRepository::new();
        repo.commit_file("delete.txt", b"delete me\n", "initial");
        repo.commit_file("old.txt", b"rename me\n", "rename source");
        repo.write("added.txt", b"added\n");
        repo.write("binary.dat", &[0, 159, 146, 150, 0, 1]);
        repo.git(["add", "--", "added.txt", "binary.dat"]);
        repo.git(["rm", "--", "delete.txt"]);
        repo.git(["mv", "old.txt", "new.txt"]);

        let context = git_commit_context(repo.path_string()).unwrap();
        let paths: Vec<_> = context
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();

        assert_eq!(
            paths,
            vec!["added.txt", "binary.dat", "delete.txt", "new.txt"]
        );
        assert!(context
            .files
            .iter()
            .any(|file| file.status == "A" && file.path == "added.txt"));
        assert!(context
            .files
            .iter()
            .any(|file| file.status == "D" && file.path == "delete.txt"));
        assert!(context.files.iter().any(|file| {
            file.status == "R"
                && file.path == "new.txt"
                && file.old_path.as_deref() == Some("old.txt")
        }));
        let binary = context
            .files
            .iter()
            .find(|file| file.path == "binary.dat")
            .unwrap();
        assert!(binary.is_binary);
        assert!(binary.patch.is_none());
        assert!(context
            .files
            .iter()
            .all(|file| !file.path.contains(repo.path.to_string_lossy().as_ref())));
    }

    #[test]
    fn commit_context_balances_patch_budget_and_truncates_unicode_safely() {
        let repo = TestRepository::new();
        let content = "á".repeat(COMMIT_CONTEXT_PATCH_BUDGET);
        repo.write("a.txt", content.as_bytes());
        repo.write("b.txt", content.as_bytes());
        repo.git(["add", "--", "a.txt", "b.txt"]);

        let context = git_commit_context(repo.path_string()).unwrap();

        assert_eq!(context.files.len(), 2);
        assert!(context.files.iter().all(|file| file.patch_truncated));
        assert!(context.files.iter().all(|file| file
            .patch
            .as_ref()
            .is_some_and(|patch| patch.is_char_boundary(patch.len()))));
        assert!(context.patch_bytes_included <= COMMIT_CONTEXT_PATCH_BUDGET);
        assert!(context.patch_bytes_omitted > 0);
        let included_sizes: Vec<_> = context
            .files
            .iter()
            .map(|file| file.patch.as_ref().map_or(0, String::len))
            .collect();
        assert!(included_sizes[0].abs_diff(included_sizes[1]) <= 1);
    }

    #[test]
    fn commit_context_supports_unborn_head() {
        let repo = TestRepository::new();
        repo.write("first.txt", b"first\n");
        repo.git(["add", "--", "first.txt"]);

        let context = git_commit_context(repo.path_string()).unwrap();

        assert_eq!(context.files.len(), 1);
        assert_eq!(context.files[0].status, "A");
        assert!(context.files[0]
            .patch
            .as_deref()
            .is_some_and(|patch| patch.contains("+first")));
    }

    #[test]
    fn snapshot_supports_unborn_head_and_custom_remote_without_upstream() {
        let repo = TestRepository::new();
        repo.git([
            "remote",
            "add",
            "hyska",
            "https://github.com/Hyska-Software/Hyscode.git",
        ]);

        let snapshot = git_repository_snapshot(repo.path_string()).unwrap();

        assert_eq!(snapshot.head_state, "unborn");
        assert_eq!(snapshot.current_branch.as_deref(), Some("main"));
        assert!(snapshot.upstream.is_none());
        assert_eq!(snapshot.remotes[0].name, "hyska");
    }

    #[test]
    fn commit_uses_and_respects_user_hooks() {
        let repo = TestRepository::new();
        repo.commit_file("file.txt", b"initial\n", "initial");
        repo.write("file.txt", b"blocked\n");
        repo.git(["add", "--", "file.txt"]);
        repo.write(".git/hooks/pre-commit", b"#!/bin/sh\nexit 1\n");

        let result = git_commit(repo.path_string(), "must be rejected".into());

        assert!(result.is_err());
        assert_eq!(repo.git(["log", "-1", "--pretty=%s"]), "initial");
    }

    #[test]
    fn amend_commit_rewrites_head_with_the_configured_identity() {
        let repo = TestRepository::new();
        repo.commit_file("file.txt", b"initial\n", "initial");
        let original_head = repo.git(["rev-parse", "HEAD"]);
        repo.write("file.txt", b"amended\n");
        repo.git(["add", "--", "file.txt"]);

        let short_hash =
            git_commit_amend(repo.path_string(), "amended message".into()).expect("amend commit");

        assert_ne!(repo.git(["rev-parse", "HEAD"]), original_head);
        assert_eq!(repo.git(["rev-parse", "--short", "HEAD"]), short_hash);
        assert_eq!(repo.git(["log", "-1", "--pretty=%s"]), "amended message");
        assert_eq!(repo.git(["log", "-1", "--pretty=%an"]), "HysCode Test");
    }

    #[test]
    fn graph_includes_commits_reachable_only_from_parallel_branches() {
        let repo = TestRepository::new();
        repo.commit_file("base.txt", b"base\n", "base");
        repo.git(["switch", "-c", "parallel"]);
        repo.commit_file("parallel.txt", b"parallel\n", "parallel commit");
        let parallel = repo.git(["rev-parse", "HEAD"]);
        repo.git(["switch", "main"]);
        repo.commit_file("main.txt", b"main\n", "main commit");

        let graph = git_log_graph(repo.path_string(), 100).unwrap();
        let hashes: HashSet<_> = graph.iter().map(|commit| commit.hash.as_str()).collect();

        assert!(hashes.contains(parallel.as_str()));
        assert!(graph
            .iter()
            .any(|commit| commit.refs.iter().any(|reference| reference == "parallel")));
    }

    #[test]
    fn graph_peels_annotated_tags_before_walking() {
        let repo = TestRepository::new();
        repo.commit_file("release.txt", b"release\n", "release commit");
        repo.git(["tag", "-a", "v1.0.0", "-m", "release v1.0.0"]);

        let graph = git_log_graph(repo.path_string(), 100).unwrap();

        assert!(graph.iter().any(|commit| {
            commit.message.trim() == "release commit"
                && commit
                    .refs
                    .iter()
                    .any(|reference| reference == "tag:v1.0.0")
        }));
    }

    #[test]
    fn file_history_skips_unrelated_commits_and_follows_renames() {
        let repo = TestRepository::new();
        repo.commit_file("old-name.txt", b"first\n", "add tracked file");
        repo.commit_file("unrelated.txt", b"other\n", "unrelated change");
        repo.git(["mv", "old-name.txt", "new-name.txt"]);
        repo.git(["commit", "-m", "rename tracked file"]);
        repo.write("new-name.txt", b"second\n");
        repo.git(["add", "--", "new-name.txt"]);
        repo.git(["commit", "-m", "modify tracked file"]);

        let history = git_log_file(repo.path_string(), "new-name.txt".into(), 20).unwrap();
        let messages: Vec<_> = history.iter().map(|commit| commit.message.trim()).collect();

        assert_eq!(
            messages,
            vec![
                "modify tracked file",
                "rename tracked file",
                "add tracked file"
            ]
        );
    }

    #[test]
    fn normalize_accepts_absolute_paths_inside_worktree_and_rejects_outside() {
        let repo = TestRepository::new();
        repo.commit_file("file.txt", b"content\n", "initial");
        let opened = open_repo(&repo.path_string()).unwrap();

        let absolute_inside = repo.path.join("file.txt").to_string_lossy().to_string();
        assert_eq!(
            normalize_repo_relative_path(&opened, &absolute_inside).unwrap(),
            "file.txt"
        );

        let absolute_outside = std::env::temp_dir()
            .join("hyscode-outside-worktree.txt")
            .to_string_lossy()
            .to_string();
        assert!(normalize_repo_relative_path(&opened, &absolute_outside).is_err());

        assert_eq!(
            normalize_repo_relative_path(&opened, "nested/file.txt").unwrap(),
            "nested/file.txt"
        );
        assert!(normalize_repo_relative_path(&opened, "../escape.txt").is_err());
    }

    #[test]
    fn uncommitted_diff_is_single_pass_and_respects_the_byte_budget() {
        let repo = TestRepository::new();
        repo.commit_file("file.txt", b"one\n", "initial");
        repo.write("file.txt", b"one\ntwo\nthree\nfour\nfive\n");

        let full = git_uncommitted_diff(repo.path_string(), false, None).unwrap();
        assert!(full.contains("+two"));
        assert!(!full.contains("truncated"));

        let tiny = git_uncommitted_diff(repo.path_string(), false, Some(16)).unwrap();
        assert!(tiny.contains("diff truncated"));

        repo.git(["add", "--", "file.txt"]);
        let staged = git_uncommitted_diff(repo.path_string(), true, None).unwrap();
        assert!(staged.contains("+two"));

        assert_eq!(
            git_diff_staged_all(repo.path_string()).unwrap(),
            git_uncommitted_diff(repo.path_string(), true, None).unwrap()
        );
    }
}
