import { Fragment, type ReactNode } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { cn } from "../../lib/cn";

export interface Conversation {
  id: string;
  title: string;
  /** Group header, e.g. "Today", "Yesterday", "Previous 7 days". */
  group?: string;
  icon?: ReactNode;
}

export interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  className?: string;
}

/** ChatGPT-style history sidebar list, grouped by time bucket. */
export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
  className,
}: ConversationListProps) {
  const groups: [string, Conversation[]][] = [];
  for (const c of conversations) {
    const key = c.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last[0] === key) last[1].push(c);
    else groups.push([key, [c]]);
  }

  return (
    <nav className={cn("flex flex-col gap-3 p-2", className)}>
      {groups.map(([group, items], gi) => (
        <Fragment key={gi}>
          <div className="flex flex-col gap-0.5">
            {group && (
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{group}</p>
            )}
            {items.map((conv) => {
              const active = conv.id === activeId;
              return (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors",
                    active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect?.(conv.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left [&_svg]:size-4"
                  >
                    {conv.icon ?? <MessageSquare className="shrink-0 text-muted-foreground" />}
                    <span className="truncate">{conv.title}</span>
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(conv.id)}
                      aria-label={`Delete ${conv.title}`}
                      className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Fragment>
      ))}
    </nav>
  );
}
