use git2::{
    BranchType, Delta, DiffOptions, ErrorCode, IndexAddOption, Repository,
    Signature, Sort, StatusOptions,
};
use serde::Serialize;
use std::path::Path;
use super::utils::cmd;

// ── Serializable Types ──────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct GitFile {
    pub path: String,
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
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
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
pub struct GitFileContent {
    pub original: String,
    pub modified: String,
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

pub fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::discover(path).map_err(|e| format!("Git error: {}", e))
}

fn delta_to_status(delta: Delta) -> &'static str {
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

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn git_is_repo(path: String) -> bool {
    Repository::discover(&path).is_ok()
}

#[tauri::command]
pub fn git_init(path: String) -> Result<(), String> {
    Repository::init(&path).map_err(|e| format!("Git init failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatusResult, String> {
    let repo = open_repo(&repo_path)?;
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
        .map_err(|e| format!("Status error: {}", e))?;

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        // Conflicts
        if s.is_conflicted() {
            result.conflicts.push(GitFile {
                path,
                status: "U".to_string(),
                old_path: None,
            });
            continue;
        }

        // Staged (index → HEAD)
        if s.is_index_new() {
            result.staged.push(GitFile {
                path: path.clone(),
                status: "A".to_string(),
                old_path: None,
            });
        } else if s.is_index_modified() {
            result.staged.push(GitFile {
                path: path.clone(),
                status: "M".to_string(),
                old_path: None,
            });
        } else if s.is_index_deleted() {
            result.staged.push(GitFile {
                path: path.clone(),
                status: "D".to_string(),
                old_path: None,
            });
        } else if s.is_index_renamed() {
            let old = entry
                .head_to_index()
                .and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().to_string()));
            result.staged.push(GitFile {
                path: path.clone(),
                status: "R".to_string(),
                old_path: old,
            });
        } else if s.is_index_typechange() {
            result.staged.push(GitFile {
                path: path.clone(),
                status: "T".to_string(),
                old_path: None,
            });
        }

        // Unstaged (workdir → index)
        if s.is_wt_modified() {
            result.unstaged.push(GitFile {
                path: path.clone(),
                status: "M".to_string(),
                old_path: None,
            });
        } else if s.is_wt_deleted() {
            result.unstaged.push(GitFile {
                path: path.clone(),
                status: "D".to_string(),
                old_path: None,
            });
        } else if s.is_wt_renamed() {
            let old = entry
                .index_to_workdir()
                .and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().to_string()));
            result.unstaged.push(GitFile {
                path: path.clone(),
                status: "R".to_string(),
                old_path: old,
            });
        } else if s.is_wt_typechange() {
            result.unstaged.push(GitFile {
                path: path.clone(),
                status: "T".to_string(),
                old_path: None,
            });
        }

        // Untracked
        if s.is_wt_new() {
            result.untracked.push(GitFile {
                path,
                status: "?".to_string(),
                old_path: None,
            });
        }
    }

    Ok(result)
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
    let mut opts = DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = if staged {
        let head_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok());
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

/// Returns the full unified diff of ALL staged changes (index vs HEAD).
/// Used by the AI commit message generator. Output is truncated at 32 KB to
/// avoid overwhelming the model context.
#[tauri::command]
pub fn git_diff_staged_all(repo_path: String) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok());
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, None)
        .map_err(|e| format!("Diff error: {}", e))?;

    let mut output = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ' | 'F' | 'H') {
            output.push(origin);
        }
        if let Ok(content) = std::str::from_utf8(line.content()) {
            output.push_str(content);
        }
        true
    })
    .map_err(|e| format!("Diff print error: {}", e))?;

    // Truncate at 32 KB to keep within model context limits
    const MAX_BYTES: usize = 32 * 1024;
    if output.len() > MAX_BYTES {
        output.truncate(MAX_BYTES);
        output.push_str("\n... (diff truncated)");
    }

    Ok(output)
}

#[tauri::command]
pub fn git_diff_file(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = if staged {
        // Diff index vs HEAD
        let head_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        // Diff workdir vs index
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| format!("Diff error: {}", e))?;

    let mut output = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            output.push(origin);
        }
        if let Ok(content) = std::str::from_utf8(line.content()) {
            output.push_str(content);
        }
        true
    })
    .map_err(|e| format!("Diff print error: {}", e))?;

    Ok(output)
}

#[tauri::command]
pub fn git_file_content(
    repo_path: String,
    file_path: String,
) -> Result<GitFileContent, String> {
    let repo = open_repo(&repo_path)?;

    // Get original content from HEAD
    let original = get_head_content(&repo, &file_path).unwrap_or_default();

    // Get modified content from working directory
    let workdir = repo.workdir().ok_or("No working directory")?;
    let full_path = workdir.join(&file_path);
    let modified = std::fs::read_to_string(&full_path).unwrap_or_default();

    Ok(GitFileContent { original, modified })
}

