// ─── Memory Viewer ────────────────────────────────────────────────────────────
// Full-page editor-area tab for viewing and editing a single agent memory.

import { useState, useEffect, useCallback } from 'react';
import {
  BrainCircuit,
  Tag,
  Bot,
  User,
  Cpu,
  Archive,
  Trash2,
  Save,
  X,
  Plus,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useMemoryStore } from '@/stores/memory-store';
import { tauriInvokeRaw } from '@/lib/tauri-invoke';
import { promptConfirm } from '@/components/ui/dialogs';
import { useEditorStore } from '@/stores/editor-store';
import type { Memory } from '@hyscode/agent-harness';

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  'error_solution',
  'convention',
  'decision',
  'workflow',
  'fact',
  'preference',
] as const;

const TYPE_LABELS: Record<string, string> = {
  error_solution: 'Fix',
  convention:     'Convention',
  decision:       'Decision',
  workflow:       'Workflow',
  fact:           'Fact',
  preference:     'Preference',
};

const TYPE_COLORS: Record<string, string> = {
  error_solution: 'bg-red-500/15 text-red-400 border-red-500/20',
  convention:     'bg-blue-500/15 text-blue-400 border-blue-500/20',
  decision:       'bg-purple-500/15 text-purple-400 border-purple-500/20',
  workflow:       'bg-green-500/15 text-green-400 border-green-500/20',
  fact:           'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  preference:     'bg-orange-500/15 text-orange-400 border-orange-500/20',
};

const CREATOR_ICONS: Record<string, typeof Bot> = {
  agent: Bot,
  user:  User,
  system: Cpu,
};

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1 block">
      {label}
    </span>
  );
}

// ─── Memory Viewer ────────────────────────────────────────────────────────────

interface MemoryViewerProps {
  memoryId: string;
}

