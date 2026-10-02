import {
  Check,
  CircleAlert,
  CirclePause,
  CirclePlay,
  CircleStop,
  CircleX,
  Clock3,
  FileCheck,
  Flag,
  Gauge,
  ListChecks,
  LockKeyhole,
  Pencil,
  Wrench,
  X,
} from 'lucide-react';
import type { GoalState } from '@hyscode/agent-harness';
import { pauseActiveGoal, resumeActiveGoal } from '@/lib/active-agent-bridge';
import { EditorPanel, GoalActionButton, GoalMetric, ProgressRing } from './goal-card-controls';
import {
  budgetValue,
  criteriaLabel,
  criterionStatus,
  formatRelativeTime,
  formatTime,
  statusMeta,
  type GoalDetailsActions,
} from './goal-card-model';
import { cn } from '@/lib/utils';

export type GoalDetailsProps = {
  goal: GoalState;
  progress: { percentage: number; passed: number; total: number };
  actions: GoalDetailsActions;
};

/**
 * Expanded goal details, rendered inline between the goal bar and the composer.
 * Purely presentational: all state and actions are owned by `GoalBar`.
 */
export function GoalDetails({ goal, progress, actions }: GoalDetailsProps) {
  const status = goal.goal.status;
  const meta = statusMeta(status);
  const canResume =
    status === 'paused' ||
    status === 'blocked' ||
    status === 'usage_limited' ||
    status === 'budget_limited';
  const canPause = status === 'active';
  const canEdit = status === 'paused';
  const unresolvedBlocker = [...goal.blockers].reverse().find((blocker) => !blocker.resolvedAt);
  const visibleCriteria = actions.showAllCriteria ? goal.criteria : goal.criteria.slice(0, 4);
  const updatedAgo = formatRelativeTime(goal.goal.updatedAt);

  return (
    <div
      id="goal-details"
      className="agent-scale-in mx-auto mb-1.5 max-w-4xl overflow-hidden rounded-lg border border-border/40 bg-card shadow-sm"
    >
      <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <ProgressRing percentage={progress.percentage} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Current checkpoint
                </p>
                <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                  {updatedAgo === 'now' ? 'Updated now' : `Updated ${updatedAgo} ago`}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-foreground">
                {goal.goal.checkpoint || 'The agent has not reported a checkpoint yet.'}
              </p>
              <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
                {meta.description}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/40 bg-border/40 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
            <GoalMetric icon={ListChecks} label="Criteria" value={criteriaLabel(goal, progress)} />
            <GoalMetric
              icon={Clock3}
              label="Turns"
              value={budgetValue(goal.goal.usage.turns, goal.goal.budget.maxTurns, 'turns')}
            />
            <GoalMetric
              icon={Wrench}
              label="Tools"
              value={budgetValue(goal.goal.usage.toolCalls, goal.goal.budget.maxToolCalls, 'calls')}
            />
            <GoalMetric
              icon={Gauge}
              label="Tokens"
              value={budgetValue(goal.goal.usage.totalTokens, goal.goal.budget.maxTokens, '')}
            />
          </div>

          {unresolvedBlocker && (
            <div
              className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-2 text-warning"
              role="status"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium">Blocker needs attention</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-foreground/75">
                  {unresolvedBlocker.summary}
                </p>
                <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                  Seen {unresolvedBlocker.consecutiveTurns} consecutive times
                </p>
              </div>
            </div>
          )}

          {goal.goal.lastError && (
            <div
              className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-destructive"
              role="alert"
            >
              <CircleX className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium">Last execution error</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed">
                  {goal.goal.lastError}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <section className="rounded-lg border border-border/40 bg-card p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <FileCheck className="size-3.5 text-primary" />
                <h3 className="text-[10px] font-medium text-foreground">Acceptance criteria</h3>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">
                {criteriaLabel(goal, progress)}
              </span>
            </div>
            {goal.criteria.length === 0 ? (
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                The agent will define concrete acceptance criteria before beginning the work.
              </p>
            ) : (
              <div className="mt-2 divide-y divide-border/20">
                {visibleCriteria.map((criterion) => {
                  const criterionMeta = criterionStatus(criterion);
                  const CriterionIcon = criterionMeta.Icon;
                  return (
                    <div
                      key={criterion.id}
                      className="group flex items-start gap-2 py-1.5 text-[10px] first:pt-0 last:pb-0"
                    >
                      <CriterionIcon
                        className={cn('mt-0.5 size-3.5 shrink-0', criterionMeta.className)}
                        aria-label={criterionMeta.label}
                      />
                      <span className="min-w-0 flex-1 leading-relaxed text-muted-foreground group-hover:text-foreground">
                        {criterion.description}
                      </span>
                      <span className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-muted-foreground">
                        {criterion.kind.replace('_', ' ')}
                      </span>
                    </div>
                  );
                })}
                {goal.criteria.length > 4 && (
                  <button
                    type="button"
                    className="mt-2 text-[10px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={actions.toggleShowAllCriteria}
                  >
                    {actions.showAllCriteria
                      ? 'Show fewer criteria'
                      : `Show all ${goal.criteria.length} criteria`}
                  </button>
                )}
              </div>
            )}
          </section>

          {goal.events.length > 0 && (
            <section className="rounded-lg border border-border/40 bg-card p-3 shadow-sm">
              <div className="flex items-center gap-1.5">
                <Flag className="size-3.5 text-muted-foreground" />
                <h3 className="text-[10px] font-medium text-foreground">Recent activity</h3>
              </div>
              <div className="mt-2 max-h-28 space-y-2 overflow-y-auto border-l border-border/40 pl-2 pr-1">
                {goal.events
                  .slice(-6)
                  .reverse()
                  .map((event) => (
                    <div key={event.id} className="flex items-start gap-2 text-[10px]">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70" />
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                        {formatTime(event.createdAt)}
                      </span>
                      <span className="min-w-0 line-clamp-2 leading-relaxed text-muted-foreground">
                        {event.message}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {actions.editor && (
        <div className="px-3 pb-3">
          <EditorPanel
            editor={actions.editor}
            error={actions.editorError}
            busy={actions.pendingAction === 'editor'}
            onChange={actions.changeEditorValue}
            onCancel={actions.cancelEditor}
            onSave={() => void actions.saveEditor()}
          />
        </div>
      )}

      {actions.notice && (
        <div className="px-3 pb-3">
          <div
            className={cn(
              'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed',
              actions.notice.tone === 'success'
                ? 'border-success/30 bg-success/5 text-success'
                : 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
            role="status"
            aria-live="polite"
          >
            {actions.notice.tone === 'success' ? (
              <Check className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>{actions.notice.message}</span>
            <button
              type="button"
              className="ml-auto shrink-0 rounded p-0.5 opacity-70 transition-colors hover:bg-muted hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={actions.dismissNotice}
              aria-label="Dismiss notification"
            >
              <X className="size-3" />
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-border/40 px-3 py-3">
        {!canEdit && status !== 'complete' && status !== 'cancelled' && (
          <p
            className="mb-2 flex items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground"
            role="note"
          >
            <LockKeyhole className="size-3.5 shrink-0" />
            <span>Pause the goal to unlock objective editing.</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {canPause && (
            <GoalActionButton
              label="Pause"
              icon={CirclePause}
              onClick={() => void actions.runAction('pause', pauseActiveGoal, 'Goal paused.')}
              disabled={actions.busy}
              loading={actions.pendingAction === 'pause'}
            />
          )}
          {canResume && (
            <GoalActionButton
              label="Resume"
              icon={CirclePlay}
              tone="primary"
              onClick={() => void actions.runAction('resume', resumeActiveGoal, 'Goal resumed.')}
              disabled={actions.busy}
              loading={actions.pendingAction === 'resume'}
            />
          )}
          {status !== 'complete' && status !== 'cancelled' && (
            <GoalActionButton
              label="Stop"
              icon={CircleStop}
              tone="danger"
              onClick={() => void actions.stopGoal()}
              disabled={actions.busy}
              loading={actions.pendingAction === 'stop'}
            />
          )}
          {status !== 'complete' && status !== 'cancelled' && (
            <GoalActionButton
              label="Edit objective"
              icon={canEdit ? Pencil : LockKeyhole}
              onClick={() => actions.openEditor('objective')}
              disabled={actions.busy || !canEdit}
              disabledReason="Pause the goal to edit its objective."
            />
          )}
        </div>
      </div>
    </div>
  );
}
