import type { AIModel, TokenUsage } from '@hyscode/ai-providers';
import type { ChatMessage } from '@/stores/agent-store';
import { getContextUsageMetrics } from './token-usage';

export const CONTEXT_CATEGORY_KEYS = [
  'system',
  'tools',
  'currentTurn',
  'activeToolFrame',
  'recentHistory',
  'explicit',
  'memory',
  'environment',
  'automatic',
] as const;

export type ContextCategory = (typeof CONTEXT_CATEGORY_KEYS)[number];

export interface ContextTokenBreakdown {
  system: number;
  tools: number;
  currentTurn: number;
  activeToolFrame: number;
  recentHistory: number;
  explicit: number;
  memory: number;
  environment: number;
  automatic: number;
  total: number;
  dropped: number;
  deduplicated: number;
}

export interface ContextEntryDecision {
  id: string;
  category: ContextCategory;
  tokens: number;
  included: boolean;
  reason?: 'budget' | 'duplicate' | 'expired' | 'superseded';
}

export const CONTEXT_CATEGORY_META: Record<ContextCategory, { label: string; color: string }> = {
  system: { label: 'System', color: 'bg-primary' },
  tools: { label: 'Tools', color: 'bg-success' },
  currentTurn: { label: 'Current turn', color: 'bg-warning' },
  activeToolFrame: { label: 'Active tool frame', color: 'bg-error' },
  recentHistory: { label: 'Recent history', color: 'bg-primary/70' },
  explicit: { label: 'Explicit context', color: 'bg-success/70' },
  memory: { label: 'Memory', color: 'bg-warning/70' },
  environment: { label: 'Environment', color: 'bg-error/70' },
  automatic: { label: 'Automatic context', color: 'bg-muted-foreground' },
};

export interface PersistedConversation {
  id: string;
  title: string;
  mode: string;
  model_id: string | null;
  provider_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersistedSessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheMeasuredReadTokens: number;
  cacheEligibleTokens: number;
  cacheMeasuredEligibleTokens: number;
  cacheHitRequests: number;
  cacheObservedRequests: number;
  cacheTotalRequests: number;
  cacheUnknownRequests: number;
  cacheHitRate: number | null;
  cacheInputReadRatio: number | null;
  cacheRequestHitRate: number | null;
  cacheUnknownRate: number | null;
}

export interface PersistedTraceRow {
  id: string;
  conversation_id: string;
  mode: string;
  provider: string;
  model: string;
  system_prompt_hash: string | null;
  iterations: string;
  token_input: number;
  token_output: number;
  token_cache_read: number;
  token_cache_write: number;
  token_cache_measured_read: number;
  token_cache_eligible: number;
  token_cache_measured: number;
  token_cache_hit_requests: number;
  token_cache_observed_requests: number;
  token_cache_total_requests: number;
  token_cache_unknown_requests: number;
  stop_reason: string;
  verification_performed: boolean;
  verification_forced: boolean;
  files_modified: string | null;
  errors: string | null;
  loop_warnings: string | null;
  duration_ms: number;
  created_at: string;
  parent_turn_id: string | null;
}

interface ParsedContextSnapshot {
  tokenBreakdown: ContextTokenBreakdown;
  entries: ContextEntryDecision[];
  toolCount: number;
}

interface ParsedTraceIteration {
  number: number;
  durationMs: number;
  toolCallCount: number;
  context: ParsedContextSnapshot | null;
}

export interface InspectorUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cacheHitRate: number | null;
  requestCount: number | null;
  durationMs: number | null;
  costUsd: number | null;
  costEstimated: boolean;
}

export type ContextUsageSource = 'live' | 'usage' | 'trace' | 'none';

export interface ContextInspectorViewModel {
  title: string;
  provider: string | null;
  model: string | null;
  mode: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  status: 'Streaming' | 'Ready' | 'No active session';
  contextWindow: number | null;
  contextUsage: {
    tokens: number | null;
    percentage: number | null;
    source: ContextUsageSource;
  };
  messages: {
    total: number;
    user: number;
    assistant: number;
    toolCalls: number;
  };
  latestTurn: InspectorUsage & { source: ContextUsageSource };
  sessionTotals: InspectorUsage;
  contextComposition: {
    breakdown: ContextTokenBreakdown | null;
    entries: ContextEntryDecision[];
    iterationNumber: number | null;
    toolCount: number | null;
  };
  attachedContext: {
    files: number;
    gatheredEntries: number;
    gatheredTokens: number;
    images: number;
    terminal: boolean;
  };
}

