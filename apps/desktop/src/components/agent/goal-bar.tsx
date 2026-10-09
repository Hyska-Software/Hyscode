import {
  CirclePause,
  CirclePlay,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Target,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { GoalDetails } from './goal-details';
import {
  barStatusLabel,
  budgetDraftFromGoal,
  errorMessage,
  formatElapsed,
  getProgress,
  parseBudgetDraft,
  type GoalActionKey,
  type GoalBudgetField,
  type GoalDetailsActions,
  type GoalEditorMode,
  type GoalEditorState,
  type GoalNotice,
} from './goal-card-model';

function toTime(value: string | null): number {
  if (!value) return Number.NaN;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

/**
 * Compact goal bar docked directly above the composer.
 *
 * Renders a single pill row (status + objective + elapsed time + actions)
 * whenever a goal exists, regardless of agent mode. Expanding shows the full
 * `GoalDetails` body inline between the bar and the input frame.
 */
export function GoalBar() {
  const goal = useAgentStore((state) => state.goal);
  const [expanded, setExpanded] = useState(false);
  const [showAllCriteria, setShowAllCriteria] = useState(false);
  const [editor, setEditor] = useState<GoalEditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [notice, setNotice] = useState<GoalNotice | null>(null);
  const [pendingAction, setPendingAction] = useState<GoalActionKey | 'editor' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const status = goal?.goal.status ?? null;
  const isActive = status === 'active';
  const goalId = goal?.goal.id ?? null;

  // Live elapsed-time ticker while the goal is active.
  useEffect(() => {
    if (!isActive) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  // Reset transient UI state when the goal is cleared.
  useEffect(() => {
    if (goalId) return;
    setExpanded(false);
    setShowAllCriteria(false);
    setEditor(null);
    setEditorError(null);
    setNotice(null);
    setPendingAction(null);
  }, [goalId]);

  const progress = useMemo(() => (goal ? getProgress(goal) : null), [goal]);

  const busy = pendingAction !== null;

  const runAction: GoalDetailsActions['runAction'] = async (action, task, successMessage) => {
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
        description:
          'This removes the goal, its criteria, activity, and evidence from this conversation.',
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

  const openEditor = (mode: GoalEditorMode): void => {
    if (!goal) return;
    setEditor(
      mode === 'budget'
        ? { mode, values: budgetDraftFromGoal(goal) }
        : { mode, value: goal.goal.objective },
    );
    setEditorError(null);
    setNotice(null);
    setExpanded(true);
  };

  const saveEditor = async (): Promise<void> => {
    if (!editor || busy) return;
    if (editor.mode === 'budget') {
      setPendingAction('editor');
      setEditorError(null);
      setNotice(null);
      try {
        await editActiveGoal({ budget: parseBudgetDraft(editor.values) });
        setEditor(null);
        setNotice({ tone: 'success', message: 'Goal budget updated.' });
      } catch (actionError) {
        setEditorError(errorMessage(actionError));
      } finally {
        setPendingAction(null);
      }
      return;
    }
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

  if (!goal || !progress) return null;

  const canResume =
    status === 'paused' ||
    status === 'blocked' ||
    status === 'usage_limited' ||
    status === 'budget_limited';
  const canPause = status === 'active';

  // Elapsed time: live while active, frozen at the last persist otherwise.
  const runningRun = [...goal.runs].reverse().find((run) => run.status === 'running');
  const startRaw = toTime(runningRun?.startedAt ?? goal.goal.createdAt);
  const startMs = Number.isFinite(startRaw) ? startRaw : now;
  const endRaw = isActive ? now : toTime(goal.goal.completedAt ?? goal.goal.updatedAt);
  const endMs = Number.isFinite(endRaw) ? endRaw : now;
  const elapsedText = formatElapsed(Math.max(0, endMs - startMs));

  const toggleExpanded = (): void => setExpanded((value) => !value);

  const detailsActions: GoalDetailsActions = {
    busy,
    pendingAction,
    notice,
    dismissNotice: () => setNotice(null),
    runAction,
    stopGoal,
    editor,
    editorError,
    openEditor,
    changeEditorValue: (value) =>
      setEditor((current) => (current?.mode === 'objective' ? { ...current, value } : current)),
    changeBudgetValue: (field: GoalBudgetField, value: string) =>
      setEditor((current) =>
        current?.mode === 'budget' ? { ...current, values: { ...current.values, [field]: value } } : current,
      ),
    cancelEditor: () => {
      setEditor(null);
      setEditorError(null);
    },
    saveEditor,
    showAllCriteria,
    toggleShowAllCriteria: () => setShowAllCriteria((value) => !value),
  };

  return (
    <>
      <section
        className="agent-scale-in mx-auto mb-1.5 max-w-4xl overflow-hidden rounded-lg border border-border/40 bg-card shadow-sm"
        aria-label="Persistent goal"
      >
        {isActive && (
          <div className="h-px bg-primary/60 motion-safe:animate-pulse" aria-hidden="true" />
        )}

        <div className="flex min-h-10 items-center gap-2 px-3 py-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Target className={cn('size-3.5', isActive && 'motion-safe:animate-pulse')} />
          </div>

          <button
            type="button"
            className="group flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-controls="goal-details"
          >
            <span className="shrink-0 text-[11px] font-semibold text-foreground group-hover:text-primary">
              {barStatusLabel(status ?? 'active')}
            </span>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground group-hover:text-foreground">
              {goal.goal.objective}
            </span>
            <span
              className="hidden shrink-0 text-[10px] text-muted-foreground/70 sm:inline"
              title="Elapsed time"
            >
              • {elapsedText}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
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
                    aria-label={expanded ? 'Collapse goal details' : 'Expand goal details'}
                    aria-expanded={expanded}
                    aria-controls="goal-details"
                    className="text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={toggleExpanded}
                  />
                }
              >
                {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </TooltipTrigger>
              <TooltipContent side="top">
                {expanded ? 'Collapse goal details' : 'Expand goal details'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </section>

      {expanded && <GoalDetails goal={goal} progress={progress} actions={detailsActions} />}
    </>
  );
}
