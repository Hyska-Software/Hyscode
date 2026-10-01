import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  Loader2,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  ClipboardCopy,
  ClipboardPaste,
  Scissors,
  FolderSearch,
  Files,
  History,
  Database,
  SquareTerminal,
  MessageSquarePlus,
  GitCompare,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { useFileStore, useEditorStore, useGitStore, useAgentStore } from '../../../stores';
import { useLayoutStore } from '../../../stores/layout-store';
import { useDiagnosticsStore } from '../../../stores/diagnostics-store';
import { useExtensionStore } from '../../../stores/extension-store';
import { useExtensionUiStore } from '../../../stores/extension-ui-store';
import { useTerminalStore } from '../../../stores/terminal-store';
import type { FileDiagnostics } from '../../../stores/diagnostics-store';
import { tauriFs, TRASH_UNAVAILABLE_PREFIX } from '../../../lib/tauri-fs';
import {
  extractInvokeMessage,
  fsPathsEqual,
  getUniqueDestPath,
  isSameOrWithin,
  joinChild,
  loadDeletePref,
  parentDir,
  performCopy,
  performMove,
  saveDeletePref,
  syncTabsAfterDelete,
  syncTabsAfterMove,
  validateNameClient,
} from '../../../lib/file-ops';
import { getViewerType, writeClipboard } from '../../../lib/utils';
import { detectLanguage } from '../../../lib/lsp-bridge';
import { diagnosticRelativePath } from '../../../lib/diagnostics-types';
import { getFileIcon, getFolderIcon, FolderIcon as DefaultFolderIcon } from './file-icons';
import { promptInput, promptConfirm, promptDelete } from '../../ui/dialogs';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem as UniversalMenuItem,
  ContextMenuSeparator as UniversalMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../../ui/context-menu';
import { FileHistoryModal } from '../../editor/file-history-modal';
import type { FileNode } from '../../../stores/file-store';
import type { GitFile } from '../../../stores/git-store';

// ── Git status colors (matching VS Code) ─────────────────────────────────────
const GIT_NAME_COLORS: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-destructive',
  R: 'text-success',
  C: 'text-success',
  T: 'text-primary',
  U: 'text-warning',
  '?': 'text-success',
};

const GIT_BADGE_COLORS: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-destructive',
  R: 'text-success',
  C: 'text-success',
  T: 'text-primary',
  U: 'text-warning',
  '?': 'text-success',
};

function buildGitStatusMap(
  staged: GitFile[],
  unstaged: GitFile[],
  untracked: GitFile[],
  conflicts: GitFile[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of untracked) map.set(f.path, f.status);
  for (const f of unstaged) map.set(f.path, f.status);
  for (const f of staged) map.set(f.path, f.status);
  for (const f of conflicts) map.set(f.path, f.status);
  return map;
}

function getDirGitInfo(
  relDir: string,
  gitMap: Map<string, string>,
): { count: number; dominantStatus: string | null } {
  let count = 0;
  let dominantStatus: string | null = null;
  const prefix = relDir + '/';
  for (const [path, status] of gitMap) {
    if (path.startsWith(prefix)) {
      count++;
      if (!dominantStatus) dominantStatus = status;
      else if (status === 'M' || status === 'U') dominantStatus = status;
    }
  }
  return { count, dominantStatus };
}

// ── Diagnostics helpers ──────────────────────────────────────────────────────

function getDirDiagnosticsInfo(
  relDir: string,
  diagnosticsMap: Map<string, FileDiagnostics>,
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  const prefix = relDir + '/';
  for (const [path, d] of diagnosticsMap) {
    if (path.startsWith(prefix)) {
      errors += d.errors;
      warnings += d.warnings;
    }
  }
  return { errors, warnings };
}