export interface BuildContextInspectorInput {
  conversation: PersistedConversation | null;
  persistedUsage: PersistedSessionUsage | null;
  traces: PersistedTraceRow[];
  messages: ChatMessage[];
  liveUsage: TokenUsage | null;
  liveSessionUsage: TokenUsage | null;
  model: AIModel | null;
  providerName: string | null;
  contextWindow: number | null;
  fallbackTitle: string | null;
  isStreaming: boolean;
  apiRequestCount: number;
  pendingToolCallCount: number;
  contextFiles: string[];
  gatheredContext: Array<{ tokenEstimate: number }>;
  attachedImageCount: number;
  hasAttachedTerminal: boolean;
}

const OPTIONAL_USAGE_KEYS = [
  'requestCount',
  'lastInputTokens',
  'lastEffectiveInputTokens',
  'peakInputTokens',
  'peakEffectiveInputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'cacheMeasuredReadTokens',
  'cacheEligibleTokens',
  'cacheMeasuredEligibleTokens',
  'cacheHitRequests',
  'cacheObservedRequests',
  'cacheTotalRequests',
  'cacheUnknownRequests',
  'cacheHitRate',
  'cacheInputReadRatio',
  'cacheRequestHitRate',
  'cacheUnknownRate',
  'reasoningTokens',
  'retryCount',
  'estimatedCostUsd',
  'possibleDuplicateCharge',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseBreakdown(value: unknown): ContextTokenBreakdown | null {
  const record = asRecord(value);
  if (!record) return null;

  const values = [...CONTEXT_CATEGORY_KEYS, 'total', 'dropped', 'deduplicated'].map((key) => [
    key,
    finiteNumber(record[key]),
  ] as const);
  if (values.some(([, number]) => number === null)) return null;

  return {
    system: values[0][1]!,
    tools: values[1][1]!,
    currentTurn: values[2][1]!,
    activeToolFrame: values[3][1]!,
    recentHistory: values[4][1]!,
    explicit: values[5][1]!,
    memory: values[6][1]!,
    environment: values[7][1]!,
    automatic: values[8][1]!,
    total: values[9][1]!,
    dropped: values[10][1]!,
    deduplicated: values[11][1]!,
  };
}

function isContextCategory(value: unknown): value is ContextCategory {
  return typeof value === 'string' && CONTEXT_CATEGORY_KEYS.includes(value as ContextCategory);
}

function parseEntries(value: unknown): ContextEntryDecision[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const tokens = finiteNumber(record?.tokens);
    if (!record || typeof record.id !== 'string' || !isContextCategory(record.category)) return [];
    if (tokens === null || typeof record.included !== 'boolean') return [];
    const reason = record.reason;
    const validReason =
      reason === 'budget' ||
      reason === 'duplicate' ||
      reason === 'expired' ||
      reason === 'superseded';
    return [
      {
        id: record.id,
        category: record.category,
        tokens,
        included: record.included,
        ...(validReason ? { reason } : {}),
      },
    ];
  });
}

