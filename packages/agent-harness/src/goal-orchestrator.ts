import type { TokenUsage } from '@hyscode/ai-providers';
import type { ToolCallRecord, TurnOutcome } from './types';
import { GoalService } from './goal-service';
import {
  emptyTokenUsage,
  type GoalRun,
  type GoalRunSource,
  type GoalState,
  type GoalTurnDecision,
} from './goal-types';

/**
 * Hidden steering message that drives the next goal turn. Kept in the
 * orchestrator so Desktop and TUI continuations read the same prompt instead
 * of duplicating the string.
 */
export const GOAL_CONTINUATION_MESSAGE =
  'Continue the active persistent goal from its current checkpoint. Take the next concrete step and keep working until the goal is complete or a real blocker is reached.';

export type GoalTurnErrorReport = {
  status?: string;
  turnId?: string | null;
  error: string;
  tokenUsage?: TokenUsage;
  toolCalls?: readonly ToolCallRecord[];
  durationMs?: number;
};

/**
 * One goal turn owned by the orchestrator. The bridge reports the harness
 * result as soon as it exists and settles exactly once from `finally`, so
 * every started run is finished on every control path — including early
 * returns, identity changes, and thrown errors. `settle` is idempotent and
 * never throws.
 */
export type GoalTurnScope = {
  readonly state: GoalState;
  readonly run: GoalRun | null;
  readonly goalContext: string;
  report(outcome: TurnOutcome): void;
  reportError(info: GoalTurnErrorReport): void;
  settle(): Promise<GoalTurnDecision | null>;
};

export type GoalOrchestratorDeps = {
  service: GoalService;
  /** Single build-mode gate for goal tools, actions, and continuations. */
  isGoalAllowed: () => boolean;
  /** True while the conversation still owns the UI (host-specific). */
  isConversationCurrent: (conversationId: string) => boolean;
  /** True while a turn is streaming (continuations defer instead of colliding). */
  isTurnRunning: () => boolean;
  /** Dispatches the hidden continuation/start message for a conversation. */
  startTurn: (conversationId: string, source: GoalRunSource) => Promise<void>;
  onDiagnostic?: (message: string) => void;
  scheduleDelayMs?: number;
};

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Owns persistent-goal execution for a host bridge: run start/finish pairing,
 * completion wiring, and autonomous continuation scheduling. Both bridges
 * delegate to one instance so the lifecycle cannot drift between runtimes.
 */
export class GoalOrchestrator {
  private readonly service: GoalService;
  private readonly isGoalAllowed: () => boolean;
  private readonly isConversationCurrent: (conversationId: string) => boolean;
  private readonly isTurnRunning: () => boolean;
  private readonly startTurn: (conversationId: string, source: GoalRunSource) => Promise<void>;
  private readonly onDiagnostic?: (message: string) => void;
  private readonly scheduleDelayMs: number;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<string>();
  private readonly pending = new Set<string>();
  private disposed = false;

  constructor(deps: GoalOrchestratorDeps) {
    this.service = deps.service;
    this.isGoalAllowed = deps.isGoalAllowed;
    this.isConversationCurrent = deps.isConversationCurrent;
    this.isTurnRunning = deps.isTurnRunning;
    this.startTurn = deps.startTurn;
    this.onDiagnostic = deps.onDiagnostic;
    this.scheduleDelayMs = deps.scheduleDelayMs ?? 100;
  }

  goalsAllowed(): boolean {
    return this.isGoalAllowed();
  }

  /**
   * Loads the goal and starts a run when it is active. Returns null when
   * there is no goal or the gate is closed; throws when the goal refuses a
   * new run (e.g. budget reached) without creating a leaked run.
   */
  async beginTurn(conversationId: string | null, source: GoalRunSource): Promise<GoalTurnScope | null> {
    if (!conversationId || !this.isGoalAllowed()) return null;
    const state = await this.service.getState(conversationId);
    if (!state) return null;
    const goalContext = this.service.buildContext(state);
    const run = state.goal.status === 'active'
      ? await this.service.startRun(conversationId, source)
      : null;
    return this.createScope(conversationId, state, goalContext, run);
  }

  /** User-initiated start (Start/Resume buttons). Silent no-op when busy or inactive. */
  async startUserTurn(conversationId: string): Promise<void> {
    if (this.disposed || !this.isConversationCurrent(conversationId) || !this.isGoalAllowed()) return;
    if (this.inFlight.has(conversationId) || this.isTurnRunning()) return;
    const state = await this.service.getState(conversationId);
    if (!state || state.goal.status !== 'active') return;
    await this.startTurn(conversationId, 'user');
  }

