import type { TokenUsage } from '@hyscode/ai-providers';
import type { ToolCallRecord } from './types';

export type GoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usage_limited'
  | 'budget_limited'
  | 'complete'
  | 'cancelled';

export type GoalVerification = 'verified' | 'partial' | 'unverified';

export type GoalCriterionKind = 'review' | 'file_exists' | 'command' | 'tool_success';
export type GoalCriterionStatus = 'pending' | 'passed' | 'failed' | 'unproven';

export type GoalBudget = {
  maxTokens: number | null;
  maxTurns: number | null;
  maxDurationMs: number | null;
  maxToolCalls: number | null;
  maxCostUsd: number | null;
  maxConsecutiveErrors: number | null;
};

export type GoalBudgetInput = Partial<GoalBudget>;

export type GoalUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  durationMs: number;
  costUsd: number | null;
  consecutiveErrors: number;
  lastTurnAt: string | null;
};

export type GoalCriterion = {
  id: string;
  goalId: string;
  description: string;
  kind: GoalCriterionKind;
  config: Record<string, unknown>;
  required: boolean;
  status: GoalCriterionStatus;
  verificationNote: string | null;
  evidenceId: string | null;
};

export type GoalCriterionInput = {
  description: string;
  kind?: GoalCriterionKind;
  config?: Record<string, unknown>;
  required?: boolean;
};

/**
 * User-owned goal edits. The objective is edited while the goal is not
 * running; the execution budget may be edited from any non-running,
 * non-terminal state so a budget-limited goal can always be recovered.
 */
export type GoalEditInput = {
  objective?: string;
  budget?: GoalBudgetInput;
};

export type GoalEvidenceSource = 'user' | 'agent' | 'validator' | 'system';

export type GoalEvidence = {
  id: string;
  goalId: string;
  criterionId: string | null;
  source: GoalEvidenceSource;
  summary: string;
  details: string | null;
  passed: boolean;
  verified: boolean;
  turnId: string | null;
  createdAt: string;
};

export type GoalBlocker = {
  id: string;
  goalId: string;
  fingerprint: string;
  summary: string;
  details: string | null;
  consecutiveTurns: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastTurnId: string | null;
  resolvedAt: string | null;
};

export type GoalRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type GoalRunSource = 'user' | 'continuation' | 'resume';

export type GoalRun = {
  id: string;
  goalId: string;
  turnId: string | null;
  source: GoalRunSource;
  status: GoalRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  tokenUsage: TokenUsage;
  toolCalls: number;
  durationMs: number;
  error: string | null;
};

export type GoalEventType =
  | 'created'
  | 'updated'
  | 'progress'
  | 'evidence'
  | 'run_started'
  | 'run_completed'
  | 'paused'
  | 'resumed'
  | 'blocked'
  | 'limit_reached'
  | 'completion_requested'
  | 'completion_denied'
  | 'completed'
  | 'cancelled';

export type GoalEvent = {
  id: string;
  goalId: string;
  type: GoalEventType;
  message: string;
  turnId: string | null;
  createdAt: string;
};