fn get_head_content(repo: &Repository, file_path: &str) -> Result<String, String> {
    let head = repo.head().map_err(|e| format!("HEAD error: {}", e))?;
    let tree = head
        .peel_to_tree()
        .map_err(|e| format!("Tree error: {}", e))?;
    let entry = tree
        .get_path(Path::new(file_path))
        .map_err(|e| format!("Entry error: {}", e))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Blob error: {}", e))?;
    String::from_utf8(blob.content().to_vec())
        .map_err(|e| format!("UTF-8 error: {}", e))
}

#[tauri::command]
pub fn git_add(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;
    let mut index = repo.index().map_err(|e| format!("Index error: {}", e))?;

    for path in &paths {
        let full_path = repo
            .workdir()
            .ok_or("No working directory")?
            .join(path);

        if full_path.exists() {
            index
                .add_path(Path::new(path))
                .map_err(|e| format!("Stage error for '{}': {}", path, e))?;
        } else {
            // File was deleted, remove from index
            index
                .remove_path(Path::new(path))
                .map_err(|e| format!("Stage removal error for '{}': {}", path, e))?;
        }
    }

    index.write().map_err(|e| format!("Index write error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn git_add_all(repo_path: String) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;
    let mut index = repo.index().map_err(|e| format!("Index error: {}", e))?;

    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Stage all error: {}", e))?;

    // Also handle deleted files
    index
        .update_all(["*"].iter(), None)
        .map_err(|e| format!("Update index error: {}", e))?;

    index.write().map_err(|e| format!("Index write error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;

    let head = match repo.head() {
        Ok(h) => Some(h.peel_to_tree().map_err(|e| format!("Tree error: {}", e))?),
        Err(ref e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(format!("HEAD error: {}", e)),
    };

    let mut index = repo.index().map_err(|e| format!("Index error: {}", e))?;

    for path in &paths {
        if let Some(ref tree) = head {
            // Reset this path in the index to match HEAD
            match tree.get_path(Path::new(path)) {
                Ok(entry) => {
                    let blob = repo
                        .find_blob(entry.id())
                        .map_err(|e| format!("Blob error: {}", e))?;
                    let idx_entry = git2::IndexEntry {
                        ctime: git2::IndexTime::new(0, 0),
                        mtime: git2::IndexTime::new(0, 0),
                        dev: 0,
                        ino: 0,
                        mode: entry.filemode() as u32,
                        uid: 0,
                        gid: 0,
                        file_size: blob.size() as u32,
                        id: entry.id(),
                        flags: 0,
                        flags_extended: 0,
                        path: path.as_bytes().to_vec(),
                    };
                    index
                        .add(&idx_entry)
                        .map_err(|e| format!("Index add error: {}", e))?;
                }
                Err(_) => {
                    // File doesn't exist in HEAD, remove from index
                    let _ = index.remove_path(Path::new(path));
                }
            }
        } else {
            // No HEAD (initial commit), just remove from index
            let _ = index.remove_path(Path::new(path));
        }
    }

    index.write().map_err(|e| format!("Index write error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn git_discard(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;

    for path in &paths {
        let workdir = repo.workdir().ok_or("No working directory")?;
        let full_path = workdir.join(path);

        // Try to restore from index first, then from HEAD
        let index = repo.index().map_err(|e| format!("Index error: {}", e))?;

        if let Some(entry) = index.get_path(Path::new(path), 0) {
            let blob = repo
                .find_blob(entry.id)
                .map_err(|e| format!("Blob error: {}", e))?;
            std::fs::write(&full_path, blob.content())
                .map_err(|e| format!("Write error: {}", e))?;
        } else if let Ok(content) = get_head_content(&repo, path) {
            std::fs::write(&full_path, content.as_bytes())
                .map_err(|e| format!("Write error: {}", e))?;
        } else {
            // Untracked file — delete it
            if full_path.exists() {
                std::fs::remove_file(&full_path)
                    .map_err(|e| format!("Delete error: {}", e))?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    let repo = open_repo(&repo_path)?;
    let mut index = repo.index().map_err(|e| format!("Index error: {}", e))?;
    let oid = index
        .write_tree()
        .map_err(|e| format!("Tree write error: {}", e))?;
    let tree = repo
        .find_tree(oid)
        .map_err(|e| format!("Find tree error: {}", e))?;

    let sig = repo
        .signature()
        .or_else(|_| Signature::now("HysCode User", "user@hyscode.local"))
        .map_err(|e| format!("Signature error: {}", e))?;

    let parents: Vec<git2::Commit> = match repo.head() {
        Ok(head) => {
            let commit = head
                .peel_to_commit()
                .map_err(|e| format!("Peel error: {}", e))?;
            vec![commit]
        }
        Err(ref e) if e.code() == ErrorCode::UnbornBranch => vec![],
        Err(e) => return Err(format!("HEAD error: {}", e)),
    };

    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let commit_oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)
        .map_err(|e| format!("Commit error: {}", e))?;

    let short = &commit_oid.to_string()[..7];
    Ok(short.to_string())
}

#[tauri::command]
pub fn git_log(repo_path: String, limit: u32) -> Result<Vec<GitCommitInfo>, String> {
    let repo = open_repo(&repo_path)?;
    let mut revwalk = repo.revwalk().map_err(|e| format!("Revwalk error: {}", e))?;
    revwalk.push_head().map_err(|e| format!("Push head error: {}", e))?;
    revwalk.set_sorting(Sort::TIME).map_err(|e| format!("Sort error: {}", e))?;

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
    let mut revwalk = repo.revwalk().map_err(|e| format!("Revwalk error: {}", e))?;
    revwalk.push_head().map_err(|e| format!("Push head error: {}", e))?;
    revwalk.set_sorting(Sort::TIME).map_err(|e| format!("Sort error: {}", e))?;

    let mut commits = Vec::new();
    let mut prev_blob_id = None;

    for oid_result in revwalk {
        if commits.len() >= limit as usize {
            break;
        }
        let oid = oid_result.map_err(|e| format!("OID error: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Commit error: {}", e))?;
        let tree = commit
            .tree()
            .map_err(|e| format!("Tree error: {}", e))?;

        let current_blob_id = tree
            .get_path(Path::new(&file_path))
            .ok()
            .map(|e| e.id());

        // Include commit if the file changed (its blob id differs from prev)
        let changed = match (&prev_blob_id, &current_blob_id) {
            (None, Some(_)) => true,
            (Some(_), None) => true,
            (Some(a), Some(b)) => a != b,
            (None, None) => false,
        };

        if changed {
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

        prev_blob_id = current_blob_id;
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
) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;
    let head = repo
        .head()
        .map_err(|e| format!("HEAD error: {}", e))?;
    let commit = head
        .peel_to_commit()
        .map_err(|e| format!("Peel error: {}", e))?;

    repo.branch(&name, &commit, false)
        .map_err(|e| format!("Create branch error: {}", e))?;

    if checkout {
        let refname = format!("refs/heads/{}", name);
        let obj = repo
            .revparse_single(&refname)
            .map_err(|e| format!("Rev parse error: {}", e))?;
        repo.checkout_tree(&obj, None)
            .map_err(|e| format!("Checkout tree error: {}", e))?;
        repo.set_head(&refname)
            .map_err(|e| format!("Set head error: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn git_branch_delete(repo_path: String, name: String) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;
    let mut branch = repo
        .find_branch(&name, BranchType::Local)
        .map_err(|e| format!("Find branch error: {}", e))?;
    branch
        .delete()
        .map_err(|e| format!("Delete branch error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    let repo = open_repo(&repo_path)?;

    let refname = format!("refs/heads/{}", branch);
    let obj = repo
        .revparse_single(&refname)
        .map_err(|e| format!("Rev parse error: {}", e))?;

    repo.checkout_tree(&obj, None)
        .map_err(|e| format!("Checkout error: {}", e))?;
    repo.set_head(&refname)
        .map_err(|e| format!("Set head error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn git_remote_list(repo_path: String) -> Result<Vec<GitRemoteInfo>, String> {
    let repo = open_repo(&repo_path)?;
    let remotes = repo
        .remotes()
        .map_err(|e| format!("Remotes error: {}", e))?;

    let mut list = Vec::new();
    for name in remotes.iter().flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            list.push(GitRemoteInfo {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
            });
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn git_ahead_behind(repo_path: String) -> Result<GitAheadBehind, String> {
    let repo = open_repo(&repo_path)?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(GitAheadBehind { ahead: 0, behind: 0 }),
    };

    if !head.is_branch() {
        return Ok(GitAheadBehind { ahead: 0, behind: 0 });
    }

    let local_oid = head.target().ok_or("No HEAD target")?;

    let branch_name = head.shorthand().unwrap_or("");
    let branch = match repo.find_branch(branch_name, BranchType::Local) {
        Ok(b) => b,
        Err(_) => return Ok(GitAheadBehind { ahead: 0, behind: 0 }),
    };

    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(_) => return Ok(GitAheadBehind { ahead: 0, behind: 0 }),
    };

    let upstream_oid = upstream
        .get()
        .target()
        .ok_or("No upstream target")?;

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|e| format!("Ahead/behind error: {}", e))?;

    Ok(GitAheadBehind { ahead, behind })
}

#[tauri::command]
pub fn git_stash(repo_path: String, message: Option<String>) -> Result<(), String> {
    let mut repo =
        Repository::discover(&repo_path).map_err(|e| format!("Git error: {}", e))?;

    let sig = repo
        .signature()
        .or_else(|_| Signature::now("HysCode User", "user@hyscode.local"))
        .map_err(|e| format!("Signature error: {}", e))?;

    let msg = message.as_deref().unwrap_or("WIP on stash");

    repo.stash_save(&sig, msg, None)
        .map_err(|e| format!("Stash error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn git_stash_list(repo_path: String) -> Result<Vec<GitStashEntry>, String> {
    let mut repo =
        Repository::discover(&repo_path).map_err(|e| format!("Git error: {}", e))?;

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
    let mut repo =
        Repository::discover(&repo_path).map_err(|e| format!("Git error: {}", e))?;

    repo.stash_pop(index, None)
        .map_err(|e| format!("Stash pop error: {}", e))?;

    Ok(())
}

// ── Commit Detail ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn git_commit_detail(repo_path: String, hash: String) -> Result<CommitDetail, String> {
    let repo = open_repo(&repo_path)?;
    let oid = git2::Oid::from_str(&hash).map_err(|e| format!("Invalid hash: {}", e))?;
    let commit = repo.find_commit(oid).map_err(|e| format!("Commit not found: {}", e))?;

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

    for i in 0..diff.deltas().len() {
        let delta = diff.get_delta(i).unwrap();
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
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), Some(&mut per_file_opts))
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
    let oid = git2::Oid::from_str(&hash).map_err(|e| format!("Invalid hash: {}", e))?;
    let commit = repo.find_commit(oid).map_err(|e| format!("Commit not found: {}", e))?;

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

    let mut output = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            output.push(origin);
        }
        if let Ok(content) = std::str::from_utf8(line.content()) {
            output.push_str(content);
        }
        true
    })
    .map_err(|e| format!("Diff print error: {}", e))?;

    Ok(output)
}

// ── Remote operations (via CLI for auth compatibility) ───────────────────────

fn run_git_cli(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = cmd("git")
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

#[tauri::command]
pub fn git_push(
    repo_path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<String, String> {
    let r = remote.as_deref().unwrap_or("origin");
    match branch {
        Some(b) => run_git_cli(&repo_path, &["push", r, &b]),
        None => run_git_cli(&repo_path, &["push", r]),
    }
}

#[tauri::command]
pub fn git_pull(repo_path: String, remote: Option<String>) -> Result<String, String> {
    let r = remote.as_deref().unwrap_or("origin");
    run_git_cli(&repo_path, &["pull", r])
}

#[tauri::command]
pub fn git_fetch(repo_path: String, remote: Option<String>) -> Result<String, String> {
    let r = remote.as_deref().unwrap_or("origin");
    run_git_cli(&repo_path, &["fetch", r])
}

#[tauri::command]
pub fn git_merge(repo_path: String, branch: String) -> Result<String, String> {
    run_git_cli(&repo_path, &["merge", &branch])
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
pub fn git_blame(repo_path: String, file_path: String, line: Option<u32>) -> Result<Vec<GitBlameHunk>, String> {
    let repo = open_repo(&repo_path)?;

    let mut opts = git2::BlameOptions::new();
    if let Some(l) = line {
        let min_line = std::num::NonZeroU32::new(l).unwrap_or_else(|| std::num::NonZeroU32::new(1).unwrap());
        opts.min_line(min_line.get() as usize);
        opts.max_line(min_line.get() as usize);
    }

    let blame = repo.blame_file(std::path::Path::new(&file_path), Some(&mut opts))
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

        let message = repo.find_commit(hunk.final_commit_id())
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
    let repo = open_repo(&repo_path)?;
    let head = repo.head().map_err(|e| format!("HEAD error: {}", e))?;
    let target = head
        .peel(git2::ObjectType::Commit)
        .map_err(|e| format!("Peel error: {}", e))?;

    if let Some(msg) = message {
        let sig = repo
            .signature()
            .or_else(|_| Signature::now("HysCode User", "user@hyscode.local"))
            .map_err(|e| format!("Signature error: {}", e))?;
        repo.tag(&name, &target, &sig, &msg, false)
            .map_err(|e| format!("Tag error: {}", e))?;
    } else {
        repo.tag_lightweight(&name, &target, false)
            .map_err(|e| format!("Tag error: {}", e))?;
    }

    Ok(())
}
