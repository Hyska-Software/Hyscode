import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
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
} from 'lucide-react';
import { useFileStore, useEditorStore, useGitStore } from '../../../stores';
import { useLayoutStore } from '../../../stores/layout-store';
import { useDiagnosticsStore } from '../../../stores/diagnostics-store';
import { useExtensionStore } from '../../../stores/extension-store';
import type { FileDiagnostics } from '../../../stores/diagnostics-store';
import { tauriFs } from '../../../lib/tauri-fs';
import { getViewerType, writeClipboard } from '../../../lib/utils';
import { detectLanguage } from '../../../lib/lsp-bridge';
import { getFileIcon, getFolderIcon, FolderIcon as DefaultFolderIcon } from './file-icons';
import { promptInput, promptConfirm } from '../../ui/dialogs';
import { FileHistoryModal } from '../../editor/file-history-modal';
import type { FileNode } from '../../../stores/file-store';
import type { GitFile } from '../../../stores/git-store';

// ── Git status colors (matching VS Code) ─────────────────────────────────────
const GIT_NAME_COLORS: Record<string, string> = {
  M: 'text-amber-300',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-green-400',
  C: 'text-green-400',
  T: 'text-purple-400',
  U: 'text-orange-400',
  '?': 'text-green-400',
};

const GIT_BADGE_COLORS: Record<string, string> = {
  M: 'text-amber-300',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-green-400',
  C: 'text-green-400',
  T: 'text-purple-400',
  U: 'text-orange-400',
  '?': 'text-green-400',
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

async function getUniqueDestPath(targetDir: string, name: string, sep: string): Promise<string> {
  let destPath = targetDir + sep + name;
  try {
    await tauriFs.statPath(destPath);
    const dotIdx = name.lastIndexOf('.');
    const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
    const ext = dotIdx > 0 ? name.slice(dotIdx) : '';
    let i = 1;
    while (true) {
      destPath = `${targetDir}${sep}${base} (${i})${ext}`;
      try {
        await tauriFs.statPath(destPath);
        i++;
      } catch {
        break;
      }
    }
  } catch {
    // Original path doesn't exist, use it as-is
  }
  return destPath;
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

function getParentPath(path: string): string {
  const sep = path.includes('/') ? '/' : '\\';
  const parts = path.split(sep);
  parts.pop();
  return parts.join(sep);
}

function getSep(path: string): string {
  return path.includes('/') ? '/' : '\\';
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
        className="flex-1 rounded-sm bg-background px-1 py-0.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent/40"
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

  const isFocused = focusedPath === node.path;
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
    if (fileDiagnostics && fileDiagnostics.errors > 0) return 'text-red-400';
    if (fileDiagnostics && fileDiagnostics.warnings > 0) return 'text-amber-300';
    if (gitStatus) return GIT_NAME_COLORS[gitStatus] ?? '';
    if (dirDiagnostics && dirDiagnostics.errors > 0) return 'text-red-400';
    if (dirDiagnostics && dirDiagnostics.warnings > 0) return 'text-amber-300';
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
  const ChevronIcon = node.isExpanded ? ChevronDown : ChevronRight;

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
        className={`flex w-full items-center gap-1 rounded-sm px-1 py-[3px] text-[11px] transition-colors ${
          isDragOver
            ? 'bg-accent/20 ring-1 ring-inset ring-accent/50'
            : isActive ? 'bg-accent-muted' : 'hover:bg-surface-raised'
        } ${nameColorClass || 'text-foreground'} ${isHidden ? 'opacity-60' : ''} ${
          isDragging || isCut ? 'opacity-30' : ''
        } ${isFocused ? 'outline outline-1 outline-accent/40' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {node.isDir ? (
          <>
            {node.isLoading ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <NodeIcon className="h-3.5 w-3.5 shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <NodeIcon className="h-3.5 w-3.5 shrink-0" />
          </>
        )}
        <span className={`truncate ${nameColorClass || ''} ${gitStatus === 'D' ? 'line-through opacity-70' : ''}`}>
          {node.name}
        </span>
        {/* Diagnostics badge for files */}
        {!node.isDir && fileDiagnostics && fileDiagnostics.errors > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-red-500/15 px-1 py-0 text-[9px] font-bold text-red-400">
            {formatBadge(fileDiagnostics.errors)}
          </span>
        )}
        {!node.isDir && fileDiagnostics && fileDiagnostics.errors === 0 && fileDiagnostics.warnings > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1 py-0 text-[9px] font-bold text-amber-300">
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
          <span className="ml-auto mr-1 shrink-0 h-[6px] w-[6px] rounded-full bg-red-400" />
        )}
        {node.isDir && dirDiagnostics && dirDiagnostics.errors === 0 && dirDiagnostics.warnings > 0 && (
          <span className="ml-auto mr-1 shrink-0 h-[6px] w-[6px] rounded-full bg-amber-400" />
        )}
        {/* Git dot for directories */}
        {node.isDir && dirGit && dirGit.count > 0 && (
          <span className={`ml-1 shrink-0 pr-1 h-[6px] w-[6px] rounded-full ${
            dirGit.dominantStatus === 'M' || dirGit.dominantStatus === 'U'
              ? 'bg-amber-400'
              : dirGit.dominantStatus === 'D' ? 'bg-red-400' : 'bg-green-400'
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

// ── Context Menu Item ────────────────────────────────────────────────────────

function ContextMenuItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
  danger,
}: {
  icon: typeof FilePlus;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
        danger ? 'text-error hover:bg-error/10' : 'text-foreground hover:bg-surface-raised'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="ml-4 text-[10px] text-muted-foreground">{shortcut}</span>
      )}
    </button>
  );
}

function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
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
  const menuRef = useRef<HTMLDivElement>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Build git status map
  const staged = useGitStore((s) => s.staged);
  const unstaged = useGitStore((s) => s.unstaged);
  const untracked = useGitStore((s) => s.untracked);
  const conflicts = useGitStore((s) => s.conflicts);
  const gitMap = useMemo(
    () => buildGitStatusMap(staged, unstaged, untracked, conflicts),
    [staged, unstaged, untracked, conflicts],
  );

  // Build diagnostics map
  const diagnosticsRaw = useDiagnosticsStore((s) => s.diagnostics);
  const diagnosticsMap = useMemo(() => {
    const map = new Map<string, FileDiagnostics>();
    if (!rootPath) return map;
    const rootNormalized = rootPath.replace(/\\/g, '/');
    const rootPrefix = rootNormalized.endsWith('/') ? rootNormalized : rootNormalized + '/';
    for (const [absPath, counts] of diagnosticsRaw) {
      const normalized = absPath.replace(/\\/g, '/');
      const relPath = normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
      map.set(relPath, counts);
    }
    return map;
  }, [diagnosticsRaw, rootPath]);

  // ── Keyboard Navigation ────────────────────────────────────────────────────
  const visibleNodes = useMemo(() => getVisibleNodes(tree), [tree]);

  const getTargetParent = (node: FileNode | null): string => {
    if (!node) return rootPath ?? '';
    return node.isDir ? node.path : getParentPath(node.path);
  };

  const withPending = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setPendingOps((prev) => new Set(prev).add(key));
    try {
      return await fn();
    } catch (err) {
      console.error(err);
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
    const sep = getSep(targetDir);
    for (const srcPath of cb.paths) {
      if (srcPath === targetDir || targetDir.startsWith(srcPath + sep)) continue;
      const fileName = srcPath.split(/[\\/]/).pop()!;
      const destPath = await getUniqueDestPath(targetDir, fileName, sep);
      try {
        if (cb.op === 'copy') {
          await withPending('paste-' + srcPath, () => tauriFs.copyPath(srcPath, destPath));
        } else {
          await withPending('paste-' + srcPath, () => tauriFs.renamePath(srcPath, destPath));
        }
      } catch (err) {
        console.error('Paste failed:', err);
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
        if (targetDir) handlePaste(targetDir).catch(console.error);
      }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }, [visibleNodes, focusedPath, renamingPath, creatingIn, expandDirectory, rootPath, handleCopyItem, handleCutItem, handlePaste, getTargetParent]);

  // ── Context menu interactions ─────────────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const onMouse = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const onScroll = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
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
      const sep = getSep(dragged);
      if (node.path === dragged || node.path.startsWith(dragged + sep)) return;
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
    const sep = getSep(targetDir);
    const targetNode = useFileStore.getState().findNode(targetDir);
    if (targetNode && !targetNode.isExpanded) {
      await expandDirectory(targetDir);
    }
    for (const file of files) {
      const srcPath = (file as any).path as string | undefined;
      if (!srcPath) continue;
      const destPath = await getUniqueDestPath(targetDir, file.name, sep);
      await withPending('import-' + file.name, () => tauriFs.copyPath(srcPath, destPath));
    }
  }, [expandDirectory]);

  const handleDrop = useCallback(async (e: React.DragEvent, targetNode: FileNode) => {
    setDragOverPath(null);
    const dragged = draggedPathRef.current;
    setDraggedPath(null);
    if (!targetNode.isDir) return;
    if (dragged) {
      if (dragged === targetNode.path) return;
      const sep = getSep(dragged);
      if (targetNode.path.startsWith(dragged + sep)) return;
      const fileName = dragged.split(/[\\/]/).pop()!;
      const newPath = targetNode.path + sep + fileName;
      if (newPath === dragged) return;
      try {
        await tauriFs.renamePath(dragged, newPath);
      } catch (err) {
        console.error('Failed to move:', err);
      }
    } else {
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      handleExternalFileDrop(files, targetNode.path).catch(console.error);
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
      await withPending('new-file', () => tauriFs.createFile(rootPath + getSep(rootPath) + name.trim(), ''));
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
      await withPending('new-folder', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('create_directory', { path: rootPath + getSep(rootPath) + name.trim() });
      });
      return;
    }

    const parentPath = getTargetParent(node);
    if (!parentPath) return;
    if (node.isDir && !node.isExpanded) {
      await expandDirectory(node.path);
    }
    setCreatingIn({ parentPath, isDir: true });
  };

  const handleRename = async () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);

    const newName = await promptInput({
      title: `Rename ${node.isDir ? 'Folder' : 'File'}`,
      placeholder: 'Enter new name',
      defaultValue: node.name,
      confirmLabel: 'Rename',
    });

    if (!newName || newName === node.name) return;

    const parentPath = getParentPath(node.path);
    const sep = getSep(node.path);
    const newPath = parentPath + sep + newName;
    await withPending('rename-' + node.path, () => tauriFs.renamePath(node.path, newPath));
  };

  const handleDeleteNode = async (targetNode?: FileNode) => {
    const target = targetNode ?? contextMenu?.node;
    if (!target) return;
    setContextMenu(null);

    const confirmed = await promptConfirm({
      title: `Delete "${target.name}"?`,
      description: target.isDir
        ? 'This will permanently delete the folder and all its contents.'
        : 'This will permanently delete this file.',
      confirmLabel: 'Delete',
      danger: true,
    });

    if (!confirmed) return;
    await withPending('delete-' + target.path, () => tauriFs.deletePath(target.path));
  };

  const handleDuplicate = async () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);

    const parentPath = getParentPath(node.path);
    const sep = getSep(node.path);

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

    const newPath = parentPath + sep + newName;
    await withPending('duplicate-' + node.path, () => tauriFs.copyPath(node.path, newPath));
  };

  const handleCopyPath = async () => {
    if (!contextMenu?.node) return;
    const node = contextMenu.node;
    setContextMenu(null);
    try {
      await writeClipboard(node.path);
    } catch (err) {
      console.error('Failed to copy path:', err);
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
      console.error('Failed to copy relative path:', err);
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
      console.error('Failed to reveal in file manager:', err);
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

  // ── Create / Rename submit ─────────────────────────────────────────────────

  const handleRenameSubmit = async (node: FileNode, newName: string) => {
    setRenamingPath(null);
    if (newName === node.name) return;
    const parentPath = getParentPath(node.path);
    const sep = getSep(node.path);
    const newPath = parentPath + sep + newName;
    await withPending('rename-' + node.path, () => tauriFs.renamePath(node.path, newPath));
  };

  const handleCreateSubmit = async (name: string) => {
    if (!creatingIn) return;
    const sep = getSep(creatingIn.parentPath);
    const newPath = creatingIn.parentPath + sep + name;
    await withPending('create-' + newPath, async () => {
      if (creatingIn.isDir) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('create_directory', { path: newPath });
      } else {
        await tauriFs.createFile(newPath, '');
      }
    });
    setCreatingIn(null);
  };

  if (tree.length === 0) {
    return null;
  }

  const sortedTree = sortNodes(tree);
  const hasNode = !!contextMenu?.node;

  // Clamp context menu to viewport
  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 220) : 0;
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 320) : 0;

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
        handleExternalFileDrop(files, rootPath).catch(console.error);
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

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-xl"
          style={{ left: menuX, top: menuY }}
        >
          <ContextMenuItem icon={FilePlus} label="New File..." onClick={handleNewFile} />
          <ContextMenuItem icon={FolderPlus} label="New Folder..." onClick={handleNewFolder} />

          <ContextMenuSeparator />
          {hasNode && (
            <ContextMenuItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => { handleCutItem(contextMenu!.node!); setContextMenu(null); }} />
          )}
          {hasNode && (
            <ContextMenuItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => { handleCopyItem(contextMenu!.node!); setContextMenu(null); }} />
          )}
          {clipboard && (
            <ContextMenuItem icon={ClipboardPaste} label="Paste" shortcut="Ctrl+V" onClick={() => {
              const t = contextMenu?.node ? getTargetParent(contextMenu.node) : (rootPath ?? '');
              setContextMenu(null);
              if (t) handlePaste(t).catch(console.error);
            }} />
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

              <ContextMenuSeparator />
              <ContextMenuItem icon={FolderSearch} label="Reveal in File Manager" onClick={handleRevealInFileManager} />

              {!contextMenu.node?.isDir && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem icon={History} label="View History" onClick={handleViewHistory} />
                  {['sql', 'prisma', 'db', 'sqlite', 'sqlite3'].includes(contextMenu.node?.name.split('.').pop()?.toLowerCase() ?? '') && (
                    <ContextMenuItem icon={Database} label="Open in Schema Canvas" onClick={handleOpenAsSchemaViewer} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

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
          <div className="flex items-center gap-1.5 rounded-md bg-surface-raised px-2 py-1 text-[10px] text-muted-foreground shadow">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working...
          </div>
        </div>
      )}
    </div>
  );
}
