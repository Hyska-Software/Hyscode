// ─── Memory Manager ──────────────────────────────────────────────────────────
// Persistent cross-session knowledge for the agent.
// Bridges TypeScript ↔ Tauri SQLite commands for the memory system.

import type { Memory, MemoryType, MemoryQuery, MemoryExtraction } from './types';

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

interface MemoryStats {
  total: number;
  by_type: string;
  archived: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    type: row.memory_type as MemoryType,
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

function generateId(): string {
  return 'mem_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
}

// ─── MemoryManager ───────────────────────────────────────────────────────────

export class MemoryManager {
  private invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

  constructor(invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) {
    this.invoke = invoke;
  }

  // ─── CRUD ────────────────────────────────────────────────────────────

  async create(
    fields: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'status'> & {
      sourceConversationId?: string;
      sourceMessageIds?: string[];
    }
  ): Promise<Memory> {
    const id = generateId();
    const row = await this.invoke<MemoryRow>('db_create_memory', {
      id,
      projectId: fields.projectId ?? null,
      memoryType: fields.type,
      title: fields.title,
      content: fields.content,
      summary: fields.summary || truncateSummary(fields.content),
      tags: JSON.stringify(fields.tags ?? []),
      sourceConversationId: fields.sourceConversationId ?? null,
      sourceMessageIds: fields.sourceMessageIds ? JSON.stringify(fields.sourceMessageIds) : null,
      relevanceScore: fields.relevanceScore ?? 0.7,
      createdBy: fields.createdBy ?? 'agent',
    });
    return rowToMemory(row);
  }

  async list(query: MemoryQuery): Promise<Memory[]> {
    const rows = await this.invoke<MemoryRow[]>('db_list_memories', {
      projectId: query.projectId ?? null,
      memoryType: query.types && query.types.length === 1 ? query.types[0] : null,
      status: query.status ?? 'active',
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
    return rows.map(rowToMemory);
  }

  async search(query: MemoryQuery): Promise<Memory[]> {
    if (!query.query?.trim()) {
      return this.list(query);
    }
    const rows = await this.invoke<MemoryRow[]>('db_search_memories', {
      projectId: query.projectId ?? null,
      query: query.query,
      memoryTypes: query.types ? JSON.stringify(query.types) : null,
      minRelevance: query.minRelevance ?? 0.0,
      limit: query.limit ?? 20,
    });
    return rows.map(rowToMemory);
  }

  async update(id: string, fields: Partial<Pick<Memory, 'title' | 'content' | 'summary' | 'tags' | 'relevanceScore' | 'status'>>): Promise<void> {
    await this.invoke('db_update_memory', {
      id,
      title: fields.title ?? null,
      content: fields.content ?? null,
      summary: fields.summary ?? null,
      tags: fields.tags ? JSON.stringify(fields.tags) : null,
      relevanceScore: fields.relevanceScore ?? null,
      status: fields.status ?? null,
    });
  }

  async delete(id: string): Promise<void> {
    await this.invoke('db_delete_memory', { id });
  }

  async trackAccess(id: string): Promise<void> {
    await this.invoke('db_track_memory_access', { id });
  }

  // ─── Relevance Decay ─────────────────────────────────────────────────

  /**
   * Apply relevance decay to memories not accessed recently.
   * Typically called once per session on startup.
   * Returns count of archived memories.
   */
  async decayRelevance(
    projectId?: string,
    options: {
      decayFactor?: number;       // default 0.95
      inactiveDays?: number;      // default 7
      archiveThreshold?: number;  // default 0.08
    } = {}
  ): Promise<number> {
    const archived = await this.invoke<number>('db_decay_memories', {
      projectId: projectId ?? null,
      decayFactor: options.decayFactor ?? 0.95,
      inactiveDays: options.inactiveDays ?? 7,
      archiveThreshold: options.archiveThreshold ?? 0.08,
    });
    return archived;
  }

  // ─── Context Retrieval ───────────────────────────────────────────────

  /**
   * Get the most relevant memories for a given context string.
   * Uses FTS5 text matching or falls back to relevance ranking.
   */
  async getRelevant(
    projectId: string,
    context: string,
    limit = 8,
    minRelevance = 0.2,
  ): Promise<Memory[]> {
    // First try FTS5 search with context terms
    const keywords = extractKeywords(context);
    if (keywords.length > 0) {
      try {
        const ftsMems = await this.search({
          projectId,
          query: keywords.join(' OR '),
          minRelevance,
          limit: limit + 3, // fetch extra, filter below
        });
        if (ftsMems.length >= 3) {
          // Track access for returned memories
          for (const m of ftsMems.slice(0, limit)) {
            this.trackAccess(m.id).catch(() => {});
          }
          return ftsMems.slice(0, limit);
        }
      } catch {
        // FTS5 query might fail on bad syntax, fall through
      }
    }

    // Fallback: top by relevance_score
    const allMems = await this.list({
      projectId,
      minRelevance,
      limit,
      status: 'active',
    });
    for (const m of allMems) {
      this.trackAccess(m.id).catch(() => {});
    }
    return allMems;
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  async getStats(projectId?: string): Promise<{ total: number; byType: Record<string, number>; archived: number }> {
    const stats = await this.invoke<MemoryStats>('db_get_memory_stats', {
      projectId: projectId ?? null,
    });
    let byType: Record<string, number> = {};
    try {
      byType = JSON.parse(stats.by_type);
    } catch {
      byType = {};
    }
    return { total: stats.total, byType, archived: stats.archived };
  }

  // ─── Batch from Extractions ──────────────────────────────────────────

  /**
   * Persist a batch of extracted memories, skipping low-confidence ones.
   * Minimum confidence: 0.6 for auto-extraction.
   */
  async persistExtractions(
    extractions: MemoryExtraction[],
    projectId: string,
    conversationId: string,
    minConfidence = 0.6,
  ): Promise<Memory[]> {
    const saved: Memory[] = [];
    for (const extraction of extractions) {
      if (extraction.confidence < minConfidence) continue;

      try {
        const memory = await this.create({
          projectId,
          type: extraction.type,
          title: extraction.title,
          content: extraction.content,
          summary: extraction.summary || truncateSummary(extraction.content),
          tags: extraction.tags,
          relevanceScore: 0.5 + extraction.confidence * 0.3, // 0.5–0.8 based on confidence
          createdBy: 'agent',
          sourceConversationId: conversationId,
        });
        saved.push(memory);
      } catch (err) {
        // Silently skip duplicate or failed saves
        console.warn('[MemoryManager] Failed to save extraction:', extraction.title, err);
      }
    }
    return saved;
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Truncate content to produce a short summary. */
function truncateSummary(content: string, maxLen = 280): string {
  if (!content) return '';
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 3) + '...';
}

/** Extract meaningful keywords from context for FTS5 query. */
function extractKeywords(text: string): string[] {
  // Remove common stop words, extract meaningful tokens
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'that', 'this', 'is', 'was', 'are', 'be',
    'can', 'i', 'you', 'we', 'it', 'do', 'my', 'me', 'how', 'what', 'use',
    'using', 'want', 'need', 'please', 'help', 'make', 'create', 'add',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  // Deduplicate, keep top 6 by length (longer = more specific)
  const unique = [...new Set(words)];
  return unique
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
}
