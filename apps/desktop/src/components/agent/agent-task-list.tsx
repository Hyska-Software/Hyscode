import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ListTodo,
} from 'lucide-react';
import { useState } from 'react';
import { useAgentStore } from '@/stores/agent-store';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<
  string,
  { icon: typeof CheckCircle2; color: string; animate?: boolean }
> = {
  not_started: { icon: Circle, color: 'text-muted-foreground/30' },
  in_progress: { icon: Loader2, color: 'text-primary', animate: true },
  completed: { icon: CheckCircle2, color: 'text-success/80' },
  blocked: { icon: AlertTriangle, color: 'text-warning/80' },
};

export function AgentTaskList() {
  const tasks = useAgentStore((s) => s.agentTasks);
  const [expanded, setExpanded] = useState(true);

  if (tasks.length === 0) return null;

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const total = tasks.length;
  const allDone = completed === total;

  return (
    <div className="agent-fade-in mx-4 my-2 border-l-2 border-foreground/[0.08] pl-3">
      <div>
        {/* Header — clickable to expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 py-1 text-left transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          )}
          <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
          <span className="text-[11px] font-medium text-foreground/80">
            Todos ({completed}/{total})
          </span>

          {/* Mini progress indicator */}
          {!allDone && (
            <div className="ml-auto h-1 w-16 overflow-hidden rounded-full bg-foreground/[0.08]">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.round((completed / total) * 100)}%` }}
              />
            </div>
          )}
          {allDone && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-success/80" />}
        </button>

        {/* Task items */}
        {expanded && (
          <div className="mt-1 space-y-0.5 border-l border-foreground/[0.06] pl-3">
            {tasks.map((task) => {
              const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.not_started;
              const Icon = cfg.icon;
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors"
                >
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 flex-shrink-0',
                      cfg.color,
                      cfg.animate && 'animate-spin',
                    )}
                  />
                  <span
                    className={cn(
                      'truncate text-[11px]',
                      task.status === 'completed'
                        ? 'text-muted-foreground/50'
                        : task.status === 'in_progress'
                          ? 'font-medium text-foreground'
                          : 'text-foreground/75',
                    )}
                  >
                    {task.title}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
