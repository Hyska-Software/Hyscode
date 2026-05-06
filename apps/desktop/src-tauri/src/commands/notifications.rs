use tauri::AppHandle;

/// Send an OS notification when the agent finishes working.
/// Requires tauri-plugin-notification to be registered.
#[tauri::command]
pub fn notify_agent_done(app: AppHandle, title: String, body: String) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(&title)
            .body(&body)
            .show()
            .map_err(|e| e.to_string())?;
    }
    // On unsupported platforms, silently succeed
    let _ = (app, title, body);
    Ok(())
}
