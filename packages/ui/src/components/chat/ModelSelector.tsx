import { type ReactNode } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../primitives/DropdownMenu";
import { useControllableState } from "../../lib/hooks/useControllableState";

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export interface ModelSelectorProps {
  models: ModelOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  className?: string;
}

/** Model picker dropdown (ChatGPT-style). */
export function ModelSelector({
  models,
  value,
  defaultValue,
  onValueChange,
  className,
}: ModelSelectorProps) {
  const [selected, setSelected] = useControllableState({
    value,
    defaultValue: defaultValue ?? models[0]?.id,
    onChange: onValueChange,
  });
  const current = models.find((m) => m.id === selected);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
          className,
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0">
            {current?.icon ?? <Sparkles className="text-primary" />}
          </span>
          <span className="truncate">{current?.name ?? "Select model"}</span>
        </span>
        <ChevronDown className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={12}
        className="max-h-[calc(100dvh-1.5rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain sm:max-h-80"
      >
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onSelect={() => setSelected(model.id)}
            className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
          >
            <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">
              {model.icon ?? <Sparkles />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{model.name}</span>
                {model.badge}
              </span>
              {model.description && (
                <span className="block text-xs text-muted-foreground">{model.description}</span>
              )}
            </span>
            {selected === model.id && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
