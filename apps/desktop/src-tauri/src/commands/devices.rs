use super::utils::cmd;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A connected physical device or running emulator.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    /// "android" | "ios" | "web" | "linux" | "macos" | "windows"
    pub platform: String,
    pub emulator: bool,
    pub available: bool,
    /// "mobile" | "web" | "desktop"
    pub category: String,
    /// "flutter" | "adb"
    pub source: String,
}

/// An available emulator / AVD that can be launched.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorInfo {
    pub id: String,
    pub name: String,
    pub platform: String,
    /// "flutter" | "avd"
    pub source: String,
}

/// Result returned by `check_sdk_paths`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkPaths {
    /// Resolved Flutter binary path, or null if not found.
    pub flutter_bin: Option<String>,
    /// How Flutter was found: "setting" | "FLUTTER_ROOT" | "PATH"
    pub flutter_source: Option<String>,
    /// Flutter version string, e.g. "3.22.0"
    pub flutter_version: Option<String>,
    /// Resolved ADB binary path, or null if not found.
    pub adb_bin: Option<String>,
    /// How ADB was found: "setting" | "ANDROID_SDK_ROOT" | "ANDROID_HOME" | "PATH"
    pub adb_source: Option<String>,
    /// ADB version string, e.g. "1.0.41"
    pub adb_version: Option<String>,
    /// Resolved Android SDK root directory, or null if not found.
    pub android_sdk_root: Option<String>,
}

struct ResolvedBin {
    path: String,
    source: String,
}

// ── Binary resolution ─────────────────────────────────────────────────────────

/// Resolve the Flutter binary. Priority:
/// 1. `flutter_sdk_path` setting  2. FLUTTER_ROOT env var  3. PATH
fn resolve_flutter(flutter_sdk_path: Option<&str>) -> ResolvedBin {
    if let Some(sdk) = flutter_sdk_path {
        let trimmed = sdk.trim();
        if !trimmed.is_empty() {
            return ResolvedBin {
                path: flutter_bin_from_root(trimmed),
                source: "setting".to_string(),
            };
        }
    }
    if let Ok(root) = std::env::var("FLUTTER_ROOT") {
        let root = root.trim().to_string();
        if !root.is_empty() {
            return ResolvedBin {
                path: flutter_bin_from_root(&root),
                source: "FLUTTER_ROOT".to_string(),
            };
        }
    }
    ResolvedBin {
        path: flutter_default_bin().to_string(),
        source: "PATH".to_string(),
    }
}

/// Resolve the ADB binary. Priority:
/// 1. `android_sdk_path` setting  2. ANDROID_SDK_ROOT  3. ANDROID_HOME  4. PATH
fn resolve_adb(android_sdk_path: Option<&str>) -> ResolvedBin {
    if let Some(sdk) = android_sdk_path {
        let trimmed = sdk.trim();
        if !trimmed.is_empty() {
            return ResolvedBin {
                path: platform_tools_bin(trimmed),
                source: "setting".to_string(),
            };
        }
    }
    for var in &["ANDROID_SDK_ROOT", "ANDROID_HOME"] {
        if let Ok(sdk) = std::env::var(var) {
            let sdk = sdk.trim().to_string();
            if !sdk.is_empty() {
                return ResolvedBin {
                    path: platform_tools_bin(&sdk),
                    source: var.to_string(),
                };
            }
        }
    }
    ResolvedBin {
        path: adb_default_bin().to_string(),
        source: "PATH".to_string(),
    }
}

/// Resolve Android SDK root from setting → ANDROID_SDK_ROOT → ANDROID_HOME.
fn resolve_android_sdk_root(android_sdk_path: Option<&str>) -> Option<String> {
    if let Some(sdk) = android_sdk_path {
        let trimmed = sdk.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    for var in &["ANDROID_SDK_ROOT", "ANDROID_HOME"] {
        if let Ok(sdk) = std::env::var(var) {
            let sdk = sdk.trim().to_string();
            if !sdk.is_empty() {
                return Some(sdk);
            }
        }
    }
    None
}

// ── Path helpers ──────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn flutter_bin_from_root(root: &str) -> String {
    format!("{}\\bin\\flutter.bat", root.trim_end_matches(['\\', '/']))
}
#[cfg(not(target_os = "windows"))]
fn flutter_bin_from_root(root: &str) -> String {
    format!("{}/bin/flutter", root.trim_end_matches('/'))
}