  scheduleContinuation(conversationId: string): void {
    if (this.disposed) return;
    if (this.inFlight.has(conversationId)) {
      // A continuation turn is still running: remember the follow-up instead
      // of arming a timer that would race it, and flush it when the turn ends.
      this.pending.add(conversationId);
      return;
    }
    if (this.timers.has(conversationId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(conversationId);
      void this.fireContinuation(conversationId).catch((error) => {
        this.onDiagnostic?.(`Goal continuation stopped: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.scheduleDelayMs);
    this.timers.set(conversationId, timer);
  }

  clearContinuation(conversationId: string): void {
    const timer = this.timers.get(conversationId);
    if (timer) clearTimeout(timer);
    this.timers.delete(conversationId);
    this.pending.delete(conversationId);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.inFlight.clear();
  }

  private async fireContinuation(conversationId: string): Promise<void> {
    if (this.disposed || this.inFlight.has(conversationId)) {
      this.scheduleContinuation(conversationId);
      return;
    }
    if (!this.isGoalAllowed() || !this.isConversationCurrent(conversationId)) return;
    if (this.isTurnRunning()) {
      this.scheduleContinuation(conversationId);
      return;
    }
    const state = await this.service.getState(conversationId);
    if (!state || state.goal.status !== 'active') return;
    if (this.isTurnRunning()) {
      // A turn started while the state was loading; retry instead of
      // colliding with it.
      this.scheduleContinuation(conversationId);
      return;
    }
    this.inFlight.add(conversationId);
    try {
      await this.startTurn(conversationId, 'continuation');
    } catch (error) {
      this.onDiagnostic?.(`Goal continuation stopped: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.inFlight.delete(conversationId);
      if (!this.disposed && this.pending.delete(conversationId)) {
        this.scheduleContinuation(conversationId);
      }
    }
  }

  private createScope(
    conversationId: string,
    state: GoalState,
    goalContext: string,
    run: GoalRun | null,
  ): GoalTurnScope {
    let reported: { kind: 'outcome'; outcome: TurnOutcome } | { kind: 'error'; info: GoalTurnErrorReport } | null = null;
    let settled: GoalTurnDecision | null | undefined;
    return {
      state,
      run,
      goalContext,
      report: (outcome: TurnOutcome): void => {
        if (!reported) reported = { kind: 'outcome', outcome };
      },
      reportError: (info: GoalTurnErrorReport): void => {
        if (!reported) reported = { kind: 'error', info };
      },
      settle: async (): Promise<GoalTurnDecision | null> => {
        if (settled !== undefined) return settled;
        settled = null;
        if (!run) return null;
        try {
          const decision = reported?.kind === 'outcome'
            ? await this.service.finishTurn(conversationId, {
              runId: run.id,
              turnId: reported.outcome.turnId,
              status: reported.outcome.status,
              response: reported.outcome.response,
              tokenUsage: reported.outcome.turnRecord?.tokenUsage ?? emptyTokenUsage(),
              toolCalls: reported.outcome.turnRecord?.toolCalls ?? [],
              durationMs: reported.outcome.turnRecord?.durationMs ?? 0,
              completionRequest: reported.outcome.goalCompletionRequest ?? undefined,
            })
            : await this.service.finishTurn(conversationId, {
              runId: run.id,
              turnId: reported?.kind === 'error' ? (reported.info.turnId ?? null) : null,
              status: reported?.kind === 'error' ? (reported.info.status ?? 'error') : 'cancelled',
              tokenUsage: reported?.kind === 'error' ? (reported.info.tokenUsage ?? { ...ZERO_USAGE }) : { ...ZERO_USAGE },
              toolCalls: reported?.kind === 'error' ? (reported.info.toolCalls ?? []) : [],
              durationMs: reported?.kind === 'error' ? Math.max(0, reported.info.durationMs ?? 0) : 0,
              error: reported?.kind === 'error' ? reported.info.error : undefined,
            });
          if (decision.shouldContinue) this.scheduleContinuation(conversationId);
          settled = decision;
          return decision;
        } catch (error) {
          this.onDiagnostic?.(`Failed to persist goal turn: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      },
    };
  }
}
