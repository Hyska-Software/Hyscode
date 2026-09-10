/**
 * Editor context menu.
 *
 * Built on the app-wide Base UI context menu primitives (the same ones the
 * file tree uses), anchored at the cursor through a virtual Floating UI
 * reference. Hover submenus, collision handling, viewport clamping and
 * scrollable overflow come from the primitive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Wand2,
  Command,
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
  Link2,
  History,
  Undo2,
  Redo2,
  TextSelect,
  Eye,
  ListTree,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../ui/context-menu';
import { useExtensionUiStore } from '../../stores/extension-ui-store';
import { useEditorStore, useSettingsStore } from '../../stores';
import { useLayoutStore } from '../../stores/layout-store';
import { useTerminalStore } from '../../stores/terminal-store';
import { useFileStore } from '../../stores/file-store';
import { useLspStore } from '../../stores/lsp-store';
import { openCommandPalette } from './command-palette';
import { formatActiveDocument } from '../../lib/format-document';
import { detectLanguage } from '../../lib/lsp-bridge';
import { detectLspLanguage, normalizeLspLanguage, getBuiltinServerForLanguage } from '@hyscode/lsp-client';
import { cn, writeClipboard } from '../../lib/utils';
import { tauriInvoke } from '../../lib/tauri-invoke';
import { tauriFs } from '../../lib/tauri-fs';
import {
  dirnameOf,
  toRepoRelativePath,
  hasNonEmptySelection,
  trimSelectionText,
  buildPathWithLine,
  groupExtensionItems,
  getLspActionAvailability,
  type EditorSelectionLike,
} from '../../lib/editor-context-menu-utils';
import type { MenuActionContext } from '@hyscode/extension-api';

// ── Icon map for extension-contributed icons ─────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  wand: Wand2,
  sparkles: Sparkles,
  scissors: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  command: Command,
  history: History,
  link: Link2,
  terminal: Terminal,
  folder: FolderOpen,
  folderopen: FolderOpen,
  search: Search,
  type: Type,
  lightbulb: Lightbulb,
  filecode: FileCode,
  filesearch: FileSearch,
  navigation: Navigation,
  arrowright: ArrowRight,
  undo: Undo2,
  redo: Redo2,
  eye: Eye,
  symbol: ListTree,
  listtree: ListTree,
  settings: Settings2,
  select: TextSelect,
};

function getIcon(name?: string): LucideIcon {
  if (!name) return Command;
  return iconMap[name.toLowerCase().replace(/[-_\s]/g, '')] ?? Command;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface EditorContextMenuInstance {
  getPosition: () => { lineNumber: number; column: number } | null;
  getSelection: () => EditorSelectionLike | null;
  getModel: () => {
    getValue: () => string;
    getValueInRange: (range: unknown) => string;
    getFullModelRange: () => unknown;
    pushStackElement: () => void;
    pushEditOperations: (
      selections: null,
      ops: Array<{ range: unknown; text: string }>,
      cb: () => null,
    ) => void;
  } | null;
  trigger: (source: string, handlerId: string, payload?: unknown) => void;
  focus: () => void;
}

interface EditorContextMenuProps {
  x: number;
  y: number;
  editorInstance: EditorContextMenuInstance | null;
  onClose: () => void;
}

interface GitCommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
}

function formatCommitDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

// ── Menu row components ──────────────────────────────────────────────────────

const ROW_CLASS = 'text-[11px] [&_svg]:size-3.5';

interface MenuRowProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}

/** Standard menu row with icon, label, optional shortcut and disabled tooltip. */
function MenuRow({ icon: Icon, label, shortcut, onClick, disabled, primary, title }: MenuRowProps) {
  const item = (
    <ContextMenuItem
      onClick={onClick}
      disabled={disabled}
      className={cn(ROW_CLASS, primary && 'text-primary focus:bg-primary/10 focus:text-primary')}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="ml-4 text-[10px] text-muted-foreground">{shortcut}</span>}
    </ContextMenuItem>
  );
  // Disabled items ignore pointer events, so the tooltip lives on a wrapper.
  if (disabled && title) {
    return (
      <span title={title} className="block">
        {item}
      </span>
    );
  }
  return item;
}

