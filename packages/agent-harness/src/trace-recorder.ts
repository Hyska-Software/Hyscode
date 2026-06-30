// ─── Trace Recorder ─────────────────────────────────────────────────────────
// Structured local tracing for the agent harness.
// Records every turn as a self-contained trace with prompt snapshots,
// tool sequences, token budgets, timing, errors, and stop reasons.
// Traces are stored in SQLite and can be queried for recurring failure patterns.

import type { TokenUsage } from '@hyscode/ai-providers';
import type {
  AgentType,
  ToolCallRecord,
} from './types';

// ─── Trace Types ────────────────────────────────────────────────────────────

/** A single iteration within a turn (one LLM call + tool executions). */
export interface TraceIteration {
  /** 1-indexed iteration number */
  number: number;
  /** Wall-clock start time (ms since epoch) */
  startMs: number;
  /** Duration of this iteration in ms */
  durationMs: number;
  /** Tool calls made in this iteration (ordered) */
  toolCalls: {
    name: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }[];
  /** Whether the LLM returned tool calls (agent wants to continue) */
  hadToolCalls: boolean;
  /** Middleware injections triggered this iteration */
  middlewareInjections: string[];
  /** Stuck detection: was this a repeated identical call? */
  wasRepeatedCall: boolean;
}

/** Complete trace of a single agent turn. */
export interface Trace {
  /** Unique trace ID (matches TurnRecord.id) */
  id: string;
  /** Conversation this trace belongs to */
  conversationId: string;
  /** Agent mode */
  mode: AgentType;
  /** Provider + model used */
  provider: string;
  model: string;
  /** System prompt hash (for change detection across turns) */
  systemPromptHash: string;
  /** First 500 chars of system prompt (for quick inspection) */
  systemPromptPreview: string;
  /** Total system prompt token count */
  systemPromptTokens: number;
  /** Number of tools exposed to the LLM */
  toolCount: number;
  /** Per-iteration records */
  iterations: TraceIteration[];
  /** Aggregated token usage (includes prompt cache fields when provider reports them) */
  tokenUsage: TokenUsage;
  /** Stop reason */
  stopReason: 'complete' | 'max_iterations' | 'cancelled' | 'error';
  /** Verification flags */
  verificationPerformed: boolean;
  verificationForced: boolean;
  /** Files modified */
  filesModified: string[];
  /** Errors encountered during the turn */
  errors: { iteration: number; message: string; toolName?: string }[];
  /** Loop detections triggered */
  loopWarnings: { iteration: number; filePath: string; editCount: number }[];
  /** Total wall-clock duration */
  durationMs: number;
  /** ISO timestamp */
  timestamp: string;
}

// ─── Trace Analysis ─────────────────────────────────────────────────────────
// Routines that consume a set of traces and surface recurring issues.

export interface TraceAnalysisSummary {
  /** Total traces analyzed */
  totalTraces: number;
  /** Time window covered */
  timeRange: { from: string; to: string };
  /** Success rate (complete / total) */
  successRate: number;
  /** Average iterations per turn */
  avgIterations: number;
  /** Average duration per turn (ms) */
  avgDurationMs: number;
  /** Average tokens per turn */
  avgTokensPerTurn: { input: number; output: number };
  /** Most frequently failing tools */
  topFailingTools: { toolName: string; failCount: number; totalCalls: number }[];
  /** Traces that hit max iterations */
  maxIterationHits: number;
  /** Traces with loop warnings */
  loopWarningCount: number;
  /** Traces where verification was forced */
  verificationForcedCount: number;
  /** Traces that ended in error */
  errorCount: number;
  /** Most common error messages */
  topErrors: { message: string; count: number }[];
  /** Most frequently modified files */
  topModifiedFiles: { path: string; count: number }[];
  /** Tool usage distribution */
  toolUsage: { toolName: string; count: number; avgDurationMs: number }[];
}

// ─── Trace Recorder Class ───────────────────────────────────────────────────

export class TraceRecorder {
  private currentTrace: Partial<Trace> | null = null;
  private currentIteration: Partial<TraceIteration> | null = null;
  private errors: Trace['errors'] = [];
  private loopWarnings: Trace['loopWarnings'] = [];

