import { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Minus,
  Pencil,
  FileText,
  AlertTriangle,
  RotateCcw,
  GitCompare,
  Trash2,
} from 'lucide-react';
import type { GitFile } from '../../stores/git-store';

const STATUS_LABELS: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Conflicted',
  '?': 'Untracked',
};

const STATUS_COLORS: Record<string, string> = {
  M: 'text-yellow-400',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-blue-400',
  C: 'text-blue-400',
  T: 'text-purple-400',
  U: 'text-orange-400',
  '?': 'text-zinc-400',
};

const STATUS_ICONS: Record<string, typeof Pencil> = {
  M: Pencil,
  A: Plus,
  D: Minus,
  R: FileText,
  C: FileText,
  T: FileText,
  U: AlertTriangle,
  '?': Plus,
};

interface GitFileItemProps {
  file: GitFile;
  mode: 'staged' | 'unstaged' | 'untracked' | 'conflict';
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
  onOpenDiff?: () => void;
  onOpenFile?: () => void;
}

export function GitFileItem({
  file,
  mode,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
  onOpenFile,
}: GitFileItemProps) {
  const [showContext, setShowContext] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const contextRef = useRef<HTMLDivElement>(null);

  const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
  const dirPath = file.path.includes('/')
    ? file.path.substring(0, file.path.lastIndexOf('/'))
    : '';

  const Icon = STATUS_ICONS[file.status] ?? FileText;
  const statusColor = STATUS_COLORS[file.status] ?? 'text-muted-foreground';

  useEffect(() => {
    if (!showContext) return;
    const handler = (e: MouseEvent) => {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setShowContext(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showContext]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextPos({ x: e.clientX, y: e.clientY });
    setShowContext(true);
  };

  return (
    <>
      <div
        className="group relative flex items-center gap-1.5 px-2 py-[3px] text-[12px] hover:bg-surface-raised transition-colors cursor-pointer"
        onClick={onOpenDiff ?? onOpenFile}
        onContextMenu={handleContextMenu}
        title={`${STATUS_LABELS[file.status] ?? file.status}: ${file.path}`}
      >
        <Icon className={`h-3 w-3 shrink-0 ${statusColor}`} />
        <span className="truncate text-foreground">{fileName}</span>
        {dirPath && (
          <span className="truncate text-[10px] text-muted-foreground opacity-60">
            {dirPath}
          </span>
        )}
        <span className={`ml-auto shrink-0 text-[10px] font-mono ${statusColor}`}>
          {file.status === '?' ? 'U' : file.status}
        </span>

        {/* Hover action buttons — float over content, no layout reserve */}
        <div className="pointer-events-none absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-surface-raised/95 px-1 py-0.5 shadow-sm group-hover:pointer-events-auto group-hover:flex">
          {mode === 'staged' && onUnstage && (
            <ActionButton
              icon={Minus}
              title="Unstage"
              onClick={(e) => { e.stopPropagation(); onUnstage(); }}
            />
          )}
          {mode === 'staged' && onOpenDiff && (
            <ActionButton
              icon={GitCompare}
              title="Open Diff"
              onClick={(e) => { e.stopPropagation(); onOpenDiff(); }}
            />
          )}
          {(mode === 'unstaged' || mode === 'untracked') && onStage && (
            <ActionButton
              icon={Plus}
              title="Stage"
              onClick={(e) => { e.stopPropagation(); onStage(); }}
            />
          )}
          {mode === 'unstaged' && onDiscard && (
            <ActionButton
              icon={RotateCcw}
              title="Discard Changes"
              onClick={(e) => { e.stopPropagation(); onDiscard(); }}
            />
          )}
          {mode === 'untracked' && onDiscard && (
            <ActionButton
              icon={Trash2}
              title="Delete"
              onClick={(e) => { e.stopPropagation(); onDiscard(); }}
            />
          )}
        </div>
      </div>

      {/* Context Menu */}
      {showContext && (
        <div
          ref={contextRef}
          className="fixed z-50 min-w-[160px] rounded-lg bg-muted p-1"
          style={{ left: contextPos.x, top: contextPos.y }}
        >
          {mode !== 'staged' && onStage && (
            <CtxItem label="Stage" onClick={() => { setShowContext(false); onStage(); }} />
          )}
          {mode === 'staged' && onUnstage && (
            <CtxItem label="Unstage" onClick={() => { setShowContext(false); onUnstage(); }} />
          )}
          {onOpenDiff && (
            <CtxItem label="Open Diff" onClick={() => { setShowContext(false); onOpenDiff(); }} />
          )}
          {onOpenFile && (
            <CtxItem label="Open File" onClick={() => { setShowContext(false); onOpenFile(); }} />
          )}
          {mode === 'unstaged' && onDiscard && (
            <>
              <div className="my-1 h-px bg-surface-raised" />
              <CtxItem label="Discard Changes" danger onClick={() => { setShowContext(false); onDiscard(); }} />
            </>
          )}
        </div>
      )}
    </>
  );
}

function ActionButton({
  icon: Icon,
  title,
  onClick,
}: {
  icon: typeof Plus;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title={title}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

function CtxItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-foreground hover:bg-surface-raised'
      }`}
    >
      {label}
    </button>
  );
}
