use super::utils::cmd;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FileStat {
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub path: String,
    pub line_number: usize,
    pub line_content: String,
}

pub const READ_CHUNK_LEN: u64 = 256 * 1024;
pub const READ_CHUNK_HARD_CAP: u64 = 512 * 1024 * 1024;
pub const BINARY_SNIFF_LEN: usize = 8192;

// ── Workspace path sandbox ────────────────────────────────────────────────
// SECURITY: every filesystem command funnels user-supplied paths through
// these resolvers. Paths are canonicalized (symlinks + `..` resolved) and
// filesystem roots ("/", "C:\", "$HOME" itself) are always rejected, which
// blocks destructive operations against the whole disk or the home folder.
// Workspace roots are registered only from a native folder picker and restored
// from app-owned state. Selected external files are exact-path grants, never
// inferred from a caller-supplied root or directory string.

#[derive(Default)]
struct WorkspaceAuthority {
    roots: HashSet<PathBuf>,
    external_files: HashSet<PathBuf>,
    external_grants: HashMap<String, NativeExternalGrant>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PathAccess {
    Read,
    Write,
    Execute,
    Diagnostics,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeGrantOperation {
    Read,
    Write,
    Execute,
    Diagnostics,
}

impl NativeGrantOperation {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "read" => Ok(Self::Read),
            "write" => Ok(Self::Write),
            "execute" => Ok(Self::Execute),
            _ => Err(format!("Unsupported external access operation: {value}")),
        }
    }

    fn permits(self, access: PathAccess) -> bool {
        match (self, access) {
            (Self::Read, PathAccess::Read) => true,
            (Self::Write, PathAccess::Read | PathAccess::Write) => true,
            (Self::Execute, PathAccess::Execute) => true,
            (Self::Diagnostics, PathAccess::Diagnostics) => true,
            _ => false,
        }
    }
}

struct NativeExternalGrant {
    operation: NativeGrantOperation,
    exact_paths: HashSet<PathBuf>,
    directories: HashSet<PathBuf>,
    expires_at: Instant,
}

static WORKSPACE_AUTHORITY: OnceLock<Mutex<WorkspaceAuthority>> = OnceLock::new();

fn workspace_authority() -> &'static Mutex<WorkspaceAuthority> {
    WORKSPACE_AUTHORITY.get_or_init(|| Mutex::new(WorkspaceAuthority::default()))
}

fn authority_file_path() -> Result<PathBuf, String> {
    let app_data = dirs::data_local_dir().ok_or_else(|| {
        "Cannot locate the application data directory for workspace grants".to_string()
    })?;
    Ok(app_data.join("hyscode").join("workspace-roots.json"))
}

fn persist_workspace_roots(roots: &HashSet<PathBuf>) -> Result<(), String> {
    let path = authority_file_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "Workspace grant storage has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create workspace grant storage: {error}"))?;

    let mut root_paths: Vec<String> = roots.iter().map(|root| frontend_path(root)).collect();
    root_paths.sort();
    let serialized = serde_json::to_vec(&root_paths)
        .map_err(|error| format!("Could not encode workspace roots: {error}"))?;
    let temp_path = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp_path, serialized)
        .map_err(|error| format!("Could not write workspace grants: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Could not secure workspace grant storage: {error}"))?;
    }
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not replace workspace grant storage: {error}"))?;
    }
    fs::rename(&temp_path, &path)
        .map_err(|error| format!("Could not publish workspace grants: {error}"))
}

fn frontend_path(path: &Path) -> String {
    let rendered = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = rendered.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{}", unc);
        }
        return rendered
            .strip_prefix(r"\\?\")
            .unwrap_or(&rendered)
            .to_string();
    }
    #[cfg(not(windows))]
    rendered.to_string()
}

fn validate_workspace_root(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| {
        format!(
            "Cannot access workspace folder '{}': {error}",
            path.display()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "Workspace root is not a directory: {}",
            canonical.display()
        ));
    }
    reject_filesystem_root(&canonical)?;
    Ok(canonical)
}

fn register_workspace_root(path: &Path, persist: bool) -> Result<PathBuf, String> {
    let canonical = validate_workspace_root(path)?;
    let mut authority = workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?;
    if authority.roots.contains(&canonical) {
        return Ok(canonical);
    }
    let mut updated = authority.roots.clone();
    updated.insert(canonical.clone());
    if persist {
        persist_workspace_roots(&updated)?;
    }
    authority.roots = updated;
    Ok(canonical)
}

fn register_external_file(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Cannot access selected file '{}': {error}", path.display()))?;
    if !canonical.is_file() {
        return Err(format!(
            "Selected path is not a file: {}",
            canonical.display()
        ));
    }
    reject_filesystem_root(&canonical)?;
    workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?
        .external_files
        .insert(canonical.clone());
    Ok(canonical)
}

