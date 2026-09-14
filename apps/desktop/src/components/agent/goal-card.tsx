import {
  Check,
  ChevronDown,
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
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { promptConfirm } from '@/components/ui/dialogs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentStore } from '@/stores/agent-store';
import {
  cancelActiveGoal,
  clearActiveGoal,
  editActiveGoal,
  pauseActiveGoal,
  resumeActiveGoal,
} from '@/lib/active-agent-bridge';
import { cn } from '@/lib/utils';
import { EmptyGoalState, EditorPanel, GoalActionButton, GoalMetric, ProgressRing } from './goal-card-controls';
import {
  budgetValue,
  criteriaLabel,
  criterionStatus,
  errorMessage,
  formatRelativeTime,
  formatTime,
  getProgress,
  statusMeta,
  type GoalActionKey,
  type GoalEditorMode,
  type GoalEditorState,
  type GoalNotice,
} from './goal-card-model';

type GoalCardProps = {
  enabled: boolean;
};

export function GoalCard({ enabled }: GoalCardProps) {
  const goal = useAgentStore((state) => state.goal);
  const [expanded, setExpanded] = useState(false);
  const [showAllCriteria, setShowAllCriteria] = useState(false);
  const [editor, setEditor] = useState<GoalEditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [notice, setNotice] = useState<GoalNotice | null>(null);
  const [pendingAction, setPendingAction] = useState<GoalActionKey | 'editor' | null>(null);
  const progress = useMemo(() => (goal ? getProgress(goal) : null), [goal]);

  if (!enabled) return null;
  if (!goal || !progress) return <EmptyGoalState />;

  const status = goal.goal.status;
  const meta = statusMeta(status);
  const StatusIcon = meta.Icon;
  const canResume = status === 'paused' || status === 'blocked' || status === 'usage_limited' || status === 'budget_limited';
  const canPause = status === 'active';
  const canEdit = status === 'paused';
  const unresolvedBlocker = [...goal.blockers].reverse().find((blocker) => !blocker.resolvedAt);
  const visibleCriteria = showAllCriteria ? goal.criteria : goal.criteria.slice(0, 4);
  const busy = pendingAction !== null;

  const runAction = async (action: GoalActionKey, task: () => Promise<unknown>, successMessage: string): Promise<void> => {
    if (busy) return;
    setPendingAction(action);
    setNotice(null);
    try {
      await task();
      if (action !== 'clear') setNotice({ tone: 'success', message: successMessage });
    } catch (actionError) {
      setExpanded(true);
      setNotice({ tone: 'error', message: errorMessage(actionError) });
    } finally {
      setPendingAction(null);
    }
  };

  const openEditor = (mode: GoalEditorMode): void => {
    const valueByMode: Record<GoalEditorMode, string> = { objective: goal.goal.objective };
    setEditor({ mode, value: valueByMode[mode] });
    setEditorError(null);
    setNotice(null);
    setExpanded(true);
  };

  const saveEditor = async (): Promise<void> => {
    if (!editor || busy) return;
    const value = editor.value.trim();
    if (!value) {
      setEditorError('This field cannot be empty.');
      return;
    }

    setPendingAction('editor');
    setEditorError(null);
    setNotice(null);
    try {
      await editActiveGoal({ objective: value });
      setEditor(null);
      setNotice({ tone: 'success', message: 'Goal updated.' });
    } catch (actionError) {
      setEditorError(errorMessage(actionError));
    } finally {
      setPendingAction(null);
    }
  };

  const stopGoal = async (): Promise<void> => {
    if (busy) return;
    setPendingAction('stop');
    setNotice(null);
    try {
      const confirmed = await promptConfirm({
        title: 'Stop this goal?',
        description: 'The goal will stay in the conversation as stopped. You can clear it later.',
        confirmLabel: 'Stop goal',
        danger: true,
      });
      if (confirmed) {
        await cancelActiveGoal();
        setNotice({ tone: 'success', message: 'Goal stopped.' });
      }
    } catch (actionError) {
      setExpanded(true);
      setNotice({ tone: 'error', message: errorMessage(actionError) });
    } finally {
      setPendingAction(null);
    }
  };

  const clearGoal = async (): Promise<void> => {
    if (busy) return;
    setPendingAction('clear');
    setNotice(null);
    try {
      const confirmed = await promptConfirm({
        title: 'Clear persistent goal?',
        description: 'This removes the goal, its criteria, activity, and evidence from this conversation.',
        confirmLabel: 'Clear goal',
        danger: true,
      });
      if (confirmed) await clearActiveGoal();
    } catch (actionError) {
      setExpanded(true);
      setNotice({ tone: 'error', message: errorMessage(actionError) });
    } finally {
      setPendingAction(null);
    }
  };

  const updatedAgo = formatRelativeTime(goal.goal.updatedAt);
  const toggleExpanded = (): void => setExpanded((value) => !value);

  return (
    <section
      className="agent-scale-in mx-4 mt-2 overflow-hidden rounded-lg border border-border/40 bg-card shadow-sm"
      aria-label="Persistent goal"
    >
      {status === 'active' && (
        <div className="h-px bg-primary/60 motion-safe:animate-pulse" aria-hidden="true" />
      )}

      <div className="flex min-h-10 items-center gap-2 px-3 py-2">
        <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', meta.badgeClassName)}>
          <StatusIcon className={cn('size-3.5', status === 'active' && 'motion-safe:animate-spin')} />
        </div>

        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-controls="goal-details"
        >
          <span
            className={cn(
              'inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap',
              meta.badgeClassName,
            )}
          >
            <span className={cn('size-1.5 rounded-full bg-current', status === 'active' && 'motion-safe:animate-pulse')} />
            <span className={cn(meta.className)}>
              {status === 'active' ? 'In progress' : meta.label}
            </span>
          </span>
          <span className="min-w-0 truncate text-[11px] font-medium text-foreground group-hover:text-primary">
            {goal.goal.objective}
          </span>
          <span className="hidden shrink-0 font-mono text-[9px] text-muted-foreground sm:inline">
            {updatedAgo === 'now' ? 'now' : `${updatedAgo} ago`}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          {canPause && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Pause goal"
                    disabled={busy}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    onClick={() => void runAction('pause', pauseActiveGoal, 'Goal paused.')}
                  />
                }
              >
                {pendingAction === 'pause' ? (
                  <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
                ) : (
                  <CirclePause className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent side="top">Pause goal</TooltipContent>
            </Tooltip>
          )}
          {canResume && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Resume goal"
                    disabled={busy}
                    className="text-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                    onClick={() => void runAction('resume', resumeActiveGoal, 'Goal resumed.')}
                  />
                }
              >
                {pendingAction === 'resume' ? (
                  <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
                ) : (
                  <CirclePlay className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent side="top">Resume goal</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear goal"
                  disabled={busy}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  onClick={() => void clearGoal()}
                />
              }
            >
              {pendingAction === 'clear' ? (
                <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipContent side="top">Clear goal</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={expanded ? 'Collapse goal details' : 'Expand goal details'}
                  aria-expanded={expanded}
                  aria-controls="goal-details"
                  className="text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={toggleExpanded}
                />
              }
            >
              <ChevronDown className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
            </TooltipTrigger>
            <TooltipContent side="top">
              {expanded ? 'Collapse goal details' : 'Expand goal details'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {expanded && (
        <div id="goal-details" className="animate-details-open border-t border-border/40">
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
                        onClick={() => setShowAllCriteria((value) => !value)}
                      >
                        {showAllCriteria ? 'Show fewer criteria' : `Show all ${goal.criteria.length} criteria`}
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
                    {goal.events.slice(-6).reverse().map((event) => (
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

          {editor && (
            <div className="px-3 pb-3">
              <EditorPanel
                editor={editor}
                error={editorError}
                busy={pendingAction === 'editor'}
                onChange={(value) =>
                  setEditor((current) => (current ? { ...current, value } : current))
                }
                onCancel={() => {
                  setEditor(null);
                  setEditorError(null);
                }}
                onSave={() => void saveEditor()}
              />
            </div>
          )}

          {notice && (
            <div className="px-3 pb-3">
              <div
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed',
                  notice.tone === 'success'
                    ? 'border-success/30 bg-success/5 text-success'
                    : 'border-destructive/30 bg-destructive/5 text-destructive',
                )}
                role="status"
                aria-live="polite"
              >
                {notice.tone === 'success' ? (
                  <Check className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                )}
                <span>{notice.message}</span>
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded p-0.5 opacity-70 transition-colors hover:bg-muted hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setNotice(null)}
                  aria-label="Dismiss notification"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-border/40 px-3 py-3">
            {!canEdit && status !== 'complete' && status !== 'cancelled' && (
              <p className="mb-2 flex items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground" role="note">
                <LockKeyhole className="size-3.5 shrink-0" />
                <span>Pause the goal to unlock objective editing.</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {canPause && (
                <GoalActionButton
                  label="Pause"
                  icon={CirclePause}
                  onClick={() => void runAction('pause', pauseActiveGoal, 'Goal paused.')}
                  disabled={busy}
                  loading={pendingAction === 'pause'}
                />
              )}
              {canResume && (
                <GoalActionButton
                  label="Resume"
                  icon={CirclePlay}
                  tone="primary"
                  onClick={() => void runAction('resume', resumeActiveGoal, 'Goal resumed.')}
                  disabled={busy}
                  loading={pendingAction === 'resume'}
                />
              )}
              {status !== 'complete' && status !== 'cancelled' && (
                <GoalActionButton
                  label="Stop"
                  icon={CircleStop}
                  tone="danger"
                  onClick={() => void stopGoal()}
                  disabled={busy}
                  loading={pendingAction === 'stop'}
                />
              )}
              {status !== 'complete' && status !== 'cancelled' && (
                <GoalActionButton
                  label="Edit objective"
                  icon={canEdit ? Pencil : LockKeyhole}
                  onClick={() => openEditor('objective')}
                  disabled={busy || !canEdit}
                  disabledReason="Pause the goal to edit its objective."
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
