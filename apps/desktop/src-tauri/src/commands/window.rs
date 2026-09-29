use tauri::Manager;
use tauri_runtime::ResizeDirection;

/// Begins an interactive window resize from one of the eight edges/corners.
///
/// `edge` is one of: `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`.
/// The `window` argument is injected by Tauri as the window that invoked
/// the command (the main webview).
#[tauri::command]
pub fn start_resize(window: tauri::Window, edge: String) -> Result<(), String> {
    let direction = match edge.as_str() {
        "n" => ResizeDirection::North,
        "s" => ResizeDirection::South,
        "e" => ResizeDirection::East,
        "w" => ResizeDirection::West,
        "ne" => ResizeDirection::NorthEast,
        "nw" => ResizeDirection::NorthWest,
        "se" => ResizeDirection::SouthEast,
        "sw" => ResizeDirection::SouthWest,
        other => return Err(format!("invalid resize edge: {other}")),
    };

    window
        .start_resize_dragging(direction)
        .map_err(|e| e.to_string())
}

/// Opens the DevTools panel for the main webview window.
///
/// Gated frontend-side by the `devtoolsEnabled` setting (off by default);
/// the command itself performs no gating.
#[tauri::command]
pub fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    // SECURITY: the `devtools` Tauri feature is compiled in, so enforce the
    // debug-only gate here — release builds always refuse, even if the
    // frontend setting or an extension invokes this command.
    if !cfg!(debug_assertions) {
        return Err("DevTools are only available in debug builds".to_string());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.open_devtools();
    Ok(())
}
