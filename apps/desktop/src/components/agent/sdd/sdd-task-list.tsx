import {
  Check,
  Circle,
  Loader2,
  AlertCircle,
  SkipForward,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { useAgentStore } from '@/stores/agent-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SddTaskStatus } from '@hyscode/agent-harness';

const STATUS_ICONS: Record<
  SddTaskStatus,
  { icon: typeof Check; color: string; animate?: boolean }
> = {
  pending: { icon: Circle, color: 'text-muted-foreground/35' },
  in_progress: { icon: Loader2, color: 'text-primary', animate: true },
  completed: { icon: Check, color: 'text-success/80' },
  skipped: { icon: SkipForward, color: 'text-warning/80' },
  failed: { icon: AlertCircle, color: 'text-destructive/80' },
};

export function SddTaskList() {
  const tasks = useAgentStore((s) => s.sddTasks);
  const sddProgress = useAgentStore((s) => s.sddProgress);
  const sddPhase = useAgentStore((s) => s.sddPhase);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const failedTask = useAgentStore((s) => s.sddFailedTask);
  const [paused, setPaused] = useState(false);

  if (tasks.length === 0) return null;

  const isPlanReview = sddPhase === 'planning' && !isStreaming;
  const isExecuting = sddPhase === 'executing';

  const handlePauseResume = () => {
    try {
      const bridge = HarnessBridge.get();
      if (paused || failedTask) {
        void bridge.resumeSdd();
        useAgentStore.getState().setSddFailedTask(null);
      } else {
        bridge.pauseSdd();
      }
      setPaused(!(paused || failedTask));
    } catch {
      // bridge not ready
    }
  };

  const handleRetryTask = async (taskId: string) => {
    try {
      await HarnessBridge.get().retrySddTask(taskId);
      useAgentStore.getState().setSddFailedTask(null);
      setPaused(true);
    } catch {
      // bridge not ready
    }
  };

  const handleSkipTask = async (taskId: string) => {
    try {
      await HarnessBridge.get().skipSddTask(taskId);
      if (failedTask?.id === taskId) {
        useAgentStore.getState().setSddFailedTask(null);
        setPaused(true);
      }
    } catch {
      // bridge not ready
    }
  };

  const handleApprovePlan = async () => {
    try {
      await HarnessBridge.get().approveSddPlan();
    } catch {
      // bridge not ready
    }
  };

  return (
    <div className="mx-4 my-3 border-l-2 border-foreground/[0.08] pl-3">
      {/* Header with progress + controls */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground/85">
          {isPlanReview ? 'Review Plan' : 'Tasks'}
        </span>
        <div className="flex items-center gap-1.5">
          {isExecuting && (
            <>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {sddProgress}%
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handlePauseResume}
                      className="h-5 w-5 text-muted-foreground/60 hover:text-foreground"
                    />
                  }
                >
                  {paused || failedTask ? (
                    <Play className="h-3 w-3" />
                  ) : (
                    <Pause className="h-3 w-3" />
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {paused || failedTask ? 'Resume' : 'Pause'}
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Progress bar (only during execution) */}
      {isExecuting && (
        <div className="mt-1.5 h-1 w-full rounded-full bg-foreground/[0.06]">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${sddProgress}%` }}
          />
        </div>
      )}

      {/* Task list */}
      <div className="mt-2 flex flex-col gap-1">
        {tasks.map((task, i) => {
          const statusConfig = STATUS_ICONS[task.status];
          const Icon = statusConfig.icon;
          const canSkip =
            task.status === 'pending' || task.status === 'in_progress' || task.status === 'failed';
          return (
            <div
              key={task.id}
              className="group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/[0.02]"
            >
              <Icon
                className={cn(
                  'mt-0.5 h-3 w-3 shrink-0',
                  statusConfig.color,
                  statusConfig.animate ? 'animate-spin' : '',
                )}
              />
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-medium text-foreground/85">
                  {i + 1}. {task.title}
                </span>
                {task.description && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground/65">
                    {task.description}
                  </p>
                )}
                {task.files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {task.files.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70"
                      >
                        {f.split(/[\\/]/).pop()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {task.status === 'failed' && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRetryTask(task.id)}
                        className="h-5 w-5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                      />
                    }
                  >
                    <RotateCcw className="h-3 w-3" />
                  </TooltipTrigger>
                  <TooltipContent side="top">Retry task</TooltipContent>
                </Tooltip>
              )}
              {canSkip && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleSkipTask(task.id)}
                        className="h-5 w-5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-warning group-hover:opacity-100"
                      />
                    }
                  >
                    <SkipForward className="h-3 w-3" />
                  </TooltipTrigger>
                  <TooltipContent side="top">Skip task</TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>

      {/* Plan approval button — shown when plan is ready for review */}
      {isPlanReview && (
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleApprovePlan}
            className="h-6 text-[11px]"
          >
            Approve & Execute
          </Button>
        </div>
      )}
    </div>
  );
}
