import { Target } from 'lucide-react';
import type { AgentMode } from '@/stores/agent-store';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type GoalModeToggleProps = {
  mode: AgentMode;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function GoalModeToggle({ mode, enabled, onChange }: GoalModeToggleProps) {
  const available = mode === 'build';
  const label = !available
    ? 'Goal mode is available in Build only'
    : enabled
      ? 'Disable Goal mode'
      : 'Enable Goal mode';

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!available}
            aria-label={label}
            aria-pressed={available && enabled}
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              'disabled:cursor-not-allowed disabled:opacity-40',
              enabled && available && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
            )}
            onClick={() => {
              if (available) onChange(!enabled);
            }}
          />
        }
      >
        <Target className="h-4 w-4" />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