function formatBadge(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/** Surface a file-operation failure to the user (extension toast + console). */
function notifyError(message: string): void {
  console.error(message);
  try {
    useExtensionUiStore.getState().showNotification('error', message, 'Files');
  } catch {
    // Store unavailable (tests, teardown) — console output above suffices.
  }
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// ── Visible nodes flat list (for keyboard nav) ──────────────────────────────

function getVisibleNodes(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  const walk = (arr: FileNode[]) => {
    for (const n of arr) {
      result.push(n);
      if (n.isDir && n.isExpanded && n.children) {
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return result;
}

// ── Context Menu State ──────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode | null;
}

// ── Inline Input (for inline rename / create) ───────────────────────────────

interface InlineInputProps {
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  depth: number;
  isDir: boolean;
}

function InlineInput({ defaultValue = '', onSubmit, onCancel, depth, isDir }: InlineInputProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (defaultValue) {
      const dotIdx = defaultValue.lastIndexOf('.');
      el.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultValue.length);
    } else {
      el.select();
    }
  }, [defaultValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (value.trim()) onSubmit(value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const IconComp = isDir ? DefaultFolderIcon : getFileIcon(value || 'file');

  return (
    <div
      className="flex items-center gap-1 px-1 py-[3px]"
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      <span className="w-3 shrink-0" />
      <IconComp className="h-3.5 w-3.5 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        className="flex-1 rounded-md bg-card px-1.5 py-0.5 text-[11px] text-foreground outline-none ring-2 ring-primary/40"
      />
    </div>
  );
}

// ── FileTreeNode ────────────────────────────────────────────────────────────

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  renamingPath: string | null;
  creatingIn: { parentPath: string; isDir: boolean } | null;
  onRenameSubmit: (node: FileNode, newName: string) => void;
  onRenameCancel: () => void;
  onCreateSubmit: (name: string) => void;
  onCreateCancel: () => void;
  gitMap: Map<string, string>;
  diagnosticsMap: Map<string, FileDiagnostics>;
  rootPath: string | null;
  // Drag and drop
  draggedPath: string | null;
  dragOverPath: string | null;
  onDragStart: (node: FileNode) => void;
  onDragOver: (e: React.DragEvent, node: FileNode) => void;
  onDragLeave: (e: React.DragEvent, node: FileNode) => void;
  onDrop: (e: React.DragEvent, node: FileNode) => void;
  onDragEnd: () => void;
  // Keyboard focus
  focusedPath: string | null;
  onFocusNode: (path: string) => void;
  // Clipboard
  cutPaths: Set<string>;
}

function FileTreeNode({
  node, depth, onContextMenu, renamingPath, creatingIn,
  onRenameSubmit, onRenameCancel, onCreateSubmit, onCreateCancel,
  gitMap, diagnosticsMap, rootPath,
  draggedPath, dragOverPath, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  focusedPath, onFocusNode, cutPaths,
}: FileTreeNodeProps) {
  const expandDirectory = useFileStore((s) => s.expandDirectory);
  const toggleExpand = useFileStore((s) => s.toggleExpand);
  const openTab = useEditorStore((s) => s.openTab);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const workspaceMode = useLayoutStore((s) => s.workspaceMode);
  const agentPreviewFile = useLayoutStore((s) => s.agentPreviewFile);
  const setAgentPreviewFile = useLayoutStore((s) => s.setAgentPreviewFile);

  const isCut = cutPaths.has(node.path);

  const relPath = useMemo(() => {
    if (!rootPath) return node.path;
    const normalized = node.path.replace(/\\/g, '/');
    let root = rootPath.replace(/\\/g, '/');
    if (!root.endsWith('/')) root += '/';
    return normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
  }, [node.path, rootPath]);

  const gitStatus = gitMap.get(relPath) ?? null;

  const dirGit = useMemo(() => {
    if (!node.isDir) return null;
    return getDirGitInfo(relPath, gitMap);
  }, [node.isDir, relPath, gitMap]);

  const fileDiagnostics = diagnosticsMap.get(relPath) ?? null;

  const dirDiagnostics = useMemo(() => {
    if (!node.isDir) return null;
    return getDirDiagnosticsInfo(relPath, diagnosticsMap);
  }, [node.isDir, relPath, diagnosticsMap]);

  const nameColorClass = useMemo(() => {
    if (fileDiagnostics && fileDiagnostics.errors > 0) return 'text-destructive';
    if (fileDiagnostics && fileDiagnostics.warnings > 0) return 'text-warning';
    if (gitStatus) return GIT_NAME_COLORS[gitStatus] ?? '';
    if (dirDiagnostics && dirDiagnostics.errors > 0) return 'text-destructive';
    if (dirDiagnostics && dirDiagnostics.warnings > 0) return 'text-warning';
    if (dirGit && dirGit.count > 0) return GIT_NAME_COLORS[dirGit.dominantStatus ?? 'M'] ?? '';
    return '';
  }, [fileDiagnostics, gitStatus, dirDiagnostics, dirGit]);

  const isActive = !node.isDir && (
    workspaceMode === 'agent'
      ? agentPreviewFile === node.path
      : tabs.find((t) => t.filePath === node.path)?.id === activeTabId
  );
  const isHidden = node.name.startsWith('.');

  // Use node.path as the stable key for click handlers; read live state from store inside handler
  const nodePath = node.path;
  const nodeIsDir = node.isDir;

  const handleClick = useCallback(async () => {
    onFocusNode(nodePath);
    if (nodeIsDir) {
      const currentNode = useFileStore.getState().findNode(nodePath);
      if (!currentNode) return;
      if (!currentNode.isExpanded && (!currentNode.children || currentNode.children.length === 0)) {
        await expandDirectory(nodePath);
      } else {
        toggleExpand(nodePath);
      }
    } else if (workspaceMode === 'agent') {
      setAgentPreviewFile(nodePath);
    } else {
      const existing = tabs.find((t) => t.filePath === nodePath);
      if (existing) {
        useEditorStore.getState().setActiveTab(existing.id);
      } else {
        openTab({
          id: nodePath,
          filePath: nodePath,
          fileName: node.name,
          language: detectLanguage(nodePath),
          viewerType: getViewerType(node.name),
        });
      }
    }
  }, [nodePath, nodeIsDir, node.name, workspaceMode, tabs, activeTabId, expandDirectory, toggleExpand, openTab, setAgentPreviewFile, onFocusNode]);

  const NodeIcon = node.isDir
    ? getFolderIcon(node.name, !!node.isExpanded)
    : getFileIcon(node.name);

  // ── Render ──────────────────────────────────────────────────────────────

  const isRenaming = renamingPath === node.path;

  if (isRenaming) {
    return (
      <InlineInput
        defaultValue={node.name}
        onSubmit={(newName) => onRenameSubmit(node, newName)}
        onCancel={onRenameCancel}
        depth={depth}
        isDir={node.isDir}
      />
    );
  }

  const showCreateInput =
    creatingIn && creatingIn.parentPath === node.path && node.isDir && node.isExpanded;

  const isDragOver = dragOverPath === node.path && node.isDir;
  const isDragging = draggedPath === node.path;

  return (
    <div
      className="relative"
      onDragOver={node.isDir ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = draggedPath ? 'move' : 'copy';
        onDragOver(e, node);
      } : undefined}
      onDragLeave={node.isDir ? (e) => onDragLeave(e, node) : undefined}
      onDrop={node.isDir ? (e) => { e.preventDefault(); e.stopPropagation(); onDrop(e, node); } : undefined}
    >
      <button
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData('text/plain', node.path);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(node);
        }}
        onDragEnd={onDragEnd}
        onDragOver={!node.isDir ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = draggedPath ? 'move' : 'copy'; } : undefined}
        data-tree-path={node.path}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[11px] text-foreground transition-colors ${
          isDragOver
            ? 'bg-primary/20 ring-1 ring-inset ring-primary/50'
            : isActive ? 'bg-primary/15' : 'hover:bg-muted'
        } ${nameColorClass || ''} ${isHidden ? 'opacity-60' : ''} ${
          isDragging || isCut ? 'opacity-30' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isDir ? (
          <>
            {node.isLoading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${node.isExpanded ? 'rotate-90' : ''}`} />
            )}
            <NodeIcon className="h-4 w-4 shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <NodeIcon className="h-4 w-4 shrink-0" />
          </>
        )}
        <span className={`truncate ${nameColorClass || ''} ${gitStatus === 'D' ? 'line-through opacity-70' : ''}`}>
          {node.name}
        </span>
        {/* Diagnostics badge for files */}
        {!node.isDir && fileDiagnostics && fileDiagnostics.errors > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-destructive/15 px-1 py-0 text-[9px] font-bold text-destructive">
            {formatBadge(fileDiagnostics.errors)}
          </span>
        )}
        {!node.isDir && fileDiagnostics && fileDiagnostics.errors === 0 && fileDiagnostics.warnings > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-warning/15 px-1 py-0 text-[9px] font-bold text-warning">
            {formatBadge(fileDiagnostics.warnings)}
          </span>
        )}
        {/* Git badge for files */}
        {!node.isDir && gitStatus && (
          <span className={`ml-1 shrink-0 pr-1 text-[10px] font-mono font-medium ${GIT_BADGE_COLORS[gitStatus] ?? 'text-muted-foreground'}`}>
            {gitStatus === '?' ? 'U' : gitStatus}
          </span>
        )}
        {/* Diagnostics dot for directories */}
        {node.isDir && dirDiagnostics && dirDiagnostics.errors > 0 && (
          <span className="ml-auto mr-1 shrink-0 h-[6px] w-[6px] rounded-full bg-destructive" />
        )}
        {node.isDir && dirDiagnostics && dirDiagnostics.errors === 0 && dirDiagnostics.warnings > 0 && (
          <span className="ml-auto mr-1 shrink-0 h-[6px] w-[6px] rounded-full bg-warning" />
        )}
        {/* Git dot for directories */}
        {node.isDir && dirGit && dirGit.count > 0 && (
          <span className={`ml-1 shrink-0 pr-1 h-[6px] w-[6px] rounded-full ${
            dirGit.dominantStatus === 'M' || dirGit.dominantStatus === 'U'
              ? 'bg-warning'
              : dirGit.dominantStatus === 'D' ? 'bg-destructive' : 'bg-success'
          }`} />
        )}
      </button>

      {node.isDir && node.isExpanded && (
        <div>
          {showCreateInput && (
            <InlineInput
              onSubmit={onCreateSubmit}
              onCancel={onCreateCancel}
              depth={depth + 1}
              isDir={creatingIn!.isDir}
            />
          )}
          {node.children && node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              creatingIn={creatingIn}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
              gitMap={gitMap}
              diagnosticsMap={diagnosticsMap}
              rootPath={rootPath}
              draggedPath={draggedPath}
              dragOverPath={dragOverPath}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              focusedPath={focusedPath}
              onFocusNode={onFocusNode}
              cutPaths={cutPaths}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Context Menu Item (universal component + file-tree icon/label/shortcut) ──

function ContextMenuItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof FilePlus;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <UniversalMenuItem
      onClick={onClick}
      variant={danger ? 'destructive' : 'default'}
      disabled={disabled}
      className="text-[11px] [&_svg]:size-3.5"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="ml-4 text-[10px] text-muted-foreground">{shortcut}</span>
      )}
    </UniversalMenuItem>
  );
}

function ContextMenuSeparator() {
  return <UniversalMenuSeparator />;
}

// ── Main FileTree ────────────────────────────────────────────────────────────

export function FileTree() {
  const tree = useFileStore((s) => s.tree);
  const rootPath = useFileStore((s) => s.rootPath);
  const expandDirectory = useFileStore((s) => s.expandDirectory);
  // Re-render when extension icon themes change
  useExtensionStore((s) => s.extensionIconThemesVersion);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<{ parentPath: string; isDir: boolean } | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{ paths: string[]; op: 'copy' | 'cut' } | null>(null);
  const [historyModalPath, setHistoryModalPath] = useState<string | null>(null);
  const clipboardRef = useRef(clipboard);
  useEffect(() => { clipboardRef.current = clipboard; }, [clipboard]);
  const cutPaths = useMemo(() => {
    if (!clipboard || clipboard.op !== 'cut') return new Set<string>();
    return new Set(clipboard.paths);
  }, [clipboard]);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Build git status map
  const staged = useGitStore((s) => s.staged);
  const unstaged = useGitStore((s) => s.unstaged);
  const untracked = useGitStore((s) => s.untracked);
  const conflicts = useGitStore((s) => s.conflicts);
  const isGitRepo = useGitStore((s) => s.isGitRepo);
  const gitMap = useMemo(
    () => buildGitStatusMap(staged, unstaged, untracked, conflicts),
    [staged, unstaged, untracked, conflicts],
  );

  // Build diagnostics map
  const diagnosticsRaw = useDiagnosticsStore((s) => s.diagnostics);
  const diagnosticsMap = useMemo(() => {
    const map = new Map<string, FileDiagnostics>();
    if (!rootPath) return map;
    for (const [absPath, counts] of diagnosticsRaw) {
      const relativePath = diagnosticRelativePath(rootPath, absPath);
      if (relativePath !== null) map.set(relativePath, counts);
    }
    return map;
  }, [diagnosticsRaw, rootPath]);

  // ── Keyboard Navigation ────────────────────────────────────────────────────
  const visibleNodes = useMemo(() => getVisibleNodes(tree), [tree]);

  const getTargetParent = (node: FileNode | null): string => {
    if (!node) return rootPath ?? '';
    return node.isDir ? node.path : parentDir(node.path);
  };

  const withPending = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setPendingOps((prev) => new Set(prev).add(key));
    try {
      return await fn();
    } catch (err) {
      // Surface to the user (extension notification toast) in addition to console,
      // matching the git-view-new opStatus pattern — callers may re-handle.
      notifyError(`${key} failed: ${extractInvokeMessage(err)}`);
      throw err;
    } finally {
      setPendingOps((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleCopyItem = (node: FileNode) => setClipboard({ paths: [node.path], op: 'copy' });
  const handleCutItem = (node: FileNode) => setClipboard({ paths: [node.path], op: 'cut' });

  const handlePaste = async (targetDir: string) => {
    const cb = clipboardRef.current;
    if (!cb || !targetDir) return;
    for (const srcPath of cb.paths) {
      const node = useFileStore.getState().findNode(srcPath);
      let isDir = node?.isDir;
      if (isDir === undefined) {
        try {
          isDir = (await tauriFs.statPath(srcPath)).is_dir;
        } catch {
          isDir = false;
        }
      }
      try {
        if (cb.op === 'copy') {
          await withPending('paste-' + srcPath, () => performCopy(srcPath, targetDir));
        } else {
          const dest = await withPending('paste-' + srcPath, () =>
            performMove(srcPath, targetDir),
          );
          if (dest && !fsPathsEqual(dest, srcPath)) {
            syncTabsAfterMove(srcPath, dest, isDir, detectLanguage);
          }
        }
      } catch (err) {
        notifyError(`Paste failed: ${extractInvokeMessage(err)}`);
      }
    }
    if (cb.op === 'cut') setClipboard(null);
  };

  useEffect(() => {
    const container = treeContainerRef.current;
    if (!container) return;

    const handler = (e: KeyboardEvent) => {
      if (!visibleNodes.length) return;
      if (renamingPath || creatingIn) return; // Don't interfere with inline input

      const currentIdx = focusedPath ? visibleNodes.findIndex((n) => n.path === focusedPath) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = visibleNodes[Math.min(currentIdx + 1, visibleNodes.length - 1)];
        if (next) {
          setFocusedPath(next.path);
          requestAnimationFrame(() => {
            const el = container.querySelector(`[data-tree-path="${CSS.escape(next.path)}"]`) as HTMLElement | null;
            el?.scrollIntoView({ block: 'nearest' });
          });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = visibleNodes[Math.max(currentIdx - 1, 0)];
        if (prev) {
          setFocusedPath(prev.path);
          requestAnimationFrame(() => {
            const el = container.querySelector(`[data-tree-path="${CSS.escape(prev.path)}"]`) as HTMLElement | null;
            el?.scrollIntoView({ block: 'nearest' });
          });
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : visibleNodes[0];
        if (node?.isDir && !node.isExpanded) {
          expandDirectory(node.path);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : visibleNodes[0];
        if (node?.isDir && node.isExpanded) {
          useFileStore.getState().toggleExpand(node.path);
        } else if (node) {
          const parent = useFileStore.getState().getParentPath(node.path);
          if (parent && parent !== rootPath) {
            setFocusedPath(parent);
            useFileStore.getState().toggleExpand(parent);
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : visibleNodes[0];
        if (node) {
          const el = container.querySelector(`[data-tree-path="${CSS.escape(node.path)}"]`) as HTMLElement | null;
          el?.click();
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : null;
        if (node) {
          setContextMenu(null);
          setRenamingPath(node.path);
        }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : null;
        if (node) {
          handleDeleteNode(node);
        }
      } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : null;
        if (node) handleCopyItem(node);
      } else if (e.key === 'x' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : null;
        if (node) handleCutItem(node);
      } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!clipboardRef.current) return;
        const node = currentIdx >= 0 ? visibleNodes[currentIdx] : null;
        const targetDir = node ? getTargetParent(node) : (rootPath ?? '');
        if (targetDir) handlePaste(targetDir).catch((err) => notifyError(`Paste failed: ${extractInvokeMessage(err)}`));
      }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }, [visibleNodes, focusedPath, renamingPath, creatingIn, expandDirectory, rootPath, handleCopyItem, handleCutItem, handlePaste, getTargetParent]);

  // ── Context menu interactions ─────────────────────────────────────────────
  // Open/close + Escape/outside-press are handled by the universal ContextMenu
  // Root. The virtual cursor anchor is fixed, so close on scroll like before.
  useEffect(() => {
    if (!contextMenu) return;
    const onScroll = () => setContextMenu(null);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [contextMenu]);

  // Virtual Floating UI anchor at the cursor position. Memoized on coordinates
  // so the menu doesn't reposition on unrelated renders.
  const cursorAnchor = useMemo(() => {
    if (!contextMenu) return null;
    const { x, y } = contextMenu;
    return {
      getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    };
  }, [contextMenu]);

  // ── Context menu on nodes ──────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setFocusedPath(node.path);
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // ── Context menu on empty space ────────────────────────────────────────────
  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, node: null });
    },
    [],
  );

  // ── Drag and Drop ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((node: FileNode) => {
    setDraggedPath(node.path);
  }, []);

  // Use a ref for draggedPath so dragOver can read it without stale closure
  const draggedPathRef = useRef(draggedPath);
  useEffect(() => { draggedPathRef.current = draggedPath; }, [draggedPath]);

  const handleDragOver = useCallback((e: React.DragEvent, node: FileNode) => {
    if (!node.isDir) return;
    const dragged = draggedPathRef.current;
    if (dragged) {
      // Refuse dropping a folder onto itself or into its own subtree.
      if (isSameOrWithin(node.path, dragged)) return;
    } else if (!e.dataTransfer.types.includes('Files')) {
      return;
    }
    setDragOverPath((p) => (p === node.path ? p : node.path));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, _node: FileNode) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPath(null);
    }
  }, []);

  const handleExternalFileDrop = useCallback(async (files: File[], targetDir: string) => {
    const targetNode = useFileStore.getState().findNode(targetDir);
    if (targetNode && !targetNode.isExpanded) {
      await expandDirectory(targetDir);
    }
    for (const file of files) {
      const srcPath = (file as unknown as { path?: string }).path;
      if (!srcPath) continue;
      try {
        const destPath = await getUniqueDestPath(targetDir, file.name);
        await withPending('import-' + file.name, () => tauriFs.copyPath(srcPath, destPath));
      } catch (err) {
        notifyError(`Import failed for "${file.name}": ${extractInvokeMessage(err)}`);
      }
    }
  }, [expandDirectory]);

  const handleDrop = useCallback(async (e: React.DragEvent, targetNode: FileNode) => {
    setDragOverPath(null);
    const dragged = draggedPathRef.current;
    setDraggedPath(null);
    if (!targetNode.isDir) return;
    if (dragged) {
      if (isSameOrWithin(targetNode.path, dragged)) return;
      const node = useFileStore.getState().findNode(dragged);
      let isDir = node?.isDir;
      if (isDir === undefined) {
        try {
          isDir = (await tauriFs.statPath(dragged)).is_dir;
        } catch {
          isDir = false;
        }
      }
      try {
        const dest = await performMove(dragged, targetNode.path);
        if (!fsPathsEqual(dest, dragged)) {
          syncTabsAfterMove(dragged, dest, isDir, detectLanguage);
        }
      } catch (err) {
        notifyError(`Move failed: ${extractInvokeMessage(err)}`);
      }
    } else {
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      handleExternalFileDrop(files, targetNode.path).catch((err) => {
        notifyError(`Import failed: ${extractInvokeMessage(err)}`);
      });
    }
  }, [handleExternalFileDrop]);

  const handleDragEnd = useCallback(() => {
    setDraggedPath(null);
    setDragOverPath(null);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleNewFile = async () => {
    const node = contextMenu?.node ?? null;
    setContextMenu(null);

    if (!node) {
      if (!rootPath) return;
      const name = await promptInput({ title: 'New File', placeholder: 'Enter file name' });
      if (!name?.trim()) return;
      const trimmed = name.trim();
      const clientError = validateNameClient(trimmed);
      if (clientError) {
        notifyError(clientError);
        return;
      }
      try {
        const newPath = await joinChild(rootPath, trimmed);
        await withPending('new-file', () => tauriFs.createFile(newPath, ''));
      } catch (err) {
        notifyError(`Cannot create file: ${extractInvokeMessage(err)}`);
      }
      return;
    }

    const parentPath = getTargetParent(node);
    if (!parentPath) return;
    if (node.isDir && !node.isExpanded) {
      await expandDirectory(node.path);
    }
    setCreatingIn({ parentPath, isDir: false });
  };

  const handleNewFolder = async () => {
    const node = contextMenu?.node ?? null;
    setContextMenu(null);

    if (!node) {
      if (!rootPath) return;
      const name = await promptInput({ title: 'New Folder', placeholder: 'Enter folder name' });
      if (!name?.trim()) return;
      const trimmed = name.trim();
      const clientError = validateNameClient(trimmed);
      if (clientError) {
        notifyError(clientError);
        return;
      }
      try {
        const newPath = await joinChild(rootPath, trimmed);
        await withPending('new-folder', async () => {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('create_directory', { path: newPath });
        });
      } catch (err) {
        notifyError(`Cannot create folder: ${extractInvokeMessage(err)}`);
      }
      return;
    }

    const parentPath = getTargetParent(node);
    if (!parentPath) return;
    if (node.isDir && !node.isExpanded) {
      await expandDirectory(node.path);
    }
    setCreatingIn({ parentPath, isDir: true });
  };

  const handleRename = () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);
    // Inline rename (same UX as F2): validation errors keep the input open.
    setRenamingPath(node.path);
  };

  const handleDeleteNode = async (targetNode?: FileNode) => {
    const target = targetNode ?? contextMenu?.node;
    if (!target) return;
    setContextMenu(null);

    const stored = loadDeletePref();
    let mode = stored?.dontAsk === true ? stored.mode : null;
    if (!mode) {
      const choice = await promptDelete({
        fileName: target.name,
        isDir: target.isDir,
        defaultMode: stored?.mode ?? 'trash',
      });
      if (!choice) return;
      mode = choice.mode;
      if (choice.dontAsk) saveDeletePref({ mode, dontAsk: true });
    }

    const runDelete = (m: 'trash' | 'permanent') =>
      withPending('delete-' + target.path, () =>
        m === 'trash' ? tauriFs.trashPath(target.path) : tauriFs.deletePath(target.path),
      );

    try {
      await runDelete(mode);
      syncTabsAfterDelete(target.path, target.isDir);
    } catch (err) {
      const message = extractInvokeMessage(err);
      if (mode === 'trash' && message.startsWith(TRASH_UNAVAILABLE_PREFIX)) {
        const reason = message.slice(TRASH_UNAVAILABLE_PREFIX.length).replace(/^:\s*/, '');
        const confirmed = await promptConfirm({
          title: 'Trash is unavailable',
          description: reason
            ? `Could not move "${target.name}" to Trash (${reason}). Delete it permanently instead? This cannot be undone.`
            : `Could not move "${target.name}" to Trash. Delete it permanently instead? This cannot be undone.`,
          confirmLabel: 'Delete permanently',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await runDelete('permanent');
          syncTabsAfterDelete(target.path, target.isDir);
        } catch (err2) {
          notifyError(`Delete failed: ${extractInvokeMessage(err2)}`);
        }
        return;
      }
      notifyError(`Delete failed: ${message}`);
    }
  };

  const handleDuplicate = async () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);

    let defaultName: string;
    if (node.isDir) {
      defaultName = node.name + ' copy';
    } else {
      const dotIdx = node.name.lastIndexOf('.');
      if (dotIdx > 0) {
        defaultName = node.name.slice(0, dotIdx) + ' copy' + node.name.slice(dotIdx);
      } else {
        defaultName = node.name + ' copy';
      }
    }

    const newName = await promptInput({
      title: `Duplicate "${node.name}"`,
      placeholder: 'Enter name for copy',
      defaultValue: defaultName,
      confirmLabel: 'Duplicate',
    });

    if (!newName) return;

    const trimmed = newName.trim();
    const clientError = validateNameClient(trimmed);
    if (clientError) {
      notifyError(clientError);
      return;
    }

    try {
      const newPath = await joinChild(parentDir(node.path), trimmed);
      if (fsPathsEqual(newPath, node.path)) return;
      await withPending('duplicate-' + node.path, () => tauriFs.copyPath(node.path, newPath));
    } catch (err) {
      notifyError(`Duplicate failed: ${extractInvokeMessage(err)}`);
    }
  };

  const handleCopyPath = async () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);
    try {
      await writeClipboard(node.path);
    } catch (err) {
      notifyError(`Cannot copy path: ${extractInvokeMessage(err)}`);
    }
  };

  const handleCopyRelativePath = async () => {
    if (!contextMenu?.node || !rootPath) return;
    const node = contextMenu.node;
    setContextMenu(null);
    const normalized = node.path.replace(/\\/g, '/');
    let root = rootPath.replace(/\\/g, '/');
    if (!root.endsWith('/')) root += '/';
    const relPath = normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
    try {
      await writeClipboard(relPath);
    } catch (err) {
      notifyError(`Cannot copy relative path: ${extractInvokeMessage(err)}`);
    }
  };

  const handleRevealInFileManager = async () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reveal_path', { path: node.path });
    } catch (err) {
      notifyError(`Cannot reveal in file manager: ${extractInvokeMessage(err)}`);
    }
  };

  const handleViewHistory = () => {
    if (!contextMenu?.node || contextMenu.node.isDir) return;
    const node = contextMenu.node;
    setContextMenu(null);
    setHistoryModalPath(node.path);
  };

  const handleOpenAsSchemaViewer = () => {
    if (!contextMenu?.node || contextMenu.node.isDir) return;
    const node = contextMenu.node;
    setContextMenu(null);
    useEditorStore.getState().openDbSchemaTab(node.path);
  };

  const handleOpenInTerminal = (targetDir: string, label: string) => {
    setContextMenu(null);
    if (!targetDir) return;
    try {
      const sessionId = useTerminalStore
        .getState()
        .createSession(label, false, targetDir, 'panel');
      useTerminalStore.getState().setActiveSession(sessionId);
      useLayoutStore.getState().setTerminalVisible(true);
    } catch (err) {
      notifyError(`Cannot open terminal: ${extractInvokeMessage(err)}`);
    }
  };

  const handleAddToChat = () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);
    try {
      useAgentStore.getState().addContextFile(node.path);
      useExtensionUiStore
        .getState()
        .showNotification('info', `"${node.name}" added to chat context`, 'Agent');
    } catch (err) {
      notifyError(`Cannot add to chat: ${extractInvokeMessage(err)}`);
    }
  };

  const handleOpenChanges = () => {
    if (!contextMenu?.node || contextMenu.node.isDir) return;
    const node = contextMenu.node;
    setContextMenu(null);
    try {
      useEditorStore.getState().openTab({
        id: `diff:unstaged:${node.path}`,
        filePath: node.path,
        fileName: `${node.name} (changes)`,
        language: detectLanguage(node.path),
        type: 'diff',
        viewerType: getViewerType(node.name),
        diffProps: { filePath: node.path, staged: false, mode: 'unstaged' },
      });
    } catch (err) {
      notifyError(`Cannot open changes: ${extractInvokeMessage(err)}`);
    }
  };

  const handleOpenWithText = () => {
    if (!contextMenu?.node || contextMenu.node.isDir) return;
    const node = contextMenu.node;
    setContextMenu(null);
    try {
      useEditorStore.getState().openTab({
        id: node.path,
        filePath: node.path,
        fileName: node.name,
        language: detectLanguage(node.path),
        viewerType: 'code',
      });
    } catch (err) {
      notifyError(`Cannot open file: ${extractInvokeMessage(err)}`);
    }
  };

  const handleOpenWithDefault = async () => {
    if (!contextMenu?.node || contextMenu.node.isDir) return;
    const node = contextMenu.node;
    setContextMenu(null);
    try {
      await tauriFs.openPath(node.path);
    } catch (err) {
      notifyError(`Cannot open with default application: ${extractInvokeMessage(err)}`);
    }
  };

  // ── Create / Rename submit ─────────────────────────────────────────────────

  const handleRenameSubmit = async (node: FileNode, newName: string) => {
    if (newName === node.name) {
      setRenamingPath(null);
      return;
    }
    const trimmed = newName.trim();
    if (!trimmed || trimmed === node.name) {
      setRenamingPath(null);
      return;
    }
    // Validation failures keep the inline input open so nothing is lost.
    const clientError = validateNameClient(trimmed);
    if (clientError) {
      notifyError(clientError);
      return;
    }
    let newPath: string;
    try {
      await tauriFs.validateName(trimmed);
      newPath = await joinChild(parentDir(node.path), trimmed);
    } catch (err) {
      notifyError(`Cannot rename: ${extractInvokeMessage(err)}`);
      return;
    }
    if (fsPathsEqual(newPath, node.path)) {
      setRenamingPath(null);
      return;
    }
    setRenamingPath(null);
    try {
      await withPending('rename-' + node.path, () => tauriFs.renamePath(node.path, newPath));
      syncTabsAfterMove(node.path, newPath, node.isDir, detectLanguage);
    } catch (err) {
      notifyError(`Rename failed: ${extractInvokeMessage(err)}`);
    }
  };

  const handleCreateSubmit = async (name: string) => {
    if (!creatingIn) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setCreatingIn(null);
      return;
    }
    // Validation failures keep the inline input open so nothing is lost.
    const clientError = validateNameClient(trimmed);
    if (clientError) {
      notifyError(clientError);
      return;
    }
    let newPath: string;
    try {
      await tauriFs.validateName(trimmed);
      newPath = await joinChild(creatingIn.parentPath, trimmed);
    } catch (err) {
      notifyError(`Cannot create: ${extractInvokeMessage(err)}`);
      return;
    }
    const isDir = creatingIn.isDir;
    setCreatingIn(null);
    try {
      await withPending('create-' + newPath, async () => {
        if (isDir) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('create_directory', { path: newPath });
        } else {
          await tauriFs.createFile(newPath, '');
        }
      });
    } catch (err) {
      notifyError(`Create failed: ${extractInvokeMessage(err)}`);
    }
  };

  if (tree.length === 0) {
    return null;
  }

  const sortedTree = sortNodes(tree);
  const hasNode = !!contextMenu?.node;
  const menuNode = contextMenu?.node ?? null;
  const menuNodeIsFile = !!menuNode && !menuNode.isDir;
  const menuViewerType = menuNodeIsFile ? getViewerType(menuNode!.name) : null;
  const menuIsTextual = menuViewerType === 'code' || menuViewerType === 'markdown';
  const menuIsDbFile =
    menuNodeIsFile &&
    ['sql', 'prisma', 'db', 'sqlite', 'sqlite3'].includes(
      menuNode!.name.split('.').pop()?.toLowerCase() ?? '',
    );

  return (
    <div
      ref={treeContainerRef}
      tabIndex={0}
      className="relative flex min-h-full flex-col py-1 outline-none"
      onContextMenu={handleEmptyContextMenu}
      onDragOver={(e) => {
        if (draggedPath) return;
        if (rootPath && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        if (draggedPath || !rootPath) return;
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        setDragOverPath(null);
        handleExternalFileDrop(files, rootPath).catch((err) => notifyError(`Import failed: ${extractInvokeMessage(err)}`));
      }}
    >
      {sortedTree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          creatingIn={creatingIn}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={() => setRenamingPath(null)}
          onCreateSubmit={handleCreateSubmit}
          onCreateCancel={() => setCreatingIn(null)}
          gitMap={gitMap}
          diagnosticsMap={diagnosticsMap}
          rootPath={rootPath}
          draggedPath={draggedPath}
          dragOverPath={dragOverPath}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          focusedPath={focusedPath}
          onFocusNode={setFocusedPath}
          cutPaths={cutPaths}
        />
      ))}

      {/* Context Menu (universal component, anchored at the cursor;
          Floating UI flips/shifts on viewport collision) */}
      <ContextMenu
        open={!!contextMenu}
        onOpenChange={(open) => {
          if (!open) setContextMenu(null);
        }}
      >
        <ContextMenuContent
          anchor={cursorAnchor}
          side="bottom"
          align="start"
          className="min-w-[200px]"
        >
          <ContextMenuItem icon={FilePlus} label="New File..." onClick={handleNewFile} />
          <ContextMenuItem icon={FolderPlus} label="New Folder..." onClick={handleNewFolder} />

          <ContextMenuSeparator />
          {menuNodeIsFile && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-[11px] [&_svg]:size-3.5">
                <Files className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 text-left">Open With</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[200px]">
                {menuIsTextual && (
                  <ContextMenuItem icon={FileText} label="Text Editor" onClick={handleOpenWithText} />
                )}
                {menuIsDbFile && (
                  <ContextMenuItem icon={Database} label="Schema Canvas" onClick={handleOpenAsSchemaViewer} />
                )}
                <ContextMenuItem icon={ExternalLink} label="Default Application" onClick={handleOpenWithDefault} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuItem
            icon={SquareTerminal}
            label="Open in Integrated Terminal"
            onClick={() => {
              if (menuNode) {
                const cwd = menuNode.isDir ? menuNode.path : parentDir(menuNode.path);
                handleOpenInTerminal(cwd, menuNode.name);
              } else if (rootPath) {
                handleOpenInTerminal(rootPath, 'Terminal');
              }
            }}
          />
          {hasNode && (
            <ContextMenuItem icon={FolderSearch} label="Reveal in File Manager" onClick={handleRevealInFileManager} />
          )}

          <ContextMenuSeparator />
          {hasNode && (
            <ContextMenuItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => { handleCutItem(contextMenu!.node!); }} />
          )}
          {hasNode && (
            <ContextMenuItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => { handleCopyItem(contextMenu!.node!); }} />
          )}
          {clipboard && (
            <ContextMenuItem icon={ClipboardPaste} label="Paste" shortcut="Ctrl+V" onClick={() => {
              const t = contextMenu?.node ? getTargetParent(contextMenu.node) : (rootPath ?? '');
              if (t) handlePaste(t).catch((err) => notifyError(`Paste failed: ${extractInvokeMessage(err)}`));
            }} />
          )}

          {menuNodeIsFile && (
            <>
              <ContextMenuSeparator />
              {isGitRepo && (
                <ContextMenuItem icon={GitCompare} label="Open Changes" onClick={handleOpenChanges} />
              )}
              <ContextMenuItem icon={History} label="View History" onClick={handleViewHistory} />
              <ContextMenuItem icon={MessageSquarePlus} label="Add File to Chat" onClick={handleAddToChat} />
            </>
          )}
          {hasNode && contextMenu?.node?.isDir && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem icon={MessageSquarePlus} label="Add Folder to Chat" onClick={handleAddToChat} />
            </>
          )}

          {hasNode && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem icon={Pencil} label="Rename..." shortcut="F2" onClick={handleRename} />
              <ContextMenuItem icon={Files} label="Duplicate..." onClick={handleDuplicate} />
              <ContextMenuItem icon={Trash2} label="Delete" shortcut="Del" onClick={() => handleDeleteNode()} danger />

              <ContextMenuSeparator />
              <ContextMenuItem icon={Copy} label="Copy Path" onClick={handleCopyPath} />
              <ContextMenuItem icon={ClipboardCopy} label="Copy Relative Path" onClick={handleCopyRelativePath} />
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* File History Modal */}
      {historyModalPath && (
        <FileHistoryModal
          filePath={historyModalPath}
          onClose={() => setHistoryModalPath(null)}
        />
      )}

      {/* Pending ops overlay */}
      {pendingOps.size > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-end p-2">
            <div className="flex items-center gap-1.5 rounded-md bg-card px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working...
          </div>
        </div>
      )}
    </div>
  );
}
