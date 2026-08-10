import {
  Activity,
  AlertCircle,
  Bot,
  Database,
  FileCode2,
  Layers,
  MessageSquare,
  RefreshCw,
  User,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { getProviderRegistry } from '@hyscode/ai-providers';
import {
  CONTEXT_CATEGORY_KEYS,
  CONTEXT_CATEGORY_META,
  buildContextInspectorViewModel,
  formatCost,
  formatDateTime,
  formatRate,
  formatTokenCount,
  type ContextInspectorViewModel,
  type PersistedConversation,
  type PersistedSessionUsage,
  type PersistedTraceRow,
} from '@/lib/context-inspector';
import { resolveContextWindow } from '@/lib/context-window';
import { tauriInvoke } from '@/lib/tauri-invoke';
import { useAgentStore } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { cn } from '@/lib/utils';

type Icon = ComponentType<{ className?: string }>;

interface RemoteState {
  conversationId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  conversation: PersistedConversation | null;
  usage: PersistedSessionUsage | null;
  traces: PersistedTraceRow[];
  error: string | null;
}

const EMPTY_REMOTE: RemoteState = {
  conversationId: null,
  status: 'idle',
  conversation: null,
  usage: null,
  traces: [],
  error: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Section({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: Icon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border/40 bg-card p-3 shadow-sm', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: Icon;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/35 bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate font-mono text-[14px] font-medium tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[9px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function DetailRow({ label, value, primary = false }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/20 py-1.5 last:border-b-0">
      <span className="truncate text-[10px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          'shrink-0 font-mono text-[11px] tabular-nums',
          primary ? 'font-semibold text-primary' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="h-full overflow-y-auto bg-surface px-3 py-3">
      <div className="space-y-3" aria-label="Loading context information">
        <div className="space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-24 animate-pulse rounded-lg border border-border/30 bg-card" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-lg border border-border/30 bg-card" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-lg border border-border/30 bg-card" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card/50 px-4 py-6 text-center">
      <Layers className="mx-auto h-5 w-5 text-muted-foreground/70" />
      <p className="mt-2 text-[11px] font-medium text-foreground">No context data yet</p>
      <p className="mx-auto mt-1 max-w-[28ch] text-[10px] leading-relaxed text-muted-foreground">
        Start a conversation to populate token, cache, cost, and context composition details.
      </p>
    </div>
  );
}

function ContextUsageCard({ view }: { view: ContextInspectorViewModel }) {
  const percentage = view.contextUsage.percentage;
  const hasPercentage = percentage !== null;
  const safePercentage = hasPercentage ? Math.max(0, percentage) : 0;
  const sourceLabel =
    view.contextUsage.source === 'live'
      ? 'Live usage'
      : view.contextUsage.source === 'trace'
        ? 'Harness snapshot'
        : view.contextUsage.source === 'usage'
          ? 'Recorded usage'
          : 'Not available';
  const barColor =
    safePercentage > 0.8 ? 'bg-error' : safePercentage > 0.6 ? 'bg-warning' : 'bg-primary';

  return (
    <section className="rounded-lg border border-border/40 bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium text-muted-foreground">Context</div>
          <div className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-foreground">
            {formatTokenCount(view.contextUsage.tokens)}
            <span className="px-1 text-muted-foreground/60">/</span>
            {formatTokenCount(view.contextWindow)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[14px] font-semibold tabular-nums text-primary">
            {hasPercentage ? `${Math.round(safePercentage * 100)}%` : 'Not available'}
          </div>
          <div className="mt-1 text-[9px] text-muted-foreground">{sourceLabel}</div>
        </div>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Context window usage"
        aria-valuemin={hasPercentage ? 0 : undefined}
        aria-valuemax={hasPercentage ? 100 : undefined}
        aria-valuenow={hasPercentage ? Math.min(safePercentage * 100, 100) : undefined}
      >
        <div
          className={cn('h-full rounded-full', barColor)}
          style={{ width: `${Math.min(safePercentage * 100, 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground">
        <span>{view.status}</span>
        <span>{view.contextWindow !== null ? `${formatTokenCount(view.contextWindow)} token limit` : 'Model limit unavailable'}</span>
      </div>
    </section>
  );
}

function UsageDetails({ usage }: { usage: ContextInspectorViewModel['latestTurn'] | ContextInspectorViewModel['sessionTotals'] }) {
  return (
    <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
      <div>
        <DetailRow label="Input" value={formatTokenCount(usage.inputTokens)} />
        <DetailRow label="Output" value={formatTokenCount(usage.outputTokens)} />
        <DetailRow label="Total" value={formatTokenCount(usage.totalTokens)} primary />
        <DetailRow label="Reasoning" value={formatTokenCount(usage.reasoningTokens)} />
      </div>
      <div>
        <DetailRow label="Cache read" value={formatTokenCount(usage.cacheReadTokens)} />
        <DetailRow label="Cache write" value={formatTokenCount(usage.cacheWriteTokens)} />
        <DetailRow label="Cache hit" value={formatRate(usage.cacheHitRate)} />
        <DetailRow label="Requests" value={formatTokenCount(usage.requestCount)} />
      </div>
      <div className="sm:col-span-2">
        <DetailRow
          label="Cost"
          value={`${formatCost(usage.costUsd)}${usage.costEstimated && usage.costUsd !== null ? ' · estimated' : ''}`}
          primary
        />
        <DetailRow label="Duration" value={formatDuration(usage.durationMs)} />
      </div>
    </div>
  );
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return 'Not available';
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`;
}

function ContextComposition({ view }: { view: ContextInspectorViewModel }) {
  const breakdown = view.contextComposition.breakdown;
  if (!breakdown) {
    return <p className="text-[10px] text-muted-foreground">No recorded context snapshot for this turn.</p>;
  }

  const segments = CONTEXT_CATEGORY_KEYS.filter((category) => breakdown[category] > 0);
  const total = breakdown.total > 0 ? breakdown.total : 1;

  return (
    <>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-label="Context composition">
        {segments.map((category) => (
          <div
            key={category}
            className={CONTEXT_CATEGORY_META[category].color}
            style={{ width: `${Math.min((breakdown[category] / total) * 100, 100)}%` }}
            title={`${CONTEXT_CATEGORY_META[category].label}: ${formatTokenCount(breakdown[category])}`}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {CONTEXT_CATEGORY_KEYS.map((category) => (
          <div key={category} className="flex min-w-0 items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', CONTEXT_CATEGORY_META[category].color)} />
            <span className="truncate text-[9px] text-muted-foreground">
              {CONTEXT_CATEGORY_META[category].label}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-foreground">
              {formatTokenCount(breakdown[category])}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/30 pt-2">
        <DetailRow label="Total" value={formatTokenCount(breakdown.total)} primary />
        <DetailRow label="Dropped" value={formatTokenCount(breakdown.dropped)} />
        <DetailRow label="Deduplicated" value={formatTokenCount(breakdown.deduplicated)} />
      </div>
      {view.contextComposition.entries.length > 0 && (
        <div className="mt-3 border-t border-border/30 pt-2">
          <div className="mb-1.5 flex items-center justify-between text-[9px] text-muted-foreground">
            <span>Context entries</span>
            <span className="font-mono tabular-nums">Iteration {view.contextComposition.iterationNumber ?? 'Not available'}</span>
          </div>
          <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
            {view.contextComposition.entries.map((entry) => (
              <div key={`${entry.id}:${entry.category}`} className="flex items-center gap-2 text-[9px]">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', entry.included ? 'bg-success' : 'bg-muted-foreground/50')} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={entry.id}>
                  {entry.id}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-foreground">
                  {formatTokenCount(entry.tokens)}
                </span>
                {!entry.included && <span className="shrink-0 text-error">{entry.reason ?? 'excluded'}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AttachedContext({ view }: { view: ContextInspectorViewModel }) {
  return (
    <Section title="Attached context" icon={FileCode2}>
      <div className="grid grid-cols-2 gap-x-4">
        <DetailRow label="Workspace files" value={String(view.attachedContext.files)} />
        <DetailRow label="Gathered entries" value={String(view.attachedContext.gatheredEntries)} />
        <DetailRow label="Gathered tokens" value={formatTokenCount(view.attachedContext.gatheredTokens)} />
        <DetailRow label="Images" value={String(view.attachedContext.images)} />
        <DetailRow label="Terminal" value={view.attachedContext.terminal ? 'Attached' : 'Not attached'} />
      </div>
    </Section>
  );
}

export function ContextTab() {
  const conversationId = useAgentStore((state) => state.conversationId);
  const activeTabId = useAgentStore((state) => state.activeTabId);
  const openTabs = useAgentStore((state) => state.openTabs);
  const messages = useAgentStore((state) => state.messages);
  const isStreaming = useAgentStore((state) => state.isStreaming);
  const liveUsage = useAgentStore((state) => state.tokenUsage);
  const liveSessionUsage = useAgentStore((state) => state.sessionTokenUsage);
  const apiRequestCount = useAgentStore((state) => state.apiRequestCount);
  const pendingToolCallCount = useAgentStore((state) => state.pendingToolCalls.length);
  const contextFiles = useAgentStore((state) => state.contextFiles);
  const gatheredContext = useAgentStore((state) => state.gatheredContext);
  const attachedImageCount = useAgentStore((state) => state.attachedImages.length);
  const hasAttachedTerminal = useAgentStore((state) => state.attachedTerminal !== null);
  const activeProviderId = useSettingsStore((state) => state.activeProviderId);
  const activeModelId = useSettingsStore((state) => state.activeModelId);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [remote, setRemote] = useState<RemoteState>(EMPTY_REMOTE);

  useEffect(() => {
    let cancelled = false;
    if (!conversationId) {
      setRemote(EMPTY_REMOTE);
      return () => {
        cancelled = true;
      };
    }

    setRemote((current) => ({
      conversationId,
      status: 'loading',
      conversation: current.conversationId === conversationId ? current.conversation : null,
      usage: current.conversationId === conversationId ? current.usage : null,
      traces: current.conversationId === conversationId ? current.traces : [],
      error: null,
    }));

    void Promise.all([
      tauriInvoke('db_get_conversation', { conversationId }),
      tauriInvoke('db_get_conversation_token_usage', { conversationId }),
      tauriInvoke('db_list_traces', { conversationId }),
    ])
      .then(([conversation, usage, traces]) => {
        if (cancelled) return;
        setRemote({
          conversationId,
          status: 'ready',
          conversation,
          usage,
          traces,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRemote({
          conversationId,
          status: 'error',
          conversation: null,
          usage: null,
          traces: [],
          error: errorMessage(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, isStreaming, reloadNonce]);

  const activeRemote = remote.conversationId === conversationId ? remote : EMPTY_REMOTE;
  const fallbackTitle = openTabs.find((tab) => tab.id === activeTabId)?.title ?? null;
  const resolvedProviderId = activeRemote.conversation?.provider_id ?? activeProviderId;
  const resolvedModelId = activeRemote.conversation?.model_id ?? activeModelId;

  const providerAndModel = useMemo(() => {
    const registry = getProviderRegistry();
    const provider = resolvedProviderId
      ? registry.get(resolvedProviderId) ??
        (resolvedModelId
          ? registry.list().find((candidate) => candidate.models.some((model) => model.id === resolvedModelId))
          : undefined)
      : undefined;
    const model = provider?.models.find((candidate) => candidate.id === resolvedModelId) ?? null;
    return { provider, model };
  }, [resolvedModelId, resolvedProviderId]);

  const contextWindow = resolveContextWindow(providerAndModel.model, resolvedModelId ?? undefined);
  const view = useMemo(
    () =>
      buildContextInspectorViewModel({
        conversation: activeRemote.conversation,
        persistedUsage: activeRemote.usage,
        traces: activeRemote.traces,
        messages,
        liveUsage,
        liveSessionUsage,
        model: providerAndModel.model,
        providerName: providerAndModel.provider?.name ?? resolvedProviderId,
        contextWindow,
        fallbackTitle,
        isStreaming,
        apiRequestCount,
        pendingToolCallCount,
        contextFiles,
        gatheredContext,
        attachedImageCount,
        hasAttachedTerminal,
      }),
    [
      activeRemote,
      apiRequestCount,
      attachedImageCount,
      contextFiles,
      contextWindow,
      fallbackTitle,
      gatheredContext,
      hasAttachedTerminal,
      isStreaming,
      liveSessionUsage,
      liveUsage,
      messages,
      pendingToolCallCount,
      providerAndModel,
      resolvedProviderId,
    ],
  );

  const hasLiveData = messages.length > 0 || liveUsage !== null || liveSessionUsage !== null;
  if (activeRemote.status === 'loading' && !activeRemote.conversation && !hasLiveData) {
    return <LoadingState />;
  }

  return (
    <div className="h-full overflow-y-auto bg-surface px-3 py-3">
      <div className="space-y-3 pb-3">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold text-foreground">{view.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className="truncate">{view.provider ?? 'Not available'}</span>
              <span aria-hidden="true">/</span>
              <span className="truncate">{view.model ?? 'Not available'}</span>
              {view.updatedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatDateTime(view.updatedAt)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[9px] text-muted-foreground">
            <span className={cn('h-1.5 w-1.5 rounded-full', view.status === 'Streaming' ? 'animate-pulse bg-primary' : 'bg-success')} />
            {view.status}
          </div>
        </header>

        {activeRemote.status === 'error' && (
          <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[10px] text-error">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>Context data could not be loaded.</p>
              <p className="mt-0.5 break-words text-error/80">{activeRemote.error ?? 'Unknown error'}</p>
            </div>
            <button
              type="button"
              onClick={() => setReloadNonce((value) => value + 1)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-error transition-colors hover:bg-error/10 active:scale-[0.98]"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        <ContextUsageCard view={view} />

        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Messages" value={String(view.messages.total)} detail={`${view.messages.user} user · ${view.messages.assistant} assistant`} icon={MessageSquare} />
          <MetricCard label="User" value={String(view.messages.user)} detail="User messages" icon={User} />
          <MetricCard label="Assistant" value={String(view.messages.assistant)} detail="Assistant messages" icon={Bot} />
          <MetricCard label="Tool calls" value={String(view.messages.toolCalls)} detail="Recorded and pending" icon={Wrench} />
          <MetricCard label="Requests" value={formatTokenCount(view.latestTurn.requestCount)} detail="Latest assistant turn" icon={Activity} />
          <MetricCard label="Cost" value={formatCost(view.latestTurn.costUsd)} detail={view.latestTurn.costEstimated ? 'Estimated from model pricing' : 'Reported by provider'} icon={Database} />
        </div>

        <Section title="Latest assistant turn" icon={Bot}>
          <UsageDetails usage={view.latestTurn} />
        </Section>

        <Section title="Session totals" icon={Database}>
          <UsageDetails usage={view.sessionTotals} />
        </Section>

        <Section title="Context composition" icon={Layers}>
          <ContextComposition view={view} />
        </Section>

        <AttachedContext view={view} />

        {!hasLiveData && !activeRemote.conversation && <EmptyState />}
      </div>
    </div>
  );
}