  /** Begin recording a new turn trace. */
  startTrace(
    conversationId: string,
    mode: AgentType,
    provider: string,
    model: string,
  ): void {
    this.currentTrace = {
      id: crypto.randomUUID(),
      conversationId,
      mode,
      provider,
      model,
      iterations: [],
      errors: [],
      loopWarnings: [],
      filesModified: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      timestamp: new Date().toISOString(),
    };
    this.errors = [];
    this.loopWarnings = [];
  }

  /** Record the system prompt snapshot (done once at start, or on change). */
  recordSystemPrompt(systemPrompt: string, toolCount: number): void {
    if (!this.currentTrace) return;
    this.currentTrace.systemPromptHash = simpleHash(systemPrompt);
    this.currentTrace.systemPromptPreview = systemPrompt.slice(0, 500);
    this.currentTrace.systemPromptTokens = Math.ceil(systemPrompt.length / 4); // rough estimate
    this.currentTrace.toolCount = toolCount;
  }

  /** Begin a new iteration within the current trace. */
  startIteration(number: number): void {
    this.currentIteration = {
      number,
      startMs: Date.now(),
      toolCalls: [],
      middlewareInjections: [],
      hadToolCalls: false,
      wasRepeatedCall: false,
    };
  }

  /** Record a completed tool call within the current iteration. */
  recordToolCall(record: ToolCallRecord): void {
    if (!this.currentIteration) return;
    this.currentIteration.toolCalls!.push({
      name: record.toolName,
      durationMs: record.durationMs,
      success: record.output.success,
      error: record.output.error,
    });

    if (!record.output.success) {
      this.errors.push({
        iteration: this.currentIteration.number!,
        message: record.output.error ?? 'Tool execution failed',
        toolName: record.toolName,
      });
    }
  }

  /** Record that this iteration had tool calls (agent continues). */
  setHadToolCalls(hadCalls: boolean): void {
    if (this.currentIteration) {
      this.currentIteration.hadToolCalls = hadCalls;
    }
  }

  /** Record a middleware injection for the current iteration. */
  recordMiddlewareInjection(name: string): void {
    if (this.currentIteration) {
      this.currentIteration.middlewareInjections!.push(name);
    }
  }

  /** Record a stuck-detection event. */
  recordRepeatedCall(): void {
    if (this.currentIteration) {
      this.currentIteration.wasRepeatedCall = true;
    }
  }

  /** Record a loop warning from the LoopDetectionMiddleware. */
  recordLoopWarning(filePath: string, editCount: number): void {
    if (this.currentIteration) {
      this.loopWarnings.push({
        iteration: this.currentIteration.number!,
        filePath,
        editCount,
      });
    }
  }

  /** Record an error that occurred during the iteration. */
  recordError(message: string, toolName?: string): void {
    const iteration = this.currentIteration?.number ?? 0;
    this.errors.push({ iteration, message, toolName });
  }

  /** End the current iteration. */
  endIteration(): void {
    if (!this.currentIteration || !this.currentTrace) return;
    this.currentIteration.durationMs = Date.now() - this.currentIteration.startMs!;
    this.currentTrace.iterations!.push(this.currentIteration as TraceIteration);
    this.currentIteration = null;
  }

  /** Finalize the trace with summary data. */
  finalizeTrace(
    stopReason: 'complete' | 'max_iterations' | 'cancelled' | 'error',
    tokenUsage: TokenUsage,
    filesModified: string[],
    verificationPerformed?: boolean,
    verificationForced?: boolean,
  ): Trace | null {
    if (!this.currentTrace) return null;

    const trace: Trace = {
      id: this.currentTrace.id!,
      conversationId: this.currentTrace.conversationId!,
      mode: this.currentTrace.mode!,
      provider: this.currentTrace.provider!,
      model: this.currentTrace.model!,
      systemPromptHash: this.currentTrace.systemPromptHash ?? '',
      systemPromptPreview: this.currentTrace.systemPromptPreview ?? '',
      systemPromptTokens: this.currentTrace.systemPromptTokens ?? 0,
      toolCount: this.currentTrace.toolCount ?? 0,
      iterations: this.currentTrace.iterations ?? [],
      tokenUsage,
      stopReason,
      verificationPerformed: verificationPerformed ?? false,
      verificationForced: verificationForced ?? false,
      filesModified,
      errors: this.errors,
      loopWarnings: this.loopWarnings,
      durationMs: Date.now() - new Date(this.currentTrace.timestamp!).getTime(),
      timestamp: this.currentTrace.timestamp!,
    };

    this.currentTrace = null;
    this.currentIteration = null;
    this.errors = [];
    this.loopWarnings = [];

    return trace;
  }

