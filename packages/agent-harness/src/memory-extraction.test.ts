import { describe, expect, it, vi } from 'vitest';

import { MemoryContextProvider } from './memory-context-provider';
import { MemoryExtractor } from './memory-extractor';
import { MemoryManager } from './memory-manager';
import type { Memory } from './types';

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem_1',
    projectId: 'project-1',
    type: 'fact',
    title: 'Stack',
    content: 'The project uses React and TypeScript.',
    summary: 'React and TypeScript',
    tags: ['react'],
    relevanceScore: 0.8,
    accessCount: 0,
    createdBy: 'agent',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('MemoryContextProvider', () => {
  it('returns null when no memories match', async () => {
    const manager = {
      getRelevant: vi.fn(async () => []),
    } as unknown as MemoryManager;
    const provider = new MemoryContextProvider(manager, 'project-1');
    await expect(provider.getContextBlock('deployment')).resolves.toBeNull();
    expect(manager.getRelevant).toHaveBeenCalledWith('project-1', 'deployment', 8, 0.2);
  });

  it('builds a memories block within the token budget', async () => {
    const manager = {
      getRelevant: vi.fn(async () => [memory()]),
    } as unknown as MemoryManager;
    const provider = new MemoryContextProvider(manager, 'project-1');
    const block = await provider.getContextBlock('react', 4096);

    expect(block).toContain('<memories count="1">');
    expect(block).toContain('relevance="0.80"');
    expect(block).toContain('<title>Stack</title>');
    expect(block).toContain('<tags>react</tags>');
  });

  it('escapes XML in titles and content', async () => {
    const manager = {
      getRelevant: vi.fn(async () => [
        memory({ title: 'A&B <C>', summary: 'use "quotes" & <angle>' }),
      ]),
    } as unknown as MemoryManager;
    const provider = new MemoryContextProvider(manager, 'project-1');
    const block = await provider.getContextBlock('x', 4096);
    expect(block).toContain('A&amp;B &lt;C&gt;');
    expect(block).toContain('use &quot;quotes&quot; &amp; &lt;angle&gt;');
  });

  it('excludes memories matching the exclude text', async () => {
    const manager = {
      getRelevant: vi.fn(async () => [
        memory({ id: 'mem_1', title: 'Stack', summary: 'React and TypeScript' }),
        memory({
          id: 'mem_2',
          title: 'Other',
          summary: 'this is a completely different thing entirely and should not be shown here at all',
        }),
      ]),
    } as unknown as MemoryManager;
    const provider = new MemoryContextProvider(manager, 'project-1');
    const block = await provider.getContextBlock(
      'x',
      4096,
      'this is a completely different thing entirely and should not be shown here at all',
    );
    expect(block).toContain('mem_1');
    expect(block).not.toContain('mem_2');
  });

  it('stops adding entries once the char budget is exhausted', async () => {
    const manager = {
      getRelevant: vi.fn(async () => [
        memory({ id: 'mem_1', title: 'Stack', summary: 'React and TypeScript' }),
        memory({ id: 'mem_2', title: 'Other', summary: 'A different thing entirely' }),
      ]),
    } as unknown as MemoryManager;
    const provider = new MemoryContextProvider(manager, 'project-1');
    const block = await provider.getContextBlock('x', 500);
    expect(block).toContain('mem_1');
    expect(block).not.toContain('mem_2');
  });

  it('returns null when the manager fails', async () => {
    const manager = {
      getRelevant: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as MemoryManager;
    const provider = new MemoryContextProvider(manager, 'project-1');
    await expect(provider.getContextBlock('x')).resolves.toBeNull();
  });
});

describe('MemoryExtractor', () => {
  it('extracts an error → solution memory from a debugging turn', () => {
    const extractor = new MemoryExtractor();
    const results = extractor.extract(
      'I get an error: Cannot find module foo',
      'The fix is to install the missing dependency and rerun the build.',
      ['get_diagnostics'],
    );
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('error_solution');
    expect(results[0].content).toContain('Solution:');
    expect(results[0].confidence).toBe(0.65);
  });

  it('extracts coding conventions from code-writing turns', () => {
    const extractor = new MemoryExtractor();
    const results = extractor.extract(
      'write the parser',
      'We always use snake_case for internal helpers and keep them private.',
      ['write_file'],
    );
    expect(results[0].type).toBe('convention');
    expect(results[0].content).toContain('snake_case');
  });

  it('extracts decisions from assistant text', () => {
    const extractor = new MemoryExtractor();
    const results = extractor.extract(
      'pick a database',
      'We decided to use SQLite for local storage because it is simple.',
      [],
    );
    expect(results[0].type).toBe('decision');
    expect(results[0].content).toContain('SQLite');
  });

  it('extracts workflows from step-by-step turns', () => {
    const extractor = new MemoryExtractor();
    const results = extractor.extract(
      'how do I deploy?',
      [
        'Follow this process:',
        '1. Run the build',
        '2. Run the tests',
        '3. Publish the artifact',
      ].join('\n'),
      ['run_terminal_command'],
    );
    expect(results[0].type).toBe('workflow');
    expect(results[0].content).toContain('1. Run the build');
  });

  it('extracts project facts', () => {
    const extractor = new MemoryExtractor();
    const results = extractor.extract(
      'tell me about this project',
      'The project uses Rust for the backend and React for the frontend.',
      [],
    );
    expect(results[0].type).toBe('fact');
  });

  it('extracts user preferences', () => {
    const extractor = new MemoryExtractor();
    const results = extractor.extract(
      'I prefer TypeScript over JavaScript and I always use tabs.',
      '',
      [],
    );
    expect(results[0].type).toBe('user_preference');
  });

  it('returns nothing for unrelated turns', () => {
    const extractor = new MemoryExtractor();
    expect(extractor.extract('hello', 'hi there', [])).toEqual([]);
  });

  it('deduplicates repeated signatures within a session and caps at 5', () => {
    const extractor = new MemoryExtractor();
    const input = [
      'We always use hooks for state and keep components small.',
      'We always use hooks for state and keep components small.',
    ].join(' ');
    const first = extractor.extract('write code', input, ['write_file']);
    const second = extractor.extract('write code', input, ['write_file']);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('reset clears the deduplication cache', () => {
    const extractor = new MemoryExtractor();
    const input = 'We always use hooks for state management in components.';
    extractor.extract('write code', input, ['write_file']);
    extractor.reset();
    expect(extractor.extract('write code', input, ['write_file'])).toHaveLength(1);
  });

  it('persists extractions through extractAndPersist', async () => {
    const manager = {
      persistExtractions: vi.fn(async () => [memory()]),
    } as unknown as MemoryManager;
    const extractor = new MemoryExtractor();
    const count = await extractor.extractAndPersist(
      manager,
      'I get an error: module missing',
      'The fix is to install the dependency and rebuild the project.',
      [],
      'project-1',
      'conv-1',
    );
    expect(count).toBe(1);
    expect(manager.persistExtractions).toHaveBeenCalledWith(
      expect.any(Array),
      'project-1',
      'conv-1',
      0.6,
    );
  });

  it('returns zero when nothing is extracted', async () => {
    const manager = {
      persistExtractions: vi.fn(async () => []),
    } as unknown as MemoryManager;
    const extractor = new MemoryExtractor();
    await expect(
      extractor.extractAndPersist(manager, 'hi', 'hello', [], 'p', 'c'),
    ).resolves.toBe(0);
    expect(manager.persistExtractions).not.toHaveBeenCalled();
  });
});
