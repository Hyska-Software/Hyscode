import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronRight,
  Regex,
  Replace,
  WholeWord,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useControllableState } from "../../lib/hooks/useControllableState";

export interface SearchPanelState {
  query: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchPanelProps {
  onSearch?: (state: SearchPanelState) => void;
  onReplace?: (state: SearchPanelState, all: boolean) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  /** e.g. "3 of 12" */
  matchInfo?: ReactNode;
  query?: string;
  onQueryChange?: (q: string) => void;
  className?: string;
}

const toggle =
  "flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted [&_svg]:size-3.5 data-[on=true]:bg-primary/20 data-[on=true]:text-primary";

/** VS Code-style find & replace panel. */
export function SearchPanel({
  onSearch,
  onReplace,
  onNext,
  onPrevious,
  matchInfo,
  query,
  onQueryChange,
  className,
}: SearchPanelProps) {
  const [q, setQ] = useControllableState({ value: query, defaultValue: "", onChange: onQueryChange });
  const [replace, setReplace] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);

  const state: SearchPanelState = { query: q, replace, caseSensitive, wholeWord, regex };

  return (
    <div className={cn("flex gap-1 rounded-lg   bg-card p-2", className)}>
      <button
        type="button"
        aria-label="Toggle replace"
        onClick={() => setShowReplace((s) => !s)}
        className="flex w-5 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-4 transition-transform", showReplace && "rotate-90")} />
      </button>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-1 rounded-md   bg-background px-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              onSearch?.({ ...state, query: e.target.value });
            }}
            placeholder="Find"
            className="h-7 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {matchInfo && <span className="text-xs text-muted-foreground">{matchInfo}</span>}
          <button type="button" data-on={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} className={toggle} aria-label="Match case" title="Match case">
            <CaseSensitive />
          </button>
          <button type="button" data-on={wholeWord} onClick={() => setWholeWord((v) => !v)} className={toggle} aria-label="Whole word" title="Whole word">
            <WholeWord />
          </button>
          <button type="button" data-on={regex} onClick={() => setRegex((v) => !v)} className={toggle} aria-label="Use regex" title="Use regex">
            <Regex />
          </button>
          <button type="button" onClick={onPrevious} className={toggle} aria-label="Previous match" title="Previous">
            <ArrowUp />
          </button>
          <button type="button" onClick={onNext} className={toggle} aria-label="Next match" title="Next">
            <ArrowDown />
          </button>
        </div>
        {showReplace && (
          <div className="flex items-center gap-1 rounded-md   bg-background px-2">
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Replace"
              className="h-7 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button type="button" onClick={() => onReplace?.(state, false)} className={toggle} aria-label="Replace" title="Replace">
              <Replace />
            </button>
            <button
              type="button"
              onClick={() => onReplace?.(state, true)}
              className="rounded-sm px-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              All
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