export function parseTraceIterations(raw: string): ParsedTraceIteration[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((iteration) => {
      const record = asRecord(iteration);
      if (!record) return [];
      const contextRecord = asRecord(record.context);
      const breakdown = parseBreakdown(contextRecord?.tokenBreakdown);
      const toolCount = finiteNumber(contextRecord?.toolCount);
      const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls.length : 0;
      const context =
        breakdown && toolCount !== null
          ? {
              tokenBreakdown: breakdown,
              entries: parseEntries(contextRecord?.entries),
              toolCount,
            }
          : null;

      return [
        {
          number: finiteNumber(record.number) ?? 0,
          durationMs: finiteNumber(record.durationMs) ?? 0,
          toolCallCount: toolCalls,
          context,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function selectLatestMainTrace(traces: PersistedTraceRow[]): PersistedTraceRow | null {
  return traces.find((trace) => trace.parent_turn_id === null) ?? traces[0] ?? null;
}

function mapPersistedUsage(usage: PersistedSessionUsage | null): TokenUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheMeasuredReadTokens: usage.cacheMeasuredReadTokens,
    cacheEligibleTokens: usage.cacheEligibleTokens,
    cacheMeasuredEligibleTokens: usage.cacheMeasuredEligibleTokens,
    cacheHitRequests: usage.cacheHitRequests,
    cacheObservedRequests: usage.cacheObservedRequests,
    cacheTotalRequests: usage.cacheTotalRequests,
    cacheUnknownRequests: usage.cacheUnknownRequests,
    ...(usage.cacheHitRate !== null ? { cacheHitRate: usage.cacheHitRate } : {}),
    ...(usage.cacheInputReadRatio !== null
      ? { cacheInputReadRatio: usage.cacheInputReadRatio }
      : {}),
    ...(usage.cacheRequestHitRate !== null
      ? { cacheRequestHitRate: usage.cacheRequestHitRate }
      : {}),
    ...(usage.cacheUnknownRate !== null ? { cacheUnknownRate: usage.cacheUnknownRate } : {}),
  };
}

function mapTraceUsage(trace: PersistedTraceRow): TokenUsage {
  return {
    inputTokens: trace.token_input,
    outputTokens: trace.token_output,
    totalTokens: trace.token_input + trace.token_output,
    cacheReadTokens: trace.token_cache_read,
    cacheWriteTokens: trace.token_cache_write,
    cacheMeasuredReadTokens: trace.token_cache_measured_read,
    cacheEligibleTokens: trace.token_cache_eligible,
    cacheMeasuredEligibleTokens: trace.token_cache_measured,
    cacheHitRequests: trace.token_cache_hit_requests,
    cacheObservedRequests: trace.token_cache_observed_requests,
    cacheTotalRequests: trace.token_cache_total_requests,
    cacheUnknownRequests: trace.token_cache_unknown_requests,
    ...(trace.token_cache_measured > 0
      ? { cacheHitRate: trace.token_cache_measured_read / trace.token_cache_measured }
      : {}),
  };
}

function mergeUsage(primary: TokenUsage, fallback: TokenUsage | null): TokenUsage {
  if (!fallback) return primary;
  const merged = { ...primary } as TokenUsage;
  for (const key of OPTIONAL_USAGE_KEYS) {
    if (primary[key] === undefined && fallback[key] !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = fallback[key];
    }
  }
  return merged;
}

function estimateCost(usage: TokenUsage | null, model: AIModel | null): number | null {
  if (!usage) return null;
  if (usage.estimatedCostUsd !== undefined && Number.isFinite(usage.estimatedCostUsd)) {
    return usage.estimatedCostUsd;
  }
  if (model?.inputPricePerMToken == null || model.outputPricePerMToken == null) return null;

  const inputTokens = Math.max(usage.inputTokens, 0);
  const cacheReadTokens = Math.min(Math.max(usage.cacheReadTokens ?? 0, 0), inputTokens);
  const uncachedInputTokens = inputTokens - cacheReadTokens;
  const cachedInputPrice = model.cachedInputPricePerMToken ?? model.inputPricePerMToken;
  return (
    (uncachedInputTokens / 1_000_000) * model.inputPricePerMToken +
    (cacheReadTokens / 1_000_000) * cachedInputPrice +
    (Math.max(usage.outputTokens, 0) / 1_000_000) * model.outputPricePerMToken
  );
}

function buildUsageMetrics(
  usage: TokenUsage | null,
  model: AIModel | null,
  requestCount: number | null,
  durationMs: number | null,
): InspectorUsage {
  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cacheHitRate: null,
      requestCount,
      durationMs,
      costUsd: null,
      costEstimated: false,
    };
  }
  const costUsd = estimateCost(usage, model);
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens ?? null,
    cacheReadTokens: usage.cacheReadTokens ?? null,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
    cacheHitRate: usage.cacheHitRate ?? null,
    requestCount: requestCount ?? usage.requestCount ?? null,
    durationMs,
    costUsd,
    costEstimated: costUsd !== null,
  };
}

function gatheredTokenCount(entries: Array<{ tokenEstimate: number }>): number {
  return entries.reduce((total, entry) => total + Math.max(entry.tokenEstimate, 0), 0);
}

