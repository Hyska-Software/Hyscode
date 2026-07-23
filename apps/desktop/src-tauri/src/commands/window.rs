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
