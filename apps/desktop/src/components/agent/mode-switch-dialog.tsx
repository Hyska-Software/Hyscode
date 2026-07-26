import { ArrowRight, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAgentStore } from '@/stores/agent-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import type { ModeSwitchRequest } from '@hyscode/agent-harness';

// Agent mode display config
const MODE_DISPLAY: Record<string, { label: string; color: string }> = {
  chat: { label: 'Chat', color: 'text-blue-400' },
  build: { label: 'Build', color: 'text-primary' },
  review: { label: 'Review', color: 'text-purple-400' },
  debug: { label: 'Debug', color: 'text-destructive' },
  plan: { label: 'Plan', color: 'text-amber-400' },
};

export function ModeSwitchDialog() {
  const pendingModeSwitch = useAgentStore((s) => s.pendingModeSwitch);
  const [contextOpen, setContextOpen] = useState(false);

  if (!pendingModeSwitch) return null;

  const req: ModeSwitchRequest = pendingModeSwitch;
  const from = MODE_DISPLAY[req.fromMode] ?? { label: req.fromMode, color: 'text-foreground' };
  const to = MODE_DISPLAY[req.toMode] ?? { label: req.toMode, color: 'text-foreground' };

  const handleApprove = () => {
    HarnessBridge.get().resolveModeSwitch(true);
  };

  const handleDeny = () => {
    HarnessBridge.get().resolveModeSwitch(false);
  };

  return (
    <div className="agent-fade-in my-3 border-l-2 border-cyan-500/30 pl-3">
      <div className="py-0.5">
        {/* Header */}
        <div className="mb-2.5 flex items-center gap-2.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/10">
            <ArrowRight className="h-3 w-3 text-cyan-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-cyan-300/90">Agent Delegation</span>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className={from.color}>{from.label}</span>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />
              <span className={to.color}>{to.label}</span>
            </div>
          </div>
        </div>

        {/* Reason */}
        <p className="mb-3 text-[12px] leading-relaxed text-foreground/80">{req.reason}</p>

        {/* Collapsible context summary */}
        {req.contextSummary && (
          <>
            <button
              onClick={() => setContextOpen(!contextOpen)}
              className="mb-3 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground/50 transition-colors hover:bg-foreground/[0.02] hover:text-muted-foreground/80"
            >
              {contextOpen ? (
                <ChevronDown className="h-2.5 w-2.5" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5" />
              )}
              <span>View handoff context</span>
            </button>

            {contextOpen && (
              <div className="agent-fade-in mb-3 overflow-hidden rounded-md bg-muted/30">
                <pre className="overflow-x-auto whitespace-pre-wrap p-2.5 font-mono text-[10px] leading-relaxed text-foreground/60">
                  {req.contextSummary}
                </pre>
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleApprove}
            className="h-7 gap-1.5 rounded-md bg-cyan-600 px-3.5 text-[11px] font-medium hover:bg-cyan-500 transition-colors"
          >
            <Check className="h-3 w-3" />
            Switch to {to.label}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDeny}
            className="h-7 gap-1.5 rounded-md px-3.5 text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            Stay in {from.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
