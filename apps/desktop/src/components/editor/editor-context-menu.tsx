import { useEffect, useRef, useCallback, useState } from 'react';
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Wand2,
  Command,
  ChevronRight,
  Sparkles,
  Navigation,
  ArrowRight,
  FileSearch,
  FileCode,
  Search,
  Type,
  Lightbulb,
  AlignLeft,
  FolderOpen,
  Terminal,
  Link,
  History,
  type LucideIcon,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useExtensionUiStore } from '../../stores/extension-ui-store';
import { useEditorStore, useSettingsStore } from '../../stores';
import { useLayoutStore } from '../../stores/layout-store';
import { useTerminalStore } from '../../stores/terminal-store';
import { useFileStore } from '../../stores/file-store';
import { detectLanguage } from '../../lib/lsp-bridge';
import { writeClipboard } from '../../lib/utils';
import type { MenuActionContext } from '@hyscode/extension-api';

// ── Icon map for extension-contributed icons ─────────────────────────────────
const iconMap: Record<string, LucideIcon> = {
  wand: Wand2,
  sparkles: Sparkles,
  scissors: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  command: Command,
};

function getIcon(name?: string): LucideIcon {
  if (!name) return Command;
  return iconMap[name.toLowerCase()] ?? Command;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface EditorContextMenuProps {
  x: number;
  y: number;
  editorInstance: { getPosition: () => { lineNumber: number; column: number } | null; getSelection: () => { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number } | null; getModel: () => { getValueInRange: (range: unknown) => string } | null; trigger: (source: string, handlerId: string, payload?: unknown) => void; focus: () => void } | null;
  onClose: () => void;
}

interface ContextItemProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  submenu?: boolean;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ContextItem({ icon: Icon, label, shortcut, onClick, disabled, primary, submenu }: ContextItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
        disabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : primary
            ? 'text-primary hover:bg-primary/10 hover:text-primary'
            : 'text-foreground hover:bg-surface-raised'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="ml-4 text-[10px] text-muted-foreground">{shortcut}</span>
      )}
      {submenu && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

function Separator() {
  return <div className="my-1 h-px bg-border" />;
}

// ── Format sub-menu ──────────────────────────────────────────────────────────

function FormatSubmenu({
  formatters,
  onSelect,
}: {
  formatters: Array<{ extensionName: string; item: { id: string; displayName: string } }>;
  onSelect: (formatterId: string) => void;
}) {
  if (formatters.length === 0) return null;

  return (
    <div className="ml-1 mt-1 rounded-lg border border-border bg-surface p-1 shadow-lg">
      {formatters.map((f) => (
        <button
          key={f.item.id}
          onClick={() => onSelect(f.item.id)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-foreground hover:bg-surface-raised transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{f.item.displayName}</span>
          <span className="ml-auto text-[9px] text-muted-foreground">{f.extensionName}</span>
        </button>
      ))}
    </div>
  );
}

// ── Git history sub-menu ─────────────────────────────────────────────────────

interface GitCommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
}

function HistorySubmenu({
  commits,
  onClose,
}: {
  commits: GitCommitInfo[];
  onClose: () => void;
}) {
  if (commits.length === 0) {
    return (
      <div className="ml-1 mt-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
        <span className="text-[11px] text-muted-foreground">No history found</span>
      </div>
    );
  }

  return (
    <div className="ml-1 mt-1 max-h-[240px] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
      {commits.map((c) => (
        <button
          key={c.hash}
          onClick={() => {
            onClose();
            // Could open diff view in the future
          }}
          className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-[11px] text-foreground hover:bg-surface-raised transition-colors"
        >
          <span className="truncate font-medium">{c.message.split('\n')[0]}</span>
          <span className="text-[10px] text-muted-foreground">
            {c.short_hash} — {c.author}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function EditorContextMenu({ x, y, editorInstance, onClose }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showFormatSubmenu, setShowFormatSubmenu] = useState(false);
  const [showHistorySubmenu, setShowHistorySubmenu] = useState(false);
  const [historyCommits, setHistoryCommits] = useState<GitCommitInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const contextMenuItems = useExtensionUiStore((s) => s.contextMenuItems);
  const formatters = useExtensionUiStore((s) => s.formatters);

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabSize = useSettingsStore((s) => s.tabSize);
  const rootPath = useFileStore((s) => s.rootPath);

  const languageId = activeTab?.filePath ? (detectLanguage(activeTab.filePath) ?? activeTab.language ?? 'plaintext') : 'plaintext';
  const availableFormatters = formatters.filter(
    (f) => f.item.languageIds.includes(languageId) || f.item.languageIds.includes('*'),
  );

  const isUntitled = activeTab?.filePath?.startsWith('untitled:') ?? true;

  // Build the menu action context
  const getMenuContext = useCallback((): MenuActionContext => {
    const pos = editorInstance?.getPosition?.();
    const sel = editorInstance?.getSelection?.();
    let selectedText: string | null = null;
    if (sel && editorInstance?.getModel?.()) {
      const model = editorInstance.getModel();
      try {
        selectedText = model?.getValueInRange(sel) ?? null;
      } catch { selectedText = null; }
    }
    return {
      filePath: activeTab?.filePath ?? null,
      languageId,
      selectedText: selectedText || null,
      cursorLine: pos?.lineNumber ?? 1,
      cursorColumn: pos?.column ?? 1,
    };
  }, [editorInstance, activeTab, languageId]);

  // Close on outside click / escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Position adjustment
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [x, y]);

  // ── Navigation actions ────────────────────────────────────────────────────
  const handleGoToDefinition = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.revealDefinition'); };
  const handleGoToDeclaration = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.revealDeclaration'); };
  const handleGoToTypeDefinition = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.goToTypeDefinition'); };
  const handleGoToImplementation = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.goToImplementation'); };
  const handleFindAllReferences = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.goToReferences'); };

  // ── Refactoring actions ───────────────────────────────────────────────────
  const handleRenameSymbol = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.rename'); };

  // ── Code actions ──────────────────────────────────────────────────────────
  const handleShowCodeActions = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.quickFix'); };

  // ── Clipboard actions ─────────────────────────────────────────────────────
  const handleCut = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.clipboardCutAction'); };
  const handleCopy = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.clipboardCopyAction'); };
  const handlePaste = () => { onClose(); editorInstance?.trigger('contextMenu', 'editor.action.clipboardPasteAction'); };

  const handleCopyAndTrim = () => {
    onClose();
    const sel = editorInstance?.getSelection?.();
    const model = editorInstance?.getModel?.();
    if (!sel || !model) return;
    try {
      const text = model.getValueInRange(sel);
      const trimmed = text.split('\n').map((line: string) => line.trimEnd()).join('\n').trim();
      writeClipboard(trimmed).catch(console.error);
    } catch (err) {
      console.error('[EditorContextMenu] Copy and trim error:', err);
    }
  };

  // ── Format action ─────────────────────────────────────────────────────────
  const handleFormat = async (formatterId: string) => {
    onClose();
    const formatter = formatters.find((f) => f.item.id === formatterId);
    if (!formatter || !editorInstance) return;

    const model = editorInstance.getModel?.();
    if (!model) return;

    const content = (model as unknown as { getValue: () => string }).getValue();
    try {
      const formatted = await formatter.item.format({
        content,
        filePath: activeTab?.filePath ?? '',
        languageId,
        tabSize,
        insertSpaces: true,
      });
      // Replace content via Monaco edit operation
      const fullRange = (model as unknown as { getFullModelRange: () => unknown }).getFullModelRange();
      (model as unknown as { pushStackElement: () => void }).pushStackElement();
      (model as unknown as {
        pushEditOperations: (sel: null, ops: Array<{ range: unknown; text: string }>, cb: () => null) => void;
      }).pushEditOperations(null, [{ range: fullRange, text: formatted }], () => null);
      (model as unknown as { pushStackElement: () => void }).pushStackElement();
      editorInstance.focus();
    } catch (err) {
      console.error('[EditorContextMenu] Format error:', err);
    }
  };

  // ── File actions ──────────────────────────────────────────────────────────
  const handleRevealInFileExplorer = async () => {
    onClose();
    if (isUntitled || !activeTab?.filePath) return;
    try {
      await invoke('reveal_path', { path: activeTab.filePath });
    } catch (err) {
      console.error('Failed to reveal in file explorer:', err);
    }
  };

  const handleOpenInTerminal = () => {
    onClose();
    if (!activeTab?.filePath) return;
    const dir = activeTab.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (!dir) return;

    const { createSession } = useTerminalStore.getState();
    const { setTerminalVisible } = useLayoutStore.getState();
    createSession(undefined, false, dir);
    setTerminalVisible(true);
  };

  const handleCopyPermalink = async () => {
    onClose();
    if (!activeTab?.filePath) return;
    const pos = editorInstance?.getPosition?.();
    const line = pos?.lineNumber ?? 1;
    const permalink = `${activeTab.filePath}:${line}`;
    try {
      await writeClipboard(permalink);
    } catch (err) {
      console.error('Failed to copy permalink:', err);
    }
  };

  const handleViewFileHistory = async () => {
    if (!rootPath || !activeTab?.filePath || isUntitled) return;
    const relPath = activeTab.filePath.replace(/\\/g, '/').replace(rootPath.replace(/\\/g, '/') + '/', '');

    if (!showHistorySubmenu) {
      setHistoryLoading(true);
      try {
        const log = await invoke<GitCommitInfo[]>('git_log_file', {
          repoPath: rootPath,
          filePath: relPath,
          limit: 20,
        });
        setHistoryCommits(log);
      } catch (err) {
        console.error('Failed to load file history:', err);
        setHistoryCommits([]);
      } finally {
        setHistoryLoading(false);
      }
    }
    setShowHistorySubmenu(!showHistorySubmenu);
  };

  // Group extension items
  const sortedExtItems = [...contextMenuItems].sort((a, b) => (a.item.order ?? 50) - (b.item.order ?? 50));

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
      className="min-w-[240px] max-w-[320px] rounded-lg border border-border bg-surface p-1 shadow-lg"
    >
      {/* Navigation */}
      <ContextItem icon={Navigation} label="Go to Definition" shortcut="F12" onClick={handleGoToDefinition} />
      <ContextItem icon={ArrowRight} label="Go to Declaration" onClick={handleGoToDeclaration} />
      <ContextItem icon={FileCode} label="Go to Type Definition" onClick={handleGoToTypeDefinition} />
      <ContextItem icon={FileSearch} label="Go to Implementation" shortcut="Ctrl+F12" onClick={handleGoToImplementation} />
      <ContextItem icon={Search} label="Find All References" shortcut="Alt+Shift+F12" onClick={handleFindAllReferences} />

      <Separator />

      {/* Refactoring */}
      <ContextItem icon={Type} label="Rename Symbol" shortcut="F2" onClick={handleRenameSymbol} />

      {/* Format */}
      {availableFormatters.length > 0 && (
        <>
          {availableFormatters.length === 1 ? (
            <ContextItem
              icon={Sparkles}
              label={`Format with ${availableFormatters[0].item.displayName}`}
              shortcut="Shift+Alt+F"
              onClick={() => handleFormat(availableFormatters[0].item.id)}
              primary
            />
          ) : (
            <div className="relative">
              <ContextItem
                icon={Sparkles}
                label="Format Document..."
                shortcut="Shift+Alt+F"
                onClick={() => setShowFormatSubmenu(!showFormatSubmenu)}
                primary
                submenu
              />
              {showFormatSubmenu && (
                <FormatSubmenu
                  formatters={availableFormatters}
                  onSelect={handleFormat}
                />
              )}
            </div>
          )}
        </>
      )}

      <ContextItem icon={Lightbulb} label="Show Code Actions" shortcut="Ctrl+." onClick={handleShowCodeActions} />

      <Separator />

      {/* Clipboard */}
      <ContextItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={handleCut} />
      <ContextItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={handleCopy} />
      <ContextItem icon={AlignLeft} label="Copy and Trim" onClick={handleCopyAndTrim} />
      <ContextItem icon={ClipboardPaste} label="Paste" shortcut="Ctrl+V" onClick={handlePaste} />

      <Separator />

      {/* File actions */}
      <ContextItem
        icon={FolderOpen}
        label="Reveal in File Explorer"
        shortcut="Ctrl+K R"
        onClick={handleRevealInFileExplorer}
        disabled={isUntitled}
      />
      <ContextItem
        icon={Terminal}
        label="Open in Terminal"
        onClick={handleOpenInTerminal}
        disabled={isUntitled}
      />
      <ContextItem
        icon={Link}
        label="Copy Permalink"
        onClick={handleCopyPermalink}
        disabled={isUntitled}
      />
      <div className="relative">
        <ContextItem
          icon={History}
          label="View File History"
          onClick={handleViewFileHistory}
          disabled={isUntitled || !rootPath}
          submenu
        />
        {showHistorySubmenu && (
          <div className="absolute left-full top-0 ml-1 min-w-[220px]">
            {historyLoading ? (
              <div className="rounded-lg border border-border bg-surface p-2 shadow-lg">
                <span className="text-[11px] text-muted-foreground">Loading...</span>
              </div>
            ) : (
              <HistorySubmenu commits={historyCommits} onClose={onClose} />
            )}
          </div>
        )}
      </div>

      {/* Extension-contributed items */}
      {sortedExtItems.length > 0 && (
        <>
          <Separator />
          {sortedExtItems.map((reg) => {
            const Icon = getIcon(reg.item.icon);
            return (
              <ContextItem
                key={`${reg.extensionName}-${reg.item.id}`}
                icon={Icon}
                label={reg.item.label}
                onClick={() => {
                  onClose();
                  const ctx = getMenuContext();
                  Promise.resolve(reg.item.handler(ctx)).catch(console.error);
                }}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
