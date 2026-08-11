import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  Archive,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CircleStop,
  GripVertical,
  Inbox,
  MessageCircle,
  MousePointerClick,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import type {
  KanbanTask,
  KanbanTaskColumnKey,
  KanbanTaskPriority,
  KanbanTaskRunMode,
  KanbanTaskRunSummary,
} from '@hyscode/agent-harness';
import { useProjectStore } from '@/stores/project-store';
import { useKanbanStore } from '@/stores/kanban-store';
import { cn } from '@/lib/utils';
import { promptConfirm } from '@/components/ui/dialogs';
import { Badge } from '@/components/ui/badge';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Button as AuroraButton,
  Badge as AuroraBadge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input as AuroraInput,
  SearchInput as AuroraSearchInput,
  Select as AuroraSelect,
  Switch,
  Textarea as AuroraTextarea,
} from '@hyscode/ui';

type KanbanColumnDefinition = {
  key: KanbanTaskColumnKey;
  label: string;
  accentClass: string;
  dotClass: string;
};

const KANBAN_COLUMNS: readonly KanbanColumnDefinition[] = [
  {
    key: 'backlog',
    label: 'Backlog',
    accentClass: 'border-muted-foreground/40',
    dotClass: 'bg-muted-foreground',
  },
  { key: 'todo', label: 'To do', accentClass: 'border-primary/50', dotClass: 'bg-primary/70' },
  {
    key: 'in_progress',
    label: 'In progress',
    accentClass: 'border-warning/60',
    dotClass: 'bg-warning',
  },
  { key: 'blocked', label: 'Blocked', accentClass: 'border-error/60', dotClass: 'bg-error' },
  { key: 'done', label: 'Done', accentClass: 'border-success/60', dotClass: 'bg-success' },
];

const PRIORITIES: readonly { value: KanbanTaskPriority; label: string }[] = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

function priorityBadgeClass(priority: KanbanTaskPriority): string {
  if (priority === 'urgent') return 'border-transparent bg-error/10 text-error';
  if (priority === 'high' || priority === 'medium') {
    return 'border-transparent bg-warning/10 text-warning';
  }
  if (priority === 'low') return 'border-transparent bg-primary/10 text-primary';
  return 'border-transparent bg-muted text-muted-foreground';
}

function runLabel(run: KanbanTaskRunSummary | null): string | null {
  if (!run) return null;
  if (run.state === 'queued') return 'Queued';
  if (run.state === 'running') return 'Running';
  if (run.state === 'waiting') return 'Waiting';
  return run.state[0].toUpperCase() + run.state.slice(1);
}