fn register_external_save_file(path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .ok_or_else(|| "Selected save path must include a file name".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "Selected save path must include a parent directory".to_string())?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Cannot access selected save folder: {error}"))?;
    reject_filesystem_root(&canonical_parent)?;
    let target = canonical_parent.join(name);
    workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?
        .external_files
        .insert(target.clone());
    Ok(target)
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .replace('\\', "/")
            .eq_ignore_ascii_case(&right.to_string_lossy().replace('\\', "/"))
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn is_authorized_path(path: &Path) -> Result<bool, String> {
    let authority = workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(authority.roots.iter().any(|root| is_within_dir(path, root))
        || authority
            .external_files
            .iter()
            .any(|external| same_path(external, path)))
}

fn is_authorized_path_with_grants(
    path: &Path,
    access: PathAccess,
    grant_ids: Option<&[String]>,
) -> Result<bool, String> {
    if is_authorized_path(path)? {
        return Ok(true);
    }
    let Some(grant_ids) = grant_ids else {
        return Ok(false);
    };
    let mut authority = workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?;
    let now = Instant::now();
    authority
        .external_grants
        .retain(|_, grant| grant.expires_at > now);
    Ok(grant_ids.iter().any(|grant_id| {
        let Some(grant) = authority.external_grants.get(grant_id) else {
            return false;
        };
        grant.operation.permits(access)
            && (grant.exact_paths.iter().any(|exact| same_path(exact, path))
                || grant
                    .directories
                    .iter()
                    .any(|directory| is_within_dir(path, directory)))
    }))
}

fn require_authorized_path_with_grants(
    path: &Path,
    access: PathAccess,
    grant_ids: Option<&[String]>,
) -> Result<(), String> {
    if is_authorized_path_with_grants(path, access, grant_ids)? {
        return Ok(());
    }
    Err(format!(
        "Path is outside every authorized workspace or approved external grant: {}",
        path.display()
    ))
}

fn add_external_access_grant(
    operation: NativeGrantOperation,
    exact_paths: HashSet<PathBuf>,
    directories: HashSet<PathBuf>,
    session_scoped: bool,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let lifetime = if session_scoped {
        Duration::from_secs(8 * 60 * 60)
    } else {
        Duration::from_secs(10 * 60)
    };
    let grant = NativeExternalGrant {
        operation,
        exact_paths,
        directories,
        expires_at: Instant::now() + lifetime,
    };
    workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?
        .external_grants
        .insert(id.clone(), grant);
    Ok(id)
}

fn canonical_save_target(path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .ok_or_else(|| "Selected save path must include a file name".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "Selected save path must include a parent directory".to_string())?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Cannot access selected save folder: {error}"))?;
    reject_filesystem_root(&canonical_parent)?;
    Ok(canonical_parent.join(name))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExternalAccessRequest {
    operation: String,
    paths: Vec<String>,
    directories: Vec<String>,
    directory_scopes: Vec<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_confirm_external_access(
    app: AppHandle,
    request: NativeExternalAccessRequest,
    grant_type: String,
    workspace_path: String,
) -> Result<String, String> {
    let operation = NativeGrantOperation::parse(&request.operation)?;
    let session_scoped = match grant_type.as_str() {
        "once" => false,
        "session-directory" => true,
        _ => return Err("Unsupported external access grant type".to_string()),
    };
    let _canonical_workspace = validate_registered_workspace(Path::new(&workspace_path))?;

    let subjects: Vec<(String, bool)> = if session_scoped {
        request
            .directories
            .iter()
            .cloned()
            .map(|path| (path, true))
            .collect()
    } else {
        request
            .paths
            .iter()
            .cloned()
            .map(|path| {
                let is_scope = request
                    .directory_scopes
                    .iter()
                    .any(|scope| same_path(Path::new(scope), Path::new(&path)));
                (path, is_scope)
            })
            .collect()
    };
    if subjects.is_empty() {
        return Err("External access request contains no paths".to_string());
    }

    let mut exact_paths = HashSet::new();
    let mut directories = HashSet::new();
    for (subject, is_scope) in subjects {
        let expected = PathBuf::from(&subject);
        if !expected.is_absolute() {
            return Err(format!("External access path must be absolute: {subject}"));
        }
        reject_filesystem_root(&expected)?;
        let canonical = select_exact_native_path(&app, &expected, is_scope, operation).await?;
        if is_scope || canonical.is_dir() {
            directories.insert(canonical);
        } else {
            exact_paths.insert(canonical);
        }
    }

    add_external_access_grant(operation, exact_paths, directories, session_scoped)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_confirm_diagnostics(
    app: AppHandle,
    workspace_path: String,
) -> Result<String, String> {
    let workspace = validate_registered_workspace(Path::new(&workspace_path))?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "HysCode wants to run project-controlled diagnostic tools in:\n\n{}\n\nProject configuration may execute code. Continue?",
            workspace.display()
        ))
        .title("Approve project diagnostics")
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    if !receiver
        .await
        .map_err(|error| format!("Diagnostics approval dialog failed: {error}"))?
    {
        return Err("Project diagnostics were not approved".to_string());
    }

    add_external_access_grant(
        NativeGrantOperation::Diagnostics,
        HashSet::new(),
        HashSet::from([workspace]),
        false,
    )
}

async fn select_exact_native_path(
    app: &AppHandle,
    expected: &Path,
    force_directory: bool,
    operation: NativeGrantOperation,
) -> Result<PathBuf, String> {
    let expected_is_directory = force_directory
        || fs::metadata(expected)
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false);
    let selected = if expected_is_directory {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_directory(expected)
            .pick_folder(move |selection| {
                let _ = sender.send(selection);
            });
        let Some(selection) = receiver
            .await
            .map_err(|error| format!("External directory confirmation failed: {error}"))?
        else {
            return Err("External access confirmation was cancelled".to_string());
        };
        selection
            .into_path()
            .map_err(|error| format!("Could not resolve selected directory: {error}"))?
    } else if operation == NativeGrantOperation::Write && !expected.exists() {
        let parent = expected
            .parent()
            .ok_or_else(|| "External save target has no parent directory".to_string())?;
        let name = expected
            .file_name()
            .ok_or_else(|| "External save target has no file name".to_string())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_directory(parent)
            .set_file_name(name.to_string_lossy())
            .save_file(move |selection| {
                let _ = sender.send(selection);
            });
        let Some(selection) = receiver
            .await
            .map_err(|error| format!("External save confirmation failed: {error}"))?
        else {
            return Err("External access confirmation was cancelled".to_string());
        };
        selection
            .into_path()
            .map_err(|error| format!("Could not resolve selected save path: {error}"))?
    } else {
        let parent = expected
            .parent()
            .ok_or_else(|| "External file path has no parent directory".to_string())?;
        let name = expected
            .file_name()
            .ok_or_else(|| "External file path has no file name".to_string())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_directory(parent)
            .set_file_name(name.to_string_lossy())
            .pick_file(move |selection| {
                let _ = sender.send(selection);
            });
        let Some(selection) = receiver
            .await
            .map_err(|error| format!("External file confirmation failed: {error}"))?
        else {
            return Err("External access confirmation was cancelled".to_string());
        };
        selection
            .into_path()
            .map_err(|error| format!("Could not resolve selected file: {error}"))?
    };

    let canonical_selected = if expected_is_directory {
        fs::canonicalize(&selected)
            .map_err(|error| format!("Could not validate selected directory: {error}"))?
    } else if operation == NativeGrantOperation::Write && !expected.exists() {
        canonical_save_target(&selected)?
    } else {
        fs::canonicalize(&selected)
            .map_err(|error| format!("Could not validate selected file: {error}"))?
    };
    let canonical_expected = if operation == NativeGrantOperation::Write && !expected.exists() {
        canonical_save_target(expected)?
    } else {
        fs::canonicalize(expected)
            .map_err(|error| format!("Could not validate requested external path: {error}"))?
    };
    if !same_path(&canonical_selected, &canonical_expected) {
        return Err(format!(
            "Native selection did not match the requested external path: {}",
            expected.display()
        ));
    }
    reject_filesystem_root(&canonical_selected)?;
    Ok(canonical_selected)
}

#[tauri::command(rename_all = "camelCase")]
pub fn workspace_revoke_external_grants(grant_ids: Vec<String>) -> Result<(), String> {
    let mut authority = workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?;
    for grant_id in grant_ids {
        authority.external_grants.remove(&grant_id);
    }
    Ok(())
}

/// Restore only native-picker roots previously recorded by this app.
pub fn restore_authorized_roots() -> Result<(), String> {
    let path = authority_file_path()?;
    let data = match fs::read_to_string(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Could not read workspace grants: {error}")),
    };
    let recorded: Vec<String> = serde_json::from_str(&data)
        .map_err(|error| format!("Workspace grant storage is invalid: {error}"))?;
    let roots = recorded
        .iter()
        .filter_map(|root| validate_workspace_root(Path::new(root)).ok())
        .collect();
    workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?
        .roots = roots;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileDialogFilter {
    name: String,
    extensions: Vec<String>,
}

#[tauri::command]
pub async fn workspace_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |selected| {
        let _ = sender.send(selected);
    });
    let Some(selected) = receiver
        .await
        .map_err(|error| format!("Workspace folder picker failed: {error}"))?
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Could not resolve selected folder: {error}"))?;
    let canonical = register_workspace_root(&path, true)?;
    Ok(Some(frontend_path(&canonical)))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_pick_file(
    app: AppHandle,
    filters: Option<Vec<WorkspaceFileDialogFilter>>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    for filter in filters.unwrap_or_default() {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(filter.name, &extensions);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    builder.pick_file(move |selected| {
        let _ = sender.send(selected);
    });
    let Some(selected) = receiver
        .await
        .map_err(|error| format!("Workspace file picker failed: {error}"))?
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Could not resolve selected file: {error}"))?;
    let canonical = register_external_file(&path)?;
    Ok(Some(frontend_path(&canonical)))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_save_file(
    app: AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(default_name) = default_name {
        builder = builder.set_file_name(default_name);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    builder.save_file(move |selected| {
        let _ = sender.send(selected);
    });
    let Some(selected) = receiver
        .await
        .map_err(|error| format!("Workspace save picker failed: {error}"))?
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Could not resolve selected save path: {error}"))?;
    let authorized = register_external_save_file(&path)?;
    Ok(Some(frontend_path(&authorized)))
}

/// Reject filesystem roots: `/`, drive roots (`C:\`), and `$HOME` itself.
/// Subdirectories of `$HOME` (regular workspaces) remain allowed.
/// Both sides are canonicalized before comparison: on Windows
/// `canonicalize` returns verbatim (`\\?\C:\...`) paths while `dirs` does
/// not, so a raw string comparison would miss the home directory.
fn reject_filesystem_root(canonical: &Path) -> Result<(), String> {
    if let Some(home) = dirs::home_dir() {
        let is_home = fs::canonicalize(&home)
            .map(|canonical_home| canonical == canonical_home)
            .unwrap_or(false)
            || canonical == home;
        if is_home {
            return Err(format!(
                "Refusing operation on home directory: {}",
                canonical.display()
            ));
        }
    }
    match canonical.parent() {
        None => Err(format!(
            "Refusing operation on filesystem root: {}",
            canonical.display()
        )),
        Some(parent) if parent.as_os_str().is_empty() || parent == canonical => Err(format!(
            "Refusing operation on filesystem root: {}",
            canonical.display()
        )),
        _ => Ok(()),
    }
}

fn validate_registered_workspace(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Cannot access workspace '{}': {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Workspace is not a directory: {}",
            canonical.display()
        ));
    }
    reject_filesystem_root(&canonical)?;
    let authority = workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?;
    if !authority
        .roots
        .iter()
        .any(|root| is_within_dir(&canonical, root))
    {
        return Err(format!(
            "Workspace is not authorized by a native folder selection: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

pub(super) fn require_native_diagnostics_grant(
    workspace_path: &str,
    grant_ids: Option<&[String]>,
) -> Result<PathBuf, String> {
    let workspace = validate_registered_workspace(Path::new(workspace_path))?;
    let Some(grant_ids) = grant_ids else {
        return Err("Project diagnostics require native user approval".to_string());
    };
    let mut authority = workspace_authority()
        .lock()
        .map_err(|error| error.to_string())?;
    let now = Instant::now();
    authority
        .external_grants
        .retain(|_, grant| grant.expires_at > now);
    let authorized = grant_ids.iter().any(|grant_id| {
        let Some(grant) = authority.external_grants.get(grant_id) else {
            return false;
        };
        grant.operation.permits(PathAccess::Diagnostics)
            && grant.directories.iter().any(|directory| {
                is_within_dir(&workspace, directory) && is_within_dir(directory, &workspace)
            })
    });
    if !authorized {
        return Err("Project diagnostics require a valid native user approval".to_string());
    }
    Ok(workspace)
}

/// Resolve a path that must already exist: canonicalize + root-guard.
/// Returned path is the canonical (symlink-resolved) location.
pub fn resolve_workspace_path(path: &str) -> Result<PathBuf, String> {
    resolve_workspace_path_with_grants(path, PathAccess::Read, None)
}

fn resolve_workspace_path_with_grants(
    path: &str,
    access: PathAccess,
    grant_ids: Option<&[String]>,
) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if path.contains('\0') {
        return Err("Path contains invalid characters".to_string());
    }
    let canonical = fs::canonicalize(path)
        .map_err(|e| format!("Cannot access path '{}': {e}", Path::new(path).display()))?;
    reject_filesystem_root(&canonical)?;
    require_authorized_path_with_grants(&canonical, access, grant_ids)?;
    Ok(canonical)
}

pub(super) fn resolve_authorized_execution_directory(
    path: &str,
    grant_ids: Option<&[String]>,
) -> Result<PathBuf, String> {
    let canonical = resolve_workspace_path_with_grants(path, PathAccess::Execute, grant_ids)?;
    if !canonical.is_dir() {
        return Err(format!(
            "Execution working directory is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

/// Resolve a destructive target without following its final symlink. Parent
/// components are canonicalized so aliases and traversal are normalized, but
/// the final path remains the link itself for safe unlink/trash operations.
fn resolve_delete_target(path: &str, grant_ids: Option<&[String]>) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if path.contains('\0') {
        return Err("Path contains invalid characters".to_string());
    }

    let candidate = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| format!("Cannot access path '{}': {error}", candidate.display()))?;
    if !metadata.file_type().is_symlink() {
        return resolve_workspace_path_with_grants(path, PathAccess::Write, grant_ids);
    }

    let parent = candidate.parent().ok_or_else(|| {
        format!(
            "Refusing operation on filesystem root: {}",
            candidate.display()
        )
    })?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "Cannot access parent directory '{}': {error}",
            parent.display()
        )
    })?;
    let name = candidate
        .file_name()
        .ok_or_else(|| format!("Invalid symlink path: {}", candidate.display()))?;
    let resolved = canonical_parent.join(name);
    reject_filesystem_root(&resolved)?;
    require_authorized_path_with_grants(&resolved, PathAccess::Write, grant_ids)?;
    Ok(resolved)
}

/// Resolve a path for writing (it may not exist yet): canonicalize the
/// nearest existing ancestor, root-guard it, validate the file name, and
/// re-attach. Parent directories are therefore never created above (or as)
/// a filesystem root — `write_file` cannot `create_dir_all("/")`.
#[cfg(test)]
fn resolve_workspace_write_path(path: &str) -> Result<PathBuf, String> {
    resolve_workspace_write_path_with_grants(path, None)
}

fn resolve_workspace_write_path_with_grants(
    path: &str,
    grant_ids: Option<&[String]>,
) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if path.contains('\0') {
        return Err("Path contains invalid characters".to_string());
    }
    let candidate = PathBuf::from(path);
    if let Ok(canonical) = fs::canonicalize(&candidate) {
        reject_filesystem_root(&canonical)?;
        require_authorized_path_with_grants(&canonical, PathAccess::Write, grant_ids)?;
        return Ok(canonical);
    }
    // Walk up to the nearest existing ancestor and canonicalize it.
    let mut ancestor = candidate.as_path();
    let mut pending: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match ancestor.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => {
                if let Some(name) = ancestor.file_name() {
                    pending.push(name.to_os_string());
                }
                ancestor = parent;
                if ancestor.exists() {
                    break;
                }
            }
            _ => {
                if let Some(name) = ancestor.file_name() {
                    pending.push(name.to_os_string());
                }
                break;
            }
        }
    }
    let canonical_base = fs::canonicalize(ancestor)
        .map_err(|e| format!("Cannot access path '{}': {e}", candidate.display()))?;
    reject_filesystem_root(&canonical_base)?;
    let mut resolved = canonical_base;
    for component in pending.into_iter().rev() {
        let text = component.to_string_lossy();
        if text == "." || text == ".." {
            return Err(format!(
                "Path escapes the workspace: '{}'",
                candidate.display()
            ));
        }
        resolved.push(component);
    }
    reject_filesystem_root(&resolved)?;
    require_authorized_path_with_grants(&resolved, PathAccess::Write, grant_ids)?;
    Ok(resolved)
}

#[derive(Serialize)]
pub struct FileChunk {
    pub data: String,
    pub total_size: u64,
    pub is_binary: bool,
    pub finished: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_file(path: String, native_grant_ids: Option<Vec<String>>) -> Result<String, String> {
    let path =
        resolve_workspace_path_with_grants(&path, PathAccess::Read, native_grant_ids.as_deref())?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_file_chunk(
    path: String,
    offset: u64,
    length: u64,
    native_grant_ids: Option<Vec<String>>,
) -> Result<FileChunk, String> {
    let path =
        resolve_workspace_path_with_grants(&path, PathAccess::Read, native_grant_ids.as_deref())?;
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let total_size = metadata.len();
    if offset >= total_size {
        return Ok(FileChunk {
            data: String::new(),
            total_size,
            is_binary: false,
            finished: true,
        });
    }
    if length == 0 || length > READ_CHUNK_LEN || offset.saturating_add(length) > READ_CHUNK_HARD_CAP
    {
        return Err("Chunk out of range".to_string());
    }
    let remaining = total_size.saturating_sub(offset);
    let read_len = (length.min(remaining)) as usize;
    if read_len == 0 {
        return Ok(FileChunk {
            data: String::new(),
            total_size,
            is_binary: false,
            finished: true,
        });
    }
    let mut file = fs::File::open(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let mut bytes = vec![0u8; read_len];
    file.read_exact(&mut bytes)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let finished = offset.saturating_add(read_len as u64) >= total_size;
    match String::from_utf8(bytes) {
        Ok(data) => Ok(FileChunk {
            data,
            total_size,
            is_binary: false,
            finished,
        }),
        Err(err) => {
            let raw = err.as_bytes();
            let sniff_len = raw.len().min(BINARY_SNIFF_LEN);
            if raw[..sniff_len].contains(&0) {
                return Ok(FileChunk {
                    data: String::new(),
                    total_size,
                    is_binary: true,
                    finished: true,
                });
            }
            Ok(FileChunk {
                data: String::from_utf8_lossy(raw).into_owned(),
                total_size,
                is_binary: false,
                finished,
            })
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_file(
    path: String,
    content: String,
    native_grant_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let path = resolve_workspace_write_path_with_grants(&path, native_grant_ids.as_deref())?;
    if let Some(parent) = path.parent() {
        // Parent was root-guarded by the resolver; only create below it.
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_file(
    path: String,
    content: Option<String>,
    native_grant_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let path = resolve_workspace_write_path_with_grants(&path, native_grant_ids.as_deref())?;
    if path.exists() {
        return Err(format!("File already exists: {}", path.display()));
    }
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&path, content.unwrap_or_default())
        .map_err(|e| format!("Failed to create file: {}", e))
}

fn ensure_path_exists(path: &Path) -> Result<(), String> {
    if !path.exists() && fs::symlink_metadata(path).is_err() {
        return Err(format!("Path not found: {}", path.display()));
    }
    Ok(())
}

/// Permanently delete a file or directory on the blocking filesystem pool.
///
/// SECURITY: the frontend must confirm destructive deletes with the user
/// before invoking; the backend additionally refuses filesystem roots
/// (`/`, `C:\`, `$HOME`) via `resolve_workspace_path`.
///
/// Recursive deletion can take a long time for large workspaces. Keeping it
/// off the Tauri async runtime prevents filesystem work from delaying commands
/// that need to keep the application responsive.
#[tauri::command(rename_all = "camelCase")]
pub async fn delete_path(
    path: String,
    native_grant_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let resolved = resolve_delete_target(&path, native_grant_ids.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_path_exists(&resolved)?;
        remove_all_hardened(&resolved)
    })
    .await
    .map_err(|error| format!("Delete task failed: {}", error))?
}

/// Move a file or directory to the OS Trash / Recycle Bin.
///
/// SECURITY: same root-guard as `delete_path`.
///
/// Returns `Err("TRASH_UNAVAILABLE: ...")` when the platform trash cannot be
/// used (e.g. Linux without a Freedesktop trash backend). Callers should offer
/// a permanent delete as an explicit user-confirmed fallback in that case.
#[tauri::command(rename_all = "camelCase")]
pub async fn trash_path(path: String, native_grant_ids: Option<Vec<String>>) -> Result<(), String> {
    let resolved = resolve_delete_target(&path, native_grant_ids.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_path_exists(&resolved)?;
        trash::delete(&resolved).map_err(|e| format!("TRASH_UNAVAILABLE: {}", e))
    })
    .await
    .map_err(|error| format!("Trash task failed: {}", error))?
}

/// Clear the read-only flag recursively so deletes succeed on all platforms
/// (Windows file attributes, Unix permission bits).
fn clear_readonly_recursive(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to read metadata of {}: {}", path.display(), e))?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.permissions().readonly() {
        let perms = writable_permissions(&meta);
        fs::set_permissions(path, perms).map_err(|e| {
            format!(
                "Failed to clear read-only flag of {}: {}",
                path.display(),
                e
            )
        })?;
    }
    if meta.is_dir() {
        let entries = fs::read_dir(path)
            .map_err(|e| format!("Failed to read dir {}: {}", path.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            clear_readonly_recursive(&entry.path())?;
        }
    }
    Ok(())
}

/// Permissions that allow deletion: on Unix add owner-write while preserving
/// all other mode bits (avoids the world-writable side effect of
/// `set_readonly(false)`); on Windows clear the read-only attribute.
fn writable_permissions(meta: &fs::Metadata) -> fs::Permissions {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::Permissions::from_mode(meta.permissions().mode() | 0o200)
    }
    #[cfg(not(unix))]
    {
        let mut perms = meta.permissions();
        perms.set_readonly(false);
        perms
    }
}

/// Permanent recursive delete that handles symlinks (never follows them into
/// the target) and read-only files/dirs on Windows, Linux and macOS.
fn remove_all_hardened(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to read metadata of {}: {}", path.display(), e))?;
    if meta.file_type().is_symlink() || meta.is_file() {
        let _ = fs::set_permissions(path, writable_permissions(&meta));
        return fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e));
    }

    // Most directories do not need permission preparation. Trying the native
    // recursive removal first avoids walking every entry twice on large trees.
    let delete_error = match fs::remove_dir_all(path) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };
    // Read-only entries are handled by the fallback below. Keeping this path
    // on every error preserves the hardened delete behavior on all platforms.

    // A failed recursive delete may have removed the last entries already.
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect directory {} after delete failure: {}",
                path.display(),
                error
            ));
        }
    }

    clear_readonly_recursive(path)?;
    fs::remove_dir_all(path).map_err(|error| {
        format!(
            "Failed to delete directory (initial attempt: {}; retry: {})",
            delete_error, error
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_dir(
    path: String,
    show_hidden: Option<bool>,
    native_grant_ids: Option<Vec<String>>,
) -> Result<Vec<FileEntry>, String> {
    let show_hidden = show_hidden.unwrap_or(false);
    let path =
        resolve_workspace_path_with_grants(&path, PathAccess::Read, native_grant_ids.as_deref())?;
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Always skip heavy build/dependency directories
        if name == "node_modules" || name == "target" {
            continue;
        }

        // Skip hidden entries unless explicitly requested
        if !show_hidden && name.starts_with('.') {
            continue;
        }

        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

    Ok(entries)
}

#[tauri::command(rename_all = "camelCase")]
pub fn stat_path(path: String, native_grant_ids: Option<Vec<String>>) -> Result<FileStat, String> {
    let path =
        resolve_workspace_path_with_grants(&path, PathAccess::Read, native_grant_ids.as_deref())?;

    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(FileStat {
        path: path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        size: metadata.len(),
        modified,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn path_exists(path: String, native_grant_ids: Option<Vec<String>>) -> Result<bool, String> {
    let resolved = resolve_workspace_write_path_with_grants(&path, native_grant_ids.as_deref())?;
    match fs::symlink_metadata(&resolved) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Could not inspect path '{}': {error}",
            resolved.display()
        )),
    }
}

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".turbo",
];

const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "svg", "woff", "woff2", "ttf", "otf", "eot", "mp3",
    "mp4", "avi", "mov", "zip", "tar", "gz", "rar", "7z", "pdf", "exe", "dll", "so", "dylib", "o",
    "a", "wasm", "lock",
];

fn is_binary_file(name: &str) -> bool {
    if let Some(ext) = name.rsplit('.').next() {
        BINARY_EXTENSIONS.contains(&ext.to_lowercase().as_str())
    } else {
        false
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn search_files(
    root: String,
    query: String,
    is_regex: Option<bool>,
    max_results: Option<usize>,
    show_hidden: Option<bool>,
    native_grant_ids: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, String> {
    let root_path =
        resolve_workspace_path_with_grants(&root, PathAccess::Read, native_grant_ids.as_deref())?;
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }

    let use_regex = is_regex.unwrap_or(false);
    let limit = max_results.unwrap_or(200);
    let show_hidden = show_hidden.unwrap_or(false);
    let mut results = Vec::new();

    // Pre-compile regex if requested
    let regex_opt = if use_regex {
        match regex::Regex::new(&query) {
            Ok(re) => Some(re),
            Err(e) => return Err(format!("Invalid regex: {}", e)),
        }
    } else {
        None
    };

    fn walk(
        dir: &PathBuf,
        query: &str,
        regex_opt: &Option<regex::Regex>,
        results: &mut Vec<SearchResult>,
        limit: usize,
        show_hidden: bool,
    ) -> std::io::Result<()> {
        if results.len() >= limit {
            return Ok(());
        }

        let entries = fs::read_dir(dir)?;
        for entry in entries {
            if results.len() >= limit {
                break;
            }
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();

            if (!show_hidden && name.starts_with('.')) || IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }

            let path = entry.path();
            let ft = entry.file_type()?;

            if ft.is_dir() {
                walk(&path, query, regex_opt, results, limit, show_hidden)?;
            } else if ft.is_file() && !is_binary_file(&name) {
                if let Ok(content) = fs::read_to_string(&path) {
                    for (i, line) in content.lines().enumerate() {
                        if results.len() >= limit {
                            break;
                        }
                        let matched = if let Some(ref re) = regex_opt {
                            re.is_match(line)
                        } else {
                            line.to_lowercase().contains(&query.to_lowercase())
                        };
                        if matched {
                            results.push(SearchResult {
                                path: path.to_string_lossy().to_string(),
                                line_number: i + 1,
                                line_content: line.trim().to_string(),
                            });
                        }
                    }
                }
            }
        }
        Ok(())
    }

    walk(
        &root_path,
        &query,
        &regex_opt,
        &mut results,
        limit,
        show_hidden,
    )
    .map_err(|e| format!("Search error: {}", e))?;

    Ok(results)
}

#[tauri::command(rename_all = "camelCase")]
pub fn rename_path(
    from: String,
    to: String,
    native_grant_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let from_path =
        resolve_workspace_path_with_grants(&from, PathAccess::Write, native_grant_ids.as_deref())?;
    let to_path = resolve_workspace_write_path_with_grants(&to, native_grant_ids.as_deref())?;

    if !from_path.exists() && fs::symlink_metadata(&from_path).is_err() {
        return Err(format!("Source path not found: {}", from));
    }
    if to_path.exists() || fs::symlink_metadata(&to_path).is_ok() {
        return Err(format!("Destination already exists: {}", to));
    }
    if let Some(name) = to_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }

    fs::rename(&from_path, &to_path).map_err(|e| format!("Failed to rename: {}", e))
}

/// Returns true when `child` equals `parent` or is nested inside it.
/// On Windows the comparison is case-insensitive and separator-agnostic so
/// that "C:\A" vs "c:/a/b" is detected; elsewhere `Path::starts_with` is used.
fn is_within_dir(child: &Path, parent: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        fn norm(p: &Path) -> String {
            p.to_string_lossy()
                .replace('/', "\\")
                .trim_end_matches('\\')
                .to_lowercase()
        }
        let c = norm(child);
        let p = norm(parent);
        c == p || c.starts_with(&format!("{}\\", p))
    }
    #[cfg(not(target_os = "windows"))]
    {
        child.starts_with(parent)
    }
}