export function buildContextInspectorViewModel(
  input: BuildContextInspectorInput,
): ContextInspectorViewModel {
  const latestTrace = selectLatestMainTrace(input.traces);
  const latestIterations = latestTrace ? parseTraceIterations(latestTrace.iterations) : [];
  const latestContextIteration = [...latestIterations]
    .reverse()
    .find((iteration) => iteration.context !== null);
  const traceUsage = latestTrace ? mapTraceUsage(latestTrace) : null;
  const latestUsage = input.isStreaming
    ? input.liveUsage
    : traceUsage
      ? mergeUsage(traceUsage, input.liveUsage)
      : input.liveUsage;
  const latestRequestCount = input.isStreaming
    ? (input.liveUsage?.requestCount ?? (input.apiRequestCount > 0 ? input.apiRequestCount : null))
    : latestIterations.length > 0
      ? latestIterations.length
      : input.apiRequestCount > 0
        ? input.apiRequestCount
        : null;
  const latestTurn = buildUsageMetrics(
    latestUsage,
    input.model,
    latestRequestCount,
    input.isStreaming ? null : (latestTrace?.duration_ms ?? null),
  );

  const persistedSessionUsage = mapPersistedUsage(input.persistedUsage);
  const sessionUsage = persistedSessionUsage ?? input.liveSessionUsage;
  const sessionRequestCount = input.traces.reduce(
    (total, trace) => total + parseTraceIterations(trace.iterations).length,
    0,
  );
  const sessionTotals = buildUsageMetrics(
    sessionUsage,
    input.model,
    sessionRequestCount > 0
      ? sessionRequestCount
      : input.apiRequestCount > 0
        ? input.apiRequestCount
        : null,
    null,
  );

  const usageContextTokens = latestUsage
    ? getContextUsageMetrics(latestUsage, input.contextWindow).contextInputTokens
    : null;
  const traceContextTokens = latestContextIteration?.context?.tokenBreakdown.total ?? null;
  const contextTokens = usageContextTokens ?? traceContextTokens;
  const contextSource: ContextUsageSource =
    usageContextTokens !== null
      ? input.isStreaming
        ? 'live'
        : 'usage'
      : traceContextTokens !== null
        ? 'trace'
        : 'none';
  const percentage =
    contextTokens !== null && input.contextWindow !== null && input.contextWindow > 0
      ? contextTokens / input.contextWindow
      : null;

  const userMessages = input.messages.filter((message) => message.role === 'user').length;
  const assistantMessages = input.messages.filter((message) => message.role === 'assistant').length;
  const recordedToolCalls = input.messages.reduce(
    (total, message) => total + (message.toolCalls?.length ?? 0),
    0,
  );

  return {
    title: input.conversation?.title || input.fallbackTitle || 'Current session',
    provider: input.providerName ?? input.conversation?.provider_id ?? null,
    model: input.model?.name ?? input.conversation?.model_id ?? null,
    mode: input.conversation?.mode ?? null,
    createdAt: input.conversation?.created_at ?? null,
    updatedAt: input.conversation?.updated_at ?? latestTrace?.created_at ?? null,
    status: input.isStreaming
      ? 'Streaming'
      : input.conversation || input.messages.length > 0 || sessionUsage
        ? 'Ready'
        : 'No active session',
    contextWindow: input.contextWindow,
    contextUsage: { tokens: contextTokens, percentage, source: contextSource },
    messages: {
      total: userMessages + assistantMessages,
      user: userMessages,
      assistant: assistantMessages,
      toolCalls: recordedToolCalls + input.pendingToolCallCount,
    },
    latestTurn: {
      ...latestTurn,
      source:
        input.isStreaming && input.liveUsage
          ? 'live'
          : traceUsage
            ? 'trace'
            : input.liveUsage
              ? 'live'
              : 'none',
    },
    sessionTotals,
    contextComposition: {
      breakdown: latestContextIteration?.context?.tokenBreakdown ?? null,
      entries: latestContextIteration?.context?.entries ?? [],
      iterationNumber: latestContextIteration?.number ?? null,
      toolCount: latestContextIteration?.context?.toolCount ?? null,
    },
    attachedContext: {
      files: input.contextFiles.length,
      gatheredEntries: input.gatheredContext.length,
      gatheredTokens: gatheredTokenCount(input.gatheredContext),
      images: input.attachedImageCount,
      terminal: input.hasAttachedTerminal,
    },
  };
}

export function formatTokenCount(value: number | null): string {
  return value === null ? 'Not available' : Math.round(value).toLocaleString('en-US');
}

export function formatRate(value: number | null): string {
  return value === null ? 'Not available' : `${(value * 100).toFixed(value >= 0.995 ? 1 : 0)}%`;
}

export function formatCost(value: number | null): string {
  if (value === null) return 'Not available';
  if (value < 0.001) return '<$0.001';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
