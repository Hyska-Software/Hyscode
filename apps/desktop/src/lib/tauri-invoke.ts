// ─── Typed Tauri Invoke Wrapper ──────────────────────────────────────────────
// Centralises invoke usage and provides per-command type safety.

import { invoke } from '@tauri-apps/api/core';

// ─── Shared types ───────────────────────────────────────────────────────────

interface GitFile {
  path: string;
  status: string;
  old_path: string | null;
}

// ─── Command signatures ─────────────────────────────────────────────────────

interface TauriCommands {
  // FS
  read_file: { args: { path: string }; ret: string };
  write_file: { args: { path: string; content: string }; ret: void };
  create_file: { args: { path: string; content?: string }; ret: void };
  delete_path: { args: { path: string }; ret: void };
  list_dir: { args: { path: string }; ret: Array<{ name: string; path: string; is_dir: boolean; size: number }> };
  stat_path: { args: { path: string }; ret: { path: string; is_dir: boolean; is_file: boolean; size: number; modified: number | null } };
  rename_path: { args: { from: string; to: string }; ret: void };
  create_directory: { args: { path: string }; ret: void };
  search_files: { args: { root: string; query: string; maxResults?: number }; ret: Array<{ path: string; line_number: number; line_content: string }> };
  fs_watch: { args: { path: string }; ret: void };
  fs_unwatch: { args: { path: string }; ret: void };

  // Git
  git_is_repo: { args: { path: string }; ret: boolean };
  git_status: { args: { repoPath: string }; ret: { staged: GitFile[]; unstaged: GitFile[]; untracked: GitFile[]; conflicts: GitFile[] } };
  git_diff_file: { args: { repoPath: string; filePath: string; staged: boolean }; ret: string };
  git_add: { args: { repoPath: string; paths: string[] }; ret: void };
  git_add_all: { args: { repoPath: string }; ret: void };
  git_commit: { args: { repoPath: string; message: string }; ret: string };
  git_log: { args: { repoPath: string; limit: number }; ret: Array<{ hash: string; short_hash: string; message: string; author: string; email: string; timestamp: number }> };
  git_checkout: { args: { repoPath: string; branch: string }; ret: void };
  git_branch_current: { args: { repoPath: string }; ret: string };
  git_branch_list: { args: { repoPath: string }; ret: Array<{ name: string; is_current: boolean; is_remote: boolean; upstream: string | null }> };
  git_branch_create: { args: { repoPath: string; name: string; checkout: boolean }; ret: void };
  git_branch_delete: { args: { repoPath: string; name: string }; ret: void };
  git_unstage: { args: { repoPath: string; paths: string[] }; ret: void };
  git_discard: { args: { repoPath: string; paths: string[] }; ret: void };
  git_remote_list: { args: { repoPath: string }; ret: Array<{ name: string; url: string }> };
  git_ahead_behind: { args: { repoPath: string }; ret: { ahead: number; behind: number } };
  git_stash: { args: { repoPath: string; message?: string }; ret: void };
  git_stash_list: { args: { repoPath: string }; ret: Array<{ index: number; message: string }> };
  git_stash_pop: { args: { repoPath: string; index: number }; ret: void };
  git_log_file: { args: { repoPath: string; filePath: string; limit: number }; ret: Array<{ hash: string; short_hash: string; message: string; author: string; email: string; timestamp: number }> };
  git_diff_hunks: { args: { repoPath: string; filePath: string; staged: boolean }; ret: Array<{ new_start: number; new_lines: number; old_lines: number }> };
  git_file_content: { args: { repoPath: string; filePath: string }; ret: { original: string; modified: string } };
  git_init: { args: { path: string }; ret: void };
  git_commit_detail: { args: { repoPath: string; hash: string }; ret: { hash: string; short_hash: string; message: string; author: string; email: string; timestamp: number; files: Array<{ path: string; status: string; insertions: number; deletions: number }>; total_insertions: number; total_deletions: number } };
  git_commit_file_diff: { args: { repoPath: string; hash: string; filePath: string }; ret: string };
  git_push: { args: { repoPath: string; remote?: string; branch?: string }; ret: string };
  git_pull: { args: { repoPath: string; remote?: string }; ret: string };
  git_fetch: { args: { repoPath: string; remote?: string }; ret: string };
  git_merge: { args: { repoPath: string; branch: string }; ret: string };
  git_tag_create: { args: { repoPath: string; name: string; message?: string }; ret: void };