fn is_cross_device_error(e: &std::io::Error) -> bool {
    match e.raw_os_error() {
        #[cfg(target_os = "windows")]
        Some(code) => code == 17, // ERROR_NOT_SAME_DEVICE
        #[cfg(target_os = "macos")]
        Some(code) => code == 18, // EXDEV
        #[cfg(target_os = "linux")]
        Some(code) => code == 18, // EXDEV
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Some(_) => false,
        None => false,
    }
}

/// Move a file or directory, working across volumes/drives.
///
/// Same-device moves use an atomic `rename`. Cross-device moves
/// (`C:` -> `D:`, `/` -> `/mnt`, ...) fall back to copy + permanent delete.
/// The destination must not exist; callers are expected to auto-rename first.
#[tauri::command(rename_all = "camelCase")]
pub fn move_path(
    from: String,
    to: String,
    native_grant_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let from_path =
        resolve_workspace_path_with_grants(&from, PathAccess::Write, native_grant_ids.as_deref())?;
    let to_path = resolve_workspace_write_path_with_grants(&to, native_grant_ids.as_deref())?;

    if !from_path.exists() && fs::symlink_metadata(&from_path).is_err() {
        return Err(format!("Source path not found: {}", from));
    }
    if to_path.exists() || fs::symlink_metadata(&to_path).is_ok() {
        return Err(format!("Destination already exists: {}", to));
    }
    if is_within_dir(&to_path, &from_path) {
        return Err("Cannot move a folder into itself".to_string());
    }
    if let Some(name) = to_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }

    match fs::rename(&from_path, &to_path) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device_error(&e) => {
            copy_path_inner(&from_path, &to_path)?;
            remove_all_hardened(&from_path)?;
            Ok(())
        }
        Err(e) => Err(format!("Failed to move: {}", e)),
    }
}

