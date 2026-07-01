import {
  Settings,
  MessageSquare,
  Hammer,
  Search,
  Bug,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ArrowRight,
  Zap,
  Server,
  FileText,
  Loader2,
  Shield,
  ShieldOff,
  ShieldCheck,
  HelpCircle,
  Brain,
  Bell,
  SlidersHorizontal,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '../../../stores';
import { useSettingsStore } from '../../../stores/settings-store';
import { useProjectStore } from '../../../stores/project-store';
import { HarnessBridge } from '../../../lib/harness-bridge';
import { McpBridge } from '../../../lib/mcp-bridge';
import { tauriInvoke } from '../../../lib/tauri-invoke';
import { cn } from '../../../lib/utils';
import { BrandMark } from '../../../components/brand-mark';
import { getAllAgentDefinitions, getModePolicy } from '@hyscode/agent-harness';
import type { AgentMode, SessionSummary, ChatMessage } from '../../../stores/agent-store';
import type { ApprovalMode } from '../../../stores/settings-store';

// ─── Constants ──────────────────────────────────────────────────────────────

const MODE_ICONS: Record<AgentMode, typeof MessageSquare> = {
  chat: MessageSquare,
  build: Hammer,
  review: Search,
  debug: Bug,
  plan: ClipboardList,
};

const MODE_COLORS: Record<AgentMode, string> = {
  chat: 'text-blue-400',
  build: 'text-accent',
  review: 'text-purple-400',
  debug: 'text-red-400',
  plan: 'text-amber-400',
};

const APPROVAL_OPTIONS: {
  value: ApprovalMode;
  label: string;
  icon: typeof Shield;
  color?: string;
}[] = [
  { value: 'manual', label: 'Manual', icon: Shield, color: 'text-blue-400' },
  { value: 'smart', label: 'Smart', icon: Brain, color: 'text-cyan-400' },
  { value: 'session-trust', label: 'Trust', icon: ShieldCheck, color: 'text-emerald-400' },
  { value: 'notify', label: 'Notify', icon: Bell, color: 'text-violet-400' },
  { value: 'yolo', label: 'Auto', icon: ShieldOff, color: 'text-amber-400' },
  { value: 'custom', label: 'Custom', icon: SlidersHorizontal, color: 'text-purple-400' },
];

const AGENT_DEFS = getAllAgentDefinitions();

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    // DB not available yet
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
      timestamp: new Date(r.created_at).getTime(),
    }));
    const store = useAgentStore.getState();
    store.clearConversation();
    store.setConversationId(conversationId);
    for (const msg of messages) store.addMessage(msg);
    try {
      HarnessBridge.get().restoreSession(conversationId);
    } catch {
      /* bridge not ready */
    }
    store.setHistoryOpen(false);
  } catch {
    /* failed to load */
  }
}

async function deleteSession(conversationId: string): Promise<void> {
  try {
    await tauriInvoke('db_delete_conversation', { conversationId });
    useAgentStore.getState().deleteSession(conversationId);
    if (useAgentStore.getState().conversationId === conversationId) {
      useAgentStore.getState().clearConversation();
    }
  } catch {
    /* silently fail */
  }
}

function startNewSession(): void {
  const store = useAgentStore.getState();
  store.clearConversation();
  const newId = crypto.randomUUID();
  store.setConversationId(newId);
  try {
    HarnessBridge.get().restoreSession(newId);
  } catch {
    /* bridge not ready */
  }
  store.setHistoryOpen(false);
}

// ─── Collapsible Section ────────────────────────────────────────────────────

function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span>{title}</span>
        {count !== undefined && (
          <span className="ml-auto rounded-full bg-muted px-1.5 text-[9px] tabular-nums">
            {count}
          </span>
        )}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

// ─── Mode Section ───────────────────────────────────────────────────────────

