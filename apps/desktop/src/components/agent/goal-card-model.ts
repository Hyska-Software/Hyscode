import type { GoalBudgetInput, GoalState } from '@hyscode/agent-harness';
import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleStop,
  CircleX,
  Clock3,
  Gauge,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';

export type GoalStatus = GoalState['goal']['status'];
export type GoalEditorMode = 'objective' | 'budget';
export type GoalActionKey = 'pause' | 'resume' | 'stop' | 'clear';

export type GoalBudgetField =
  | 'turns'
  | 'durationMinutes'
  | 'toolCalls'
  | 'tokens'
  | 'costUsd'
  | 'consecutiveErrors';

/** Form draft for the budget editor: every field is a raw string, empty means unlimited. */
export type GoalBudgetDraft = Record<GoalBudgetField, string>;

export const GOAL_BUDGET_FIELDS: Array<{ field: GoalBudgetField; label: string; hint: string }> = [
  { field: 'turns', label: 'Turns', hint: 'Max agent turns' },
  { field: 'durationMinutes', label: 'Minutes', hint: 'Max total runtime' },
  { field: 'toolCalls', label: 'Tool calls', hint: 'Max tool executions' },
  { field: 'tokens', label: 'Tokens', hint: 'Max total tokens' },
  { field: 'costUsd', label: 'Cost (USD)', hint: 'Max estimated cost' },
  { field: 'consecutiveErrors', label: 'Error streak', hint: 'Max consecutive errors' },
];

/** Prefills the budget draft from the live goal; null limits render empty (unlimited). */
export function budgetDraftFromGoal(goal: GoalState): GoalBudgetDraft {
  const numberOrEmpty = (value: number | null): string => (value === null ? '' : String(value));
  const minutesOrEmpty = (value: number | null): string =>
    value === null ? '' : String(Number((value / 60_000).toFixed(2)));
  return {
    turns: numberOrEmpty(goal.goal.budget.maxTurns),
    durationMinutes: minutesOrEmpty(goal.goal.budget.maxDurationMs),
    toolCalls: numberOrEmpty(goal.goal.budget.maxToolCalls),
    tokens: numberOrEmpty(goal.goal.budget.maxTokens),
    costUsd: numberOrEmpty(goal.goal.budget.maxCostUsd),
    consecutiveErrors: numberOrEmpty(goal.goal.budget.maxConsecutiveErrors),
  };
}

/**
 * Converts a budget draft into a validated budget patch. Empty fields clear
 * the limit (unlimited); every other field must be a positive number.
 */