/// Join a parent directory and a child name using the OS separator.
/// Validates the child name and avoids any frontend separator guessing.
/// NOTE: the parent is intentionally NOT canonicalized so the returned string
/// keeps the caller's path form (canonicalization would rewrite it to a
/// verbatim `\\?\` path on Windows); `validate_file_name` already rules out
/// separators and traversal in `name`.
#[tauri::command(rename_all = "camelCase")]
pub fn join_path(parent: String, name: String) -> Result<String, String> {
    validate_file_name(&name)?;
    if parent.trim().is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    Ok(PathBuf::from(&parent)
        .join(&name)
        .to_string_lossy()
        .to_string())
}

/// Validate a single file/folder name for the running OS.
/// Returns `Ok(())` when valid, `Err(message)` describing the problem.
#[tauri::command(rename_all = "camelCase")]
pub fn validate_name(name: String) -> Result<(), String> {
    validate_file_name(&name)
}

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn validate_file_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if name.contains('\0') || name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain `/`, `\\` or null characters".to_string());
    }
    if name.len() > 255 {
        return Err("Name is too long (max 255 characters)".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if name
            .chars()
            .any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || (c as u32) < 0x20)
        {
            return Err(
                "Name cannot contain any of the following characters: < > : \" / \\ | ? *"
                    .to_string(),
            );
        }
        if name.ends_with(' ') || name.ends_with('.') {
            return Err("Name cannot end with a space or a dot".to_string());
        }
        let stem = name.split('.').next().unwrap_or(name).to_uppercase();
        if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
            return Err(format!("\"{}\" is a reserved name on Windows", stem));
        }
    }

    Ok(())
}