  // PTY — spawn returns the pty_id; output arrives via 'pty:data' events
  pty_spawn: { args: { shell?: string; cwd?: string; env?: Record<string, string> }; ret: string };
  pty_write: { args: { ptyId: string; data: string }; ret: void };
  pty_resize: { args: { ptyId: string; cols: number; rows: number }; ret: void };
  pty_kill: { args: { ptyId: string }; ret: void };
  pty_exists: { args: { ptyId: string }; ret: boolean };

  // Keychain
  keychain_set: { args: { service: string; account: string; password: string }; ret: void };
  keychain_get: { args: { service: string; account: string }; ret: string | null };
  keychain_delete: { args: { service: string; account: string }; ret: void };
  keychain_has: { args: { service: string; account: string }; ret: boolean };

  // AI Streaming
  ai_stream_request: { args: { requestId: string; provider: string; url: string; headers: Record<string, string>; body: string; timeoutMs?: number }; ret: void };
  ai_stream_cancel: { args: { requestId: string }; ret: void };

  // Claude Agent Sidecar
  claude_agent_run: { args: { request: { request_id: string; model: string; system_prompt?: string; messages: Array<{ role: string; content: string }>; max_turns?: number; cwd?: string } }; ret: void };
  claude_agent_cancel: { args: { requestId: string }; ret: void };

  // GitHub OAuth / Copilot
  github_oauth_start: { args: Record<string, never>; ret: { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number } };
  github_oauth_poll: { args: { deviceCode: string }; ret: { access_token: string; token_type: string; scope: string } };
  github_copilot_ensure_token: { args: Record<string, never>; ret: string };
  github_copilot_disconnect: { args: Record<string, never>; ret: void };
  github_copilot_is_authenticated: { args: Record<string, never>; ret: boolean };

  // Database: Projects
  db_ensure_project: { args: { id: string; path: string }; ret: void };

  // Database: Conversations
  db_list_conversations: { args: { projectId: string }; ret: Array<{ id: string; title: string; mode: string; model_id: string | null; provider_id: string | null; message_count: number; created_at: string; updated_at: string }> };
  db_get_conversation: { args: { conversationId: string }; ret: { id: string; title: string; mode: string; model_id: string | null; provider_id: string | null; created_at: string; updated_at: string } | null };
  db_create_conversation: { args: { id: string; projectId: string; title: string; mode: string; modelId?: string; providerId?: string }; ret: void };
  db_update_conversation: { args: { conversationId: string; title?: string }; ret: void };
  db_delete_conversation: { args: { conversationId: string }; ret: void };

  // Database: Messages
  db_list_messages: { args: { conversationId: string }; ret: Array<{ id: string; role: string; content: string; tool_calls: string | null; token_input: number; token_output: number; created_at: string }> };
  db_create_message: { args: { id: string; conversationId: string; role: string; content: string; toolCalls?: string; tokenInput?: number; tokenOutput?: number }; ret: void };

  // Database: Traces
  db_create_trace: { args: { id: string; conversationId: string; mode: string; provider: string; model: string; systemPromptHash?: string; systemPromptPreview?: string; systemPromptTokens?: number; toolCount?: number; iterations: string; tokenInput: number; tokenOutput: number; stopReason: string; verificationPerformed: boolean; verificationForced: boolean; filesModified?: string; errors?: string; loopWarnings?: string; durationMs: number }; ret: void };
  db_list_traces: { args: { conversationId: string }; ret: Array<{ id: string; conversation_id: string; mode: string; provider: string; model: string; system_prompt_hash: string | null; iterations: string; token_input: number; token_output: number; stop_reason: string; verification_performed: boolean; verification_forced: boolean; files_modified: string | null; errors: string | null; loop_warnings: string | null; duration_ms: number; created_at: string }> };

