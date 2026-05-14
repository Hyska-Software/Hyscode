// ─── Memories View ────────────────────────────────────────────────────────────
// Sidebar panel that displays and manages agent-extracted memories.

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  X,
  BrainCircuit,
  Trash2,
  Archive,
  RefreshCw,
  Tag,
  ChevronDown,
  ChevronRight,
  Bot,
  User,
  Cpu,
  ExternalLink,
} from 'lucide-react';
import { useMemoryStore } from '@/stores/memory-store';
import { useEditorStore } from '@/stores/editor-store';
import type { Memory } from '@hyscode/agent-harness';

// ─── Type badge ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  error_solution: 'Fix',
  convention:     'Convention',
  decision:       'Decision',
  workflow:       'Workflow',
  fact:           'Fact',
  preference:     'Preference',
};

const TYPE_COLORS: Record<string, string> = {
  error_solution: 'bg-red-500/15 text-red-400',
  convention:     'bg-blue-500/15 text-blue-400',
  decision:       'bg-purple-500/15 text-purple-400',
  workflow:       'bg-green-500/15 text-green-400',
  fact:           'bg-yellow-500/15 text-yellow-400',
  preference:     'bg-orange-500/15 text-orange-400',
};

const CREATOR_ICONS: Record<string, typeof Bot> = {
  agent:  Bot,
  user:   User,
  system: Cpu,
};

// ─── Memory Card ─────────────────────────────────────────────────────────────

interface MemoryCardProps {
  memory: Memory;
  expanded: boolean;
  onToggle: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenTab: (id: string, title: string) => void;
}

function MemoryCard({ memory, expanded, onToggle, onArchive, onDelete, onOpenTab }: MemoryCardProps) {
  const typeLabel  = TYPE_LABELS[memory.type] ?? memory.type;
  const typeColor  = TYPE_COLORS[memory.type] ?? 'bg-[var(--badge-bg)] text-[var(--text-muted)]';
  const CreatorIcon = CREATOR_ICONS[memory.createdBy] ?? Bot;
  const relevancePct = Math.round(memory.relevanceScore * 100);

  return (
    <div className="group border border-[var(--border)] rounded-md bg-[var(--sidebar-bg)] hover:bg-[var(--list-hover-bg)] transition-colors">
      {/* Header */}
      <div
        className="flex items-start gap-2 px-3 py-2 cursor-pointer"
        onClick={onToggle}
      >
        <button className="mt-0.5 text-[var(--text-muted)] shrink-0">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />
          }
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${typeColor}`}>
              {typeLabel}
            </span>
            <span className="text-xs text-[var(--text-primary)] font-medium truncate">
              {memory.title}
            </span>
          </div>
          {!expanded && (
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-1">
              {memory.summary}
            </p>
          )}
        </div>

        {/* Actions — visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onOpenTab(memory.id, memory.title); }}
            className="h-5 w-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--list-active-bg)] transition-colors"
            title="Open in editor tab"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(memory.id); }}
            className="h-5 w-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--list-active-bg)] transition-colors"
            title="Archive memory"
          >
            <Archive className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(memory.id); }}
            className="h-5 w-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete memory"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{memory.content}</p>

          {memory.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
              {memory.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded px-1.5 py-px text-[10px] bg-[var(--badge-bg,theme(colors.zinc.800))] text-[var(--text-muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <CreatorIcon className="h-3 w-3" />
              {memory.createdBy}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              relevance {relevancePct}%
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              accessed {memory.accessCount}×
            </span>
          </div>

          {/* Open in tab link */}
          <button
            onClick={() => onOpenTab(memory.id, memory.title)}
            className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Open in editor tab
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Memories View ────────────────────────────────────────────────────────────

export function MemoriesView() {
  const memories      = useMemoryStore((s) => s.memories);
  const stats         = useMemoryStore((s) => s.stats);
  const loading       = useMemoryStore((s) => s.loading);
  const searchQuery   = useMemoryStore((s) => s.searchQuery);
  const loadMemories  = useMemoryStore((s) => s.loadMemories);
  const searchMemories = useMemoryStore((s) => s.searchMemories);
  const loadStats     = useMemoryStore((s) => s.loadStats);
  const archiveMemory = useMemoryStore((s) => s.archiveMemory);
  const deleteMemory  = useMemoryStore((s) => s.deleteMemory);

  const openMemoryTab = useEditorStore((s) => s.openMemoryTab);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [localQuery, setLocalQuery]   = useState(searchQuery);

  // Load on mount
  useEffect(() => {
    loadMemories();
    loadStats();
  }, [loadMemories, loadStats]);

  const handleSearch = useCallback(
    (q: string) => {
      setLocalQuery(q);
      searchMemories(q);
    },
    [searchMemories],
  );

  const handleRefresh = useCallback(() => {
    loadMemories();
    loadStats();
  }, [loadMemories, loadStats]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleArchive = useCallback(async (id: string) => {
    await archiveMemory(id);
  }, [archiveMemory]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteMemory(id);
  }, [deleteMemory]);

  const handleOpenTab = useCallback((id: string, title: string) => {
    openMemoryTab(id, title);
  }, [openMemoryTab]);

  return (
    <div className="flex h-full flex-col bg-[var(--sidebar-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5">
          <BrainCircuit className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Memories
          </span>
          {stats && (
            <span className="text-[10px] text-[var(--text-muted)]">
              ({stats.total})
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--list-hover-bg)] transition-colors disabled:opacity-40"
          title="Refresh memories"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={localQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search memories…"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] pl-7 pr-7 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
          />
          {localQuery && (
            <button
              onClick={() => handleSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {stats && stats.total > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] flex-wrap">
          {Object.entries(stats.byType).map(([type, count]) =>
            count > 0 ? (
              <span
                key={type}
                className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium ${TYPE_COLORS[type] ?? 'bg-[var(--badge-bg)] text-[var(--text-muted)]'}`}
              >
                {TYPE_LABELS[type] ?? type}: {count}
              </span>
            ) : null
          )}
        </div>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {loading && memories.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">Loading…</span>
          </div>
        )}

        {!loading && memories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <BrainCircuit className="h-8 w-8 text-[var(--text-muted)] opacity-30" />
            <p className="text-xs text-[var(--text-muted)]">
              {localQuery ? 'No memories match your search.' : 'No memories yet.'}
            </p>
            {!localQuery && (
              <p className="text-[11px] text-[var(--text-muted)] opacity-70 max-w-[200px] leading-relaxed">
                The agent automatically extracts and stores knowledge from your conversations.
              </p>
            )}
          </div>
        )}

        {memories.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            expanded={expandedIds.has(memory.id)}
            onToggle={() => toggleExpand(memory.id)}
            onArchive={handleArchive}
            onDelete={handleDelete}
            onOpenTab={handleOpenTab}
          />
        ))}
      </div>
    </div>
  );
}