/// Recursively search for files matching a glob-like pattern.
/// Supports: `*` (any chars except `/`), `**` (any path segments), `?` (single char).
#[tauri::command(rename_all = "camelCase")]
pub fn find_files(
    base_path: String,
    pattern: String,
    max_results: Option<usize>,
    show_hidden: Option<bool>,
    native_grant_ids: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let root = resolve_workspace_path_with_grants(
        &base_path,
        PathAccess::Read,
        native_grant_ids.as_deref(),
    )?;
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", base_path));
    }

    let limit = max_results.unwrap_or(50).min(200);
    let show_hidden = show_hidden.unwrap_or(false);
    let mut results = Vec::new();

    // Convert glob pattern to regex
    let regex_pattern = glob_to_regex(&pattern);
    let re = regex::Regex::new(&regex_pattern)
        .map_err(|e| format!("Invalid pattern \"{}\": {}", pattern, e))?;

    fn walk_find(
        dir: &PathBuf,
        root: &PathBuf,
        re: &regex::Regex,
        results: &mut Vec<String>,
        limit: usize,
        show_hidden: bool,
    ) -> std::io::Result<()> {
        if results.len() >= limit {
            return Ok(());
        }
        let entries = fs::read_dir(dir)?;
        for entry in entries {
            if results.len() >= limit {
                break;
            }
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();

            if (!show_hidden && name.starts_with('.')) || IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }

            let path = entry.path();
            let ft = entry.file_type()?;

            // Get path relative to root for matching
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            if ft.is_dir() {
                walk_find(&path, root, re, results, limit, show_hidden)?;
            } else if ft.is_file() {
                // Match against relative path and also just the filename
                if re.is_match(&rel) || re.is_match(&name) {
                    results.push(path.to_string_lossy().to_string());
                }
            }
        }
        Ok(())
    }

    walk_find(&root, &root, &re, &mut results, limit, show_hidden)
        .map_err(|e| format!("Find error: {}", e))?;

    results.sort();
    Ok(results)
}

/// Convert a simple glob pattern to a regex string.
fn glob_to_regex(pattern: &str) -> String {
    let mut regex = String::from("(?i)"); // case-insensitive
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '*' => {
                if i + 1 < chars.len() && chars[i + 1] == '*' {
                    // ** matches any path segments
                    if i + 2 < chars.len() && chars[i + 2] == '/' {
                        regex.push_str("(.*/)?");
                        i += 3;
                    } else {
                        regex.push_str(".*");
                        i += 2;
                    }
                } else {
                    // * matches anything except /
                    regex.push_str("[^/]*");
                    i += 1;
                }
            }
            '?' => {
                regex.push_str("[^/]");
                i += 1;
            }
            '.' | '(' | ')' | '+' | '|' | '^' | '$' | '{' | '}' | '[' | ']' => {
                regex.push('\\');
                regex.push(chars[i]);
                i += 1;
            }
            _ => {
                regex.push(chars[i]);
                i += 1;
            }
        }
    }

    format!("^{}$", regex)
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_directory(path: String, native_grant_ids: Option<Vec<String>>) -> Result<(), String> {
    let dir_path = resolve_workspace_write_path_with_grants(&path, native_grant_ids.as_deref())?;
    if dir_path.exists() {
        return Err(format!("Directory already exists: {}", path));
    }
    if let Some(name) = dir_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }
    fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

