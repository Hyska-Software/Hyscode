import { Trash2, History, Bot, BookText, Terminal, MessageSquare, Zap, Plus, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { AgentMessages } from './agent-messages';
import { AgentInput } from './agent-input';
import { ContextChipsBar } from './context-chips-bar';
import { SessionHistory } from './session-history';
import { SddStepper } from './sdd/sdd-stepper';
import { SddSpecReview } from './sdd/sdd-spec-review';
import { SddTaskList } from './sdd/sdd-task-list';
import { AgentTaskList } from './agent-task-list';
import { AgentChangedFiles } from './agent-changed-files';
import { AgentQuestionCard } from './agent-question-card';
import { RulesPanelDialog } from './rules-panel-dialog';
import { useAgentStore } from '@/stores/agent-store';
import { useLayoutStore } from '@/stores/layout-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TokenUsage } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { getProviderRegistry } from '@hyscode/ai-providers';
import { TerminalPanel } from '@/components/terminal';
import type { AIModel } from '@hyscode/ai-providers';
import { resolveContextWindow } from '@/lib/context-window';

// ─── Context Window Pie Popup ─────────────────────────────────────────────────

/** Look up the active model from the provider registry */
function useActiveModel(): AIModel | null {
  const providerId = useSettingsStore((s) => s.activeProviderId);
  const modelId = useSettingsStore((s) => s.activeModelId);
  if (!providerId || !modelId) return null;
  const provider = getProviderRegistry().get(providerId);
  return provider?.models.find((m) => m.id === modelId) ?? null;
}

/** Format a dollar amount compactly */
function fmtCost(dollars: number): string {
  if (dollars < 0.001) return '<$0.001';
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}

function PieChart({ pct, size = 14, color = 'var(--color-accent)' }: { pct: number; size?: number; color?: string }) {
  const r = size / 2 - 1.5;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const fill = Math.min(Math.max(pct, 0), 1);

  if (fill >= 0.999) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="2" strokeDasharray={`${circumference} 0`} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={`${fill * circumference} ${(1 - fill) * circumference}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ContextPieButton({
  usage,
  sessionUsage,
  messageCount,
}: {
  usage: TokenUsage | null;
  sessionUsage: TokenUsage | null;
  messageCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const model = useActiveModel();
  const modelId = useSettingsStore((s) => s.activeModelId);
  const contextWindow = resolveContextWindow(model, modelId ?? undefined);
  const pct = usage && contextWindow ? usage.inputTokens / contextWindow : 0;
  const pctDisplay = Math.round(pct * 100);
  const hasContextWindow = contextWindow != null;

  // Cost estimation
  const inputCost = usage && model?.inputPricePerMToken
    ? (usage.inputTokens / 1_000_000) * model.inputPricePerMToken
    : null;
  const outputCost = usage && model?.outputPricePerMToken
    ? (usage.outputTokens / 1_000_000) * model.outputPricePerMToken
    : null;
  const totalCost = inputCost != null && outputCost != null ? inputCost + outputCost : null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pieColor = !hasContextWindow
    ? 'var(--color-muted-foreground)'
    : pct > 0.8
      ? '#f87171'
      : pct > 0.6
        ? '#fb923c'
        : 'var(--color-accent)';

  const cacheRead = usage?.cacheReadTokens ?? 0;
  const cacheWrite = usage?.cacheWriteTokens ?? 0;
  const effectiveInput = usage ? Math.max(usage.inputTokens - cacheRead, 0) : 0;
  const hasCache = cacheRead > 0 || cacheWrite > 0;

  return (
    <div ref={ref} className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={() => setOpen((v) => !v)}
              className={cn(
                'flex cursor-pointer items-center justify-center rounded p-0.5 transition-colors',
                open ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
              )}
            />
          }
        >
          <PieChart pct={hasContextWindow ? pct : 0} size={14} color={pieColor} />
        </TooltipTrigger>
        <TooltipContent side="bottom">Context usage</TooltipContent>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-7 z-50 w-60 rounded-lg border border-border/50 bg-surface-raised shadow-lg shadow-black/20 backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
            <PieChart pct={hasContextWindow ? pct : 0} size={32} color={pieColor} />
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-foreground">
                {hasContextWindow ? `${pctDisplay}% used` : 'Context unknown'}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {hasContextWindow
                  ? `of ~${(contextWindow! / 1000).toFixed(0)}k context window`
                  : 'Model context window not registered'}
              </span>
            </div>
          </div>

          {/* This turn */}
          <div className="flex flex-col gap-0 px-3 pt-2">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">This turn</span>
            {usage ? (
              <>
                <StatRow label="Input tokens" value={usage.inputTokens.toLocaleString()} />
                <StatRow label="Output tokens" value={usage.outputTokens.toLocaleString()} />
                <StatRow label="Total tokens" value={usage.totalTokens.toLocaleString()} accent />
                {hasCache && (
                  <>
                    <StatRow label="  └ Cache read" value={cacheRead.toLocaleString()} />
                    {cacheWrite > 0 && (
                      <StatRow label="  └ Cache write" value={cacheWrite.toLocaleString()} />
                    )}
                    <StatRow label="Effective input" value={effectiveInput.toLocaleString()} />
                  </>
                )}
              </>
            ) : (
              <span className="py-1 text-[10px] text-muted-foreground">No data yet</span>
            )}
            {totalCost != null && (
              <>
                <div className="my-1 border-t border-border/20" />
                <StatRow label="Input cost" value={fmtCost(inputCost!)} />
                <StatRow label="Output cost" value={fmtCost(outputCost!)} />
                <StatRow label="Est. total cost" value={fmtCost(totalCost)} accent />
              </>
            )}
            <StatRow label="Messages" value={String(messageCount)} />
          </div>

          {/* Session totals */}
          {sessionUsage && (sessionUsage.inputTokens > 0 || sessionUsage.outputTokens > 0) && (
            <div className="mt-1 border-t border-border/30 px-3 py-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">Session totals</span>
              <StatRow label="Input tokens" value={sessionUsage.inputTokens.toLocaleString()} />
              <StatRow label="Output tokens" value={sessionUsage.outputTokens.toLocaleString()} />
              <StatRow label="Total tokens" value={sessionUsage.totalTokens.toLocaleString()} accent />
              {(sessionUsage.cacheReadTokens ?? 0) > 0 && (
                <StatRow label="Cache read" value={(sessionUsage.cacheReadTokens ?? 0).toLocaleString()} />
              )}
              {(sessionUsage.cacheWriteTokens ?? 0) > 0 && (
                <StatRow label="Cache write" value={(sessionUsage.cacheWriteTokens ?? 0).toLocaleString()} />
              )}
            </div>
          )}

          {/* Progress bar */}
          {hasContextWindow && (
            <div className="px-3 pb-2.5 pt-2">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(pctDisplay, 100)}%`, background: pieColor }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-[3px]">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn('text-[10px] tabular-nums', accent ? 'font-semibold text-foreground' : 'text-foreground/80')}>{value}</span>
    </div>
  );
}

