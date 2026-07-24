import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface PromptSuggestion {
  id?: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  prompt?: string;
}

export interface PromptSuggestionsProps {
  suggestions: PromptSuggestion[];
  onSelect?: (suggestion: PromptSuggestion) => void;
  /** "cards" (grid) or "chips" (inline). */
  variant?: "cards" | "chips";
  className?: string;
}

/** Starter-prompt suggestions shown in an empty chat. */
export function PromptSuggestions({
  suggestions,
  onSelect,
  variant = "cards",
  className,
}: PromptSuggestionsProps) {
  if (variant === "chips") {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        {suggestions.map((s, i) => (
          <button
            key={s.id ?? i}
            type="button"
            onClick={() => onSelect?.(s)}
            className="inline-flex items-center gap-1.5 rounded-full   bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted [&_svg]:size-4"
          >
            {s.icon}
            {s.title}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {suggestions.map((s, i) => (
        <button
          key={s.id ?? i}
          type="button"
          onClick={() => onSelect?.(s)}
          className="group flex items-start gap-3 rounded-xl   bg-card p-3 text-left transition-all hover: hover:shadow-sm dark:hover:"
        >
          {s.icon && (
            <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{s.icon}</span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{s.title}</span>
            {s.subtitle && (
              <span className="block truncate text-xs text-muted-foreground">{s.subtitle}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
