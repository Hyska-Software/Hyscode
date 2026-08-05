// ─── Per-Project State Persistence ──────────────────────────────────────────
//
// Saves/restores IDE state (editor tabs, agent session, review data)
// scoped to each project's rootPath. Uses localStorage keyed by a
// deterministic hash of the project path.

import { useEditorStore, type Tab } from '@/stores/editor-store';
import {
  useAgentStore,
  type AgentMode,
  type ChatMessage,
  type ToolCallDisplay,
  type TurnSummary,
} from '@/stores/agent-store';
import { useLayoutStore, type WorkspaceMode } from '@/stores/layout-store';
import { useDbViewerStore } from '@/stores/db-viewer-store';
import { useDiagnosticsStore } from '@/stores/diagnostics-store';
import { useFileStore } from '@/stores/file-store';
import { useGitStore } from '@/stores/git-store';
import { useLspStore } from '@/stores/lsp-store';
import { useMemoryStore } from '@/stores/memory-store';
import { useProjectStore } from '@/stores/project-store';
import { useRulesStore } from '@/stores/rules-store';
import { useSchemaDiagramStore } from '@/stores/schema-diagram-store';
import { useSkillsStore } from '@/stores/skills-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { HarnessBridge } from './harness-bridge';
import { areSameProjectPath, normalizeProjectPath } from './project-path';
import { tauriInvoke } from './tauri-invoke';
import { vortexSessionRuntimeManager } from './vortex-session-runtime';

export { areSameProjectPath } from './project-path';

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

export interface ProjectOpenOptions {
  /** Override a saved layout when navigation originates in a specific mode. */
  workspaceMode?: WorkspaceMode;
}

// ─── Key Generation ─────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'hyscode-project-state:';
let projectSwitchGeneration = 0;

function isCurrentProjectSwitch(switchId: number, rootPath: string): boolean {
  return (
    switchId === projectSwitchGeneration &&
    areSameProjectPath(useProjectStore.getState().rootPath, rootPath)
  );
}

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

function toAgentMode(mode: string): AgentMode {
  return ['chat', 'build', 'review', 'debug', 'plan'].includes(mode)
    ? (mode as AgentMode)
    : 'chat';
}

function parseJsonValue<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function mapDatabaseMessage(message: {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  blocks: string | null;
  turn_summary: string | null;
  created_at: string;
}): ChatMessage | null {
  if (message.role === 'system' || (message.role !== 'user' && message.role !== 'assistant')) {
    return null;
  }
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    toolCalls: parseJsonValue<ToolCallDisplay[]>(message.tool_calls),
    blocks: parseJsonValue<NonNullable<ChatMessage['blocks']>>(message.blocks),
    turnSummary: parseJsonValue<TurnSummary>(message.turn_summary),
    timestamp: new Date(message.created_at).getTime(),
  };
}

/** Persist the agent's open tabs for a project before its store is reset. */
export function saveOpenAgentTabs(rootPath: string): void {
  const { openTabs, activeTabId, tabStates, conversationId, mode } = useAgentStore.getState();
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) return;

  openTabs.forEach((tab, tabIndex) => {
    const isActive = tab.id === activeTabId;
    const tabState = tabStates[tab.id];
    tauriInvoke('db_upsert_open_tab', {
      id: tab.id,
      projectId: rootPath,
      conversationId: isActive ? conversationId : (tabState?.conversationId ?? null),
      title: tab.title,
      mode: isActive ? mode : (tabState?.mode ?? 'chat'),
      tabIndex,
    }).catch(() => {
      // Open-tab persistence is best effort during teardown.
    });
  });
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
  const activeTabId = snapshot.tabs.some((tab) => tab.id === snapshot.activeTabId)
    ? snapshot.activeTabId
    : (snapshot.tabs[0]?.id ?? null);
  useEditorStore.setState({
    tabs: snapshot.tabs.map((t) => ({ ...t, isPreview: false })),
    activeTabId,
  });
}

/**
 * Restore the agent session from a snapshot.
 * Sets mode + conversationId, then loads messages from DB if a conversation
 * was previously active.
 */