function ModeSection() {
  const currentMode = useAgentStore((s) => s.mode);

  const handleSelect = useCallback((mode: AgentMode) => {
    try {
      HarnessBridge.get().setAgentType(mode);
    } catch {
      useAgentStore.getState().setMode(mode);
    }
  }, []);

  return (
    <Section title="Mode">
      <div className="flex flex-col gap-0.5">
        {AGENT_DEFS.map((agent) => {
          const mode = agent.type as AgentMode;
          const Icon = MODE_ICONS[mode] ?? MessageSquare;
          const color = MODE_COLORS[mode] ?? 'text-accent';
          const isActive = mode === currentMode;
          const policy = getModePolicy(mode);
          const approvalLabel = policy.approvalMode === 'yolo' ? 'auto' : policy.approvalMode;

          return (
            <button
              key={agent.type}
              onClick={() => handleSelect(mode)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                isActive
                  ? 'bg-accent/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? color : '')} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[11px] font-medium leading-tight">{agent.name}</span>
                <span className="truncate text-[9px] text-muted-foreground leading-tight">
                  {agent.description}
                </span>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded px-1 py-px text-[8px] font-medium uppercase',
                  isActive ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground',
                )}
              >
                {approvalLabel}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Sessions Section ───────────────────────────────────────────────────────

function SessionsSection() {
  const sessions = useAgentStore((s) => s.sessions);
  const loading = useAgentStore((s) => s.sessionsLoading);
  const currentId = useAgentStore((s) => s.conversationId);
  const messageCount = useAgentStore((s) => s.messages.length);
  const sessionTokenUsage = useAgentStore((s) => s.sessionTokenUsage);
  const setHistoryOpen = useAgentStore((s) => s.setHistoryOpen);
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const projectId = useProjectStore((s) => s.rootPath ?? undefined);

  useEffect(() => {
    if (projectId) loadSessions(projectId);
  }, [projectId]);

  const recentSessions = useMemo(() => sessions.slice(0, 5), [sessions]);

  return (
    <Section title="Session" count={messageCount}>
      {/* Current session card */}
      <div className="mb-2 rounded-md bg-surface-raised/50 px-2 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-foreground">Current</span>
          <button
            onClick={startNewSession}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Plus className="h-2.5 w-2.5" />
            New
          </button>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground">
          <Zap className="h-2.5 w-2.5 shrink-0" />
          <span>{messageCount} msgs</span>
          {sessionTokenUsage && sessionTokenUsage.totalTokens > 0 && (
            <>
              <span>·</span>
              <span className="tabular-nums">
                {(sessionTokenUsage.totalTokens / 1000).toFixed(1)}k tok
              </span>
            </>
          )}
          {activeModelId && (
            <>
              <span>·</span>
              <span className="truncate">{activeModelId}</span>
            </>
          )}
        </div>
      </div>

      {/* Recent sessions list */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </div>
      ) : recentSessions.length > 0 ? (
        <div className="flex flex-col gap-px">
          {recentSessions.map((session) => {
            const Icon = MODE_ICONS[session.mode] ?? MessageSquare;
            const isActive = session.id === currentId;
            return (
              <div
                key={session.id}
                className={cn(
                  'group flex items-start gap-1.5 rounded-md px-1.5 py-1 transition-colors',
                  isActive
                    ? 'bg-accent/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <Icon className="mt-0.5 h-3 w-3 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[10px] font-medium leading-tight">
                    {session.title}
                  </span>
                  <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                    <span>{session.messageCount} msgs</span>
                    <span>·</span>
                    <span>{relativeTime(session.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {!isActive && (
                    <button
                      onClick={() => restoreSession(session.id)}
                      title="Restore"
                      className="rounded p-0.5 hover:bg-muted hover:text-accent"
                    >
                      <ArrowRight className="h-2.5 w-2.5" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                    title="Delete"
                    className="rounded p-0.5 hover:bg-muted hover:text-red-400"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            );
          })}
          {sessions.length > 5 && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="mt-1 text-[9px] text-accent hover:underline text-left px-1.5"
            >
              View all {sessions.length} sessions →
            </button>
          )}
        </div>
      ) : (
        <p className="text-[9px] text-muted-foreground opacity-50 px-1">No previous sessions</p>
      )}
    </Section>
  );
}

// ─── Context Files Section ──────────────────────────────────────────────────

function ContextFilesSection() {
  const contextFiles = useAgentStore((s) => s.contextFiles);
  const removeContextFile = useAgentStore((s) => s.removeContextFile);

  return (
    <Section title="Context Files" count={contextFiles.length}>
      {contextFiles.length === 0 ? (
        <p className="text-[9px] text-muted-foreground opacity-50">
          Drag files here or use @ in chat
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {contextFiles.map((file) => {
            const name = file.split(/[\\/]/).pop() ?? file;
            return (
              <div
                key={file}
                className="group flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] hover:bg-muted"
                title={file}
              >
                <FileText className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-foreground">{name}</span>
                <button
                  onClick={() => removeContextFile(file)}
                  className="ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground text-[10px]"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ─── Quick Settings Section ─────────────────────────────────────────────────

function QuickSettingsSection() {
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const approvalMode = useSettingsStore((s) => s.approvalMode);
  const temperature = useSettingsStore((s) => s.temperature);
  const interactionLimitEnabled = useSettingsStore((s) => s.interactionLimitEnabled);
  const maxIterations = useSettingsStore((s) => s.maxIterations);
  const setSetting = useSettingsStore((s) => s.set);
  const openSettings = useSettingsStore((s) => s.openSettings);

  return (
    <Section title="Settings" defaultOpen={false}>
      {/* Provider / Model */}
      <div className="mb-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground">Provider / Model</span>
          <button onClick={openSettings} className="text-[9px] text-accent hover:underline">
            Change
          </button>
        </div>
        <span className="block truncate text-[10px] text-foreground mt-0.5">
          {activeProviderId ?? 'None'}
          {activeModelId ? ` · ${activeModelId}` : ''}
        </span>
      </div>

      {/* Approval Mode */}
      <div className="mb-2">
        <span className="text-[9px] text-muted-foreground block mb-1">Approval</span>
        <div className="grid grid-cols-3 gap-0.5">
          {APPROVAL_OPTIONS.map(({ value, label, icon: Icon, color }) => (
            <button
              key={value}
              onClick={() => setSetting('approvalMode', value)}
              className={cn(
                'flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-medium transition-colors',
                approvalMode === value
                  ? `bg-accent/15 ${color ?? 'text-accent'}`
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-2.5 w-2.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Temperature */}
      <div className="mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">Temperature</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button className="text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
                }
              >
                <HelpCircle className="h-2.5 w-2.5" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[180px]">
                <p className="text-[10px] leading-relaxed">
                  Controls how creative or predictable the AI responses are.
                  <br />
                  <br />
                  <span className="text-muted-foreground">0.0</span> = deterministic ·{' '}
                  <span className="text-muted-foreground">1.0</span> = balanced ·{' '}
                  <span className="text-muted-foreground">2.0</span> = very creative
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <span className="text-[9px] tabular-nums text-foreground">{temperature.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          onChange={(e) => setSetting('temperature', parseFloat(e.target.value))}
          className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-muted accent-accent [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
        />
      </div>

      {/* Interaction limit */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground">Interaction Limit</span>
          <button
            onClick={openSettings}
            className="rounded bg-muted px-1.5 py-px text-[9px] tabular-nums text-foreground transition-colors hover:text-accent"
            title="Configure interaction limit in Settings"
          >
            {interactionLimitEnabled ? maxIterations : 'Infinite'}
          </button>
        </div>
      </div>
    </Section>
  );
}

// ─── MCP Status Section ─────────────────────────────────────────────────────

function McpStatusSection() {
  const mcpServers = useSettingsStore((s) => s.mcpServers);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);

  const enabledServers = useMemo(() => mcpServers.filter((s) => s.enabled), [mcpServers]);

  useEffect(() => {
    try {
      const ids = McpBridge.get().getConnectedServerIds();
      setConnectedIds(ids);
    } catch {
      // McpBridge not initialized
    }
  }, [enabledServers.length]);

  return (
    <Section title="MCP Servers" count={enabledServers.length} defaultOpen={false}>
      {enabledServers.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-2">
          <Server className="h-4 w-4 text-muted-foreground/30" />
          <p className="text-[9px] text-muted-foreground opacity-50">No servers configured</p>
          <button onClick={openSettings} className="text-[9px] text-accent hover:underline">
            Configure in Settings
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {enabledServers.map((server) => {
            const isConnected = connectedIds.includes(server.id);
            return (
              <div
                key={server.id}
                className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-[10px]"
              >
                <div
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    isConnected ? 'bg-green-400' : 'bg-muted-foreground/30',
                  )}
                />
                <span className="truncate text-foreground">{server.name}</span>
                <span className="ml-auto shrink-0 rounded bg-muted px-1 py-px text-[8px] text-muted-foreground uppercase">
                  {server.transport}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ─── Main View ──────────────────────────────────────────────────────────────

export function AgentSidebarView() {
  const mode = useAgentStore((s) => s.mode);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const modeColor = MODE_COLORS[mode] ?? 'text-accent';
  const ModeIcon = MODE_ICONS[mode] ?? MessageSquare;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/30">
        <BrandMark className="h-3.5 w-3.5 rounded-sm" alt="HysCode" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Agent
        </span>
        <span
          className={cn(
            'ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium',
            modeColor,
            'bg-current/10',
          )}
          style={{ backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)' }}
        >
          <ModeIcon className="h-2.5 w-2.5" />
          {mode}
        </span>
        <button
          onClick={openSettings}
          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Open Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-auto">
        <ModeSection />
        <SessionsSection />
        <ContextFilesSection />
        <QuickSettingsSection />
        <McpStatusSection />
      </div>
    </div>
  );
}