#[cfg(target_os = "windows")]
fn platform_tools_bin(sdk_root: &str) -> String {
    format!(
        "{}\\platform-tools\\adb.exe",
        sdk_root.trim_end_matches(['\\', '/'])
    )
}
#[cfg(not(target_os = "windows"))]
fn platform_tools_bin(sdk_root: &str) -> String {
    format!("{}/platform-tools/adb", sdk_root.trim_end_matches('/'))
}

#[cfg(target_os = "windows")]
fn emulator_bin_from_root(sdk_root: &str) -> String {
    format!(
        "{}\\emulator\\emulator.exe",
        sdk_root.trim_end_matches(['\\', '/'])
    )
}
#[cfg(not(target_os = "windows"))]
fn emulator_bin_from_root(sdk_root: &str) -> String {
    format!("{}/emulator/emulator", sdk_root.trim_end_matches('/'))
}

#[cfg(target_os = "windows")]
fn flutter_default_bin() -> &'static str {
    "flutter.bat"
}
#[cfg(not(target_os = "windows"))]
fn flutter_default_bin() -> &'static str {
    "flutter"
}

#[cfg(target_os = "windows")]
fn adb_default_bin() -> &'static str {
    "adb.exe"
}
#[cfg(not(target_os = "windows"))]
fn adb_default_bin() -> &'static str {
    "adb"
}

// ── Platform normalization ────────────────────────────────────────────────────

fn normalize_platform(raw: &str) -> String {
    let p = raw.to_lowercase();
    if p.contains("android") {
        "android".to_string()
    } else if p.contains("ios") {
        "ios".to_string()
    } else if p.contains("web") || p.contains("chrome") {
        "web".to_string()
    } else if p.contains("linux") {
        "linux".to_string()
    } else if p.contains("darwin") || p.contains("macos") {
        "macos".to_string()
    } else if p.contains("windows") {
        "windows".to_string()
    } else {
        p
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Detect which SDKs are available and how they were found.
/// Returns resolved binary paths, sources, and version strings.
#[tauri::command]
pub async fn check_sdk_paths(
    flutter_sdk_path: Option<String>,
    android_sdk_path: Option<String>,
) -> SdkPaths {
    let flutter = resolve_flutter(flutter_sdk_path.as_deref());
    let adb = resolve_adb(android_sdk_path.as_deref());
    let sdk_root = resolve_android_sdk_root(android_sdk_path.as_deref());

    // Test Flutter — `flutter --version` outputs "Flutter X.Y.Z • channel …"
    let (flutter_found, flutter_version) = match cmd(&flutter.path).arg("--version").output() {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let version = text
                .lines()
                .find(|l| l.starts_with("Flutter "))
                .and_then(|l| l.split_whitespace().nth(1))
                .map(|s| s.to_string());
            (true, version)
        }
        Err(_) => (false, None),
    };

    // Test ADB — `adb version` outputs "Android Debug Bridge version X.Y.Z"
    let (adb_found, adb_version) = match cmd(&adb.path).arg("version").output() {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let version = text
                .lines()
                .find(|l| l.contains("Android Debug Bridge version"))
                .map(|l| l.split("version ").nth(1).unwrap_or("").trim().to_string());
            (true, version)
        }
        Err(_) => (false, None),
    };

    SdkPaths {
        flutter_bin: if flutter_found {
            Some(flutter.path)
        } else {
            None
        },
        flutter_source: if flutter_found {
            Some(flutter.source)
        } else {
            None
        },
        flutter_version,
        adb_bin: if adb_found { Some(adb.path) } else { None },
        adb_source: if adb_found { Some(adb.source) } else { None },
        adb_version,
        android_sdk_root: sdk_root,
    }
}

