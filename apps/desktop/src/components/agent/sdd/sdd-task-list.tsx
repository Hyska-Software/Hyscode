import { Check, Circle, Loader2, AlertCircle, SkipForward, Pause, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useAgentStore } from '@/stores/agent-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SddTaskStatus } from '@hyscode/agent-harness';

const STATUS_ICONS: Record<SddTaskStatus, { icon: typeof Check; color: string; animate?: boolean }> = {
  pending: { icon: Circle, color: 'text-muted-foreground/50' },
  in_progress: { icon: Loader2, color: 'text-accent', animate: true },
  completed: { icon: Check, color: 'text-green-400' },
  skipped: { icon: SkipForward, color: 'text-yellow-400' },
  failed: { icon: AlertCircle, color: 'text-red-400' },
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
    <div className="flex flex-col gap-2 rounded-lg border border-surface-raised bg-background p-3">
      {/* Header with progress + controls */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground">
          {isPlanReview ? 'Review Plan' : 'Tasks'}
        </span>
        <div className="flex items-center gap-1.5">
          {isExecuting && (
            <>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {sddProgress}%
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handlePauseResume}
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  {paused || failedTask ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                </TooltipTrigger>
                <TooltipContent side="top">{paused || failedTask ? 'Resume' : 'Pause'}</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Progress bar (only during execution) */}
      {isExecuting && (
        <div className="h-1 w-full rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${sddProgress}%` }}
          />
        </div>
      )}

      {/* Task list */}
      <div className="flex flex-col gap-1">
        {tasks.map((task, i) => {
          const statusConfig = STATUS_ICONS[task.status];
          const Icon = statusConfig.icon;
          const canSkip = task.status === 'pending' || task.status === 'in_progress' || task.status === 'failed';
          return (
            <div
              key={task.id}
              className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-raised"
            >
              <Icon
                className={cn(
                  'mt-0.5 h-3 w-3 shrink-0',
                  statusConfig.color,
                  statusConfig.animate ? 'animate-spin' : '',
                )}
              />
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-medium text-foreground">
                  {i + 1}. {task.title}
                </span>
                {task.description && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    {task.description}
                  </p>
                )}
                {task.files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {task.files.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-surface-raised px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground"
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
                        className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-accent"
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
                        className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-yellow-400"
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
        <div className="flex justify-end gap-2 pt-1">
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
