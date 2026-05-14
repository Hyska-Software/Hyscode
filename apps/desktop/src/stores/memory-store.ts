// ─── Memory Store ──────────────────────────────────────────────────────────
// Zustand store for the agent memory system.
// Data lives in SQLite (via Tauri commands); this store is a read-through cache.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Memory } from '@hyscode/agent-harness';
import { tauriInvokeRaw } from '@/lib/tauri-invoke';

// ─── Raw row type from Rust ──────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  project_id: string | null;
  memory_type: string;
  title: string;
  content: string;
  summary: string;
  tags: string;
  source_conversation_id: string | null;
  relevance_score: number;
  access_count: number;
  last_accessed_at: string | null;
  created_by: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToMemory(row: MemoryRow): Memory {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    type: row.memory_type as Memory['type'],
    title: row.title,
    content: row.content,
    summary: row.summary,
    tags,
    sourceConversationId: row.source_conversation_id ?? undefined,
    relevanceScore: row.relevance_score,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    createdBy: row.created_by as Memory['createdBy'],
    status: row.status as Memory['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── State ──────────────────────────────────────────────────────────────────

interface MemoryStats {
  total: number;
  byType: Record<string, number>;
  archived: number;
}

interface MemoryState {
  memories: Memory[];
  stats: MemoryStats | null;
  loading: boolean;
  searchQuery: string;
  /** Current project id; set when HarnessBridge initializes */
  projectId: string;

  // ─── Actions ────────────────────────────────────────────────────────

  setProjectId: (id: string) => void;
  setSearchQuery: (q: string) => void;

  /** Load all active memories for the current project */
  loadMemories: () => Promise<void>;

  /** Search memories with FTS5 */
  searchMemories: (query: string) => Promise<void>;

  /** Load memory stats */
  loadStats: () => Promise<void>;

  /** Archive (soft-delete) a memory by id */
  archiveMemory: (id: string) => Promise<void>;

  /** Hard-delete a memory (requires user intent) */
  deleteMemory: (id: string) => Promise<void>;

  /** Called from harness events — merge newly-extracted memories */
  reloadFromEvent: (memories: Memory[]) => void;

  /** Add or update a single memory (from memory_created event) */
  addOrUpdateMemory: (memory: Memory) => void;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useMemoryStore = create<MemoryState>()(
  immer((set, get) => ({
    memories: [],
    stats: null,
    loading: false,
    searchQuery: '',
    projectId: '',

    setProjectId: (id) =>
      set((state) => {
        state.projectId = id;
      }),

    setSearchQuery: (q) =>
      set((state) => {
        state.searchQuery = q;
      }),

    loadMemories: async () => {
      const { projectId, searchQuery } = get();
      if (!projectId) return;

      set((state) => { state.loading = true; });
      try {
        if (searchQuery.trim()) {
          const rows = await tauriInvokeRaw<MemoryRow[]>('db_search_memories', {
            projectId,
            query: searchQuery.trim(),
            memoryTypes: null,
            minRelevance: 0.0,
            limit: 50,
          });
          set((state) => {
            state.memories = rows.map(rowToMemory);
            state.loading = false;
          });
        } else {
          const rows = await tauriInvokeRaw<MemoryRow[]>('db_list_memories', {
            projectId,
            memoryType: null,
            status: 'active',
            limit: 100,
            offset: 0,
          });
          set((state) => {
            state.memories = rows.map(rowToMemory);
            state.loading = false;
          });
        }
      } catch (err) {
        console.warn('[MemoryStore] loadMemories failed:', err);
        set((state) => { state.loading = false; });
      }
    },

    searchMemories: async (query) => {
      const { projectId } = get();
      if (!projectId) return;

      set((state) => {
        state.searchQuery = query;
        state.loading = true;
      });

      try {
        if (query.trim()) {
          const rows = await tauriInvokeRaw<MemoryRow[]>('db_search_memories', {
            projectId,
            query: query.trim(),
            memoryTypes: null,
            minRelevance: 0.0,
            limit: 50,
          });
          set((state) => {
            state.memories = rows.map(rowToMemory);
            state.loading = false;
          });
        } else {
          await get().loadMemories();
        }
      } catch (err) {
        console.warn('[MemoryStore] searchMemories failed:', err);
        set((state) => { state.loading = false; });
      }
    },

    loadStats: async () => {
      const { projectId } = get();
      if (!projectId) return;

      try {
        const raw = await tauriInvokeRaw<{ total: number; by_type: string; archived: number }>(
          'db_get_memory_stats',
          { projectId },
        );
        let byType: Record<string, number> = {};
        try { byType = JSON.parse(raw.by_type); } catch { byType = {}; }
        set((state) => {
          state.stats = { total: raw.total, byType, archived: raw.archived };
        });
      } catch (err) {
        console.warn('[MemoryStore] loadStats failed:', err);
      }
    },

    archiveMemory: async (id) => {
      try {
        await tauriInvokeRaw('db_update_memory', {
          id,
          title: null,
          content: null,
          summary: null,
          tags: null,
          relevanceScore: null,
          status: 'archived',
        });
        set((state) => {
          state.memories = state.memories.filter((m) => m.id !== id);
        });
        await get().loadStats();
      } catch (err) {
        console.warn('[MemoryStore] archiveMemory failed:', err);
      }
    },

    deleteMemory: async (id) => {
      try {
        await tauriInvokeRaw('db_delete_memory', { id });
        set((state) => {
          state.memories = state.memories.filter((m) => m.id !== id);
        });
        await get().loadStats();
      } catch (err) {
        console.warn('[MemoryStore] deleteMemory failed:', err);
      }
    },

    reloadFromEvent: (memories) => {
      set((state) => {
        for (const m of memories) {
          const idx = state.memories.findIndex((existing) => existing.id === m.id);
          if (idx >= 0) {
            state.memories[idx] = m;
          } else {
            state.memories.unshift(m);
          }
        }
      });
    },

    addOrUpdateMemory: (memory) => {
      set((state) => {
        const idx = state.memories.findIndex((m) => m.id === memory.id);
        if (idx >= 0) {
          state.memories[idx] = memory;
        } else {
          state.memories.unshift(memory);
        }
      });
    },
  })),
);
