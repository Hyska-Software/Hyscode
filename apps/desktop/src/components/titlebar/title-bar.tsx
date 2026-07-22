import { useEffect } from 'react';
import { FileMenu } from './file-menu';
import { ViewMenu } from './view-menu';
import { ModeSelector } from './mode-selector';
import { BrandMark } from '../brand-mark';
import { useLayoutStore } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';

export function TitleBar() {
  const mode = useLayoutStore((s) => s.workspaceMode);
  const setMode = useLayoutStore((s) => s.setWorkspaceMode);
  const showAgentTab = useSettingsStore((s) => s.showAgentTab);
  const showAgentChatPanel = useSettingsStore((s) => s.showAgentChatPanel);
  const setSettings = useSettingsStore((s) => s.set);

  // If the current mode's tab is hidden, fall back to editor
  useEffect(() => {
    if (mode === 'agent' && !showAgentTab) setMode('editor');
  }, [showAgentTab, mode, setMode]);

  // Agent mode requires chat to be visible
  useEffect(() => {
    if (mode === 'agent' && !showAgentChatPanel) {
      setSettings('showAgentChatPanel', true);
    }
  }, [mode, showAgentChatPanel, setSettings]);

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

      {/* Center spacer for visual balance */}
      <div className="flex-1" />

      {/* Right: layout mode selector */}
      <div className="flex shrink-0 items-center gap-2">
        <ModeSelector />
      </div>
    </header>
  );
}