/// Like list_dir but includes hidden entries (files/dirs starting with '.')
/// Used by the skills loader to scan ~/.agents/skills/ etc.
#[tauri::command(rename_all = "camelCase")]
pub fn list_dir_all(
    path: String,
    native_grant_ids: Option<Vec<String>>,
) -> Result<Vec<FileEntry>, String> {
    let path =
        resolve_workspace_path_with_grants(&path, PathAccess::Read, native_grant_ids.as_deref())?;
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

// ── File System Watcher ──────────────────────────────────────────────────────

pub struct FsWatcherState(pub Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
pub struct FsChangeEvent {
    pub kind: String, // "create" | "modify" | "remove" | "rename"
    pub paths: Vec<String>,
}

fn event_kind_to_string(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(_) => Some("modify"),
        EventKind::Remove(_) => Some("remove"),
        _ => None,
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn fs_watch(
    path: String,
    app: AppHandle,
    state: tauri::State<'_, FsWatcherState>,
) -> Result<(), String> {
    // A watcher survives the invoking tool call, so external one-shot grants
    // must not be used to create a background observer.
    let canonical = resolve_workspace_path(&path)?;
    // Use the canonical path as the watcher key so `..`/symlink aliases for
    // the same directory cannot register duplicate watchers.
    let path = canonical.to_string_lossy().to_string();
    let mut watchers = state.0.lock().map_err(|e| e.to_string())?;

    // If already watching this path, do nothing
    if watchers.contains_key(&path) {
        return Ok(());
    }

    let watch_path = PathBuf::from(&path);

    let app_handle = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if let Some(kind_str) = event_kind_to_string(&event.kind) {
                    let paths: Vec<String> = event
                        .paths
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    let _ = app_handle.emit(
                        "fs:changed",
                        FsChangeEvent {
                            kind: kind_str.to_string(),
                            paths,
                        },
                    );
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    watchers.insert(path, watcher);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn fs_unwatch(path: String, state: tauri::State<'_, FsWatcherState>) -> Result<(), String> {
    // Keys are canonical paths (see fs_watch); canonicalize best-effort so a
    // non-canonical alias still releases the watcher. If the path is gone,
    // fall back to the raw key.
    let key = resolve_workspace_path(&path)
        .map(|canonical| canonical.to_string_lossy().to_string())
        .unwrap_or(path);
    let mut watchers = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut watcher) = watchers.remove(&key) {
        let watch_path = PathBuf::from(&key);
        let _ = watcher.unwatch(&watch_path);
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn copy_path(
    from: String,
    to: String,
    native_grant_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let from_path =
        resolve_workspace_path_with_grants(&from, PathAccess::Write, native_grant_ids.as_deref())?;
    let to_path = resolve_workspace_write_path_with_grants(&to, native_grant_ids.as_deref())?;
    if !from_path.exists() && fs::symlink_metadata(&from_path).is_err() {
        return Err(format!("Source not found: {}", from));
    }
    if to_path.exists() || fs::symlink_metadata(&to_path).is_ok() {
        return Err(format!("Destination already exists: {}", to));
    }
    if let Some(name) = to_path.file_name().and_then(|n| n.to_str()) {
        validate_file_name(name)?;
    }
    copy_path_inner(&from_path, &to_path)
}

fn copy_path_inner(from_path: &PathBuf, to_path: &PathBuf) -> Result<(), String> {
    let meta = fs::symlink_metadata(from_path)
        .map_err(|e| format!("Failed to read metadata of {}: {}", from_path.display(), e))?;
    if meta.file_type().is_symlink() {
        return copy_symlink(from_path, to_path);
    }
    if meta.is_dir() {
        if is_within_dir(to_path, from_path) {
            return Err("Cannot copy a folder into itself".to_string());
        }
        copy_dir_recursive(from_path, to_path)
    } else {
        if let Some(parent) = to_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        fs::copy(from_path, to_path)
            .map(|_| ())
            .map_err(|e| format!("Failed to copy file: {}", e))?;
        copy_permissions(from_path, to_path);
        Ok(())
    }
}

/// Replicate a symlink instead of following it (prevents infinite loops on
/// cyclic links and preserves link semantics on every platform).
fn copy_symlink(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    let target =
        fs::read_link(src).map_err(|e| format!("Failed to read link {}: {}", src.display(), e))?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        // Decide the symlink kind from the link target when possible.
        let is_dir = src.is_dir();
        if is_dir {
            std::os::windows::fs::symlink_dir(&target, dst)
        } else {
            std::os::windows::fs::symlink_file(&target, dst)
        }
        .map_err(|e| format!("Failed to copy symlink: {}", e))
    }
    #[cfg(target_os = "macos")]
    {
        std::os::unix::fs::symlink(&target, dst)
            .map_err(|e| format!("Failed to copy symlink: {}", e))
    }
    #[cfg(target_os = "linux")]
    {
        std::os::unix::fs::symlink(&target, dst)
            .map_err(|e| format!("Failed to copy symlink: {}", e))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Copying symlinks is not supported on this platform".to_string())
    }
}

/// Best-effort permission preservation (Unix mode bits; no-op elsewhere).
fn copy_permissions(src: &Path, dst: &Path) {
    if let (Ok(src_meta), Ok(dst_meta)) = (fs::metadata(src), fs::metadata(dst)) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = src_meta.permissions().mode();
            let _ = fs::set_permissions(dst, fs::Permissions::from_mode(mode));
        }
        #[cfg(not(unix))]
        {
            let _ = (src_meta, dst_meta);
        }
    }
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    // Fail instead of silently merging when the destination already exists;
    // callers auto-rename to a unique name before invoking.
    if dst.exists() || fs::symlink_metadata(dst).is_ok() {
        return Err(format!("Destination already exists: {}", dst.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir: {}", e))?;
    let entries = fs::read_dir(src).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read entry type: {}", e))?;
        if file_type.is_symlink() {
            copy_symlink(&src_path, &dst_path)?;
        } else if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy: {}", e))?;
            copy_permissions(&src_path, &dst_path);
        }
    }
    copy_permissions(src, dst);
    Ok(())
}

/// Convert a path to the native Windows separator form. Projects are
/// normalized with `/` on the frontend, but `explorer.exe` treats `/` in its
/// arguments as a switch sigil (`/select`, `/root`, ...), so a path such as
/// `D:/project/src` makes Explorer drop the target and open its default folder.
#[cfg(any(target_os = "windows", test))]
fn windows_native_path(path: &str) -> String {
    path.replace('/', "\\")
}

/// Resolve what to open on Linux, where `xdg-open` cannot select a file:
/// directories open directly, files open via their parent directory.
#[cfg(any(target_os = "linux", test))]
fn linux_reveal_target(path: &Path, is_dir: bool) -> PathBuf {
    if is_dir {
        path.to_path_buf()
    } else {
        path.parent().unwrap_or(path).to_path_buf()
    }
}

/// Reveal a path in Explorer through the shell PIDL API instead of a command
/// line. Explorer does not parse argv like a standard program (its `/select,`
/// syntax is comma-delimited and quoting-sensitive), so handing it a path with
/// spaces or forward slashes silently opens the default folder.
/// `SHOpenFolderAndSelectItems` performs no command-line parsing at all.
#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{S_FALSE, S_OK};
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows_sys::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};

    let native = windows_native_path(&path.to_string_lossy());
    let wide: Vec<u16> = std::ffi::OsStr::new(&native)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let init = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        // `RPC_E_CHANGED_MODE` means COM is already initialized in another
        // apartment: the shell call still works and must not be balanced by
        // `CoUninitialize`.
        let should_uninitialize = init == S_OK || init == S_FALSE;

        let pidl = ILCreateFromPathW(wide.as_ptr());
        if pidl.is_null() {
            if should_uninitialize {
                CoUninitialize();
            }
            return Err(format!("Failed to reveal: {}", path.display()));
        }

        let result = SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0);
        ILFree(pidl);
        if should_uninitialize {
            CoUninitialize();
        }

        if result < 0 {
            return Err(format!(
                "Failed to reveal {}: shell error 0x{:08X}",
                path.display(),
                result as u32
            ));
        }
    }

    Ok(())
}

