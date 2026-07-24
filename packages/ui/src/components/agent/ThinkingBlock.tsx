import { type ReactNode } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../primitives/Collapsible";

export interface ThinkingBlockProps {
  children: ReactNode;
  /** Header label. Default "Thought for a few seconds". */
  label?: ReactNode;
  /** Pulse the label while the model is still reasoning. */
  thinking?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

/** Collapsible reasoning / chain-of-thought trace. */
export function ThinkingBlock({
  children,
  label = "Reasoning",
  thinking = false,
  defaultOpen = false,
  className,
}: ThinkingBlockProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("text-sm", className)}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <Brain className={cn("size-3.5", thinking && "animate-pulse text-primary")} />
        <span className={cn(thinking && "animate-pulse")}>{label}</span>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1   pl-3 text-sm italic leading-relaxed text-muted-foreground">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