async function restoreAgentState(
  snapshot: AgentSnapshot,
  expectedProjectPath: string,
  isCurrent: () => boolean,
): Promise<void> {
  const store = useAgentStore.getState();
  if (!isCurrent()) return;
  store.clearConversation();
  store.setMode(snapshot.mode);

  if (snapshot.conversationId) {
    try {
      // Check conversation still exists in DB
      const conv = await tauriInvoke('db_get_conversation', {
        conversationId: snapshot.conversationId,
      });
      if (!conv || !isCurrent()) return;
      if (conv.project_id && !areSameProjectPath(conv.project_id, expectedProjectPath)) {
        console.warn(
          '[project-persistence] Ignoring a snapshot conversation owned by another project:',
          snapshot.conversationId,
        );
        return;
      }

      store.setConversationId(snapshot.conversationId);

      // Load messages from DB
      const dbMessages = await tauriInvoke('db_list_messages', {
        conversationId: snapshot.conversationId,
      });

      for (const m of dbMessages) {
        if (!isCurrent()) return;
        if (m.role === 'system') continue;
        const message = mapDatabaseMessage(m);
        if (!message) continue;
        store.addMessage(message);
        if (message.turnSummary) store.hydrateTurnSummary(message.turnSummary);
      }

      // Sync harness bridge if available
      try {
        if (!isCurrent()) return;
        HarnessBridge.get().restoreSession(snapshot.conversationId);
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
 * The caller awaits this so the workspace is not considered ready until the
 * new project's history has either loaded or failed safely.
 */
async function loadSessionsForProject(rootPath: string, isCurrent: () => boolean): Promise<void> {
  const store = useAgentStore.getState();
  if (!isCurrent()) return;
  store.setSessionsLoading(true);
  try {
    const rows = await tauriInvoke('db_list_conversations', { projectId: rootPath });
    if (!isCurrent()) return;
    const mapped = rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: toAgentMode(r.mode),
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
    if (isCurrent()) useAgentStore.getState().setSessionsLoading(false);
  }
}

/**
 * Restore one explicitly selected conversation in the currently active
 * project. This is intentionally separate from snapshot restoration so a
 * VORTEX click always wins over the target project's previously active tab.
 */
export async function restoreProjectConversation(
  conversationId: string,
  expectedProjectPath: string,
): Promise<void> {
  const switchId = projectSwitchGeneration;
  const rootPath = normalizeProjectPath(expectedProjectPath);
  const isCurrent = () =>
    switchId === projectSwitchGeneration &&
    !useProjectStore.getState().isLoading &&
    areSameProjectPath(useProjectStore.getState().rootPath, rootPath);

  if (!isCurrent()) return;

  const conversation = await tauriInvoke('db_get_conversation', { conversationId });
  if (!isCurrent()) return;
  if (!conversation) {
    throw new Error('The selected session is no longer available.');
  }
  if (conversation.project_id && !areSameProjectPath(conversation.project_id, rootPath)) {
    throw new Error('The selected session belongs to a different project.');
  }

  const rows = await tauriInvoke('db_list_messages', { conversationId });
  if (!isCurrent()) return;

  const store = useAgentStore.getState();
  if (store.conversationId === conversationId || store.messages.length === 0) {
    store.clearConversation();
  } else {
    store.openNewTab(toAgentMode(conversation.mode));
  }

  store.setMode(toAgentMode(conversation.mode));
  store.setConversationId(conversationId);
  store.updateTabTitle(store.activeTabId, conversation.title || 'Conversation');

  for (const row of rows) {
    const message = mapDatabaseMessage(row);
    if (!message || !isCurrent()) continue;
    store.addMessage(message);
    if (message.turnSummary) store.hydrateTurnSummary(message.turnSummary);
  }

  try {
    HarnessBridge.get().restoreSession(conversationId);
  } catch {
    // The bridge is initialized after the project coordinator finishes.
  }
  store.setHistoryOpen(false);
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Reset all project-scoped stores to their clean initial state.
 */
export async function clearAllProjectState(
  options: { preserveVortexRuntimes?: boolean } = {},
): Promise<void> {
  const preserveVortexRuntimes =
    options.preserveVortexRuntimes ??
    (useLayoutStore.getState().workspaceMode === 'agent' &&
      vortexSessionRuntimeManager.hasActiveRuntimes());
  vortexSessionRuntimeManager.suspendProjection();
  vortexSessionRuntimeManager.clearFocus();
  HarnessBridge.destroy();
  useLayoutStore.getState().resetProjectState();
  useFileStore.getState().closeFolder();
  useEditorStore.getState().closeAllTabs();
  useAgentStore.getState().resetProjectState();
  useDbViewerStore.getState().reset();
  useDiagnosticsStore.getState().clearAll();
  useGitStore.getState().resetForProjectSwitch();
  useLspStore.getState().clearAll();
  useMemoryStore.getState().resetProjectState();
  useRulesStore.getState().resetProjectState();
  useSchemaDiagramStore.getState().reset();
  useSkillsStore.getState().resetProjectState();

  const ptyIds = preserveVortexRuntimes ? [] : useTerminalStore.getState().clearSessions();
  await Promise.all(
    ptyIds.map((ptyId) => tauriInvoke('pty_kill', { ptyId }).catch(() => undefined)),
  );
}

/**
 * Open a project through the complete desktop lifecycle.
 *
 * The selected project becomes active only after the old project has been
 * persisted, cancelled, and removed from every project-scoped store. All
 * asynchronous work is guarded by a monotonically increasing switch id.
 */
export async function openProjectWorkspace(
  newRootPath: string,
  options: ProjectOpenOptions = {},
): Promise<void> {
  await performProjectOpen(newRootPath, true, options);
}

/**
 * Activate a VORTEX session, switching projects through the canonical
 * lifecycle when necessary and then making the clicked conversation active.
 */
export async function activateVortexSession(
  projectPath: string,
  conversationId: string,
): Promise<void> {
  const targetPath = normalizeProjectPath(projectPath);
  const projectState = useProjectStore.getState();
  if (projectState.isLoading) {
    throw new Error('A project switch is already in progress.');
  }

  if (!areSameProjectPath(projectState.rootPath, targetPath)) {
    await performProjectOpen(targetPath, true, { workspaceMode: 'agent' });
  } else {
    useLayoutStore.getState().setWorkspaceMode('agent');
  }

  await vortexSessionRuntimeManager.focusSession(targetPath, conversationId);
}

/** Restore the persisted project that was present when the app last closed. */
export async function hydrateProjectWorkspace(rootPath: string): Promise<void> {
  await performProjectOpen(rootPath, false);
}

async function performProjectOpen(
  newRootPath: string,
  saveCurrentProject: boolean,
  options: ProjectOpenOptions = {},
): Promise<void> {
  const rootPath = normalizeProjectPath(newRootPath);
  if (!rootPath) throw new Error('Cannot open an empty project path.');

  const switchId = ++projectSwitchGeneration;
  const currentRootPath = useProjectStore.getState().rootPath;
  const previousTerminalVisible = useLayoutStore.getState().terminalVisible;
  const preserveVortexRuntimes =
    useLayoutStore.getState().workspaceMode === 'agent' &&
    vortexSessionRuntimeManager.hasActiveRuntimes();

  if (saveCurrentProject && currentRootPath && !areSameProjectPath(currentRootPath, rootPath)) {
    saveProjectState(currentRootPath);
    saveOpenAgentTabs(currentRootPath);
  }

  useProjectStore.getState().setLoading(true);

  try {
    await clearAllProjectState({ preserveVortexRuntimes });
    if (switchId !== projectSwitchGeneration) return;

    useProjectStore.getState().openProject(rootPath);
    useProjectStore.getState().setLoading(true);

    await tauriInvoke('db_ensure_project', { id: rootPath, path: rootPath }).catch((error) => {
      console.warn('[project-persistence] Failed to register project in the database:', error);
    });
    if (switchId !== projectSwitchGeneration) return;

    const snapshot = loadProjectState(rootPath);
    if (snapshot) {
      restoreEditorState(snapshot.editor);
      if (snapshot.workspaceMode && !options.workspaceMode) {
        useLayoutStore.getState().setWorkspaceMode(snapshot.workspaceMode);
      }
    }
    if (options.workspaceMode) {
      useLayoutStore.getState().setWorkspaceMode(options.workspaceMode);
    }

    await useFileStore.getState().openFolder(rootPath);
    if (!isCurrentProjectSwitch(switchId, rootPath)) return;

    const isCurrent = () => isCurrentProjectSwitch(switchId, rootPath);
    if (snapshot) await restoreAgentState(snapshot.agent, rootPath, isCurrent);
    await loadSessionsForProject(rootPath, isCurrent);
    if (!isCurrent()) return;

    useProjectStore.getState().setLoading(false);
    useLayoutStore.getState().setTerminalVisible(previousTerminalVisible);
    vortexSessionRuntimeManager.resumeProjection();
  } catch (error) {
    if (isCurrentProjectSwitch(switchId, rootPath)) {
      useProjectStore.getState().setLoading(false);
      useLayoutStore.getState().setTerminalVisible(previousTerminalVisible);
    }
    throw error;
  }
}

/** Save current state and clean up for project close. */
export async function closeProjectWorkspace(): Promise<void> {
  const switchId = ++projectSwitchGeneration;
  const rootPath = useProjectStore.getState().rootPath;
  if (rootPath) {
    saveProjectState(rootPath);
    saveOpenAgentTabs(rootPath);
  }

  await clearAllProjectState();
  if (switchId !== projectSwitchGeneration) return;

  useFileStore.getState().closeFolder();
  useProjectStore.getState().closeProject();
  useProjectStore.getState().setLoading(false);
}
