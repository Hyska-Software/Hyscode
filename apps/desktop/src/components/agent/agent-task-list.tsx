import { useState } from 'react';
import { Check, Circle, Loader2, X, ChevronDown, ChevronRight, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agent-store';

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <Check className="size-3 shrink-0 text-success" />;
    case 'in_progress':
      return <Loader2 className="size-3 shrink-0 animate-spin text-primary" />;
    case 'blocked':
      return <X className="size-3 shrink-0 text-muted-foreground" />;
    default:
      return <Circle className="size-3 shrink-0 text-muted-foreground" />;
  }
}

export function AgentTaskList() {
  const [isExpanded, setIsExpanded] = useState(true);
  const tasks = useAgentStore((s) => s.agentTasks);
  if (tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="px-4 py-1">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-0.5 py-px text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <ListTodo className="size-3 shrink-0" />
        <span>
          {done}/{tasks.length} tasks
        </span>
      </button>

      {isExpanded && (
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-1.5 px-1">
              <span className="mt-px shrink-0">{statusIcon(task.status)}</span>
              <span
                className={cn(
                  'text-xs leading-relaxed',
                  task.status === 'completed' && 'text-muted-foreground line-through',
                  task.status === 'blocked' && 'text-muted-foreground line-through opacity-70',
                  task.status === 'in_progress' && 'font-medium text-foreground',
                  task.status === 'not_started' && 'text-foreground',
                )}
              >
                {task.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
