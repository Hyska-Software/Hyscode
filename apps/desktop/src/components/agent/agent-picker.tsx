import {
  MessageSquare,
  Hammer,
  Search,
  Bug,
  ClipboardList,
  ChevronRight,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agent-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { cn } from '@/lib/utils';
import type { AgentMode } from '@/stores/agent-store';
import { getAllAgentDefinitions } from '@hyscode/agent-harness';

const AGENT_ICONS: Record<AgentMode, typeof MessageSquare> = {
  chat: MessageSquare,
  build: Hammer,
  review: Search,
  debug: Bug,
  plan: ClipboardList,
};

const AGENT_COLORS: Record<AgentMode, string> = {
  chat: 'text-blue-400',
  build: 'text-primary',
  review: 'text-purple-400',
  debug: 'text-destructive',
  plan: 'text-amber-400',
};

const AGENT_DEFS = getAllAgentDefinitions();

export function AgentPicker() {
  const currentMode = useAgentStore((s) => s.mode);

  const handleSelect = (mode: AgentMode) => {
    try {
      HarnessBridge.get().setAgentType(mode);
    } catch {
      useAgentStore.getState().setMode(mode);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <span className="px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Agents
      </span>
      {AGENT_DEFS.map((agent) => {
        const mode = agent.type as AgentMode;
        const Icon = AGENT_ICONS[mode] ?? MessageSquare;
        const color = AGENT_COLORS[mode] ?? 'text-primary';
        const isActive = mode === currentMode;

        return (
          <button
            key={agent.type}
            onClick={() => handleSelect(mode)}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
              isActive
                ? 'bg-surface-raised text-foreground'
                : 'text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', isActive ? color : '')} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[11px] font-medium">{agent.name}</span>
              <span className="truncate text-[9px] text-muted-foreground">
                {agent.description}
              </span>
            </div>
            {isActive && <ChevronRight className="h-3 w-3 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
