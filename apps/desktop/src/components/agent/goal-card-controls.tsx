import {
  CircleAlert,
  LoaderCircle,
  Plus,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createActiveGoal } from '@/lib/active-agent-bridge';
import { cn } from '@/lib/utils';
import {
  errorMessage,
  type GoalEditorMode,
  type GoalEditorState,
} from './goal-card-model';

export function ProgressRing({ percentage }: { percentage: number }) {
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const boundedPercentage = Math.min(Math.max(percentage, 0), 100);
  const offset = circumference - (boundedPercentage / 100) * circumference;

  return (
    <div
      className="relative size-12 shrink-0"
      role="progressbar"
      aria-label="Required criteria progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedPercentage}
    >
      <svg className="h-full w-full -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-semibold tabular-nums text-foreground">
        {boundedPercentage}%
      </span>
    </div>
  );
}

export function GoalMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0 bg-card px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="text-[9px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 truncate font-mono text-[12px] font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function GoalActionButton({
  label,
  icon: Icon,
  onClick,
  tone = 'neutral',
  disabled = false,
  disabledReason,
  loading = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  tone?: 'neutral' | 'primary' | 'success' | 'danger';
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
}) {
  const toneClassName = {
    neutral: 'border-border/50 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    primary: 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
    success: 'border-success/30 bg-success/10 text-success hover:bg-success/15',
    danger: 'border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10',
  }[tone];

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      title={disabled && disabledReason ? disabledReason : label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'border text-[10px] font-medium focus-visible:ring-2 focus-visible:ring-ring/50',
        toneClassName,
      )}
    >
      {loading ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Icon className="size-3.5" />}
      <span>{loading ? 'Working' : label}</span>
    </Button>
  );
}

export function EditorPanel({
  editor,
  error,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  editor: GoalEditorState;
  error: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const config: Record<GoalEditorMode, { title: string; description: string; placeholder: string }> = {
    objective: {
      title: 'Edit objective',
      description: 'Keep the outcome concrete so the agent can make progress without guessing.',
      placeholder: 'Describe the result you want…',
    },
  };
  const copy = config[editor.mode];

  return (
    <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3" role="form" aria-label={copy.title}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor="goal-editor-value" className="text-[11px] font-medium text-foreground">
            {copy.title}
          </label>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{copy.description}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close editor"
          title="Close editor"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Textarea
        id="goal-editor-value"
        autoFocus
        value={editor.value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            onSave();
          }
        }}
        placeholder={copy.placeholder}
        aria-label={copy.title}
        aria-invalid={Boolean(error)}
        className={cn(
          'mt-3 min-h-[76px] resize-y bg-background text-[11px] leading-relaxed',
        )}
      />
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-destructive" role="alert">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[9px] text-muted-foreground">Ctrl/⌘ + Enter to save</span>
        <div className="flex gap-1.5">
          <Button type="button" variant="ghost" size="xs" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" size="xs" onClick={onSave} disabled={busy}>
            {busy && <LoaderCircle className="motion-safe:animate-spin" />}
            {busy ? 'Saving' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EmptyGoalState() {
  const [open, setOpen] = useState(false);
  const [objective, setObjective] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const cleanObjective = objective.trim();
    if (!cleanObjective) {
      setError('Add an objective before starting the goal.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createActiveGoal(cleanObjective);
      setObjective('');
      setOpen(false);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="agent-scale-in mx-4 mt-2 overflow-hidden rounded-lg border border-border/40 bg-card shadow-sm" aria-label="Create persistent goal">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Target className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-medium text-foreground">Goal mode ready</p>
            <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-primary">
              Build
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            The agent owns the plan, criteria, evidence, and progress while it works toward your objective.
          </p>
        </div>
        {!open && (
          <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" />
            New goal
          </Button>
        )}
      </div>

      {open && (
        <form className="border-t border-border/40 bg-surface-raised/20 p-3" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="new-goal-objective" className="text-[10px] font-medium text-foreground">
            Objective
          </label>
          <Textarea
            id="new-goal-objective"
            autoFocus
            value={objective}
            onChange={(event) => {
              setObjective(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Example: ship the settings redesign and verify it with the desktop tests"
            className="mt-1.5 min-h-[72px] bg-background text-[11px] leading-relaxed"
            aria-invalid={Boolean(error)}
          />
          <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
            The agent will define the acceptance criteria, checkpoint, evidence, and execution metadata after you start. Goal tokens and turns are unlimited.
          </p>
          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-[10px] text-destructive" role="alert">
              <CircleAlert className="mt-0.5 size-3 shrink-0" />
              <span>{error}</span>
            </p>
          )}
          <div className="mt-3 flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="xs" onClick={() => { setOpen(false); setError(null); }} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={submitting || !objective.trim()}>
              {submitting && <LoaderCircle className="motion-safe:animate-spin" />}
              {submitting ? 'Starting' : 'Start goal'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