interface MenuSubRowProps {
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}

function MenuSubRow({ icon: Icon, label, primary, disabled, title }: MenuSubRowProps) {
  const trigger = (
    <ContextMenuSubTrigger
      disabled={disabled}
      className={cn(ROW_CLASS, primary && 'text-primary data-open:text-primary data-popup-open:text-primary')}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
    </ContextMenuSubTrigger>
  );
  if (disabled && title) {
    return (
      <span title={title} className="block">
        {trigger}
      </span>
    );
  }
  return trigger;
}

// ── Main Component ───────────────────────────────────────────────────────────

export function EditorContextMenu({ x, y, editorInstance, onClose }: EditorContextMenuProps) {
  const [historyCommits, setHistoryCommits] = useState<GitCommitInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestRef = useRef(false);
  const historyLoadedForRef = useRef<string | null>(null);

  const contextMenuItems = useExtensionUiStore((s) => s.contextMenuItems);
  const getFormattersForLanguage = useExtensionUiStore((s) => s.getFormattersForLanguage);

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const openSettingsOnTab = useSettingsStore((s) => s.openSettingsOnTab);
  const rootPath = useFileStore((s) => s.rootPath);
  const serverStatuses = useLspStore((s) => s.serverStatuses);
  const serverCapabilities = useLspStore((s) => s.serverCapabilities);

  const languageId = activeTab?.filePath
    ? (detectLanguage(activeTab.filePath) || activeTab.language || 'plaintext')
    : 'plaintext';
  const detectedLspLanguage = activeTab?.filePath
    ? (detectLspLanguage(activeTab.filePath) ?? null)
    : null;
  const lspLanguage = detectedLspLanguage ? normalizeLspLanguage(detectedLspLanguage) : null;
  const lspStatus = lspLanguage ? serverStatuses[lspLanguage]?.status : undefined;
  const lspCapabilities = lspLanguage ? serverCapabilities[lspLanguage] : undefined;
  const lspActions = getLspActionAvailability(lspLanguage, lspStatus, lspCapabilities);
  const builtinServer = lspLanguage ? getBuiltinServerForLanguage(lspLanguage) : undefined;
  const lspDisabledHint = lspLanguage
    ? builtinServer
      ? `Requires the ${builtinServer.displayName} language server (not running)`
      : `No language server available for ${lspLanguage}`
    : 'No language server available for this file';

  /** Tooltip for an intellisense item that is disabled or needs a fallback. */
  const lspHintFor = (available: boolean, capability: string): string | undefined => {
    if (available) return undefined;
    if (lspStatus === 'ready') {
      const serverName = builtinServer?.displayName ?? `${lspLanguage ?? 'language'} server`;
      return `The running ${serverName} does not support ${capability}`;
    }
    return lspDisabledHint;
  };

  const availableFormatters = getFormattersForLanguage(languageId);
  const isUntitled = activeTab?.filePath?.startsWith('untitled:') ?? true;

  const notify = useCallback(
    (type: 'info' | 'warning' | 'error', message: string, title?: string) => {
      useExtensionUiStore.getState().showNotification(type, message, title);
    },
    [],
  );

  // Selection snapshot taken when the menu opens (the editor loses focus).
  const [menuSelection] = useState(() => {
    try {
      const sel = editorInstance?.getSelection?.() ?? null;
      const model = editorInstance?.getModel?.() ?? null;
      let text: string | null = null;
      if (sel && model) {
        try {
          text = model.getValueInRange(sel);
        } catch {
          text = null;
        }
      }
      return { sel, text };
    } catch {
      return { sel: null as EditorSelectionLike | null, text: null as string | null };
    }
  });
  const hasSelection = hasNonEmptySelection(menuSelection.sel) && !!menuSelection.text;

  // Build the menu action context for extensions.
  const getMenuContext = useCallback((): MenuActionContext => {
    const pos = editorInstance?.getPosition?.();
    const { tabSize, insertSpaces } = useSettingsStore.getState();
    return {
      filePath: activeTab?.filePath ?? null,
      languageId,
      selectedText: menuSelection.text || null,
      cursorLine: pos?.lineNumber ?? 1,
      cursorColumn: pos?.column ?? 1,
      tabSize,
      insertSpaces,
      selection: menuSelection.sel
        ? {
            text: menuSelection.text ?? '',
            startLineNumber: menuSelection.sel.startLineNumber,
            startColumn: menuSelection.sel.startColumn,
            endLineNumber: menuSelection.sel.endLineNumber,
            endColumn: menuSelection.sel.endColumn,
          }
        : null,
    };
  }, [editorInstance, activeTab, languageId, menuSelection.text, menuSelection.sel]);

  // Group + filter extension items by `when`-clause and `group`.
  const groupedExtItems = groupExtensionItems([...contextMenuItems], {
    hasSelection,
    languageId,
  });

  // Virtual Floating UI anchor fixed at the cursor position.
  const cursorAnchor = useMemo(
    () => ({
      getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    }),
    [x, y],
  );

  // Close a stale menu when the user switches tabs underneath it.
  const prevTabIdRef = useRef(activeTabId);
  useEffect(() => {
    if (prevTabIdRef.current !== activeTabId) {
      prevTabIdRef.current = activeTabId;
      onClose();
    }
  }, [activeTabId, onClose]);

  // Close when the editor (or other scroll containers) scroll, and on resize.
  // Scrolling inside the menu popups themselves must not close it.
  useEffect(() => {
    const isInsideMenuPopup = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      !!target.closest(
        '[data-slot="context-menu-content"], [data-slot="context-menu-sub-content"]',
      );
    const handleScroll = (e: Event) => {
      if (isInsideMenuPopup(e.target)) return;
      onClose();
    };
    const handleResize = () => onClose();
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [onClose]);

  const triggerAction = (handlerId: string) => {
    onClose();
    editorInstance?.trigger('contextMenu', handlerId);
  };

  // ── Navigation actions (LSP-gated) ────────────────────────────────────────
  const handleGoToDefinition = () => triggerAction('editor.action.revealDefinition');
  const handleGoToDeclaration = () => {
    // Fall back to definition when the server has no declaration provider.
    triggerAction(
      lspActions.declaration ? 'editor.action.revealDeclaration' : 'editor.action.revealDefinition',
    );
  };
  const handleGoToTypeDefinition = () => triggerAction('editor.action.goToTypeDefinition');
  const handleGoToImplementation = () => triggerAction('editor.action.goToImplementation');
  const handleFindAllReferences = () => triggerAction('editor.action.goToReferences');
  const handlePeekDefinition = () => triggerAction('editor.action.peekDefinition');
  const handleGoToSymbol = () => triggerAction('editor.action.quickOutline');

  // ── Refactoring actions (LSP-gated) ───────────────────────────────────────
  const handleRenameSymbol = () => triggerAction('editor.action.rename');

  // ── Code actions (LSP-gated) ──────────────────────────────────────────────
  const handleShowCodeActions = () => triggerAction('editor.action.quickFix');
  const handleConfigureLanguageServers = () => {
    onClose();
    openSettingsOnTab('languages');
  };

  // ── Edit actions ──────────────────────────────────────────────────────────
  const handleUndo = () => triggerAction('undo');
  const handleRedo = () => triggerAction('redo');
  const handleSelectAll = () => triggerAction('editor.action.selectAll');
  const handleOpenCommandPalette = () => {
    onClose();
    openCommandPalette();
  };

  // ── Clipboard actions ─────────────────────────────────────────────────────
  const handleCut = () => triggerAction('editor.action.clipboardCutAction');
  const handleCopy = () => triggerAction('editor.action.clipboardCopyAction');
  const handlePaste = () => triggerAction('editor.action.clipboardPasteAction');

  const handleCopyAndTrim = () => {
    onClose();
    if (!hasSelection || !menuSelection.text) return;
    try {
      const trimmed = trimSelectionText(menuSelection.text);
      if (!trimmed) {
        notify('warning', 'Selection is empty after trimming — clipboard unchanged.', 'Copy and Trim');
        return;
      }
      writeClipboard(trimmed).catch((err: unknown) => {
        notify('error', `Failed to copy: ${err instanceof Error ? err.message : String(err)}`, 'Copy and Trim');
      });
    } catch (err) {
      notify(
        'error',
        `Copy and trim failed: ${err instanceof Error ? err.message : String(err)}`,
        'Copy and Trim',
      );
    }
  };

  // ── Format action ─────────────────────────────────────────────────────────
  const handleFormat = (formatterId: string) => {
    onClose();
    void formatActiveDocument(formatterId, editorInstance);
  };

  // ── File actions ──────────────────────────────────────────────────────────
  const handleRevealInFileExplorer = async () => {
    onClose();
    if (isUntitled || !activeTab?.filePath) return;
    try {
      await tauriInvoke('reveal_path', { path: activeTab.filePath });
    } catch (err) {
      notify(
        'error',
        `Failed to reveal in file explorer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleOpenInTerminal = async () => {
    onClose();
    if (!activeTab?.filePath) return;
    const dir = dirnameOf(activeTab.filePath, rootPath);
    if (!dir) {
      notify('warning', 'Cannot determine a directory for this file.', 'Open in Terminal');
      return;
    }
    try {
      const stat = await tauriFs.statPath(dir);
      if (!stat.is_dir) {
        notify('error', `Not a directory: ${dir}`, 'Open in Terminal');
        return;
      }
    } catch (err) {
      notify(
        'error',
        `Cannot open terminal here: ${err instanceof Error ? err.message : String(err)}`,
        'Open in Terminal',
      );
      return;
    }

    const { createSession } = useTerminalStore.getState();
    const { setTerminalVisible } = useLayoutStore.getState();
    createSession(undefined, false, dir);
    setTerminalVisible(true);
  };

  const handleCopyPathWithLine = async () => {
    onClose();
    if (!activeTab?.filePath) return;
    const pos = editorInstance?.getPosition?.();
    const label = buildPathWithLine(activeTab.filePath, pos, menuSelection.sel);
    try {
      await writeClipboard(label);
    } catch (err) {
      notify(
        'error',
        `Failed to copy path: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // ── File history ──────────────────────────────────────────────────────────
  const ensureHistoryLoaded = useCallback(() => {
    if (!rootPath || !activeTab?.filePath || isUntitled) return;
    if (historyLoadedForRef.current === activeTab.filePath || historyRequestRef.current) return;
    const relPath = toRepoRelativePath(activeTab.filePath, rootPath);
    if (!relPath) {
      notify('warning', 'This file is outside the open workspace.', 'File History');
      return;
    }

    const filePathAtInvoke = activeTab.filePath;
    historyRequestRef.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    tauriInvoke('git_log_file', {
      repoPath: rootPath,
      filePath: relPath,
      limit: 20,
    })
      .then((log) => {
        setHistoryCommits(log);
        historyLoadedForRef.current = filePathAtInvoke;
      })
      .catch((err: unknown) => {
        setHistoryCommits([]);
        const message = err instanceof Error ? err.message : String(err);
        setHistoryError(message);
        notify('error', `Failed to load file history: ${message}`, 'File History');
      })
      .finally(() => {
        historyRequestRef.current = false;
        setHistoryLoading(false);
      });
  }, [rootPath, activeTab?.filePath, isUntitled, notify]);

  const handleOpenCommit = (commit: GitCommitInfo) => {
    onClose();
    useEditorStore
      .getState()
      .openCommitTab(commit.hash, commit.short_hash, commit.message.split('\n')[0] || commit.short_hash);
  };

  return (
    <ContextMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ContextMenuContent
        anchor={cursorAnchor}
        side="bottom"
        align="start"
        aria-label="Editor context menu"
        className="min-w-[240px] max-w-[320px]"
      >
        {/* Navigation */}
        <ContextMenuSub>
          <MenuSubRow icon={Navigation} label="Go to" />
          <ContextMenuSubContent className="min-w-[240px]">
            <MenuRow
              icon={Navigation}
              label="Go to Definition"
              shortcut="F12"
              onClick={handleGoToDefinition}
              disabled={!lspActions.definition}
              title={lspHintFor(lspActions.definition, 'definition')}
            />
            <MenuRow
              icon={ArrowRight}
              label="Go to Declaration"
              onClick={handleGoToDeclaration}
              disabled={!lspActions.declaration && !lspActions.declarationFallback}
              title={
                lspActions.declarationFallback
                  ? 'No declaration provider — opens definition instead'
                  : lspHintFor(lspActions.declaration, 'declaration')
              }
            />
            <MenuRow
              icon={FileCode}
              label="Go to Type Definition"
              onClick={handleGoToTypeDefinition}
              disabled={!lspActions.typeDefinition}
              title={lspHintFor(lspActions.typeDefinition, 'type definition')}
            />
            <MenuRow
              icon={FileSearch}
              label="Go to Implementation"
              shortcut="Ctrl+F12"
              onClick={handleGoToImplementation}
              disabled={!lspActions.implementation}
              title={lspHintFor(lspActions.implementation, 'implementation')}
            />
            <MenuRow
              icon={Search}
              label="Find All References"
              shortcut="Shift+F12"
              onClick={handleFindAllReferences}
              disabled={!lspActions.references}
              title={lspHintFor(lspActions.references, 'references')}
            />
            <MenuRow
              icon={Eye}
              label="Peek Definition"
              shortcut="Alt+F12"
              onClick={handlePeekDefinition}
              disabled={!lspActions.definition}
              title={lspHintFor(lspActions.definition, 'definition')}
            />
            <MenuRow
              icon={ListTree}
              label="Go to Symbol in File"
              shortcut="Ctrl+Shift+O"
              onClick={handleGoToSymbol}
              disabled={!lspActions.documentSymbol}
              title={lspHintFor(lspActions.documentSymbol, 'document symbols')}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Refactoring */}
        <MenuRow
          icon={Type}
          label="Rename Symbol"
          shortcut="F2"
          onClick={handleRenameSymbol}
          disabled={!lspActions.rename}
          title={lspHintFor(lspActions.rename, 'rename')}
        />

        {/* Format */}
        {availableFormatters.length === 1 && (
          <MenuRow
            icon={Sparkles}
            label={`Format with ${availableFormatters[0].item.displayName}`}
            shortcut="Shift+Alt+F"
            onClick={() => handleFormat(availableFormatters[0].item.id)}
            primary
          />
        )}
        {availableFormatters.length > 1 && (
          <ContextMenuSub>
            <MenuSubRow icon={Sparkles} label="Format Document..." primary />
            <ContextMenuSubContent className="min-w-[240px]">
              {availableFormatters.map((f) => (
                <ContextMenuItem
                  key={f.item.id}
                  onClick={() => handleFormat(f.item.id)}
                  className={ROW_CLASS}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1 text-left">{f.item.displayName}</span>
                  <span className="ml-4 text-[9px] text-muted-foreground">
                    {f.extensionName}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        <MenuRow
          icon={Lightbulb}
          label="Show Code Actions"
          shortcut="Ctrl+."
          onClick={handleShowCodeActions}
          disabled={!lspActions.codeAction}
          title={lspHintFor(lspActions.codeAction, 'code actions')}
        />
        {!lspActions.codeAction && builtinServer && (
          <MenuRow
            icon={Settings2}
            label="Configure Language Servers..."
            onClick={handleConfigureLanguageServers}
          />
        )}
        <MenuRow
          icon={Command}
          label="Command Palette"
          shortcut="Ctrl+Shift+P"
          onClick={handleOpenCommandPalette}
        />

        <ContextMenuSeparator />

        {/* Edit */}
        <MenuRow icon={Undo2} label="Undo" shortcut="Ctrl+Z" onClick={handleUndo} />
        <MenuRow icon={Redo2} label="Redo" shortcut="Ctrl+Y" onClick={handleRedo} />

        <ContextMenuSeparator />

        {/* Clipboard */}
        <ContextMenuSub>
          <MenuSubRow icon={Copy} label="Clipboard" />
          <ContextMenuSubContent className="min-w-[240px]">
            <MenuRow icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={handleCut} />
            <MenuRow icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={handleCopy} />
            <MenuRow
              icon={AlignLeft}
              label="Copy and Trim"
              onClick={handleCopyAndTrim}
              disabled={!hasSelection}
              title={hasSelection ? undefined : 'Select text first'}
            />
            <MenuRow
              icon={ClipboardPaste}
              label="Paste"
              shortcut="Ctrl+V"
              onClick={handlePaste}
            />
            <MenuRow
              icon={TextSelect}
              label="Select All"
              shortcut="Ctrl+A"
              onClick={handleSelectAll}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* File actions */}
        <ContextMenuSub>
          <MenuSubRow icon={FolderOpen} label="File" />
          <ContextMenuSubContent className="min-w-[240px]">
            <MenuRow
              icon={FolderOpen}
              label="Reveal in File Explorer"
              shortcut="Ctrl+K R"
              onClick={handleRevealInFileExplorer}
              disabled={isUntitled}
            />
            <MenuRow
              icon={Terminal}
              label="Open in Terminal"
              onClick={handleOpenInTerminal}
              disabled={isUntitled}
            />
            <MenuRow
              icon={Link2}
              label="Copy Path with Line"
              onClick={handleCopyPathWithLine}
              disabled={isUntitled}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* File history */}
        <ContextMenuSub
          onOpenChange={(open) => {
            if (open) ensureHistoryLoaded();
          }}
        >
          <MenuSubRow
            icon={History}
            label="View File History"
            disabled={isUntitled || !rootPath}
          />
          <ContextMenuSubContent className="min-w-[240px]">
            <div className="max-h-[280px] overflow-y-auto">
              {historyLoading ? (
                <div className="px-1.5 py-1">
                  <span className="text-[11px] text-muted-foreground">Loading...</span>
                </div>
              ) : historyError && historyCommits.length === 0 ? (
                <div className="px-1.5 py-1">
                  <span className="text-[11px] text-muted-foreground">
                    Couldn&apos;t load history
                  </span>
                </div>
              ) : historyCommits.length === 0 ? (
                <div className="px-1.5 py-1">
                  <span className="text-[11px] text-muted-foreground">No history found</span>
                </div>
              ) : (
                historyCommits.map((c) => (
                  <ContextMenuItem
                    key={c.hash}
                    title={`${c.message}\n${c.author} — ${formatCommitDate(c.timestamp)}`}
                    onClick={() => handleOpenCommit(c)}
                    className="text-[11px]"
                  >
                    <div className="flex w-full flex-col gap-0.5 text-left">
                      <span className="truncate font-medium">
                        {c.message.split('\n')[0] || c.short_hash}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.short_hash} — {c.author} — {formatCommitDate(c.timestamp)}
                      </span>
                    </div>
                  </ContextMenuItem>
                ))
              )}
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Extension-contributed items, grouped by `group` */}
        {groupedExtItems.map(({ group, items }, gi) => (
          <div key={group}>
            <ContextMenuSeparator />
            {gi === 0 && (
              <div className="px-1.5 pt-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                Extensions
              </div>
            )}
            {items.map((reg) => {
              const Icon = getIcon(reg.item.icon);
              return (
                <MenuRow
                  key={`${reg.extensionName}-${reg.item.id}`}
                  icon={Icon}
                  label={reg.item.label}
                  onClick={() => {
                    onClose();
                    const ctx = getMenuContext();
                    Promise.resolve(reg.item.handler(ctx)).catch((err: unknown) => {
                      notify(
                        'error',
                        `Extension "${reg.extensionName}" action failed: ${err instanceof Error ? err.message : String(err)}`,
                      );
                    });
                  }}
                />
              );
            })}
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