/// List connected physical devices and running emulators.
/// Merges Flutter (rich metadata) with direct ADB queries for maximum coverage.
#[tauri::command]
pub async fn list_devices(
    flutter_sdk_path: Option<String>,
    android_sdk_path: Option<String>,
) -> Result<Vec<DeviceInfo>, String> {
    let flutter = resolve_flutter(flutter_sdk_path.as_deref());
    let adb = resolve_adb(android_sdk_path.as_deref());

    let mut devices: Vec<DeviceInfo> = Vec::new();
    let mut any_tool_found = false;

    // ── Flutter devices ───────────────────────────────────────────────────────
    if let Ok(out) = cmd(&flutter.path).args(["devices", "--machine"]).output() {
        any_tool_found = true;
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Ok(raw) = serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim()) {
                for v in raw {
                    let id = v["id"].as_str().unwrap_or("").to_string();
                    if id.is_empty() {
                        continue;
                    }
                    devices.push(DeviceInfo {
                        id,
                        name: v["name"].as_str().unwrap_or("Unknown").to_string(),
                        platform: normalize_platform(
                            v["targetPlatform"].as_str().unwrap_or("unknown"),
                        ),
                        emulator: v["emulator"].as_bool().unwrap_or(false),
                        available: v["isSupported"].as_bool().unwrap_or(true),
                        category: v["category"].as_str().unwrap_or("mobile").to_string(),
                        source: "flutter".to_string(),
                    });
                }
            }
        }
    }

    // ── ADB devices ───────────────────────────────────────────────────────────
    // Supplements Flutter: adds Android devices Flutter may miss, and provides
    // Android visibility when Flutter is not installed.
    if let Ok(out) = cmd(&adb.path).args(["devices", "-l"]).output() {
        any_tool_found = true;
        let stdout = String::from_utf8_lossy(&out.stdout);

        // Output format (after "List of devices attached" header):
        //   R5CNA2WT8EB     device product:oriole model:Pixel_6 device:oriole
        //   emulator-5554   device product:sdk_gphone model:sdk_gphone device:generic
        for line in stdout.lines().skip(1) {
            let line = line.trim();
            if line.is_empty() || line.starts_with('*') {
                continue;
            }

            let mut cols = line.splitn(2, char::is_whitespace);
            let serial = match cols.next() {
                Some(s) if !s.is_empty() => s.trim().to_string(),
                _ => continue,
            };
            let rest = cols.next().unwrap_or("").trim();

            // Skip if already reported by Flutter
            if devices.iter().any(|d| d.id == serial) {
                continue;
            }

            let available = rest.starts_with("device");
            let emulator = serial.starts_with("emulator-");

            // Extract human-readable name from "model:Pixel_6" token
            let name = rest
                .split_whitespace()
                .find(|s| s.starts_with("model:"))
                .map(|s| s.trim_start_matches("model:").replace('_', " "))
                .unwrap_or_else(|| serial.clone());

            devices.push(DeviceInfo {
                id: serial,
                name,
                platform: "android".to_string(),
                emulator,
                available,
                category: "mobile".to_string(),
                source: "adb".to_string(),
            });
        }
    }

    if !any_tool_found && devices.is_empty() {
        return Err("flutter_not_found".to_string());
    }

    Ok(devices)
}

/// List available emulators / AVDs.
/// Merges Flutter emulator list with `emulator -list-avds` for full coverage.
#[tauri::command]
pub async fn list_emulators(
    flutter_sdk_path: Option<String>,
    android_sdk_path: Option<String>,
) -> Result<Vec<EmulatorInfo>, String> {
    let flutter = resolve_flutter(flutter_sdk_path.as_deref());
    let sdk_root = resolve_android_sdk_root(android_sdk_path.as_deref());

    let mut emulators: Vec<EmulatorInfo> = Vec::new();

    // ── Flutter emulators ─────────────────────────────────────────────────────
    if let Ok(out) = cmd(&flutter.path).args(["emulators", "--machine"]).output() {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Ok(raw) = serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim()) {
                for v in raw {
                    let id = v["id"].as_str().unwrap_or("").to_string();
                    if id.is_empty() {
                        continue;
                    }
                    emulators.push(EmulatorInfo {
                        id,
                        name: v["name"].as_str().unwrap_or("Unknown").to_string(),
                        platform: v["platform"].as_str().unwrap_or("android").to_string(),
                        source: "flutter".to_string(),
                    });
                }
            }
        }
    }

    // ── Direct AVD list via `emulator -list-avds` ─────────────────────────────
    let emulator_bin = sdk_root
        .as_deref()
        .map(emulator_bin_from_root)
        .unwrap_or_else(|| "emulator".to_string());

    if let Ok(out) = cmd(&emulator_bin).arg("-list-avds").output() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for avd in stdout.lines() {
            let avd = avd.trim();
            if avd.is_empty() {
                continue;
            }
            // Deduplicate by checking if Flutter already reported this AVD
            if emulators
                .iter()
                .any(|e| e.id == avd || e.name == avd || e.id.contains(avd))
            {
                continue;
            }
            emulators.push(EmulatorInfo {
                id: avd.to_string(),
                name: avd.replace('_', " "),
                platform: "android".to_string(),
                source: "avd".to_string(),
            });
        }
    }

    Ok(emulators)
}