  // Database: Mode Policies
  db_list_mode_policies: { args: Record<string, never>; ret: Array<{ mode: string; max_iterations: number; max_input_tokens: number; max_output_tokens: number; turn_timeout_ms: number; approval_mode: string; verification_required: boolean; allowed_tool_categories: string; tool_overrides: string | null; skill_triggers: string | null }> };
  db_update_mode_policy: { args: { mode: string; maxIterations?: number; maxInputTokens?: number; maxOutputTokens?: number; turnTimeoutMs?: number; approvalMode?: string; verificationRequired?: boolean; allowedToolCategories?: string; toolOverrides?: string; skillTriggers?: string }; ret: void };

  // Docker
  docker_is_available: { args: Record<string, never>; ret: boolean };
  docker_list_containers: { args: { all?: boolean }; ret: Array<{ id: string; name: string; image: string; status: string; state: string; ports: string; created: string }> };
  docker_list_images: { args: Record<string, never>; ret: Array<{ id: string; repository: string; tag: string; size: string; created: string }> };
  docker_start_container: { args: { id: string }; ret: void };
  docker_stop_container: { args: { id: string }; ret: void };
  docker_restart_container: { args: { id: string }; ret: void };
  docker_remove_container: { args: { id: string; force?: boolean }; ret: void };
  docker_remove_image: { args: { id: string; force?: boolean }; ret: void };
  docker_container_logs: { args: { id: string; tail?: number }; ret: string };
  docker_pull_image: { args: { image: string }; ret: string };
  docker_inspect_container: { args: { id: string }; ret: string };
  docker_compose_up: { args: { composePath: string; detach?: boolean }; ret: string };
  docker_compose_down: { args: { composePath: string }; ret: string };
  docker_watch_start: { args: { intervalMs: number }; ret: string };
  docker_watch_stop: { args: { watchId: string }; ret: void };

  // Updater
  updater_check: { args: { channel?: string }; ret: { version: string; body: string; publishedAt: string; assetUrl: string; assetName: string; assetSize: number; currentVersion: string } | null };
  updater_download: { args: { assetUrl: string; assetName: string }; ret: string };
  updater_install: { args: { installerPath: string }; ret: void };

  // Open tabs
  db_get_open_tabs: { args: { projectId: string }; ret: Array<{ id: string; conversation_id: string | null; title: string; mode: string; tab_index: number }> };
  db_upsert_open_tab: { args: { id: string; projectId: string; conversationId: string | null; title: string; mode: string; tabIndex: number }; ret: void };
  db_remove_open_tab: { args: { id: string }; ret: void };

  // Diagrams
  db_list_diagrams: { args: { projectId: string }; ret: Array<{ id: string; project_id: string; name: string; content: string; source_file: string | null; created_at: string; updated_at: string }> };
  db_get_diagram: { args: { id: string }; ret: { id: string; project_id: string; name: string; content: string; source_file: string | null; created_at: string; updated_at: string } };
  db_save_diagram: { args: { id: string; projectId: string; name: string; content: string; sourceFile: string | null }; ret: void };
  db_delete_diagram: { args: { id: string }; ret: void };
  db_extract_schema: { args: { dbPath: string }; ret: Array<{ name: string; columns: Array<{ cid: number; name: string; col_type: string; not_null: boolean; default_value: string | null; is_pk: boolean }>; foreign_keys: Array<{ id: number; seq: number; to_table: string; from_col: string; to_col: string }> }> };

  // Notifications
  notify_agent_done: { args: { title: string; body: string }; ret: void };
}

// ─── Typed invoke ───────────────────────────────────────────────────────────

export function tauriInvoke<K extends keyof TauriCommands>(
  command: K,
  args: TauriCommands[K]['args'],
): Promise<TauriCommands[K]['ret']> {
  return invoke(command, args as Record<string, unknown>) as Promise<TauriCommands[K]['ret']>;
}

// ─── Generic invoke (for dynamic / unknown commands) ────────────────────────

export function tauriInvokeRaw<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}
