import { type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../primitives/HoverCard";

export interface Source {
  id: string;
  title: string;
  url?: string;
  snippet?: ReactNode;
  favicon?: string;
}

export interface CitationProps {
  /** 1-based citation index shown in the superscript badge. */
  index: number;
  source: Source;
  className?: string;
}

/** Inline citation marker with a hover preview of the source. */
export function Citation({ index, source, className }: CitationProps) {
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "mx-0.5 inline-flex size-4 items-center justify-center rounded-[4px] bg-muted align-super text-[0.65rem] font-medium text-muted-foreground no-underline transition-colors hover:bg-primary/20 hover:text-primary",
            className,
          )}
        >
          {index}
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="flex items-center gap-2">
          {source.favicon && <img src={source.favicon} alt="" className="size-4 rounded-sm" />}
          <p className="truncate text-sm font-medium text-foreground">{source.title}</p>
        </div>
        {source.snippet && (
          <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{source.snippet}</p>
        )}
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" />
            {new URL(source.url).hostname}
          </a>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export interface SourceListProps {
  sources: Source[];
  title?: ReactNode;
  className?: string;
}

/** Compact list of sources shown under an assistant answer. */
export function SourceList({ sources, title = "Sources", className }: SourceListProps) {
  if (sources.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-xs items-center gap-2 rounded-lg   bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
          >
            <span className="flex size-4 items-center justify-center rounded-[4px] bg-muted text-[0.65rem] text-muted-foreground">
              {i + 1}
            </span>
            {s.favicon && <img src={s.favicon} alt="" className="size-4 rounded-sm" />}
            <span className="truncate">{s.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