/// Launch an emulator. Tries Flutter first; falls back to `emulator -avd <id>`.
#[tauri::command]
pub async fn start_emulator(
    emulator_id: String,
    flutter_sdk_path: Option<String>,
    android_sdk_path: Option<String>,
) -> Result<(), String> {
    let flutter = resolve_flutter(flutter_sdk_path.as_deref());
    let sdk_root = resolve_android_sdk_root(android_sdk_path.as_deref());

    std::thread::spawn(move || {
        // Try Flutter first (works for AVDs + Genymotion)
        let launched = cmd(&flutter.path)
            .args(["emulators", "--launch", &emulator_id])
            .spawn()
            .map(|mut c| c.wait().map(|s| s.success()).unwrap_or(false))
            .unwrap_or(false);

        if !launched {
            let bin = sdk_root
                .as_deref()
                .map(emulator_bin_from_root)
                .unwrap_or_else(|| "emulator".to_string());
            let _ = cmd(&bin).args(["-avd", &emulator_id]).spawn();
        }
    });

    Ok(())
}

/// Run a Flutter or React Native app on a specific device via PTY.
/// Returns the PTY session ID.
#[tauri::command]
pub async fn run_on_device(
    device_id: String,
    project_path: String,
    // "flutter" | "react-native-android" | "react-native-ios"
    platform: String,
    flutter_sdk_path: Option<String>,
    android_sdk_path: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, super::pty::PtyState>,
) -> Result<String, String> {
    use portable_pty::CommandBuilder;
    use std::io::Read;

    let flutter = resolve_flutter(flutter_sdk_path.as_deref());
    let sdk_root = resolve_android_sdk_root(android_sdk_path.as_deref());

    let pair = pty_system_open()?;

    // ── Build command ─────────────────────────────────────────────────────────
    let (cmd_path, cmd_args): (String, Vec<String>) = match platform.as_str() {
        "react-native-android" => (
            "npx".to_string(),
            vec![
                "react-native".to_string(),
                "run-android".to_string(),
                "--deviceId".to_string(),
                device_id.clone(),
            ],
        ),
        "react-native-ios" => (
            "npx".to_string(),
            vec![
                "react-native".to_string(),
                "run-ios".to_string(),
                "--device".to_string(),
                device_id.clone(),
            ],
        ),
        _ => (
            flutter.path.clone(),
            vec!["run".to_string(), "-d".to_string(), device_id.clone()],
        ),
    };

    let mut cmd = CommandBuilder::new(&cmd_path);
    for arg in &cmd_args {
        cmd.arg(arg);
    }
    cmd.cwd(&project_path);

    // Inject SDK env vars so child process can find ADB / emulator / tools
    // even when the IDE was launched without a full shell environment.
    if let Some(sdk) = &sdk_root {
        cmd.env("ANDROID_SDK_ROOT", sdk);
        cmd.env("ANDROID_HOME", sdk);
    }

    // Prepend Flutter bin dir to PATH when it was resolved from a setting
    // rather than the system PATH (ensures `flutter`, `dart` are available).
    if flutter.source != "PATH" {
        if let Some(pos) = flutter.path.rfind(['/', '\\']) {
            let flutter_bin_dir = &flutter.path[..pos];
            let current_path = std::env::var("PATH").unwrap_or_default();
            #[cfg(target_os = "windows")]
            let sep = ";";
            #[cfg(not(target_os = "windows"))]
            let sep = ":";
            cmd.env(
                "PATH",
                format!("{}{}{}", flutter_bin_dir, sep, current_path),
            );
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn: {e}"))?;

    drop(pair.slave);

    let pty_id = uuid::Uuid::new_v4().to_string();

    // ── Reader thread ─────────────────────────────────────────────────────────
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
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty:data",
                        serde_json::json!({ "pty_id": reader_id, "data": text }),
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(
            "pty:exit",
            serde_json::json!({ "pty_id": reader_id, "code": null }),
        );
    });

    // ── Store session ─────────────────────────────────────────────────────────
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;
    {
        let mut sessions = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
        sessions.insert(
            pty_id.clone(),
            super::pty::PtySession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    Ok(pty_id)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn pty_system_open() -> Result<portable_pty::PtyPair, String> {
    use portable_pty::{native_pty_system, PtySize};
    native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))
}