/// Open the OS file manager and highlight/select the given path.
/// Async so the (blocking) shell reveal call never runs on the UI thread.
#[tauri::command(rename_all = "camelCase")]
pub async fn reveal_path(
    path: String,
    native_grant_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let p =
        resolve_workspace_path_with_grants(&path, PathAccess::Read, native_grant_ids.as_deref())?;

    #[cfg(target_os = "windows")]
    {
        reveal_in_file_manager(&p)?;
    }

    #[cfg(target_os = "macos")]
    {
        cmd("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // `xdg-open` has no select/highlight mode, so open the containing
        // directory for files (directly for directories).
        let target = linux_reveal_target(&p, p.is_dir());
        cmd("xdg-open")
            .arg(target.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    Ok(())
}

/// Open a file or folder with the OS default application
/// ("Open With > Default Application" in the explorer).
#[tauri::command(rename_all = "camelCase")]
pub fn open_path(path: String, native_grant_ids: Option<Vec<String>>) -> Result<(), String> {
    let resolved = resolve_workspace_path_with_grants(
        &path,
        PathAccess::Execute,
        native_grant_ids.as_deref(),
    )?;
    let p = resolved;
    // `resolve_workspace_path` guarantees existence, but keep a symlink-aware
    // check so dangling links still produce a clear error.
    if fs::symlink_metadata(&p).is_err() {
        return Err(format!("Path not found: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        // `start` takes the window title as its first quoted argument.
        cmd("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        cmd("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        cmd("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authorize_test_workspace(root: &Path) {
        fs::create_dir_all(root).expect("test workspace should be created");
        register_workspace_root(root, false).expect("test workspace should be authorized");
    }

    #[test]
    fn file_entry_and_stat_serialize_with_snake_case_keys() {
        // Regression: the frontend `tauriFs` contract expects `is_dir` /
        // `is_file` (snake_case). A `#[serde(rename_all = "camelCase")]` on
        // these structs silently flattens the explorer (every node becomes
        // a file: no chevrons, no folders-first sort, no nesting).
        let entry = FileEntry {
            name: "apps".to_string(),
            path: "/root/apps".to_string(),
            is_dir: true,
            size: 0,
        };
        let entry_value = serde_json::to_value(&entry).expect("entry serializes");
        assert_eq!(
            entry_value.get("is_dir").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(entry_value.get("isDir").is_none());

        let stat = FileStat {
            path: "/root/apps".to_string(),
            is_dir: true,
            is_file: false,
            size: 0,
            modified: None,
        };
        let stat_value = serde_json::to_value(&stat).expect("stat serializes");
        assert_eq!(
            stat_value.get("is_dir").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            stat_value.get("is_file").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert!(stat_value.get("isDir").is_none());
        assert!(stat_value.get("isFile").is_none());
    }

    #[test]
    fn workspace_resolver_rejects_roots_and_missing_paths() {
        assert!(resolve_workspace_path("").is_err());
        assert!(resolve_workspace_path("/nonexistent-hyscode-path-xyz").is_err());
        assert!(resolve_workspace_write_path("").is_err());
        #[cfg(target_os = "windows")]
        {
            assert!(resolve_workspace_path("C:\\").is_err());
            if let Some(home) = dirs::home_dir() {
                assert!(resolve_workspace_path(home.to_str().unwrap()).is_err());
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert!(resolve_workspace_path("/").is_err());
        }
        // A caller-supplied existing directory is not authority. Only a root
        // registered by the native workspace picker may be used.
        let root = std::env::temp_dir().join(format!(
            "hyscode-fs-test-{}-authorized-root",
            std::process::id()
        ));
        authorize_test_workspace(&root);
        assert!(resolve_workspace_path(&root.to_string_lossy()).is_ok());
        assert!(resolve_workspace_path(&std::env::temp_dir().to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_write_path_never_resolves_to_root() {
        #[cfg(target_os = "windows")]
        assert!(resolve_workspace_write_path("C:\\new-file.txt").is_err());
        #[cfg(not(target_os = "windows"))]
        assert!(resolve_workspace_write_path("/new-file.txt").is_err());
        // Nested temp file resolves below the user-selected root (compare canonical forms:
        // Windows canonicalize yields verbatim `\\?\` paths).
        let root =
            std::env::temp_dir().join(format!("hyscode-fs-test-{}-write-root", std::process::id()));
        authorize_test_workspace(&root);
        let canonical_root = root.canonicalize().expect("workspace should canonicalize");
        let target = root.join("nested").join("file.txt");
        let resolved = resolve_workspace_write_path(&target.to_string_lossy()).unwrap();
        assert!(resolved.starts_with(&canonical_root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn path_exists_reports_existing_and_missing_authorized_paths() {
        let root = std::env::temp_dir().join(format!(
            "hyscode-fs-test-{}-path-exists",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        authorize_test_workspace(&root);
        let existing = root.join("existing.txt");
        let missing = root.join("missing.txt");
        fs::write(&existing, b"contents").expect("fixture file should be written");

        assert_eq!(
            path_exists(existing.to_string_lossy().into_owned(), None),
            Ok(true)
        );
        assert_eq!(
            path_exists(missing.to_string_lossy().into_owned(), None),
            Ok(false)
        );
        assert!(path_exists(
            std::env::temp_dir()
                .join("unselected-hyscode-path")
                .to_string_lossy()
                .into_owned(),
            None,
        )
        .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_empty_and_blank_names() {
        assert!(validate_file_name("").is_err());
        assert!(validate_file_name("   ").is_err());
        assert!(validate_file_name("ok.txt").is_ok());
    }

    #[test]
    fn rejects_separators_and_null_bytes() {
        assert!(validate_file_name("a/b").is_err());
        assert!(validate_file_name("a\\b").is_err());
        assert!(validate_file_name("a\0b").is_err());
        assert!(validate_file_name("plain-name_1.2").is_ok());
    }

    #[test]
    fn rejects_overlong_names() {
        let long = "a".repeat(256);
        assert!(validate_file_name(&long).is_err());
        assert!(validate_file_name(&"a".repeat(255)).is_ok());
    }

    #[test]
    fn detects_move_into_self() {
        assert!(is_within_dir(
            &PathBuf::from("/a/b/c"),
            &PathBuf::from("/a/b")
        ));
        assert!(is_within_dir(
            &PathBuf::from("/a/b"),
            &PathBuf::from("/a/b")
        ));
        assert!(!is_within_dir(
            &PathBuf::from("/a/b2"),
            &PathBuf::from("/a/b")
        ));
        assert!(!is_within_dir(
            &PathBuf::from("/a/b"),
            &PathBuf::from("/a/b/c")
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detects_move_into_self_case_insensitive_on_windows() {
        assert!(is_within_dir(
            &PathBuf::from("C:\\A\\b"),
            &PathBuf::from("c:/a")
        ));
        assert!(!is_within_dir(
            &PathBuf::from("C:\\AB"),
            &PathBuf::from("C:\\A")
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_windows_reserved_and_illegal_names() {
        for reserved in ["CON", "con.txt", "NUL", "COM1", "lpt9.dat"] {
            assert!(validate_file_name(reserved).is_err(), "{}", reserved);
        }
        for illegal in [
            "a<b", "a>b", "a:b", "a\"b", "a|b", "a?b", "a*b", "trail. ", "trail.",
        ] {
            assert!(validate_file_name(illegal).is_err(), "{}", illegal);
        }
        assert!(validate_file_name("normal file (1).txt").is_ok());
    }

    #[test]
    fn windows_native_path_uses_backslashes() {
        // Regression: project paths are normalized to `/` on the frontend and
        // `explorer.exe` interprets `/` as a switch sigil, so reveal silently
        // opened the default folder instead of the target.
        assert_eq!(
            windows_native_path("D:/Hyscode/scripts"),
            "D:\\Hyscode\\scripts"
        );
        assert_eq!(
            windows_native_path("D:\\Hyscode\\scripts"),
            "D:\\Hyscode\\scripts"
        );
        assert_eq!(
            windows_native_path("C:/a dir/über.txt"),
            "C:\\a dir\\über.txt"
        );
    }

    #[test]
    fn linux_reveal_target_opens_parent_for_files() {
        assert_eq!(
            linux_reveal_target(Path::new("/home/u/file.txt"), false),
            PathBuf::from("/home/u")
        );
        assert_eq!(
            linux_reveal_target(Path::new("/home/u/docs"), true),
            PathBuf::from("/home/u/docs")
        );
    }

    #[test]
    fn open_and_trash_reject_missing_paths_without_side_effects() {
        assert!(open_path("/nonexistent-hyscode-path-xyz".to_string(), None).is_err());
        assert!(tauri::async_runtime::block_on(trash_path(
            "/nonexistent-hyscode-path-xyz".to_string(),
            None,
        ))
        .is_err());
    }

    #[test]
    fn delete_path_removes_nested_directory_on_blocking_pool() {
        let base =
            std::env::temp_dir().join(format!("hyscode-fs-test-{}-delete", std::process::id()));
        let target = base.join("large-tree");
        let nested = target.join("nested");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&nested).unwrap();
        authorize_test_workspace(&base);
        for index in 0..128 {
            fs::write(nested.join(format!("file-{index}.txt")), b"data").unwrap();
        }

        let result =
            tauri::async_runtime::block_on(delete_path(target.to_string_lossy().to_string(), None));

        assert!(result.is_ok());
        assert!(!target.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn deleting_a_symlink_removes_the_link_without_deleting_its_target() {
        let base = std::env::temp_dir().join(format!(
            "hyscode-fs-test-{}-symlink-delete",
            std::process::id()
        ));
        let link_dir = base.join("workspace");
        let target_dir = base.join("external");
        let target = target_dir.join("keep.txt");
        let link = link_dir.join("linked.txt");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&link_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();
        authorize_test_workspace(&link_dir);
        fs::write(&target, b"must remain").unwrap();

        #[cfg(unix)]
        let link_result = std::os::unix::fs::symlink(&target, &link);
        #[cfg(windows)]
        let link_result = std::os::windows::fs::symlink_file(&target, &link);
        if let Err(error) = link_result {
            #[cfg(windows)]
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                let _ = fs::remove_dir_all(&base);
                eprintln!(
                    "skipping symlink deletion assertion: Windows symlink privilege unavailable"
                );
                return;
            }
            panic!("test symlink should be created: {error}");
        }

        let result =
            tauri::async_runtime::block_on(delete_path(link.to_string_lossy().to_string(), None));

        assert!(result.is_ok(), "symlink deletion failed: {result:?}");
        assert!(
            fs::symlink_metadata(&link).is_err(),
            "the symlink should be removed"
        );
        assert_eq!(fs::read(&target).unwrap(), b"must remain");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn move_and_copy_refuse_existing_destination() {
        let base =
            std::env::temp_dir().join(format!("hyscode-fs-test-{}-move", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("src")).unwrap();
        authorize_test_workspace(&base);
        fs::write(base.join("src").join("a.txt"), b"hi").unwrap();
        fs::write(base.join("dest.txt"), b"taken").unwrap();

        assert!(move_path(
            base.join("src").join("a.txt").to_string_lossy().to_string(),
            base.join("dest.txt").to_string_lossy().to_string(),
            None,
        )
        .is_err());
        assert!(copy_path(
            base.join("src").join("a.txt").to_string_lossy().to_string(),
            base.join("dest.txt").to_string_lossy().to_string(),
            None,
        )
        .is_err());

        // Move into itself is refused.
        assert!(move_path(
            base.join("src").to_string_lossy().to_string(),
            base.join("src").join("inner").to_string_lossy().to_string(),
            None,
        )
        .is_err());

        // A real move works and the source is gone afterwards.
        assert!(move_path(
            base.join("src").join("a.txt").to_string_lossy().to_string(),
            base.join("src").join("b.txt").to_string_lossy().to_string(),
            None,
        )
        .is_ok());
        assert!(!base.join("src").join("a.txt").exists());
        assert!(base.join("src").join("b.txt").exists());

        // join_path produces a usable child path.
        let joined = join_path(
            base.join("src").to_string_lossy().to_string(),
            "c.txt".to_string(),
        )
        .unwrap();
        assert_eq!(
            joined,
            base.join("src").join("c.txt").to_string_lossy().to_string()
        );

        let _ = fs::remove_dir_all(&base);
    }
    #[test]
    fn read_file_chunk_returns_head_and_tail() {
        let base =
            std::env::temp_dir().join(format!("hyscode-fs-test-{}-chunk", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        authorize_test_workspace(&base);
        let file = base.join("big.txt");
        let expected = "line\n".repeat(100_000);
        fs::write(&file, expected.as_bytes()).unwrap();
        let path = file.to_string_lossy().to_string();

        let head = read_file_chunk(path.clone(), 0, READ_CHUNK_LEN, None).unwrap();
        assert!(!head.is_binary);
        assert_eq!(head.total_size, expected.len() as u64);
        assert!(!head.finished);
        assert_eq!(head.data.len(), READ_CHUNK_LEN as usize);

        let tail = read_file_chunk(path.clone(), READ_CHUNK_LEN, READ_CHUNK_LEN, None).unwrap();
        assert!(!tail.is_binary);
        assert!(tail.finished);

        let mut reassembled = head.data;
        reassembled.push_str(&tail.data);
        assert_eq!(reassembled, expected);
        assert_eq!(read_file(path, None).unwrap(), expected);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn read_file_chunk_flags_null_bytes_binary() {
        let base =
            std::env::temp_dir().join(format!("hyscode-fs-test-{}-binary", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        authorize_test_workspace(&base);
        let file = base.join("blob.bin");
        fs::write(&file, [0x00, 0xFF, b'a']).unwrap();

        let chunk =
            read_file_chunk(file.to_string_lossy().to_string(), 0, READ_CHUNK_LEN, None).unwrap();
        assert!(chunk.is_binary);
        assert!(chunk.data.is_empty());
        assert!(chunk.finished);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn read_file_chunk_offset_past_end_returns_finished_empty() {
        let base =
            std::env::temp_dir().join(format!("hyscode-fs-test-{}-past-end", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        authorize_test_workspace(&base);
        let file = base.join("small.txt");
        fs::write(&file, b"hi").unwrap();
        let path = file.to_string_lossy().to_string();

        let chunk = read_file_chunk(path, 1024, READ_CHUNK_LEN, None).unwrap();
        assert!(chunk.data.is_empty());
        assert!(!chunk.is_binary);
        assert!(chunk.finished);

        assert!(
            read_file_chunk("/nonexistent-hyscode-path-xyz".to_string(), 0, 128, None).is_err()
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn native_path_authority_rejects_unselected_external_paths_and_symlink_escapes() {
        let base = std::env::temp_dir().join(format!(
            "hyscode-fs-test-{}-authority-boundary",
            std::process::id()
        ));
        let workspace = base.join("workspace");
        let external = base.join("external");
        let workspace_link = workspace.join("outside.txt");
        let external_file = external.join("selected.txt");
        let external_sibling = external.join("sibling.txt");
        let unselected_file = external.join("unselected.txt");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::write(&external_file, b"selected").unwrap();
        fs::write(&external_sibling, b"not selected").unwrap();
        fs::write(&unselected_file, b"not selected either").unwrap();
        authorize_test_workspace(&workspace);

        assert!(read_file(external_file.to_string_lossy().to_string(), None).is_err());
        register_external_file(&external_file).unwrap();
        assert_eq!(
            read_file(external_file.to_string_lossy().to_string(), None).unwrap(),
            "selected"
        );
        assert!(read_file(external_sibling.to_string_lossy().to_string(), None).is_err());

        #[cfg(unix)]
        let link_result = std::os::unix::fs::symlink(&unselected_file, &workspace_link);
        #[cfg(windows)]
        let link_result = std::os::windows::fs::symlink_file(&unselected_file, &workspace_link);
        if let Err(error) = link_result {
            #[cfg(windows)]
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                let _ = fs::remove_dir_all(&base);
                eprintln!(
                    "skipping symlink escape assertion: Windows symlink privilege unavailable"
                );
                return;
            }
            panic!("test symlink should be created: {error}");
        }
        assert!(read_file(workspace_link.to_string_lossy().to_string(), None).is_err());
        assert!(write_file(
            external_sibling.to_string_lossy().to_string(),
            "denied".into(),
            None,
        )
        .is_err());
        assert_eq!(fs::read(&external_sibling).unwrap(), b"not selected");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn external_save_grant_is_exact_to_the_selected_target() {
        let base = std::env::temp_dir().join(format!(
            "hyscode-fs-test-{}-external-save-grant",
            std::process::id()
        ));
        let workspace = base.join("workspace");
        let external = base.join("external");
        let selected = external.join("save.txt");
        let sibling = external.join("other.txt");
        let _ = fs::remove_dir_all(&base);
        authorize_test_workspace(&workspace);
        fs::create_dir_all(&external).unwrap();

        register_external_save_file(&selected).unwrap();
        write_file(
            selected.to_string_lossy().to_string(),
            "approved".into(),
            None,
        )
        .unwrap();
        assert!(write_file(sibling.to_string_lossy().to_string(), "denied".into(), None,).is_err());
        assert_eq!(fs::read(&selected).unwrap(), b"approved");
        assert!(!sibling.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn native_external_tokens_enforce_operation_scope_and_directory_boundaries() {
        let base = std::env::temp_dir().join(format!(
            "hyscode-fs-test-{}-native-grant-scope",
            std::process::id()
        ));
        let workspace = base.join("workspace");
        let external = base.join("external");
        let outside_sibling = base.join("external-sibling");
        let file = external.join("file.txt");
        let sibling_file = external.join("sibling.txt");
        let _ = fs::remove_dir_all(&base);
        authorize_test_workspace(&workspace);
        fs::create_dir_all(&external).unwrap();
        fs::create_dir_all(&outside_sibling).unwrap();
        fs::write(&file, b"file").unwrap();
        fs::write(&sibling_file, b"sibling").unwrap();
        let canonical_workspace = fs::canonicalize(&workspace).unwrap();
        let canonical_file = fs::canonicalize(&file).unwrap();
        let canonical_external = fs::canonicalize(&external).unwrap();
        let canonical_outside_sibling = fs::canonicalize(&outside_sibling).unwrap();

        let write_grant = add_external_access_grant(
            NativeGrantOperation::Write,
            HashSet::from([canonical_file.clone()]),
            HashSet::new(),
            false,
        )
        .unwrap();
        assert!(require_authorized_path_with_grants(
            &canonical_file,
            PathAccess::Read,
            Some(std::slice::from_ref(&write_grant)),
        )
        .is_ok());
        assert!(require_authorized_path_with_grants(
            &canonical_file,
            PathAccess::Write,
            Some(std::slice::from_ref(&write_grant)),
        )
        .is_ok());
        assert!(require_authorized_path_with_grants(
            &sibling_file,
            PathAccess::Write,
            Some(std::slice::from_ref(&write_grant)),
        )
        .is_err());
        assert!(
            require_authorized_path_with_grants(&canonical_file, PathAccess::Write, None,).is_err()
        );

        let directory_grant = add_external_access_grant(
            NativeGrantOperation::Read,
            HashSet::new(),
            HashSet::from([canonical_external.clone()]),
            true,
        )
        .unwrap();
        assert!(require_authorized_path_with_grants(
            &canonical_file,
            PathAccess::Read,
            Some(std::slice::from_ref(&directory_grant)),
        )
        .is_ok());
        assert!(require_authorized_path_with_grants(
            &canonical_outside_sibling,
            PathAccess::Read,
            Some(std::slice::from_ref(&directory_grant)),
        )
        .is_err());
        assert!(require_authorized_path_with_grants(
            &canonical_file,
            PathAccess::Write,
            Some(std::slice::from_ref(&directory_grant)),
        )
        .is_err());

        let execute_grant = add_external_access_grant(
            NativeGrantOperation::Execute,
            HashSet::new(),
            HashSet::from([canonical_external.clone()]),
            false,
        )
        .unwrap();
        assert!(resolve_authorized_execution_directory(
            &canonical_external.to_string_lossy(),
            Some(std::slice::from_ref(&execute_grant)),
        )
        .is_ok());
        assert!(resolve_authorized_execution_directory(
            &canonical_external.to_string_lossy(),
            Some(std::slice::from_ref(&write_grant)),
        )
        .is_err());

        assert!(
            require_native_diagnostics_grant(&canonical_workspace.to_string_lossy(), None,)
                .is_err()
        );
        assert!(require_native_diagnostics_grant(
            &canonical_workspace.to_string_lossy(),
            Some(std::slice::from_ref(&execute_grant)),
        )
        .is_err());
        let diagnostics_grant = add_external_access_grant(
            NativeGrantOperation::Diagnostics,
            HashSet::new(),
            HashSet::from([canonical_workspace.clone()]),
            false,
        )
        .unwrap();
        assert_eq!(
            require_native_diagnostics_grant(
                &canonical_workspace.to_string_lossy(),
                Some(std::slice::from_ref(&diagnostics_grant)),
            )
            .unwrap(),
            canonical_workspace
        );

        workspace_revoke_external_grants(vec![write_grant.clone()]).unwrap();
        assert!(require_authorized_path_with_grants(
            &canonical_file,
            PathAccess::Write,
            Some(std::slice::from_ref(&write_grant)),
        )
        .is_err());
        workspace_revoke_external_grants(vec![directory_grant, execute_grant, diagnostics_grant])
            .unwrap();
        let _ = fs::remove_dir_all(&base);
    }
}
