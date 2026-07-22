use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

mod commands;

use commands::ai::AiRequestState;
use commands::db::DbState;
use commands::docker::DockerWatchState;
use commands::fs::FsWatcherState;
use commands::keychain::KeychainState;
use commands::lsp::LspState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(commands::pty::PtyState(std::sync::Arc::new(Mutex::new(
            HashMap::new(),
        ))))
        .manage(LspState(Mutex::new(HashMap::new())))
        .manage(FsWatcherState(Mutex::new(HashMap::new())))
        .manage(DockerWatchState(Mutex::new(HashMap::new())))
        .manage(AiRequestState::default())
        .manage(KeychainState(Arc::new(Mutex::new(
            commands::keychain::load_keychain(),
        ))))
        .manage({
            let app_dir = dirs::data_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("hyscode");
            DbState(Mutex::new(commands::db::open_database(&app_dir)))
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::list_dir,
            commands::fs::create_file,
            commands::fs::delete_path,
            commands::fs::stat_path,
            commands::fs::search_files,
            commands::fs::rename_path,
            commands::fs::create_directory,
            commands::fs::get_home_dir,
            commands::fs::list_dir_all,
            commands::fs::fs_watch,
            commands::fs::fs_unwatch,
            commands::fs::copy_path,
            commands::fs::reveal_path,
            commands::fs::find_files,
            // Git commands
            commands::git::git_is_repo,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_diff_file,
            commands::git::git_diff_staged_all,
            commands::git::git_diff_hunks,
            commands::git::git_file_content,
            commands::git::git_add,
            commands::git::git_add_all,
            commands::git::git_unstage,
            commands::git::git_discard,
            commands::git::git_commit,
            commands::git::git_log,
            commands::git::git_log_file,
            commands::git::git_branch_current,
            commands::git::git_branch_list,
            commands::git::git_branch_create,
            commands::git::git_branch_delete,
            commands::git::git_checkout,
            commands::git::git_remote_list,
            commands::git::git_ahead_behind,
            commands::git::git_stash,
            commands::git::git_stash_list,
            commands::git::git_stash_pop,
            commands::git::git_commit_detail,
            commands::git::git_commit_file_diff,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_fetch,
            commands::git::git_merge,
            commands::git::git_reset,
            commands::git::git_blame,
            commands::git::git_tag_create,
            commands::git::git_log_graph,
            // PTY commands
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::pty_exists,
            commands::pty::pty_snapshot,
            commands::pty::pty_interrupt,
            // Extension commands
            commands::extension::extension_install,
            commands::extension::extension_install_zip,
            commands::extension::extension_uninstall,
            commands::extension::extension_list,
            commands::extension::extension_read_asset,
            commands::extension::extension_toggle,
            commands::extension::extension_get_dir,
            commands::extension::extension_install_git,
            commands::extension::extension_check_git_updates,
            commands::extension::extension_update_git,
            commands::extension::extension_get_git_sources,
            commands::extension::extension_remove_git_source,
            commands::extension::extension_install_from_store,
            // LSP commands
            commands::lsp::lsp_start,
            commands::lsp::lsp_send,
            commands::lsp::lsp_stop,
            commands::lsp::lsp_list_active,
            commands::lsp::lsp_probe_server,
            // Keychain commands
            commands::keychain::keychain_set,
            commands::keychain::keychain_get,
            commands::keychain::keychain_delete,
            commands::keychain::keychain_has,
            // Browser commands
            commands::browser::web_fetch,
            commands::browser::web_search,
            // AI streaming commands
            commands::ai::ai_stream_request,
            commands::ai::ai_stream_cancel,
            // Claude Agent sidecar commands
            commands::claude_agent::claude_agent_run,
            commands::claude_agent::claude_agent_cancel,
            // GitHub OAuth / Copilot commands
            commands::github_oauth::github_oauth_start,
            commands::github_oauth::github_oauth_poll,
            commands::github_oauth::github_copilot_ensure_token,
            commands::github_oauth::github_copilot_disconnect,
            commands::github_oauth::github_copilot_is_authenticated,
            // GitHub Pull Request commands
            commands::github_pr::github_create_pull_request,
            commands::github_pr::github_set_token,
            commands::github_pr::github_has_token,
            commands::github_pr::git_remote_info,
            // Database commands
            commands::db::db_ensure_project,
            commands::db::db_list_conversations,
            commands::db::db_get_conversation,
            commands::db::db_create_conversation,
            commands::db::db_update_conversation,
            commands::db::db_delete_conversation,
            commands::db::db_list_messages,
            commands::db::db_create_message,
            commands::db::db_sdd_upsert_session,
            commands::db::db_sdd_get_session,
            commands::db::db_sdd_list_sessions,
            commands::db::db_sdd_upsert_task,
            commands::db::db_sdd_get_tasks,
            // Turn record commands
            commands::db::db_create_turn_record,
            commands::db::db_commit_agent_turn,
            commands::db::db_get_conversation_token_usage,
            // Trace commands
            commands::db::db_create_trace,
            commands::db::db_list_traces,
            // Mode policy commands
            commands::db::db_list_mode_policies,
            commands::db::db_update_mode_policy,
            // Open tabs commands
            commands::db::db_get_open_tabs,
            commands::db::db_upsert_open_tab,
            commands::db::db_remove_open_tab,
            // File history commands
            commands::db::file_history_save,
            commands::db::file_history_list,
            commands::db::file_history_get,
            commands::db::file_history_clear,
            // Diagram commands
            commands::db::db_list_diagrams,
            commands::db::db_get_diagram,
            commands::db::db_save_diagram,
            commands::db::db_delete_diagram,
            commands::db::db_extract_schema,
            // Memory commands
            commands::db::db_create_memory,
            commands::db::db_list_memories,
            commands::db::db_search_memories,
            commands::db::db_update_memory,
            commands::db::db_delete_memory,
            commands::db::db_track_memory_access,
            commands::db::db_decay_memories,
            commands::db::db_get_memory_stats,
            // Notification commands
            commands::notifications::notify_agent_done,
            // Device management commands
            commands::devices::check_sdk_paths,
            commands::devices::list_devices,
            commands::devices::list_emulators,
            commands::devices::start_emulator,
            commands::devices::run_on_device,
            // Docker commands
            commands::docker::docker_is_available,
            commands::docker::docker_list_containers,
            commands::docker::docker_list_images,
            commands::docker::docker_start_container,
            commands::docker::docker_stop_container,
            commands::docker::docker_restart_container,
            commands::docker::docker_remove_container,
            commands::docker::docker_remove_image,
            commands::docker::docker_container_logs,
            commands::docker::docker_pull_image,
            commands::docker::docker_inspect_container,
            commands::docker::docker_compose_up,
            commands::docker::docker_compose_down,
            commands::docker::docker_watch_start,
            commands::docker::docker_watch_stop,
            // Updater commands
            commands::updater::updater_check,
            commands::updater::updater_download,
            commands::updater::updater_install,
            // Shell exec
            commands::utils::shell_exec,
            // Window controls
            commands::window::start_resize,
        ])
        .setup(|app| {
            let _window = app.get_webview_window("main").unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running HysCode");
}
