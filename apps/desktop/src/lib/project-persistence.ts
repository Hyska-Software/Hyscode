// ─── Per-Project State Persistence ──────────────────────────────────────────
//
// Saves/restores IDE state (editor tabs, agent session, review data)
// scoped to each project's rootPath. Uses localStorage keyed by a
// deterministic hash of the project path.

import { useEditorStore, type Tab } from '@/stores/editor-store';
import { useAgentStore, type AgentMode } from '@/stores/agent-store';
import { useLayoutStore, type WorkspaceMode } from '@/stores/layout-store';
import { tauriInvoke } from './tauri-invoke';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EditorSnapshot {
  tabs: Tab[];
  activeTabId: string | null;
}

export interface AgentSnapshot {
  conversationId: string | null;
  mode: AgentMode;
}

export interface ProjectSnapshot {
  version: 1;
  savedAt: number;
  editor: EditorSnapshot;
  agent: AgentSnapshot;
  workspaceMode?: WorkspaceMode;
}

// ─── Key Generation ─────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'hyscode-project-state:';

/**
 * Simple djb2 hash → hex string.
 * Produces a short deterministic key from a file path.
 */
function hashPath(path: string): string {
  let hash = 5381;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) + hash + path.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function getStorageKey(rootPath: string): string {
  // Normalise separators so the same folder always matches
  const normalised = rootPath.replace(/\\/g, '/').toLowerCase();
  return STORAGE_PREFIX + hashPath(normalised);
}

// ─── Snapshot: Collect from Stores ──────────────────────────────────────────

function getEditorSnapshot(): EditorSnapshot {
  const { tabs, activeTabId } = useEditorStore.getState();
  return {
    tabs: tabs
      .filter((t) => !t.filePath.startsWith('untitled:'))
      .map((t) => ({ ...t, isDirty: false, isPreview: false })),
    activeTabId,
  };
}

function getAgentSnapshot(): AgentSnapshot {
  const { conversationId, mode } = useAgentStore.getState();
  return { conversationId, mode };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Persist the current IDE state for the given project.
 */
export function saveProjectState(rootPath: string): void {
  const snapshot: ProjectSnapshot = {
    version: 1,
    savedAt: Date.now(),
    editor: getEditorSnapshot(),
    agent: getAgentSnapshot(),
    workspaceMode: useLayoutStore.getState().workspaceMode,
  };
  try {
    localStorage.setItem(getStorageKey(rootPath), JSON.stringify(snapshot));
  } catch (err) {
    console.warn('[project-persistence] Failed to save state:', err);
  }
}

/**
 * Load a previously-saved snapshot for the given project.
 * Returns `null` if the project was never opened before.
 */
export function loadProjectState(rootPath: string): ProjectSnapshot | null {
  try {
    const raw = localStorage.getItem(getStorageKey(rootPath));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as ProjectSnapshot;
    if (snapshot.version !== 1) return null;
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Remove a project's saved state from localStorage.
 */
export function clearProjectState(rootPath: string): void {
  localStorage.removeItem(getStorageKey(rootPath));
}

// ─── Restore: Apply Snapshot to Stores ──────────────────────────────────────

/**
 * Restore editor tabs from a snapshot.
 */
function restoreEditorState(snapshot: EditorSnapshot): void {
  useEditorStore.setState({
    tabs: snapshot.tabs.map((t) => ({ ...t, isPreview: false })),
    activeTabId: snapshot.activeTabId,
  });
}

/**
 * Restore the agent session from a snapshot.
 * Sets mode + conversationId, then loads messages from DB if a conversation
 * was previously active.
 */
async function restoreAgentState(snapshot: AgentSnapshot): Promise<void> {
  const store = useAgentStore.getState();
  store.clearConversation();
  store.setMode(snapshot.mode);

  if (snapshot.conversationId) {
    try {
      // Check conversation still exists in DB
      const conv = await tauriInvoke('db_get_conversation', {
        conversationId: snapshot.conversationId,
      });
      if (!conv) return;

      store.setConversationId(snapshot.conversationId);

      // Load messages from DB
      const dbMessages = await tauriInvoke('db_list_messages', {
        conversationId: snapshot.conversationId,
      });

      for (const m of dbMessages) {
        if (m.role === 'system') continue;
        const message = {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
          blocks: m.blocks ? JSON.parse(m.blocks) : undefined,
          turnSummary: m.turn_summary ? JSON.parse(m.turn_summary) : undefined,
          timestamp: new Date(m.created_at).getTime(),
        };
        store.addMessage(message);
        if (message.turnSummary) store.hydrateTurnSummary(message.turnSummary);
      }

      // Sync harness bridge if available
      try {
        const { HarnessBridge } = await import('./harness-bridge');
        const bridge = HarnessBridge.get();
        if (bridge) bridge.restoreSession(snapshot.conversationId);
      } catch {
        // Bridge might not be initialised yet — that's fine
      }
    } catch (err) {
      console.warn('[project-persistence] Failed to restore agent state:', err);
    }
  }
}

// ─── Agent Sessions Loader ──────────────────────────────────────────────────

/**
 * Load the session history list for a project from the DB.
 * Fire-and-forget — failures are silently ignored.
 */
async function loadSessionsForProject(rootPath: string): Promise<void> {
  const store = useAgentStore.getState();
  store.setSessionsLoading(true);
  try {
    const rows = await tauriInvoke('db_list_conversations', { projectId: rootPath });
    const mapped = rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      mode: r.mode || 'chat',
      modelId: r.model_id,
      providerId: r.provider_id,
      messageCount: r.message_count ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    useAgentStore.getState().setSessions(mapped);
  } catch {
    // DB not available yet — leave empty
  } finally {
    useAgentStore.getState().setSessionsLoading(false);
  }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Reset all project-scoped stores to their clean initial state.
 */
export function clearAllProjectState(): void {
  useEditorStore.getState().closeAllTabs();
  useAgentStore.getState().clearConversation();
  useAgentStore.getState().setSessions([]);
}

/**
 * Full project-open lifecycle:
 * 1. Save current project state (if any)
 * 2. Clear all project-scoped stores
 * 3. Load snapshot for the new project (if it exists)
 * 4. Apply the snapshot (or leave clean for new projects)
 */
export async function switchProject(
  currentRootPath: string | null,
  newRootPath: string,
): Promise<void> {
  // 1. Save outgoing project
  if (currentRootPath) {
    saveProjectState(currentRootPath);
  }

  // 2. Clear everything
  clearAllProjectState();

  // 3. Load new project snapshot
  const snapshot = loadProjectState(newRootPath);

  // 4. Apply (or leave clean for never-opened projects)
  if (snapshot) {
    restoreEditorState(snapshot.editor);
    await restoreAgentState(snapshot.agent);
    if (snapshot.workspaceMode) {
      useLayoutStore.getState().setWorkspaceMode(snapshot.workspaceMode);
    }
  }

  // 5. Eagerly load agent sessions list for the new project
  loadSessionsForProject(newRootPath);
}

/**
 * Save current state and clean up for project close.
 */
export function closeCurrentProject(rootPath: string): void {
  saveProjectState(rootPath);
  clearAllProjectState();
}