  /** Check if a trace is currently being recorded. */
  isRecording(): boolean {
    return this.currentTrace !== null;
  }
}

// ─── Trace Analyzer ─────────────────────────────────────────────────────────
// Aggregates a set of traces into actionable insights.

export function analyzeTraces(traces: Trace[]): TraceAnalysisSummary {
  if (traces.length === 0) {
    return {
      totalTraces: 0,
      timeRange: { from: '', to: '' },
      successRate: 0,
      avgIterations: 0,
      avgDurationMs: 0,
      avgTokensPerTurn: { input: 0, output: 0 },
      topFailingTools: [],
      maxIterationHits: 0,
      loopWarningCount: 0,
      verificationForcedCount: 0,
      errorCount: 0,
      topErrors: [],
      topModifiedFiles: [],
      toolUsage: [],
    };
  }

  // Time range
  const timestamps = traces.map((t) => t.timestamp).sort();
  const timeRange = { from: timestamps[0], to: timestamps[timestamps.length - 1] };

  // Success rate
  const completeCount = traces.filter((t) => t.stopReason === 'complete').length;
  const successRate = completeCount / traces.length;

  // Averages
  const avgIterations = traces.reduce((sum, t) => sum + t.iterations.length, 0) / traces.length;
  const avgDurationMs = traces.reduce((sum, t) => sum + t.durationMs, 0) / traces.length;
  const avgTokensPerTurn = {
    input: traces.reduce((sum, t) => sum + t.tokenUsage.inputTokens, 0) / traces.length,
    output: traces.reduce((sum, t) => sum + t.tokenUsage.outputTokens, 0) / traces.length,
  };

  // Tool usage + failures
  const toolStats = new Map<string, { count: number; totalDurationMs: number; failCount: number }>();
  for (const trace of traces) {
    for (const iter of trace.iterations) {
      for (const tc of iter.toolCalls) {
        const stat = toolStats.get(tc.name) ?? { count: 0, totalDurationMs: 0, failCount: 0 };
        stat.count++;
        stat.totalDurationMs += tc.durationMs;
        if (!tc.success) stat.failCount++;
        toolStats.set(tc.name, stat);
      }
    }
  }

  const toolUsage = [...toolStats.entries()]
    .map(([toolName, stat]) => ({
      toolName,
      count: stat.count,
      avgDurationMs: Math.round(stat.totalDurationMs / stat.count),
    }))
    .sort((a, b) => b.count - a.count);

  const topFailingTools = [...toolStats.entries()]
    .filter(([, stat]) => stat.failCount > 0)
    .map(([toolName, stat]) => ({
      toolName,
      failCount: stat.failCount,
      totalCalls: stat.count,
    }))
    .sort((a, b) => b.failCount - a.failCount)
    .slice(0, 10);

  // Counts
  const maxIterationHits = traces.filter((t) => t.stopReason === 'max_iterations').length;
  const loopWarningCount = traces.filter((t) => t.loopWarnings.length > 0).length;
  const verificationForcedCount = traces.filter((t) => t.verificationForced).length;
  const errorCount = traces.filter((t) => t.stopReason === 'error').length;

  // Top errors
  const errorCounts = new Map<string, number>();
  for (const trace of traces) {
    for (const err of trace.errors) {
      const key = err.message.slice(0, 100);
      errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
    }
  }
  const topErrors = [...errorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top modified files
  const fileCounts = new Map<string, number>();
  for (const trace of traces) {
    for (const f of trace.filesModified) {
      fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    }
  }
  const topModifiedFiles = [...fileCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    totalTraces: traces.length,
    timeRange,
    successRate,
    avgIterations: Math.round(avgIterations * 10) / 10,
    avgDurationMs: Math.round(avgDurationMs),
    avgTokensPerTurn: {
      input: Math.round(avgTokensPerTurn.input),
      output: Math.round(avgTokensPerTurn.output),
    },
    topFailingTools,
    maxIterationHits,
    loopWarningCount,
    verificationForcedCount,
    errorCount,
    topErrors,
    topModifiedFiles,
    toolUsage,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fast non-crypto hash for comparing prompt snapshots. */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return (hash >>> 0).toString(36);
}
