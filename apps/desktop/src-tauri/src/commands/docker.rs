use super::utils::cmd;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

// ─── Managed state for docker watch ─────────────────────────────────────────

pub struct DockerWatchState(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

// ─── Serializable types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
}

#[derive(Clone, Serialize)]
struct DockerContainersUpdatedPayload {
    containers: Vec<ContainerInfo>,
    timestamp: u64,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Run a docker CLI command and return stdout on success, Err on failure.
fn run_docker(args: &[&str]) -> Result<String, String> {
    let output = cmd("docker").args(args).output().map_err(|e| {
        format!(
            "Failed to run docker: {}. Is Docker installed and on PATH?",
            e
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "docker {} failed: {}",
            args.join(" "),
            stderr.trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Parse `docker ps --format '{{json .}}'` output into ContainerInfo vec.
fn parse_containers(raw: &str) -> Vec<ContainerInfo> {
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(ContainerInfo {
                id: v["ID"].as_str().unwrap_or("").to_string(),
                name: v["Names"].as_str().unwrap_or("").to_string(),
                image: v["Image"].as_str().unwrap_or("").to_string(),
                status: v["Status"].as_str().unwrap_or("").to_string(),
                state: v["State"].as_str().unwrap_or("").to_string(),
                ports: v["Ports"].as_str().unwrap_or("").to_string(),
                created: v["CreatedAt"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect()
}

/// Parse `docker images --format '{{json .}}'` output into ImageInfo vec.
fn parse_images(raw: &str) -> Vec<ImageInfo> {
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(ImageInfo {
                id: v["ID"].as_str().unwrap_or("").to_string(),
                repository: v["Repository"].as_str().unwrap_or("").to_string(),
                tag: v["Tag"].as_str().unwrap_or("").to_string(),
                size: v["Size"].as_str().unwrap_or("").to_string(),
                created: v["CreatedSince"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect()
}

/// Validate that a container/image ID is safe (alphanumeric, colons, dots, slashes, hyphens, underscores).
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("ID cannot be empty".to_string());
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == ':' || c == '.' || c == '/' || c == '-' || c == '_')
    {
        return Err(format!("Invalid ID: {}", id));
    }
    Ok(())
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Check if Docker CLI is available on the system.
#[tauri::command]
pub fn docker_is_available() -> bool {
    cmd("docker")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// List containers. If `all` is true, includes stopped containers.
#[tauri::command]
pub fn docker_list_containers(all: Option<bool>) -> Result<Vec<ContainerInfo>, String> {
    let mut args = vec!["ps", "--format", "{{json .}}", "--no-trunc"];
    if all.unwrap_or(false) {
        args.push("-a");
    }
    let raw = run_docker(&args)?;
    Ok(parse_containers(&raw))
}

/// List all local images.
#[tauri::command]
pub fn docker_list_images() -> Result<Vec<ImageInfo>, String> {
    let raw = run_docker(&["images", "--format", "{{json .}}"])?;
    Ok(parse_images(&raw))
}

/// Start a stopped container.
#[tauri::command]
pub fn docker_start_container(id: String) -> Result<(), String> {
    validate_id(&id)?;
    run_docker(&["start", &id])?;
    Ok(())
}

/// Stop a running container.
#[tauri::command]
pub fn docker_stop_container(id: String) -> Result<(), String> {
    validate_id(&id)?;
    run_docker(&["stop", &id])?;
    Ok(())
}

/// Restart a container.
#[tauri::command]
pub fn docker_restart_container(id: String) -> Result<(), String> {
    validate_id(&id)?;
    run_docker(&["restart", &id])?;
    Ok(())
}

/// Remove a container. If `force` is true, force-removes even if running.
#[tauri::command]
pub fn docker_remove_container(id: String, force: Option<bool>) -> Result<(), String> {
    validate_id(&id)?;
    let mut args = vec!["rm"];
    if force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(&id);
    run_docker(&args)?;
    Ok(())
}

/// Remove an image. If `force` is true, force-removes.
#[tauri::command]
pub fn docker_remove_image(id: String, force: Option<bool>) -> Result<(), String> {
    validate_id(&id)?;
    let mut args = vec!["rmi"];
    if force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(&id);
    run_docker(&args)?;
    Ok(())
}

/// Fetch container logs. `tail` limits the number of lines (default: 200).
#[tauri::command]
pub fn docker_container_logs(id: String, tail: Option<u32>) -> Result<String, String> {
    validate_id(&id)?;
    let tail_str = tail.unwrap_or(200).to_string();
    run_docker(&["logs", "--tail", &tail_str, &id])
}

/// Pull an image from a registry.
#[tauri::command]
pub fn docker_pull_image(image: String) -> Result<String, String> {
    validate_id(&image)?;
    run_docker(&["pull", &image])
}

/// Inspect a container (returns raw JSON).
#[tauri::command]
pub fn docker_inspect_container(id: String) -> Result<String, String> {
    validate_id(&id)?;
    run_docker(&["inspect", &id])
}

/// Run `docker compose up` in a directory.
#[tauri::command]
pub fn docker_compose_up(compose_path: String, detach: Option<bool>) -> Result<String, String> {
    let mut args = vec!["compose", "-f", &compose_path, "up"];
    if detach.unwrap_or(true) {
        args.push("-d");
    }
    run_docker(&args)
}

/// Run `docker compose down` in a directory.
#[tauri::command]
pub fn docker_compose_down(compose_path: String) -> Result<String, String> {
    run_docker(&["compose", "-f", &compose_path, "down"])
}

// ─── Auto-refresh watch ─────────────────────────────────────────────────────

/// Start a background watcher that polls container list and emits events on change.
/// Returns a watch_id UUID to stop the watcher later.
#[tauri::command]
pub async fn docker_watch_start(
    interval_ms: u64,
    app: AppHandle,
    state: State<'_, DockerWatchState>,
) -> Result<String, String> {
    let watch_id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));

    state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .insert(watch_id.clone(), cancel.clone());

    let id = watch_id.clone();
    let interval = std::time::Duration::from_millis(interval_ms.max(1000)); // minimum 1s

    std::thread::spawn(move || {
        let mut prev_containers: Vec<ContainerInfo> = Vec::new();

        loop {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            // Poll containers
            if let Ok(raw) = run_docker(&["ps", "-a", "--format", "{{json .}}", "--no-trunc"]) {
                let containers = parse_containers(&raw);

                // Only emit if changed (compare by id + state + status)
                if containers != prev_containers {
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    let _ = app.emit(
                        "docker:containers-updated",
                        DockerContainersUpdatedPayload {
                            containers: containers.clone(),
                            timestamp,
                        },
                    );
                    prev_containers = containers;
                }
            }

            // Sleep in small increments so we can respond to cancel quickly
            let steps = (interval.as_millis() / 250).max(1) as u64;
            for _ in 0..steps {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        }

        // Cleanup: remove self from state (best-effort, state may be dropped)
        drop(id);
    });

    Ok(watch_id)
}

/// Stop a running container watcher.
#[tauri::command]
pub async fn docker_watch_stop(
    watch_id: String,
    state: State<'_, DockerWatchState>,
) -> Result<(), String> {
    let mut watchers = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(cancel) = watchers.remove(&watch_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}