export type Goal = {
  id: string;
  conversationId: string;
  projectId: string;
  objective: string;
  status: GoalStatus;
  verification: GoalVerification;
  version: number;
  budget: GoalBudget;
  usage: GoalUsage;
  checkpoint: string;
  lastError: string | null;
  currentRunId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type GoalState = {
  goal: Goal;
  criteria: GoalCriterion[];
  evidence: GoalEvidence[];
  blockers: GoalBlocker[];
  runs: GoalRun[];
  events: GoalEvent[];
};

/**
 * Change notification for one conversation's goal. `conversationId` is always
 * present so consumers can route `state === null` (cleared) correctly instead
 * of guessing from a null payload.
 */
export type GoalChangeEvent = {
  state: GoalState | null;
  conversationId: string;
};

export interface GoalRepository {
  load(conversationId: string): Promise<GoalState | null>;
  save(state: GoalState, expectedVersion: number | null): Promise<GoalState>;
  clear(conversationId: string): Promise<void>;
}

export type GoalValidationContext = {
  state: GoalState;
  turnId: string | null;
  toolCalls: readonly ToolCallRecord[];
};

export type GoalValidationResult = {
  passed: boolean;
  verified: boolean;
  summary: string;
  details?: string;
};

export type GoalValidator = (
  criterion: GoalCriterion,
  context: GoalValidationContext,
) => Promise<GoalValidationResult>;

/** Typed first-class completion request surfaced on `TurnOutcome`. */
export type GoalCompletionRequest = {
  summary: string;
  evidence?: string;
  turnId: string | null;
};

export type GoalTurnAccounting = {
  runId: string;
  turnId: string | null;
  status: string;
  response?: string;
  tokenUsage: TokenUsage;
  toolCalls: readonly ToolCallRecord[];
  durationMs: number;
  error?: string;
  completionRequest?: GoalCompletionRequest;
};

export type GoalTurnDecision = {
  state: GoalState;
  shouldContinue: boolean;
  reason: string;
};

export type GoalToolRuntime = {
  getState(conversationId: string): Promise<GoalState | null>;
  createGoal(conversationId: string, projectId: string, objective: string): Promise<GoalState>;
  defineCriteria(
    conversationId: string,
    criteria: readonly GoalCriterionInput[],
    turnId?: string | null,
  ): Promise<GoalState>;
  reportProgress(
    conversationId: string,
    summary: string,
    checkpoint?: string,
    criterionId?: string,
    evidenceDetails?: string,
    turnId?: string | null,
  ): Promise<GoalState>;
  reportBlocker(
    conversationId: string,
    summary: string,
    fingerprint?: string,
    details?: string,
    turnId?: string | null,
  ): Promise<GoalState>;
};

const MAX_OBJECTIVE_LENGTH = 40_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_EVENTS = 200;
const MAX_EVIDENCE = 500;
const MAX_RUNS = 200;

export const GOAL_LIMITS = {
  MAX_OBJECTIVE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_EVENTS,
  MAX_EVIDENCE,
  MAX_RUNS,
} as const;

export const RECOVERED_RUN_ERROR = 'Recovered an unfinished goal run after the previous runtime stopped.';

export const DEFAULT_GOAL_BUDGET: GoalBudget = {
  maxTokens: null,
  maxTurns: null,
  maxDurationMs: null,
  maxToolCalls: null,
  maxCostUsd: null,
  maxConsecutiveErrors: null,
};

/** Bounded by default; explicit input always wins over the defaults. */
export function createDefaultGoalBudget(input: GoalBudgetInput = {}): GoalBudget {
  return {
    maxTokens: input.maxTokens ?? null,
    maxTurns: input.maxTurns ?? 50,
    maxDurationMs: input.maxDurationMs ?? 300_000,
    maxToolCalls: input.maxToolCalls ?? 200,
    maxCostUsd: input.maxCostUsd ?? null,
    maxConsecutiveErrors: input.maxConsecutiveErrors ?? null,
  };
}

/**
 * Validates and merges a user budget edit onto the current budget.
 * `undefined` leaves a field untouched, `null` clears the limit
 * (unlimited), and numbers must be finite and non-negative.
 */
export function mergeGoalBudget(current: GoalBudget, patch: GoalBudgetInput): GoalBudget {
  const knownKeys: Array<keyof GoalBudget> = [
    'maxTokens',
    'maxTurns',
    'maxDurationMs',
    'maxToolCalls',
    'maxCostUsd',
    'maxConsecutiveErrors',
  ];
  for (const key of Object.keys(patch) as Array<keyof GoalBudget>) {
    if (!knownKeys.includes(key)) {
      throw new Error(`Unknown budget field "${String(key)}".`);
    }
  }
  const next: GoalBudget = { ...current };
  for (const key of knownKeys) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) {
      next[key] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Budget "${key}" must be a non-negative number or empty for unlimited.`);
    }
    next[key] = value;
  }
  return next;
}

/**
 * Parses user-facing budget edits of the form `turns=100 duration=10 tokens=none`
 * (space or comma separated `key=value` pairs). Values `none`/`off`/`unlimited`
 * clear a limit; `duration` is expressed in minutes.
 */
export function parseGoalBudgetInput(raw: string): GoalBudgetInput {
  const keyMap: Record<string, keyof GoalBudget> = {
    turns: 'maxTurns',
    maxturns: 'maxTurns',
    duration: 'maxDurationMs',
    maxduration: 'maxDurationMs',
    toolcalls: 'maxToolCalls',
    tools: 'maxToolCalls',
    tokens: 'maxTokens',
    maxtokens: 'maxTokens',
    cost: 'maxCostUsd',
    maxcost: 'maxCostUsd',
    errors: 'maxConsecutiveErrors',
  };
  const clearValues = new Set(['none', 'off', 'unlimited', '']);
  const pairs = raw.split(/[\s,]+/u).filter(Boolean);
  if (pairs.length === 0) {
    throw new Error('Provide budget edits like `turns=100 duration=10 tools=none`.');
  }
  const patch: GoalBudgetInput = {};
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Budget edit "${pair}" must use key=value syntax.`);
    }
    const rawKey = pair.slice(0, separator).toLowerCase();
    const rawValue = pair.slice(separator + 1).trim().toLowerCase();
    const key = keyMap[rawKey];
    if (!key) {
      throw new Error(`Unknown budget field "${pair.slice(0, separator)}". Valid fields: turns, duration (minutes), tools, tokens, cost, errors.`);
    }
    if (clearValues.has(rawValue)) {
      patch[key] = null;
      continue;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Budget "${pair.slice(0, separator)}" must be a positive number or "none".`);
    }
    patch[key] = key === 'maxDurationMs' ? Math.round(value * 60_000) : value;
  }
  return patch;
}

export function now(): string {
  return new Date().toISOString();
}

export function id(): string {
  return crypto.randomUUID();
}

export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function bounded(value: unknown, limit: number, fallback = ''): string {
  return text(value, fallback).slice(0, limit);
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeFingerprint(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim().slice(0, 500) || 'unspecified-blocker';
}

export function emptyTokenUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function normalizeTokenUsage(value: TokenUsage | undefined): TokenUsage {
  return {
    ...emptyTokenUsage(),
    ...(value ?? {}),
  };
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

/** The budget limit that a goal has hit, with the status it maps to. */
export type GoalBudgetLimit = {
  status: 'budget_limited' | 'usage_limited';
  reason: string;
};

/**
 * Pure budget projection: checks a budget against a usage snapshot. Used both
 * for authoritative state transitions (startRun/finishTurn) and for the
 * mid-turn advisory, which projects live turn metrics onto stored usage.
 */
export function budgetLimitFor(budget: GoalBudget, usage: GoalUsage): GoalBudgetLimit | null {
  if (budget.maxTokens !== null && usage.totalTokens >= budget.maxTokens) {
    return { status: 'budget_limited', reason: 'token budget reached' };
  }
  if (budget.maxTurns !== null && usage.turns >= budget.maxTurns) {
    return { status: 'budget_limited', reason: 'turn budget reached' };
  }
  if (budget.maxDurationMs !== null && usage.durationMs >= budget.maxDurationMs) {
    return { status: 'budget_limited', reason: 'duration budget reached' };
  }
  if (budget.maxToolCalls !== null && usage.toolCalls >= budget.maxToolCalls) {
    return { status: 'budget_limited', reason: 'tool-call budget reached' };
  }
  if (budget.maxCostUsd !== null && usage.costUsd !== null && usage.costUsd >= budget.maxCostUsd) {
    return { status: 'budget_limited', reason: 'cost budget reached' };
  }
  if (budget.maxConsecutiveErrors !== null && usage.consecutiveErrors >= budget.maxConsecutiveErrors) {
    return { status: 'usage_limited', reason: 'consecutive error limit reached' };
  }
  return null;
}

export function remainingBudget(limit: number | null, used: number): string {
  return limit === null ? 'unlimited' : String(Math.max(0, limit - used));
}

export function createCriteria(goalId: string, criteria: readonly GoalCriterionInput[]): GoalCriterion[] {
  return criteria.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const criterion = candidate as GoalCriterionInput;
    const description = bounded(criterion.description, MAX_TEXT_LENGTH);
    if (!description) return [];
    const kind: GoalCriterionKind = criterion.kind === 'file_exists'
      || criterion.kind === 'command'
      || criterion.kind === 'tool_success'
      || criterion.kind === 'review'
      ? criterion.kind
      : 'review';
    const config = criterion.config && typeof criterion.config === 'object' && !Array.isArray(criterion.config)
      ? clone(criterion.config)
      : {};
    return [{
      id: id(),
      goalId,
      description,
      kind,
      config,
      required: criterion.required !== false,
      status: 'pending' as GoalCriterionStatus,
      verificationNote: null,
      evidenceId: null,
    }];
  });
}
