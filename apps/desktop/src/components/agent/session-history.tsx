import { useEffect } from 'react';
import {
  History,
  MessageSquare,
  Hammer,
  Search,
  Bug,
  ClipboardList,
  Trash2,
  ArrowRight,
  Loader2,
  Plus,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agent-store';
import { useProjectStore } from '@/stores/project-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { tauriInvoke } from '@/lib/tauri-invoke';
import { cn } from '@/lib/utils';
import type { AgentMode, SessionSummary, ChatMessage } from '@/stores/agent-store';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MODE_ICONS: Record<AgentMode, typeof MessageSquare> = {
  chat: MessageSquare,
  build: Hammer,
  review: Search,
  debug: Bug,
  plan: ClipboardList,
};

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SessionHistory() {
  const sessions = useAgentStore((s) => s.sessions);
  const loading = useAgentStore((s) => s.sessionsLoading);
  const currentConversationId = useAgentStore((s) => s.conversationId);
  const projectId = useProjectStore((s) => s.rootPath ?? undefined);

  useEffect(() => {
    if (!projectId) return;
    loadSessions(projectId);
  }, [projectId]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">Session History</span>
        <span className="text-[10px] text-muted-foreground">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={startNewSession}
          title="New session"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <History className="mb-2 h-6 w-6 opacity-30" />
            <span className="text-[11px]">No previous sessions</span>
          </div>
        ) : (
          <div className="flex flex-col gap-px p-1">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === currentConversationId}
                onRestore={() => restoreSession(session.id)}
                onDelete={() => deleteSession(session.id, projectId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Session Row ────────────────────────────────────────────────────────────

function SessionRow({
  session,
  isActive,
  onRestore,
  onDelete,
}: {
  session: SessionSummary;
  isActive: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const Icon = MODE_ICONS[session.mode] ?? MessageSquare;

  return (
    <div
      className={cn(
        'group flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors',
        isActive
          ? 'bg-accent/10 text-foreground'
          : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground',
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] font-medium">{session.title}</span>
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          <span>{session.messageCount} msgs</span>
          <span>·</span>
          <span>{session.mode}</span>
          <span>·</span>
          <span>{relativeTime(session.updatedAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {!isActive && (
          <button
            onClick={onRestore}
            title="Restore session"
            className="rounded p-1 hover:bg-muted hover:text-accent"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete session"
          className="rounded p-1 hover:bg-muted hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Data operations ────────────────────────────────────────────────────────

async function loadSessions(projectId: string): Promise<void> {
  useAgentStore.getState().setSessionsLoading(true);
  try {
    const rows = await tauriInvoke('db_list_conversations', { projectId });
    const mapped: SessionSummary[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: (r.mode as AgentMode) || 'chat',
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

async function restoreSession(conversationId: string): Promise<void> {
  try {
    const rows = await tauriInvoke('db_list_messages', { conversationId });
    const messages: ChatMessage[] = rows.map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      blocks: r.blocks ? JSON.parse(r.blocks) : undefined,
      turnSummary: r.turn_summary ? JSON.parse(r.turn_summary) : undefined,
      timestamp: new Date(r.created_at).getTime(),
    }));

    const store = useAgentStore.getState();

    // If current tab has messages, open the session in a new tab
    if (store.messages.length > 0) {
      store.openNewTab();
    } else {
      store.clearConversation();
    }

    store.setConversationId(conversationId);
    for (const msg of messages) {
      store.addMessage(msg);
      if (msg.turnSummary) store.hydrateTurnSummary(msg.turnSummary);
    }

    // Update the active tab title to first user message snippet
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      const snippet = firstUserMsg.content.slice(0, 40);
      store.updateTabTitle(store.activeTabId, snippet);
    }

    // Sync the Harness's internal conversationId so subsequent messages
    // are persisted under the correct session.
    try {
      HarnessBridge.get().restoreSession(conversationId);
    } catch {
      // Bridge not yet initialized — the conversationId set in the store
      // will be picked up when the bridge is next initialized.
    }

    store.setHistoryOpen(false);
  } catch {
    // Failed to load messages
  }
}

async function deleteSession(conversationId: string, _projectId?: string): Promise<void> {
  try {
    await tauriInvoke('db_delete_conversation', { conversationId });
    useAgentStore.getState().deleteSession(conversationId);
    // If deleted the active session, clear conversation
    if (useAgentStore.getState().conversationId === conversationId) {
      useAgentStore.getState().clearConversation();
    }
  } catch {
    // Silently fail
  }
}

function startNewSession(): void {
  const store = useAgentStore.getState();
  // If current tab already empty, just reset its conversationId
  if (store.messages.length === 0) {
    const newId = crypto.randomUUID();
    store.setConversationId(newId);
    try {
      HarnessBridge.get().restoreSession(newId);
    } catch {
      // Bridge not yet ready
    }
  } else {
    // Open a new tab so the user can start fresh without losing current context
    store.openNewTab();
  }
  store.setHistoryOpen(false);
}
