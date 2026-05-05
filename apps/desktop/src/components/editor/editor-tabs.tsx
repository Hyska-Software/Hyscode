import { X, Circle, GitCompare, GitCommit, Wand2, Loader2, Pin, Terminal, Plus, FilePlus, FolderOpen, Search, Code2 } from 'lucide-react';
import { useState, useCallback, useRef } from 'react';
import { useEditorStore } from '../../stores';
import { useAgentStore } from '../../stores/agent-store';
import { useTerminalStore } from '../../stores/terminal-store';
import { useExtensionStore } from '../../stores/extension-store';
import { useShallow } from 'zustand/shallow';
import { TabContextMenu } from './tab-context-menu';
import { getFileIcon } from '../sidebar/views/file-icons';
import { openCommandPalette } from './command-palette';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { AgentEditPhase } from '../../stores/agent-store';
import type { Tab } from '../../stores/editor-store';

export function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  // Re-render when extension icon themes change
  useExtensionStore((s) => s.extensionIconThemesVersion);
  const closeTab = useEditorStore((s) => s.closeTab);
  const reorderTabs = useEditorStore((s) => s.reorderTabs);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: Tab } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!scrollRef.current) return;
    e.preventDefault();
    scrollRef.current.scrollLeft += e.deltaY || e.deltaX;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: Tab) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tab });
  }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // Make the ghost semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      setDragOverIndex(null);
      dragCounterRef.current = 0;
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounterRef.current = 0;
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderTabs(fromIndex, toIndex);
    }
  }, [dragIndex, reorderTabs]);

  // Map filePath → phase for active edit sessions
  const editPhaseMap = useAgentStore(
    useShallow((s) => {
      const map: Record<string, AgentEditPhase> = {};
      for (const es of s.agentEditSessions) {
        if (es.phase === 'streaming' || es.phase === 'pending_review') {
          map[es.filePath] = es.phase;
        }
      }
      return map;
    }),
  );

  const handleNewFile = useCallback(() => {
    useEditorStore.getState().openUntitled();
  }, []);

  const handleOpenFile = useCallback(async () => {
    const { pickFile } = await import('../../lib/tauri-dialog');
    const { getViewerType } = await import('../../lib/utils');
    const path = await pickFile();
    if (path) {
      const sep = path.includes('/') ? '/' : '\\';
      const fileName = path.split(sep).pop() ?? 'file';
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      useEditorStore.getState().openTab({
        id: path,
        filePath: path,
        fileName,
        language: ext || 'plaintext',
        viewerType: getViewerType(fileName),
      });
    }
  }, []);

  const handleNewTerminal = useCallback(() => {
    const sessionId = useTerminalStore.getState().createSession(undefined, false, undefined, 'editor');
    const session = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
    useEditorStore.getState().openTerminalTab(sessionId, session?.name ?? 'Terminal');
  }, []);

  const handleSearchProject = useCallback(() => {
    openCommandPalette();
  }, []);

  const handleSearchSymbols = useCallback(() => {
    openCommandPalette();
  }, []);

  if (tabs.length === 0) return null;

  return (
    <div ref={scrollRef} onWheel={handleWheel} className="flex h-8 items-center gap-0.5 bg-surface-raised px-2 overflow-x-auto shrink-0">
      {tabs.map((tab, index) => {
        const isActive = activeTabId === tab.id;
        const isDiff = tab.type === 'diff';
        const isTerminal = tab.type === 'terminal';
        const isCommit = tab.type === 'commit';
        const editPhase = tab.filePath ? editPhaseMap[tab.filePath] : undefined;
        const isStreaming = editPhase === 'streaming';
        const isPendingReview = editPhase === 'pending_review';
        const FileIcon = getFileIcon(tab.fileName);
        const isDragOver = dragOverIndex === index && dragIndex !== index;

        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
            className={`group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-grab select-none ${
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised'
            } ${isDragOver ? 'border-l-2 border-accent' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab)}
          >
            {tab.isPinned && (
              <Pin className="h-2.5 w-2.5 shrink-0 text-accent opacity-60" />
            )}
            {isDiff ? (
              <GitCompare className="h-3 w-3 shrink-0 text-accent" />
            ) : isTerminal ? (
              <Terminal className="h-3 w-3 shrink-0 text-green-400" />
            ) : isCommit ? (
              <GitCommit className="h-3 w-3 shrink-0 text-accent" />
            ) : isStreaming ? (
              <Loader2 className="h-3 w-3 shrink-0 text-purple-400 animate-spin" />
            ) : isPendingReview ? (
              <Wand2 className="h-3 w-3 shrink-0 text-purple-400" />
            ) : (
              <FileIcon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className={`truncate max-w-[120px] ${tab.isPreview ? 'italic' : ''}`}>{tab.fileName}</span>
            {tab.isDirty && (
              <Circle className="h-2 w-2 shrink-0 fill-accent text-accent" />
            )}
            <button
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {/* New tab dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
          <Plus className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="w-56">
          <DropdownMenuItem onClick={handleNewFile}>
            <FilePlus className="h-3.5 w-3.5 shrink-0" />
            New File
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenFile}>
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            Open File
            <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSearchProject}>
            <Search className="h-3.5 w-3.5 shrink-0" />
            Search Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSearchSymbols}>
            <Code2 className="h-3.5 w-3.5 shrink-0" />
            Search Symbols
            <DropdownMenuShortcut>Ctrl+T</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleNewTerminal}>
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            New Terminal
            <DropdownMenuShortcut>Ctrl+Shift+`</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tab={contextMenu.tab}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