export function MemoryViewer({ memoryId }: MemoryViewerProps) {
  const memories      = useMemoryStore((s) => s.memories);
  const loadMemories  = useMemoryStore((s) => s.loadMemories);
  const archiveMemory = useMemoryStore((s) => s.archiveMemory);
  const deleteMemory  = useMemoryStore((s) => s.deleteMemory);
  const closeTab      = useEditorStore((s) => s.closeTab);

  const [memory, setMemory]     = useState<Memory | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [dirty, setDirty]       = useState(false);

  // Editable fields
  const [title,    setTitle]    = useState('');
  const [content,  setContent]  = useState('');
  const [summary,  setSummary]  = useState('');
  const [type,     setType]     = useState('fact');
  const [tags,     setTags]     = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Load memory from store (or fetch from DB if not in store)
  useEffect(() => {
    const found = memories.find((m) => m.id === memoryId);
    if (found) {
      setMemory(found);
      setTitle(found.title);
      setContent(found.content);
      setSummary(found.summary);
      setType(found.type);
      setTags([...found.tags]);
      setDirty(false);
    } else {
      // Try loading from DB
      loadMemories().then(() => {
        const after = useMemoryStore.getState().memories.find((m) => m.id === memoryId);
        if (after) {
          setMemory(after);
          setTitle(after.title);
          setContent(after.content);
          setSummary(after.summary);
          setType(after.type);
          setTags([...after.tags]);
        } else {
          setNotFound(true);
        }
      });
    }
  }, [memoryId]); // intentionally omit memories/loadMemories to avoid re-resetting form

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!memory) return;
    setSaving(true);
    try {
      await tauriInvokeRaw('db_update_memory', {
        id:             memory.id,
        title:          title.trim() || null,
        content:        content.trim() || null,
        summary:        summary.trim() || null,
        tags:           JSON.stringify(tags),
        relevanceScore: null,
        status:         null,
      });
      // Update local state
      setMemory((prev) => prev ? { ...prev, title, content, summary, type: type as Memory['type'], tags } : prev);
      useMemoryStore.getState().addOrUpdateMemory({
        ...memory,
        title,
        content,
        summary,
        type: type as Memory['type'],
        tags,
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[MemoryViewer] save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [memory, title, content, summary, type, tags]);

  const handleArchive = useCallback(async () => {
    if (!memory) return;
    const ok = await promptConfirm({
      title: 'Archive memory?',
      description: 'This memory will be archived and excluded from context injection.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    await archiveMemory(memory.id);
    closeTab(`memory:${memory.id}`);
  }, [memory, archiveMemory, closeTab]);

  const handleDelete = useCallback(async () => {
    if (!memory) return;
    const ok = await promptConfirm({
      title: 'Delete memory?',
      description: 'This will permanently remove the memory. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteMemory(memory.id);
    closeTab(`memory:${memory.id}`);
  }, [memory, deleteMemory, closeTab]);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag || tags.includes(tag)) { setTagInput(''); return; }
    setTags((prev) => [...prev, tag]);
    setTagInput('');
    markDirty();
  }, [tagInput, tags, markDirty]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
    markDirty();
  }, [markDirty]);

  // ── Render: not found ────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
        <AlertTriangle className="h-8 w-8 opacity-40" />
        <p className="text-sm">Memory not found.</p>
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-muted)]">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  const CreatorIcon = CREATOR_ICONS[memory.createdBy] ?? Bot;
  const typeColor   = TYPE_COLORS[type] ?? 'bg-muted/40 text-muted-foreground border-muted/30';
  const relevancePct = Math.round(memory.relevanceScore * 100);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--editor-bg)]">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-2.5 shrink-0">
        <BrainCircuit className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          Memory
        </span>

        <span
          className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold ${typeColor}`}
        >
          {TYPE_LABELS[type] ?? type}
        </span>

        <div className="flex-1" />

        {/* Metadata chips */}
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

        <div className="w-px h-3 bg-[var(--border)]" />

        {/* Actions */}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium bg-[var(--button-bg)] text-[var(--button-fg)] hover:bg-[var(--button-hover-bg)] disabled:opacity-40 transition-colors"
        >
          {saving
            ? <RefreshCw className="h-3 w-3 animate-spin" />
            : saved
              ? <Save className="h-3 w-3 text-green-400" />
              : <Save className="h-3 w-3" />
          }
          {saved ? 'Saved' : 'Save'}
        </button>

        <button
          onClick={handleArchive}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--list-hover-bg)] transition-colors"
          title="Archive memory"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={handleDelete}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Delete memory"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: title + content */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 py-6">

          {/* Title */}
          <div>
            <SectionLabel label="Title" />
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); markDirty(); }}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              placeholder="Memory title…"
            />
          </div>

          {/* Summary */}
          <div>
            <SectionLabel label="Summary (≤200 chars — used in context injection)" />
            <textarea
              value={summary}
              onChange={(e) => { setSummary(e.target.value); markDirty(); }}
              rows={2}
              maxLength={250}
              className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              placeholder="Short summary used when injecting into agent context…"
            />
            <span className="text-[10px] text-[var(--text-muted)]">{summary.length}/200</span>
          </div>

          {/* Full content */}
          <div className="flex-1 flex flex-col">
            <SectionLabel label="Full Content" />
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); markDirty(); }}
              className="flex-1 min-h-[200px] resize-none rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              placeholder="Full memory content…"
            />
          </div>
        </div>

        {/* Right sidebar: meta */}
        <div className="w-56 shrink-0 border-l border-[var(--border)] flex flex-col gap-5 overflow-y-auto px-4 py-6">

          {/* Type */}
          <div>
            <SectionLabel label="Type" />
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); markDirty(); }}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <SectionLabel label="Tags" />
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-[var(--badge-bg,theme(colors.zinc.800))] text-[var(--text-muted)]"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                placeholder="Add tag…"
                className="flex-1 min-w-0 rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-[10px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              />
              <button
                onClick={handleAddTag}
                className="rounded border border-[var(--border)] px-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--list-hover-bg)] transition-colors"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Stats */}
          <div>
            <SectionLabel label="Stats" />
            <dl className="space-y-1.5 text-[11px] text-[var(--text-muted)]">
              <div className="flex justify-between">
                <dt>Relevance</dt>
                <dd>{relevancePct}%</dd>
              </div>
              <div className="flex justify-between">
                <dt>Accessed</dt>
                <dd>{memory.accessCount}×</dd>
              </div>
              <div className="flex justify-between">
                <dt>Created by</dt>
                <dd className="flex items-center gap-0.5">
                  <CreatorIcon className="h-3 w-3" />
                  {memory.createdBy}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Status</dt>
                <dd>{memory.status}</dd>
              </div>
            </dl>
          </div>

          {/* Timestamps */}
          <div>
            <SectionLabel label="Timestamps" />
            <dl className="space-y-1.5 text-[10px] text-[var(--text-muted)]">
              <div>
                <dt className="text-[9px] uppercase tracking-widest mb-0.5">Created</dt>
                <dd>{new Date(memory.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-[9px] uppercase tracking-widest mb-0.5">Updated</dt>
                <dd>{new Date(memory.updatedAt).toLocaleString()}</dd>
              </div>
              {memory.lastAccessedAt && (
                <div>
                  <dt className="text-[9px] uppercase tracking-widest mb-0.5">Last accessed</dt>
                  <dd>{new Date(memory.lastAccessedAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Source conversation */}
          {memory.sourceConversationId && (
            <div>
              <SectionLabel label="Source Conversation" />
              <p className="text-[10px] text-[var(--text-muted)] font-mono break-all">
                {memory.sourceConversationId}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
