import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliDataStore, makeSessionMessage } from './data-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function dataStore(): Promise<{ store: CliDataStore; directory: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-data-'));
  temporaryDirectories.push(directory);
  return { store: new CliDataStore(path.join(directory, 'tui-data.json')), directory };
}

describe('CLI persistence adapter', () => {
  it('persists sessions with full assistant and tool message content', async () => {
    const { store, directory } = await dataStore();
    const session = await store.createSession(directory, 'build', 'openai', 'gpt-5');
    session.messages.push(
      makeSessionMessage({ role: 'user', content: [{ type: 'text', text: 'Inspect the project.' }] }),
      makeSessionMessage({ role: 'assistant', content: [{ type: 'tool_call', id: 'call-1', name: 'read_file', input: { path: 'README.md' } }] }),
      makeSessionMessage({ role: 'tool', content: [{ type: 'tool_result', toolCallId: 'call-1', output: 'HYS_TUI_FIXTURE' }] }),
    );
    session.messageCount = session.messages.length;
    await store.saveSession(session);

    const reopened = new CliDataStore(path.join(directory, 'tui-data.json'));
    await reopened.load();
    const loaded = reopened.loadSession(session.id);
    expect(loaded?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(loaded?.messages[2]?.content[0]).toMatchObject({ type: 'tool_result', output: 'HYS_TUI_FIXTURE' });
  });

  it('stores memory and SDD records through the same invoke contract used by the harness', async () => {
    const { store } = await dataStore();
    const memory = await store.invoke<{ id: string; content: string }>('db_create_memory', {
      projectId: 'project',
      memoryType: 'decision',
      title: 'TUI runtime',
      content: 'The TypeScript TUI uses the shared TypeScript harness runtime.',
      summary: 'Shared runtime bridge',
      tags: JSON.stringify(['architecture']),
      createdBy: 'system',
    });
    expect(memory.content).toContain('shared TypeScript harness');
    expect(await store.invoke<unknown[]>('db_search_memories', { projectId: 'project', query: 'shared' })).toHaveLength(1);

    await store.invoke('db_sdd_upsert_session', { sessionJson: JSON.stringify({ id: 'sdd-1', projectId: 'project', status: 'draft' }) });
    await store.invoke('db_sdd_upsert_task', { taskJson: JSON.stringify({ id: 'task-1', sessionId: 'sdd-1', title: 'Build TUI', status: 'pending' }) });
    expect(await store.invoke<string | null>('db_sdd_get_task', { id: 'task-1' })).toContain('task-1');
    await store.invoke('db_sdd_upsert_task', { taskJson: JSON.stringify({ id: 'task-1', sessionId: 'sdd-1', title: 'Build TUI', status: 'completed' }) });
    expect(JSON.parse((await store.invoke<string | null>('db_sdd_get_task', { id: 'task-1' })) ?? '{}').status).toBe('completed');

    const persisted = JSON.parse(await readFile(store.path, 'utf8')) as { memories: unknown[]; sddTasks: Record<string, unknown[]> };
    expect(persisted.memories).toHaveLength(1);
    expect(persisted.sddTasks['sdd-1']).toHaveLength(1);
  });

  it('groups persisted sessions into recent projects for project selection', async () => {
    const { store, directory } = await dataStore();
    const secondDirectory = path.join(directory, 'second-project');
    const first = await store.createSession(directory, 'chat', null, null);
    await store.createSession(directory, 'build', null, null);
    await store.createSession(secondDirectory, 'review', null, null);

    const projects = store.listProjects();
    expect(projects).toHaveLength(2);
    expect(projects.find((project) => project.workspacePath === directory)).toMatchObject({
      sessionCount: 2,
    });
    expect(projects.find((project) => project.workspacePath === secondDirectory)).toMatchObject({
      sessionCount: 1,
    });
    expect(store.loadSession(first.id)?.workspacePath).toBe(directory);
  });

  it('renames and deletes sessions without affecting other projects', async () => {
    const { store, directory } = await dataStore();
    const first = await store.createSession(directory, 'chat', null, null);
    const second = await store.createSession(directory, 'build', null, null);
    const renamed = await store.renameSession(first.id, 'Focused TUI session');
    expect(renamed?.title).toBe('Focused TUI session');
    expect(await store.deleteSession(first.id)).toBe(true);
    expect(store.loadSession(first.id)).toBeNull();
    expect(store.loadSession(second.id)?.id).toBe(second.id);
    expect(await store.deleteSession(first.id)).toBe(false);
  });
});