export function parseBudgetDraft(draft: GoalBudgetDraft): GoalBudgetInput {
  const parseField = (field: GoalBudgetField, label: string): number | null => {
    const raw = draft[field].trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Budget "${label}" must be a positive number or empty for unlimited.`);
    }
    return value;
  };
  const durationMinutes = parseField('durationMinutes', 'Minutes');
  return {
    maxTurns: parseField('turns', 'Turns'),
    maxDurationMs: durationMinutes === null ? null : Math.round(durationMinutes * 60_000),
    maxToolCalls: parseField('toolCalls', 'Tool calls'),
    maxTokens: parseField('tokens', 'Tokens'),
    maxCostUsd: parseField('costUsd', 'Cost (USD)'),
    maxConsecutiveErrors: parseField('consecutiveErrors', 'Error streak'),
  };
}

export type GoalNotice = {
  tone: 'success' | 'error';
  message: string;
};

export type GoalEditorState =
  | { mode: 'objective'; value: string }
  | { mode: 'budget'; values: GoalBudgetDraft };

/**
 * Shared action/state contract passed from `GoalBar` (which owns the state)
 * down to the presentational `GoalDetails` body.
 */
export type GoalDetailsActions = {
  busy: boolean;
  pendingAction: GoalActionKey | 'editor' | null;
  notice: GoalNotice | null;
  dismissNotice: () => void;
  runAction: (
    action: GoalActionKey,
    task: () => Promise<unknown>,
    successMessage: string,
  ) => Promise<void>;
  stopGoal: () => Promise<void>;
  editor: GoalEditorState | null;
  editorError: string | null;
  openEditor: (mode: GoalEditorMode) => void;
  changeEditorValue: (value: string) => void;
  changeBudgetValue: (field: GoalBudgetField, value: string) => void;
  cancelEditor: () => void;
  saveEditor: () => Promise<void>;
  showAllCriteria: boolean;
  toggleShowAllCriteria: () => void;
};

export type StatusMeta = {
  label: string;
  description: string;
  className: string;
  badgeClassName: string;
  Icon: LucideIcon;
};

export function statusMeta(status: GoalStatus): StatusMeta {
  switch (status) {
    case 'complete':
      return {
        label: 'Complete',
        description: 'The goal is complete and its result is persisted.',
        className: 'text-success',
        badgeClassName: 'border-success/30 bg-success/10 text-success',
        Icon: CircleCheck,
      };
    case 'blocked':
      return {
        label: 'Blocked',
        description: 'The same blocker was reported repeatedly.',
        className: 'text-warning',
        badgeClassName: 'border-warning/30 bg-warning/10 text-warning',
        Icon: CircleAlert,
      };
    case 'usage_limited':
      return {
        label: 'Usage limited',
        description: 'Execution stopped after a runtime usage limit.',
        className: 'text-warning',
        badgeClassName: 'border-warning/30 bg-warning/10 text-warning',
        Icon: Gauge,
      };
    case 'budget_limited':
      return {
        label: 'Budget limited',
        description: 'Execution stopped after reaching the configured budget. Edit the budget, then resume.',
        className: 'text-warning',
        badgeClassName: 'border-warning/30 bg-warning/10 text-warning',
        Icon: Gauge,
      };
    case 'cancelled':
      return {
        label: 'Stopped',
        description: 'Execution was stopped by the user.',
        className: 'text-muted-foreground',
        badgeClassName: 'border-border/60 bg-muted/50 text-muted-foreground',
        Icon: CircleStop,
      };
    case 'paused':
      return {
        label: 'Paused',
        description: 'Execution is paused until you resume it.',
        className: 'text-primary',
        badgeClassName: 'border-primary/30 bg-primary/10 text-primary',
        Icon: CirclePause,
      };
    case 'active':
    default:
      return {
        label: 'Running',
        description: 'The agent is working toward this goal in the background.',
        className: 'text-primary',
        badgeClassName: 'border-primary/30 bg-primary/10 text-primary',
        Icon: LoaderCircle,
      };
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The goal action could not be completed.';
}

export function barStatusLabel(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return 'Goal in progress';
    case 'paused':
      return 'Goal paused';
    case 'blocked':
      return 'Goal blocked';
    case 'usage_limited':
      return 'Goal usage limited';
    case 'budget_limited':
      return 'Goal budget limited';
    case 'complete':
      return 'Goal complete';
    case 'cancelled':
      return 'Goal stopped';
    default:
      return 'Goal in progress';
  }
}

export function formatCompactNumber(value: number): string {
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 5) return 'now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)}m`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3_600)}h`;
  return `${Math.floor(elapsedSeconds / 86_400)}d`;
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`;
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d ${totalHours % 24}h`;
}

export function getProgress(state: GoalState): { percentage: number; passed: number; total: number } {
  const required = state.criteria.filter((criterion) => criterion.required);
  const passed = required.filter((criterion) => criterion.status === 'passed').length;
  const percentage = required.length === 0 ? (state.goal.status === 'complete' ? 100 : 0) : Math.round((passed / required.length) * 100);
  return { percentage, passed, total: required.length };
}

export function criteriaLabel(state: GoalState, progress: { passed: number; total: number }): string {
  if (state.criteria.length === 0) return 'Pending agent setup';
  if (progress.total === 0) return 'No required';
  return `${progress.passed}/${progress.total} required`;
}

export function budgetValue(used: number, limit: number | null, unit: string): string {
  const current = formatCompactNumber(used);
  const maximum = limit === null ? '∞' : formatCompactNumber(limit);
  return `${current}/${maximum} ${unit}`.trim();
}

export function criterionStatus(criterion: GoalState['criteria'][number]): {
  Icon: LucideIcon;
  className: string;
  label: string;
} {
  if (criterion.status === 'passed') return { Icon: CircleCheck, className: 'text-success', label: 'Passed' };
  if (criterion.status === 'failed') return { Icon: CircleX, className: 'text-destructive', label: 'Failed' };
  if (criterion.status === 'unproven') return { Icon: CircleAlert, className: 'text-warning', label: 'Needs verification' };
  return { Icon: Clock3, className: 'text-muted-foreground/70', label: 'Pending' };
}