// ─── Credit Usage Indicator ───────────────────────────────────────────────────
// Shows the number of API requests made in the current turn.
// Particularly useful for per-request-cost providers (e.g. GitHub Copilot).

function CreditUsageIndicator() {
  const apiRequestCount = useAgentStore((s) => s.apiRequestCount);
  const isStreaming = useAgentStore((s) => s.isStreaming);

  if (apiRequestCount === 0) return null;

  return (
    <div className="flex items-center">
      <div
        className={cn(
          'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums transition-colors',
          isStreaming
            ? 'border-accent/20 bg-accent/[0.06] text-accent/80'
            : 'border-border/30 bg-surface-raised/40 text-muted-foreground/60',
        )}
      >
        <Zap className="h-3 w-3" />
        <span>
          {apiRequestCount} {apiRequestCount === 1 ? 'request' : 'requests'}
        </span>
        {isStreaming && (
          <span className="h-1.5 w-1.5 rounded-full bg-accent/70 animate-pulse" />
        )}
      </div>
    </div>
  );
}

export function AgentPanel({ hideChangedFiles }: { hideChangedFiles?: boolean } = {}) {
  const sddPhase = useAgentStore((s) => s.sddPhase);
  const sddSpec = useAgentStore((s) => s.sddSpec);
  const sddTasks = useAgentStore((s) => s.sddTasks);
  const clearConversation = useAgentStore((s) => s.clearConversation);
  const messageCount = useAgentStore((s) => s.messages.length);
  const tokenUsage = useAgentStore((s) => s.tokenUsage);
  const sessionTokenUsage = useAgentStore((s) => s.sessionTokenUsage);
  const historyOpen = useAgentStore((s) => s.historyOpen);
  const setHistoryOpen = useAgentStore((s) => s.setHistoryOpen);
  const rulesOpen = useLayoutStore((s) => s.rulesPanelOpen);
  const setRulesOpen = useLayoutStore((s) => s.setRulesPanelOpen);
  const agentCenterPanelMode = useSettingsStore((s) => s.agentCenterPanelMode);
  const openTabs = useAgentStore((s) => s.openTabs);
  const activeTabId = useAgentStore((s) => s.activeTabId);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const switchTab = useAgentStore((s) => s.switchTab);
  const closeTab = useAgentStore((s) => s.closeTab);
  const openNewTab = useAgentStore((s) => s.openNewTab);

  const handleSpecApprove = async () => {
    try {
      await HarnessBridge.get().approveSddSpec();
    } catch {
      // Bridge not ready
    }
  };

  const handleSpecReject = async () => {
    try {
      await HarnessBridge.get().rejectSddSpec();
    } catch {
      // Bridge not ready
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar — shown when more than one tab is open */}
      {openTabs.length > 1 && (
        <div className="flex h-7 shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-surface px-1 scrollbar-none">
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'group flex h-full max-w-[140px] min-w-0 shrink-0 cursor-pointer items-center gap-1 border-r border-border/40 px-2 text-[10px] transition-colors',
                tab.id === activeTabId
                  ? 'bg-surface-raised text-foreground'
                  : 'text-muted-foreground hover:bg-surface-raised/60 hover:text-foreground',
                isStreaming && tab.id !== activeTabId && 'cursor-not-allowed opacity-50',
              )}
              onClick={() => switchTab(tab.id)}
            >
              <span className="min-w-0 truncate">{tab.title}</span>
              {openTabs.length > 1 && (
                <button
                  className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
          <button
            className="ml-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            title="New conversation"
            onClick={() => openNewTab()}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between bg-surface-raised px-3">
        <div className="flex items-center gap-2">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium">Agent</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="relative">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setRulesOpen(!rulesOpen)}
                    className={rulesOpen ? 'text-accent' : 'text-muted-foreground hover:text-foreground'}
                  />
                }
              >
                <BookText className="h-3 w-3" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Active Rules</TooltipContent>
            </Tooltip>
            <RulesPanelDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    useSettingsStore.getState().set('agentCenterPanelMode', agentCenterPanelMode === 'terminal' ? 'chat' : 'terminal')
                  }
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              {agentCenterPanelMode === 'terminal' ? <MessageSquare className="h-3 w-3" /> : <Terminal className="h-3 w-3" />}
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {agentCenterPanelMode === 'terminal' ? 'Show Chat' : 'Show Terminal'}
            </TooltipContent>
          </Tooltip>
          <CreditUsageIndicator />
          <ContextPieButton usage={tokenUsage} sessionUsage={sessionTokenUsage} messageCount={messageCount} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => openNewTab()}
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              <Plus className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent side="bottom">New conversation</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setHistoryOpen(!historyOpen)}
                  className={historyOpen ? 'text-accent' : 'text-muted-foreground hover:text-foreground'}
                />
              }
            >
              <History className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Session history</TooltipContent>
          </Tooltip>
          {messageCount > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={clearConversation}
                    className="text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <Trash2 className="h-3 w-3" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear conversation</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Session History overlay */}
      {historyOpen ? (
        <SessionHistory />
      ) : agentCenterPanelMode === 'terminal' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TerminalPanel />
        </div>
      ) : (
        <>
          {/* SDD Stepper (only visible in active SDD session) */}
          {sddPhase && <SddStepper />}

          {/* SDD Spec Review — shown when spec is ready for user approval */}
          {sddPhase === 'specifying' && sddSpec && (
            <SddSpecReview
              onApprove={handleSpecApprove}
              onReject={handleSpecReject}
            />
          )}

          {/* SDD Task List — shown during planning/executing phases */}
          {(sddPhase === 'planning' || sddPhase === 'executing') && sddTasks.length > 0 && (
            <SddTaskList />
          )}

          {/* Context chips */}
          <ContextChipsBar />

          {/* Agent questions — wizard card (shown when agent uses ask_user tool) */}
          <AgentQuestionCard />

          {/* Agent task tracking (shown when agent creates tasks) */}
          <AgentTaskList />

          {/* Messages */}
          <AgentMessages />

          {/* Changed files summary (above input) */}
          {!hideChangedFiles && <AgentChangedFiles />}

          {/* Input + selectors at the bottom */}
          <AgentInput />
        </>
      )}
    </div>
  );
}
