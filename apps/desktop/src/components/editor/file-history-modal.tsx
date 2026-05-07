import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, FolderOpen, Trash2, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../../stores/editor-store';

interface FileHistoryEntry {
  id: string;
  file_path: string;
  created_at: string;
}

interface FileHistorySnapshot {
  id: string;
  file_path: string;
  content: string;
  created_at: string;
}

interface FileHistoryModalProps {
  filePath: string;
  onClose: () => void;
}

function formatRelativeTime(isoString: string): string {
  // SQLite datetime() returns UTC without 'Z', append it for correct parsing
  const date = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return date.toLocaleDateString();
}

function formatAbsoluteTime(isoString: string): string {
  const date = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
  return date.toLocaleString();
}

export function FileHistoryModal({ filePath, onClose }: FileHistoryModalProps) {
  const [entries, setEntries] = useState<FileHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const openHistoryTab = useEditorStore((s) => s.openHistoryTab);

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await invoke<FileHistoryEntry[]>('file_history_list', { filePath });
      setEntries(rows);
    } catch (err) {
      console.error('[FileHistoryModal] Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleOpen = useCallback(async (entry: FileHistoryEntry) => {
    setOpeningId(entry.id);
    try {
      const snapshot = await invoke<FileHistorySnapshot>('file_history_get', { id: entry.id });
      openHistoryTab(snapshot.id, snapshot.file_path, snapshot.created_at, snapshot.content);
      onClose();
    } catch (err) {
      console.error('[FileHistoryModal] Failed to load snapshot:', err);
    } finally {
      setOpeningId(null);
    }
  }, [openHistoryTab, onClose]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      await invoke('file_history_clear', { filePath });
      setEntries([]);
    } catch (err) {
      console.error('[FileHistoryModal] Failed to clear history:', err);
    } finally {
      setClearing(false);
    }
  }, [filePath]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex h-[520px] w-[520px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Clock className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">File History</p>
            <p className="truncate text-[11px] text-muted-foreground">{fileName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Clock className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No history yet.</p>
              <p className="text-[11px] text-muted-foreground/60">
                Snapshots are recorded each time the file is saved.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-raised"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[12px] font-medium text-foreground"
                      title={formatAbsoluteTime(entry.created_at)}
                    >
                      {formatRelativeTime(entry.created_at)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatAbsoluteTime(entry.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleOpen(entry)}
                    disabled={openingId === entry.id}
                    className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                    aria-label={`Open snapshot from ${formatAbsoluteTime(entry.created_at)}`}
                  >
                    {openingId === entry.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FolderOpen className="h-3 w-3" />
                    )}
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {entries.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <p className="text-[11px] text-muted-foreground">
              {entries.length} snapshot{entries.length !== 1 ? 's' : ''} · max 50
            </p>
            <button
              onClick={handleClear}
              disabled={clearing}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              aria-label="Clear all history"
            >
              {clearing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Clear history
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
