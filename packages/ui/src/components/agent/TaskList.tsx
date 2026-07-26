import { type ReactNode } from "react";
import { Check, Circle, CircleDot, Loader2, X } from "lucide-react";
import { cn } from "../../lib/cn";

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface Task {
  id?: string;
  content: ReactNode;
  status: TaskStatus;
}

export interface TaskListProps {
  tasks: Task[];
  title?: ReactNode;
  /** Show "n of m" progress in the header. */
  showProgress?: boolean;
  className?: string;
}

function TaskGlyph({ status }: { status: TaskStatus }) {
  switch (status) {
    case "completed":
      return <Check className="size-4 text-success-500" />;
    case "in_progress":
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case "cancelled":
      return <X className="size-4 text-muted-foreground" />;
    case "pending":
    default:
      return <Circle className="size-4 text-muted-foreground" />;
  }
}

/** Agent plan / todo list with per-task status (todowrite style). */
export function TaskList({ tasks, title = "Plan", showProgress = true, className }: TaskListProps) {
  const done = tasks.filter((t) => t.status === "completed").length;
  return (
    <div className={cn("overflow-hidden rounded-lg   bg-card", className)}>
      {(title || showProgress) && (
        <div className="flex items-center justify-between   px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CircleDot className="size-4 text-primary" />
            {title}
          </div>
          {showProgress && (
            <span className="text-xs text-muted-foreground">
              {done}/{tasks.length}
            </span>
          )}
        </div>
      )}
      <ul className=" ">
        {tasks.map((task, i) => (
          <li key={task.id ?? i} className="flex items-start gap-2.5 px-3 py-2 text-sm">
            <span className="mt-0.5 shrink-0">
              <TaskGlyph status={task.status} />
            </span>
            <span
              className={cn(
                "leading-relaxed",
                task.status === "completed" && "text-muted-foreground line-through",
                task.status === "cancelled" && "text-muted-foreground line-through opacity-70",
                task.status === "in_progress" && "font-medium text-foreground",
                (task.status === "pending") && "text-foreground",
              )}
            >
              {task.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
