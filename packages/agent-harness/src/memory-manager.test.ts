import { describe, expect, it, vi } from 'vitest';

import { MemoryManager } from './memory-manager';
import type { MemoryExtraction } from './types';

interface MemoryRowLike {
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

function row(overrides: Partial<MemoryRowLike> = {}): MemoryRowLike {
  return {
    id: 'mem_1',
    project_id: 'project-1',
    memory_type: 'fact',
    title: 'Stack',
    content: 'The project uses React.',
    summary: 'React project',
    tags: '["react","frontend"]',
    source_conversation_id: null,
    relevance_score: 0.7,
    access_count: 3,
    last_accessed_at: null,
    created_by: 'agent',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function managerWith(
  handler: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
): MemoryManager {
  return new MemoryManager(handler as InvokeFn);
}

describe('MemoryManager', () => {
  it('creates memories, generating an id and serializing fields', async () => {
    const invoke = vi.fn(async () => row());
    const manager = managerWith(invoke);

    const memory = await manager.create({
      projectId: 'project-1',
      type: 'fact',
      title: 'Stack',
      content: 'The project uses React.',
      summary: '',
      tags: ['react'],
      relevanceScore: 0.7,
      createdBy: 'agent',
      sourceConversationId: 'conv-1',
      sourceMessageIds: ['msg-1'],
    });

    expect(memory.id).toMatch(/^mem_/);
    expect(invoke).toHaveBeenCalledWith(
      'db_create_memory',
      expect.objectContaining({
        projectId: 'project-1',
        memoryType: 'fact',
        tags: '["react"]',
        sourceConversationId: 'conv-1',
        sourceMessageIds: '["msg-1"]',
      }),
    );
  });

  it('derives a summary from content when none is provided', async () => {
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_create_memory') {
        return row({ summary: String(args?.summary ?? '') });
      }
      return row();
    });
    const manager = managerWith(invoke);
    await manager.create({
      type: 'fact',
      title: 'T',
      content: 'Short content',
      summary: '',
      tags: [],
      relevanceScore: 0.7,
      createdBy: 'agent',
    });
    expect(invoke.mock.calls[0][1]).toMatchObject({ summary: 'Short content' });
  });

  it('lists memories with query mapping and row conversion', async () => {
    const invoke = vi.fn(async () => [row({ tags: '{broken json' }), row({ tags: '[]' })]);
    const manager = managerWith(invoke);

    const memories = await manager.list({ projectId: 'project-1', types: ['fact'] });
    expect(memories).toHaveLength(2);
    expect(memories[0]).toMatchObject({
      id: 'mem_1',
      projectId: 'project-1',
      type: 'fact',
      tags: [],
      relevanceScore: 0.7,
      accessCount: 3,
    });
    expect(invoke).toHaveBeenCalledWith(
      'db_list_memories',
      expect.objectContaining({ memoryType: 'fact', status: 'active', limit: 50, offset: 0 }),
    );
  });

  it('searches or falls back to list when the query is empty', async () => {
    const invoke = vi.fn(async () => [row()]);
    const manager = managerWith(invoke);
    await manager.search({ projectId: 'project-1' });
    expect(invoke).toHaveBeenCalledWith('db_list_memories', expect.anything());
  });

  it('updates, deletes and tracks access through the db', async () => {
    const invoke = vi.fn(async () => undefined);
    const manager = managerWith(invoke);

    await manager.update('mem_1', { title: 'New', tags: ['a'], status: 'archived' });
    expect(invoke).toHaveBeenCalledWith(
      'db_update_memory',
      expect.objectContaining({ id: 'mem_1', title: 'New', tags: '["a"]', status: 'archived' }),
    );
    await manager.delete('mem_1');
    expect(invoke).toHaveBeenCalledWith('db_delete_memory', { id: 'mem_1' });
    await manager.trackAccess('mem_1');
    expect(invoke).toHaveBeenCalledWith('db_track_memory_access', { id: 'mem_1' });
  });

  it('applies relevance decay with configurable parameters', async () => {
    const invoke = vi.fn(async () => 2);
    const manager = managerWith(invoke);
    await expect(
      manager.decayRelevance('project-1', { decayFactor: 0.9, inactiveDays: 3, archiveThreshold: 0.1 }),
    ).resolves.toBe(2);
    expect(invoke).toHaveBeenCalledWith('db_decay_memories', {
      projectId: 'project-1',
      decayFactor: 0.9,
      inactiveDays: 3,
      archiveThreshold: 0.1,
    });
  });

  it('uses FTS5 results when enough matches and tracks access', async () => {
    const invoke = vi.fn(async (cmd) => {
      if (cmd === 'db_search_memories') return [row(), row(), row()];
      return [row()];
    });
    const manager = managerWith(invoke);
    const memories = await manager.getRelevant('project-1', 'how do we deploy the react app', 2);
    expect(memories).toHaveLength(2);
    expect(invoke).toHaveBeenCalledWith('db_track_memory_access', { id: 'mem_1' });
  });

  it('falls back to relevance-ranked list when FTS5 returns too little', async () => {
    const invoke = vi.fn(async (cmd) => {
      if (cmd === 'db_search_memories') return [];
      return [row(), row()];
    });
    const manager = managerWith(invoke);
    const memories = await manager.getRelevant('project-1', 'nothing meaningful here', 2);
    expect(memories).toHaveLength(2);
    expect(invoke).toHaveBeenCalledWith('db_list_memories', expect.anything());
  });

  it('parses stats, tolerating broken by_type JSON', async () => {
    const invoke = vi.fn(async () => ({ total: 5, by_type: '{bad', archived: 1 }));
    const manager = managerWith(invoke);
    await expect(manager.getStats('project-1')).resolves.toEqual({
      total: 5,
      byType: {},
      archived: 1,
    });
  });

  it('persists extractions above the confidence threshold', async () => {
    const extractions: MemoryExtraction[] = [
      {
        type: 'fact',
        title: 'Facts',
        content: 'Project uses Rust',
        summary: '',
        tags: [],
        confidence: 0.8,
        sourceSignature: 's1',
      },
      {
        type: 'decision',
        title: 'Low confidence',
        content: 'Skip me',
        summary: '',
        tags: [],
        confidence: 0.3,
        sourceSignature: 's2',
      },
    ];
    const invoke = vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => row());
    const manager = managerWith(invoke);
    const saved = await manager.persistExtractions(extractions, 'project-1', 'conv-1');
    expect(saved).toHaveLength(1);
    expect(invoke.mock.calls[0][1]).toMatchObject({
      projectId: 'project-1',
      relevanceScore: 0.74,
      createdBy: 'agent',
      sourceConversationId: 'conv-1',
    });
  });

  it('persistExtractions skips failed saves gracefully', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('duplicate');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manager = managerWith(invoke);
    const saved = await manager.persistExtractions(
      [{ type: 'fact', title: 'T', content: 'C', summary: '', tags: [], confidence: 0.9, sourceSignature: 'x' }],
      'project-1',
      'conv-1',
    );
    expect(saved).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
