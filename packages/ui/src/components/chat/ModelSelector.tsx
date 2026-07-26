import { type ReactNode } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
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
        {current?.icon ?? <Sparkles className="text-primary" />}
        {current?.name ?? "Select model"}
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {models.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => setSelected(model.id)}
            className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
          >
            <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">
              {model.icon ?? <Sparkles />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{model.name}</span>
                {model.badge}
              </span>
              {model.description && (
                <span className="block text-xs text-muted-foreground">{model.description}</span>
              )}
            </span>
            {selected === model.id && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