function TaskCard({
  task,
  selected,
  onSelect,
  onDragStart,
  onDrop,
  onMove,
  onMoveTo,
  onArchive,
  onDelete,
  onDelegate,
  onCancel,
  isActionPending,
}: {
  task: KanbanTask;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onMove: (direction: -1 | 1) => void;
  onMoveTo: (columnKey: KanbanTaskColumnKey) => void;
  onArchive: () => void;
  onDelete: () => void;
  onDelegate: () => void;
  onCancel: () => void;
  isActionPending: boolean;
}) {
  const displayRun = task.activeRun ?? task.latestRun;
  const displayRunLabel = runLabel(displayRun);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        draggable
        onDragStart={onDragStart}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={(event) => {
          event.stopPropagation();
          onDrop(event);
        }}
        onClick={onSelect}
        className={cn(
          'group relative cursor-grab overflow-hidden rounded-lg border bg-surface-raised/75 p-2.5 shadow-none transition-[border-color,background-color,box-shadow,transform] duration-150 active:cursor-grabbing active:scale-[0.995]',
          'border-border/70 hover:border-primary/45 hover:bg-surface-raised hover:shadow-sm',
          selected && 'border-primary/65 bg-primary/10 shadow-sm ring-1 ring-primary/25',
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect();
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            onMove(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
        aria-label={`Open task ${task.title}`}
      >
        <span
          className={cn(
            'pointer-events-none absolute inset-x-2.5 top-0 h-px bg-border/70',
            selected && 'bg-primary',
          )}
          aria-hidden="true"
        />
        <div className="flex items-start gap-1.5">
          <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <span className="min-w-0 flex-1 text-[11px] font-medium leading-4 text-foreground">
            {task.title}
          </span>
          {task.priority !== 'none' && (
            <Badge
              variant="outline"
              className={cn('h-5 px-1.5 text-[9px] font-semibold', priorityBadgeClass(task.priority))}
              title={`${task.priority} priority`}
              aria-label={`${task.priority} priority`}
            >
              {task.priority.slice(0, 1).toUpperCase()}
            </Badge>
          )}
        </div>
        {task.description && (
          <p className="mt-1.5 line-clamp-2 pl-5 text-[10px] leading-3.5 text-muted-foreground">
            {task.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5 pl-5">
          {task.labels.slice(0, 2).map((label) => (
            <Badge key={label} variant="secondary" className="h-5 px-1.5 text-[9px]">
              {label}
            </Badge>
          ))}
          {displayRunLabel && (
            <Badge variant="default" className="ml-auto h-5 px-1.5 text-[9px]">
              <Play className="h-2.5 w-2.5 fill-current" />
              {displayRunLabel}
            </Badge>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel className="text-[10px] uppercase tracking-wider">Task actions</ContextMenuLabel>
        <ContextMenuItem onClick={onSelect}>
          <Pencil />
          Edit task
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuLabel className="text-[10px] uppercase tracking-wider">Move to</ContextMenuLabel>
        {KANBAN_COLUMNS.map((column) => (
          <ContextMenuItem
            key={column.key}
            disabled={isActionPending || column.key === task.columnKey}
            onClick={() => onMoveTo(column.key)}
          >
            <ArrowRight />
            {column.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        {task.activeRun ? (
          <ContextMenuItem disabled={isActionPending} onClick={onCancel}>
            <CircleStop />
            Stop run
          </ContextMenuItem>
        ) : (
          <ContextMenuItem disabled={isActionPending} onClick={onDelegate}>
            <Play className="fill-current" />
            Delegate to VORTEX
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={isActionPending || Boolean(task.activeRun)} onClick={onArchive}>
          <Archive />
          Archive task
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={isActionPending || Boolean(task.activeRun)}
          onClick={onDelete}
        >
          <Trash2 />
          Delete permanently
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NewTaskForm({
  compact,
  onCreated,
  disabled = false,
}: {
  compact: boolean;
  onCreated: (task: KanbanTask) => void;
  disabled?: boolean;
}) {
  const createTask = useKanbanStore((state) => state.createTask);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<KanbanTaskPriority>('none');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const task = await createTask({
        title: title.trim(),
        description: description.trim(),
        priority,
        columnKey: 'backlog',
        autoTransition: true,
      });
      setTitle('');
      setDescription('');
      setPriority('none');
      setOpen(false);
      onCreated(task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <AuroraButton
          type="button"
          disabled={disabled}
          variant="outline"
          size="sm"
          className="text-[10px]"
          title={disabled ? 'Open a project before creating tasks' : 'Create a new task'}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
        >
          New task
        </AuroraButton>
      </DialogTrigger>
      <DialogContent
        showClose={false}
        className="w-[calc(100vw-2rem)] max-w-[420px] gap-0 overflow-hidden p-0"
      >
        <form onSubmit={handleSubmit}>
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
            <DialogHeader className="gap-0.5">
              <DialogTitle className="text-[13px]">Create task</DialogTitle>
              <DialogDescription className="text-[10px]">
                New work starts in Backlog.
              </DialogDescription>
            </DialogHeader>
            <AuroraButton
              type="button"
              onClick={() => setOpen(false)}
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Close create task form"
            >
              <XCircle className="h-3.5 w-3.5" />
            </AuroraButton>
          </div>
          <div className="space-y-3 p-4">
            <Field
              label={<span className="text-[10px] font-medium text-foreground">Task title</span>}
            >
              {({ id, ...fieldProps }) => (
                <AuroraInput
                  id={id}
                  {...fieldProps}
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What needs to be done?"
                  size="sm"
                  className="text-[11px]"
                />
              )}
            </Field>
            <Field
              label={<span className="text-[10px] font-medium text-foreground">Description</span>}
            >
              {({ id, ...fieldProps }) => (
                <AuroraTextarea
                  id={id}
                  {...fieldProps}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Add context for the agent (optional)"
                  rows={compact ? 2 : 3}
                  className="min-h-16 resize-none text-[11px]"
                />
              )}
            </Field>
            <div className="flex items-end gap-2">
              <Field
                className="min-w-0 flex-1"
                label={<span className="text-[10px] font-medium text-foreground">Priority</span>}
              >
                {({ id, ...fieldProps }) => (
                  <AuroraSelect
                    id={id}
                    {...fieldProps}
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as KanbanTaskPriority)}
                    size="sm"
                    className="text-[10px]"
                  >
                    {PRIORITIES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </AuroraSelect>
                )}
              </Field>
              <AuroraButton
                type="submit"
                disabled={isSaving || !title.trim()}
                size="sm"
                className="text-[10px]"
                loading={isSaving}
                leftIcon={!isSaving ? <Plus className="h-3 w-3" /> : undefined}
              >
                Create
              </AuroraButton>
            </div>
            {error && (
              <p
                role="alert"
                className="mt-2 rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive"
              >
                {error}
              </p>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetails({
  task,
  onToggleDetails,
}: {
  task: KanbanTask | null;
  onToggleDetails: () => void;
}) {
  const updateTask = useKanbanStore((state) => state.updateTask);
  const archiveTask = useKanbanStore((state) => state.archiveTask);
  const deleteTask = useKanbanStore((state) => state.deleteTask);
  const delegateTask = useKanbanStore((state) => state.delegateTask);
  const cancelTask = useKanbanStore((state) => state.cancelTask);
  const activities = useKanbanStore((state) => state.activities);
  const loadActivity = useKanbanStore((state) => state.loadActivity);
  const addComment = useKanbanStore((state) => state.addComment);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<KanbanTaskPriority>('none');
  const [autoTransition, setAutoTransition] = useState(true);
  const [labels, setLabels] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [mode, setMode] = useState<KanbanTaskRunMode>('dedicated_session');
  const [instructions, setInstructions] = useState('');
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDelegating, setIsDelegating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setAutoTransition(task.autoTransition);
    setLabels(task.labels.join(', '));
    setDueDate(task.dueDate?.slice(0, 10) ?? '');
    setInstructions(task.description);
    setError(null);
    void loadActivity(task.id);
  }, [task?.id, task?.version, loadActivity]);

  async function handleSave(): Promise<void> {
    if (!task || !title.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      await updateTask({
        taskId: task.id,
        title: title.trim(),
        description,
        priority,
        autoTransition,
        labels: labels.split(',').map((label) => label.trim()).filter(Boolean),
        dueDate: dueDate || null,
        expectedVersion: task.version,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelegate(): Promise<void> {
    if (!task || task.activeRun) return;
    setIsDelegating(true);
    setError(null);
    try {
      await delegateTask({
        taskId: task.id,
        mode,
        instructions: instructions.trim() || task.description || task.title,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsDelegating(false);
    }
  }

  async function handleArchive(): Promise<void> {
    if (task?.activeRun) return;
    const confirmed = await promptConfirm({
      title: 'Archive task',
      description: `Archive “${task?.title}”? The task will leave the active board and remain in storage.`,
      confirmLabel: 'Archive',
    });
    if (!task || !confirmed) return;
    setIsArchiving(true);
    setError(null);
    try {
      await archiveTask({ taskId: task.id, expectedVersion: task.version });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!task || task.activeRun) return;
    const confirmed = await promptConfirm({
      title: 'Delete task permanently',
      description: `Delete “${task.title}” and its runs and activity? This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!confirmed) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteTask({ taskId: task.id, expectedVersion: task.version });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!task || !comment.trim()) return;
    setIsCommenting(true);
    setError(null);
    try {
      await addComment({ taskId: task.id, body: comment.trim() });
      setComment('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsCommenting(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!task?.activeRun) return;
    setIsCancelling(true);
    setError(null);
    try {
      await cancelTask(task.activeRun.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsCancelling(false);
    }
  }

  if (!task) {
    return (
      <div className="flex h-full min-h-48 flex-col bg-surface">
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface-raised/60 px-3 py-2.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Inspector
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-foreground">Task details</p>
          </div>
          <AuroraButton
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onToggleDetails}
            aria-label="Collapse task details"
            title="Collapse task details"
          >
            <PanelRightClose className="size-3.5" />
          </AuroraButton>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="flex max-w-[230px] flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 bg-background/20 px-5 py-7 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <MousePointerClick className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-foreground">Select a task</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Inspect details, delegate work, or add a comment from here.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayRun = task.activeRun ?? task.latestRun;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface-raised/60 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Pencil className="size-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Inspector
            </p>
            <p className="truncate text-[12px] font-semibold text-foreground">{task.title}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">
            v{task.version}
          </Badge>
          <AuroraButton
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onToggleDetails}
            aria-label="Collapse task details"
            title="Collapse task details"
          >
            <PanelRightClose className="size-3.5" />
          </AuroraButton>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <Field
            label={<span className="text-[10px] font-medium text-muted-foreground">Title</span>}
          >
            {({ id, ...fieldProps }) => (
              <AuroraInput
                id={id}
                {...fieldProps}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                size="sm"
                className="text-[11px]"
              />
            )}
          </Field>
          <Field
            label={<span className="text-[10px] font-medium text-muted-foreground">Description</span>}
          >
            {({ id, ...fieldProps }) => (
              <AuroraTextarea
                id={id}
                {...fieldProps}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className="min-h-24 resize-y text-[11px]"
              />
            )}
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              className="min-w-0"
              label={<span className="text-[10px] font-medium text-muted-foreground">Priority</span>}
            >
              {({ id, ...fieldProps }) => (
                <AuroraSelect
                  id={id}
                  {...fieldProps}
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as KanbanTaskPriority)}
                  size="sm"
                  className="text-[10px]"
                >
                  {PRIORITIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </AuroraSelect>
              )}
            </Field>
            <Field
              className="min-w-0"
              label={<span className="text-[10px] font-medium text-muted-foreground">Due date</span>}
            >
              {({ id, ...fieldProps }) => (
                <AuroraInput
                  id={id}
                  {...fieldProps}
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  size="sm"
                  leftIcon={<CalendarDays className="size-3" />}
                  className="text-[10px]"
                />
              )}
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/25 px-2.5 py-2 sm:col-span-2">
              <div>
                <p className="text-[10px] font-medium text-foreground">Auto move</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  Advance the task as the agent progresses.
                </p>
              </div>
              <Switch
                checked={autoTransition}
                onCheckedChange={setAutoTransition}
                aria-label="Automatically move task as the agent progresses"
              />
            </div>
          </div>
          <Field
            label={<span className="text-[10px] font-medium text-muted-foreground">Labels</span>}
          >
            {({ id, ...fieldProps }) => (
              <AuroraInput
                id={id}
                {...fieldProps}
                value={labels}
                onChange={(event) => setLabels(event.target.value)}
                placeholder="frontend, urgent"
                size="sm"
                className="text-[10px]"
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            <AuroraButton
              type="button"
              onClick={() => void handleSave()}
              disabled={isArchiving || isDeleting || !title.trim()}
              size="sm"
              className="text-[10px]"
              loading={isSaving}
              leftIcon={!isSaving ? <Save className="size-3" /> : undefined}
            >
              Save changes
            </AuroraButton>
            <AuroraButton
              type="button"
              onClick={() => void handleArchive()}
              disabled={isSaving || isDeleting || Boolean(task.activeRun)}
              variant="outline"
              size="sm"
              className="text-[10px]"
              loading={isArchiving}
              leftIcon={!isArchiving ? <Archive className="size-3" /> : undefined}
            >
              Archive
            </AuroraButton>
            <AuroraButton
              type="button"
              onClick={() => void handleDelete()}
              disabled={isSaving || isArchiving || Boolean(task.activeRun)}
              variant="danger"
              size="sm"
              className="text-[10px]"
              loading={isDeleting}
              leftIcon={!isDeleting ? <Trash2 className="size-3" /> : undefined}
            >
              Delete
            </AuroraButton>
          </div>

          <section className="border-t border-border/60 pt-4">
            <div className="flex items-start gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Play className="size-3.5" />
              </div>
              <div>
                <h2 className="text-[11px] font-semibold text-foreground">Delegate to agent</h2>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  Send this task to VORTEX or the current chat.
                </p>
              </div>
            </div>
            <Field
              className="mt-3"
              label={<span className="text-[10px] font-medium text-muted-foreground">Instructions</span>}
            >
              {({ id, ...fieldProps }) => (
                <AuroraTextarea
                  id={id}
                  {...fieldProps}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  rows={3}
                  placeholder="Instructions for the agent"
                  className="min-h-20 resize-y text-[11px]"
                />
              )}
            </Field>
            <div className="mt-2 flex items-end gap-2">
              <Field
                className="min-w-0 flex-1"
                label={<span className="text-[10px] font-medium text-muted-foreground">Execution target</span>}
              >
                {({ id, ...fieldProps }) => (
                  <AuroraSelect
                    id={id}
                    {...fieldProps}
                    value={mode}
                    onChange={(event) => setMode(event.target.value as KanbanTaskRunMode)}
                    size="sm"
                    className="text-[10px]"
                  >
                    <option value="dedicated_session">Dedicated VORTEX session</option>
                    <option value="current_chat">Current chat</option>
                  </AuroraSelect>
                )}
              </Field>
              <AuroraButton
                type="button"
                onClick={() => void handleDelegate()}
                disabled={Boolean(task.activeRun)}
                size="sm"
                className="text-[10px]"
                loading={isDelegating}
                leftIcon={!isDelegating ? <Play className="size-3 fill-current" /> : undefined}
              >
                {task.activeRun ? 'Running' : task.columnKey === 'blocked' ? 'Retry' : 'Run'}
              </AuroraButton>
              {task.activeRun && (
                <AuroraButton
                  type="button"
                  onClick={() => void handleCancel()}
                  variant="danger"
                  size="sm"
                  className="text-[10px]"
                  loading={isCancelling}
                  leftIcon={!isCancelling ? <CircleStop className="size-3" /> : undefined}
                >
                  Stop
                </AuroraButton>
              )}
            </div>
            {displayRun && (
              <div className="mt-2 rounded-md border border-primary/25 bg-primary/5 p-2.5 text-[10px]">
                <div className="flex items-center gap-1.5 font-medium text-primary">
                  <Clock3 className="h-3 w-3" />
                  {runLabel(displayRun)} · {displayRun?.mode === 'dedicated_session' ? 'VORTEX' : 'current chat'}
                </div>
                {displayRun?.summary && <p className="mt-1 text-muted-foreground">{displayRun.summary}</p>}
                {displayRun?.error && <p className="mt-1 text-destructive">{displayRun.error}</p>}
              </div>
            )}
          </section>

          <section className="border-t border-border/60 pt-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-[11px] font-semibold text-foreground">Activity</h2>
            </div>
            <form onSubmit={handleComment} className="mt-2 flex items-end gap-1.5">
              <Field
                className="min-w-0 flex-1"
                label={<span className="text-[10px] font-medium text-muted-foreground">Comment</span>}
              >
                {({ id, ...fieldProps }) => (
                  <AuroraInput
                    id={id}
                    {...fieldProps}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Add a comment"
                    size="sm"
                    className="text-[10px]"
                  />
                )}
              </Field>
              <AuroraButton
                type="submit"
                disabled={!comment.trim()}
                variant="outline"
                size="sm"
                className="text-[10px]"
                loading={isCommenting}
              >
                Add
              </AuroraButton>
            </form>
            <div className="mt-2 space-y-1.5">
              {activities.slice(-8).map((activity) => (
                <div key={activity.id} className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2 text-[10px]">
                  <div className="flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                    <span>{activity.actor}</span>
                    <span>{new Date(activity.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-foreground">{activity.body}</p>
                </div>
              ))}
              {activities.length === 0 && (
                <div className="rounded-md border border-dashed border-border/60 px-2.5 py-3 text-center">
                  <p className="text-[10px] text-muted-foreground">No activity yet.</p>
                </div>
              )}
            </div>
          </section>
          {error && (
            <div role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-[10px] text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TaskBoardSkeleton({ compact }: { compact: boolean }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-background/30 p-3"
      aria-busy="true"
      aria-label="Loading Kanban tasks"
    >
      <div className="grid min-w-[980px] grid-cols-5 gap-2.5">
        {KANBAN_COLUMNS.map((column) => (
          <section
            key={column.key}
            className={cn(
              'min-h-[280px] overflow-hidden rounded-xl border border-border/60 border-t-2 bg-surface p-2.5',
              column.accentClass,
            )}
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 animate-pulse rounded bg-muted/80" />
              <div className="size-5 animate-pulse rounded-full bg-muted/80" />
            </div>
            <div className="mt-3 space-y-2">
              {Array.from({ length: compact ? 2 : 3 }, (_, index) => (
                <div key={index} className="rounded-lg border border-border/50 bg-surface-raised/70 p-2.5">
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted/80" />
                  <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-muted/70" />
                  <div className="mt-2 h-2.5 w-2/5 animate-pulse rounded bg-muted/70" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function TaskColumnEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex min-h-36 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/20 px-2 py-5 text-center transition-colors group-hover:border-primary/30">
      {filtered ? (
        <Search className="size-4 text-muted-foreground/70" />
      ) : (
        <Inbox className="size-4 text-muted-foreground/70" />
      )}
      <p className="mt-2 text-[10px] font-medium text-foreground">
        {filtered ? 'No matching tasks' : 'No tasks here'}
      </p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">
        {filtered ? 'Try a different search.' : 'Drop a task here to get started.'}
      </p>
    </div>
  );
}

function NoProjectState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background/30 p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 bg-surface px-6 py-8 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Inbox className="size-5" />
        </div>
        <div>
          <p className="text-[12px] font-semibold text-foreground">Open a project to use Kanban</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Tasks are scoped to the active Desktop project and stay synchronized with the agent.
          </p>
        </div>
      </div>
    </div>
  );
}

export function KanbanBoard({ compact = false }: { compact?: boolean }) {
  const projectId = useProjectStore((state) => state.rootPath);
  const tasks = useKanbanStore((state) => state.tasks);
  const selectedTaskId = useKanbanStore((state) => state.selectedTaskId);
  const isLoading = useKanbanStore((state) => state.isLoading);
  const storeError = useKanbanStore((state) => state.error);
  const loadProject = useKanbanStore((state) => state.loadProject);
  const reset = useKanbanStore((state) => state.reset);
  const refresh = useKanbanStore((state) => state.refresh);
  const selectTask = useKanbanStore((state) => state.selectTask);
  const moveTask = useKanbanStore((state) => state.moveTask);
  const archiveTask = useKanbanStore((state) => state.archiveTask);
  const deleteTask = useKanbanStore((state) => state.deleteTask);
  const delegateTask = useKanbanStore((state) => state.delegateTask);
  const cancelTask = useKanbanStore((state) => state.cancelTask);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState('');
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const detailsPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    if (!projectId) {
      reset();
      return;
    }
    void loadProject(projectId);
  }, [projectId, loadProject, reset]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (!query) return true;
        return `${task.title} ${task.description} ${task.labels.join(' ')}`
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => left.position - right.position || left.updatedAt.localeCompare(right.updatedAt));
  }, [search, tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const runningTaskCount = tasks.filter((task) => Boolean(task.activeRun)).length;
  const isFiltering = search.trim().length > 0;

  function tasksForColumn(columnKey: KanbanTaskColumnKey): KanbanTask[] {
    return filteredTasks.filter((task) => task.columnKey === columnKey);
  }

  function allTasksForColumn(columnKey: KanbanTaskColumnKey): KanbanTask[] {
    return tasks
      .filter((task) => task.columnKey === columnKey)
      .sort((left, right) => left.position - right.position || left.updatedAt.localeCompare(right.updatedAt));
  }

  function handleDragStart(task: KanbanTask, event: DragEvent<HTMLElement>): void {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/kanban-task', task.id);
  }

  async function handleDrop(
    columnKey: KanbanTaskColumnKey,
    event: DragEvent<HTMLElement>,
    position?: number,
  ): Promise<void> {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kanban-task');
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const targetPosition = position ?? allTasksForColumn(columnKey).length;
    if (task.columnKey === columnKey && task.position === targetPosition) return;
    setActionError(null);
    try {
      await moveTask({
        taskId,
        columnKey,
        position: targetPosition,
        expectedVersion: task.version,
      });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handleKeyboardMove(task: KanbanTask, direction: -1 | 1): Promise<void> {
    const currentIndex = KANBAN_COLUMNS.findIndex((column) => column.key === task.columnKey);
    const target = KANBAN_COLUMNS[currentIndex + direction];
    if (!target) return;
    setActionError(null);
    try {
      await moveTask({
        taskId: task.id,
        columnKey: target.key,
        position: allTasksForColumn(target.key).length,
        expectedVersion: task.version,
      });
      setKeyboardAnnouncement(`${task.title} moved to ${target.label}.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handleMoveTo(task: KanbanTask, columnKey: KanbanTaskColumnKey): Promise<void> {
    if (task.columnKey === columnKey) return;
    const target = KANBAN_COLUMNS.find((column) => column.key === columnKey);
    if (!target) return;
    setPendingTaskId(task.id);
    setActionError(null);
    try {
      await moveTask({
        taskId: task.id,
        columnKey,
        position: allTasksForColumn(columnKey).length,
        expectedVersion: task.version,
      });
      setKeyboardAnnouncement(`${task.title} moved to ${target.label}.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  }

  async function handleArchiveTask(task: KanbanTask): Promise<void> {
    if (task.activeRun) return;
    const confirmed = await promptConfirm({
      title: 'Archive task',
      description: `Archive “${task.title}”? The task will leave the active board and remain in storage.`,
      confirmLabel: 'Archive',
    });
    if (!confirmed) return;
    setPendingTaskId(task.id);
    setActionError(null);
    try {
      await archiveTask({ taskId: task.id, expectedVersion: task.version });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  }

  async function handleDeleteTask(task: KanbanTask): Promise<void> {
    if (task.activeRun) return;
    const confirmed = await promptConfirm({
      title: 'Delete task permanently',
      description: `Delete “${task.title}” and its runs and activity? This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!confirmed) return;
    setPendingTaskId(task.id);
    setActionError(null);
    try {
      await deleteTask({ taskId: task.id, expectedVersion: task.version });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  }

  async function handleDelegateTask(task: KanbanTask): Promise<void> {
    if (task.activeRun) return;
    setPendingTaskId(task.id);
    setActionError(null);
    try {
      await delegateTask({
        taskId: task.id,
        mode: 'dedicated_session',
        instructions: task.description.trim() || task.title,
      });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  }

  async function handleCancelTask(task: KanbanTask): Promise<void> {
    const runId = task.activeRun?.id;
    if (!runId) return;
    setPendingTaskId(task.id);
    setActionError(null);
    try {
      await cancelTask(runId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  }

  function handleCreated(task: KanbanTask): void {
    selectTask(task.id);
  }

  function toggleDetails(): void {
    if (compact) {
      setDetailsCollapsed((current) => !current);
      return;
    }
    if (detailsCollapsed) {
      detailsPanelRef.current?.expand();
    } else {
      detailsPanelRef.current?.collapse();
    }
  }

  function handleDetailsLayout(sizes: number[]): void {
    const detailsSize = sizes[1];
    if (detailsSize === undefined) return;
    const nextCollapsed = detailsSize <= 0;
    setDetailsCollapsed((current) => (current === nextCollapsed ? current : nextCollapsed));
  }

  const boardColumns = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background/30">
      <ScrollArea className="h-full">
        <div className="min-w-[980px] p-3">
          <div className="grid grid-cols-5 gap-2.5">
            {KANBAN_COLUMNS.map((column) => {
              const columnTasks = tasksForColumn(column.key);
              return (
                <section
                  key={column.key}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => void handleDrop(column.key, event)}
                  className={cn(
                    'group flex min-h-[280px] flex-col overflow-hidden rounded-xl border border-border/60 border-t-2 bg-surface',
                    column.accentClass,
                  )}
                >
                  <div className="flex items-center justify-between border-b border-border/60 bg-surface-raised/45 px-2.5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('size-1.5 rounded-full', column.dotClass)} aria-hidden="true" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground/80">
                        {column.label}
                      </span>
                    </div>
                    <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[9px]">
                      {columnTasks.length}
                    </Badge>
                  </div>
                  <div className="flex min-h-36 flex-1 flex-col gap-2 p-2">
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        selected={task.id === selectedTaskId}
                        onSelect={() => selectTask(task.id)}
                        onDragStart={(event) => handleDragStart(task, event)}
                        onDrop={(event) => void handleDrop(column.key, event, task.position)}
                        onMove={(direction) => void handleKeyboardMove(task, direction)}
                        onMoveTo={(columnKey) => void handleMoveTo(task, columnKey)}
                        onArchive={() => void handleArchiveTask(task)}
                        onDelete={() => void handleDeleteTask(task)}
                        onDelegate={() => void handleDelegateTask(task)}
                        onCancel={() => void handleCancelTask(task)}
                        isActionPending={pendingTaskId === task.id}
                      />
                    ))}
                    {columnTasks.length === 0 && <TaskColumnEmptyState filtered={isFiltering} />}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="relative flex shrink-0 flex-wrap items-center gap-3 border-b border-border/70 bg-surface px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <CheckCircle2 className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[12px] font-semibold tracking-tight text-foreground">Kanban board</h1>
              <AuroraBadge variant="neutral" size="sm" className="h-5 px-1.5 text-[9px]">
                {tasks.length} tasks
              </AuroraBadge>
            </div>
            <p className="hidden truncate text-[9px] text-muted-foreground sm:block">
              {isFiltering ? `Showing ${filteredTasks.length} of ${tasks.length} tasks` : 'Project task flow'}
            </p>
          </div>
          {runningTaskCount > 0 && (
            <AuroraBadge variant="primary" size="sm" dot className="hidden h-5 px-1.5 text-[9px] sm:inline-flex">
              <Play className="h-2.5 w-2.5 fill-current" />
              {runningTaskCount} active
            </AuroraBadge>
          )}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <AuroraSearchInput
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch('')}
            placeholder="Search tasks"
            aria-label="Search tasks"
            size="sm"
            className="w-[clamp(9rem,18vw,14rem)] border border-border/70 bg-surface-raised px-2 text-[10px]"
          />
          <AuroraButton
            type="button"
            onClick={() => void refresh()}
            variant="ghost"
            size="icon"
            className="size-7"
            title="Refresh Kanban"
            aria-label="Refresh Kanban"
            loading={isLoading}
          >
            <RefreshCw className="size-3.5" />
          </AuroraButton>
          {detailsCollapsed && (
            <AuroraButton
              type="button"
              onClick={toggleDetails}
              variant="outline"
              size="sm"
              className="text-[10px]"
              leftIcon={<PanelRightOpen className="size-3.5" />}
              aria-label="Open task details"
              title="Open task details"
            >
              Details
            </AuroraButton>
          )}
          <NewTaskForm compact={compact} onCreated={handleCreated} disabled={!projectId} />
        </div>
        {actionError && (
          <div role="alert" className="basis-full flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[10px] text-destructive">
            <AlertCircle className="mt-0.5 size-3 shrink-0" />
            {actionError}
          </div>
        )}
      </header>

      {storeError && (
        <div role="alert" className="m-3 flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-[10px] text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{storeError}</span>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{keyboardAnnouncement}</span>

      {!projectId ? (
        <NoProjectState />
      ) : isLoading ? (
        <TaskBoardSkeleton compact={compact} />
      ) : (
        <div className={cn('min-h-0 flex-1', compact ? 'flex flex-col' : 'flex')}>
          {compact ? (
            <>
              <div className="min-h-[280px] min-w-0 flex-1 overflow-hidden bg-background/30">{boardColumns}</div>
              {!detailsCollapsed && (
                <aside className="min-h-0 max-h-[58%] border-t border-border/70 bg-surface">
                  <TaskDetails task={selectedTask} onToggleDetails={toggleDetails} />
                </aside>
              )}
            </>
          ) : (
            <PanelGroup
              direction="horizontal"
              autoSaveId="hyscode-kanban-task-details"
              onLayout={handleDetailsLayout}
              className="min-h-0 min-w-0 flex-1"
            >
              <Panel defaultSize={68} minSize={48}>
                {boardColumns}
              </Panel>
              {!detailsCollapsed && (
                <PanelResizeHandle
                  aria-label="Resize task details panel"
                  className="group relative z-10 w-2 shrink-0 cursor-col-resize bg-transparent outline-none transition-colors focus-visible:bg-primary/10"
                >
                  <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
                  <GripVertical className="pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                </PanelResizeHandle>
              )}
              <Panel
                ref={detailsPanelRef}
                defaultSize={32}
                minSize={24}
                maxSize={48}
                collapsible
                collapsedSize={0}
                onCollapse={() => setDetailsCollapsed(true)}
                onExpand={() => setDetailsCollapsed(false)}
              >
                <aside className="h-full min-h-0 min-w-0 overflow-hidden bg-surface">
                  <TaskDetails task={selectedTask} onToggleDetails={toggleDetails} />
                </aside>
              </Panel>
            </PanelGroup>
          )}
        </div>
      )}
    </div>
  );
}

export function TasksView() {
  return <KanbanBoard compact />;
}
