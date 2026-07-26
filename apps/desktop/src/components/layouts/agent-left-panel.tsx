import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Settings,
  Blocks,
  X,
  PanelLeftClose,
} from 'lucide-react';
import { SessionHistory } from '../agent/session-history';
import { ExtensionsView } from '../sidebar/views/extensions-view';
import { useSettingsStore } from '../../stores/settings-store';
import { useLayoutStore } from '../../stores/layout-store';

function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col overflow-hidden" style={{ flex: open ? '1 1 0%' : '0 0 auto' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 border-b border-border/30 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Icon className="h-3 w-3" />
        <span>{title}</span>
      </button>
      {open && <div className="flex-1 overflow-hidden">{children}</div>}
    </div>
  );
}

function ExtensionsModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative flex h-[78vh] w-[680px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/40 bg-surface-raised px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Blocks className="h-4 w-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">Extensions</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <ExtensionsView />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AgentLeftPanel() {
  const openSettings = useSettingsStore((s) => s.openSettings);
  const setLeftCollapsed = useLayoutStore((s) => s.setAgentLeftCollapsed);
  const [extensionsOpen, setExtensionsOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* Header with toggle */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/30 px-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Workspace
        </span>
        <button
          onClick={() => setLeftCollapsed(true)}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

          {/* Sessions section */}
          <CollapsibleSection title="Sessions" icon={({ className }: { className?: string }) => (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}>
            <SessionHistory />
          </CollapsibleSection>

      {/* Footer: Quick access */}
      <div className="flex shrink-0 items-center gap-1 border-t border-border/30 px-2 py-1">
        <button
          onClick={() => openSettings()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <Settings className="h-3 w-3" />
          Settings
        </button>
        <button
          onClick={() => setExtensionsOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <Blocks className="h-3 w-3" />
          Extensions
        </button>
      </div>

      {extensionsOpen && <ExtensionsModal onClose={() => setExtensionsOpen(false)} />}
    </div>
  );
}
