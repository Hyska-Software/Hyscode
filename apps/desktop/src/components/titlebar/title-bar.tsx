import { useEffect } from 'react';
import { FileMenu } from './file-menu';
import { ViewMenu } from './view-menu';
import { BrandMark } from '../brand-mark';
import { useLayoutStore } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';
import type { WorkspaceMode } from '../../stores/layout-store';

const MODE_LABELS: Record<WorkspaceMode, string> = {
  editor: 'editor',
  agent: 'agent',
  review: 'review',
};

export function TitleBar() {
  const mode = useLayoutStore((s) => s.workspaceMode);
  const setMode = useLayoutStore((s) => s.setWorkspaceMode);
  const showAgentTab = useSettingsStore((s) => s.showAgentTab);
  const showReviewTab = useSettingsStore((s) => s.showReviewTab);
  const showAgentChatPanel = useSettingsStore((s) => s.showAgentChatPanel);
  const setSettings = useSettingsStore((s) => s.set);

  // If the current mode's tab is hidden, fall back to editor
  useEffect(() => {
    if (mode === 'agent' && !showAgentTab) setMode('editor');
    if (mode === 'review' && !showReviewTab) setMode('editor');
  }, [showAgentTab, showReviewTab, mode, setMode]);

  // Agent mode requires chat to be visible
  useEffect(() => {
    if (mode === 'agent' && !showAgentChatPanel) {
      setSettings('showAgentChatPanel', true);
    }
  }, [mode, showAgentChatPanel, setSettings]);

  const visibleModes = (['editor', 'agent', 'review'] as const).filter((m) => {
    if (m === 'agent') return showAgentTab;
    if (m === 'review') return showReviewTab;
    return true;
  });

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 items-center bg-background px-2"
    >
      {/* Left: brand + menus */}
      <div className="flex items-center shrink-0 gap-2">
        <div data-tauri-drag-region className="flex items-center gap-2 px-1">
          <BrandMark className="h-4 w-4 rounded-[4px]" alt="HysCode" />
        </div>
        <FileMenu />
        <ViewMenu />
      </div>

      {/* Center: filled mode pills */}
      <div className="flex flex-1 items-center justify-center">
        {visibleModes.length > 1 && (
          <div className="flex items-center gap-0.5 rounded-pill bg-surface-raised p-[3px]">
            {visibleModes.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-pill px-4 py-[3px] text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  mode === m
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right spacer for visual balance */}
      <div className="w-16 shrink-0" />
    </header>
  );
}
