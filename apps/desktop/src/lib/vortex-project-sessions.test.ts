import { describe, expect, it } from 'vitest';
import { areSameProjectPath } from './project-path';
import { mergeVortexProjectSessionIndex } from './vortex-project-sessions';

function conversation(
  id: string,
  title: string,
  updatedAt: string,
  mode = 'chat',
) {
  return {
    id,
    title,
    mode,
    model_id: null,
    provider_id: null,
    message_count: 2,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

describe('VORTEX project/session index', () => {
  it('normalizes Windows paths and merges an empty local project', () => {
    expect(areSameProjectPath('C:\\Work\\HysCode\\', 'c:/work/hyscode')).toBe(true);

    const index = mergeVortexProjectSessionIndex(
      {
        projects: [],
        recent_sessions: [],
      },
      [{ name: 'Empty Project', path: 'C:\\empty-project\\', lastOpened: 20 }],
      [],
    );

    expect(index.projects).toEqual([
      expect.objectContaining({
        name: 'Empty Project',
        path: 'C:/empty-project',
        sessions: [],
      }),
    ]);
  });

  it('merges database sessions, preserves recency, and filters hidden projects', () => {
    const index = mergeVortexProjectSessionIndex(
      {
        projects: [
          {
            id: 'project-a',
            name: 'Project A',
            path: 'C:/project-a',
            last_activity_at: '2026-08-04 10:01:00',
            sessions: [conversation('session-a', 'Older', '2026-08-04 10:01:00')],
          },
          {
            id: 'project-b',
            name: 'Project B',
            path: 'C:/project-b',
            last_activity_at: '2026-08-04 10:02:00',
            sessions: [conversation('session-b', 'Newest', '2026-08-04 10:02:00', 'build')],
          },
        ],
        recent_sessions: [
          {
            ...conversation('session-a', 'Older', '2026-08-04 10:01:00'),
            project_id: 'project-a',
            project_name: 'Project A',
            project_path: 'C:/project-a',
          },
          {
            ...conversation('session-b', 'Newest', '2026-08-04 10:02:00', 'build'),
            project_id: 'project-b',
            project_name: 'Project B',
            project_path: 'C:/project-b',
          },
        ],
      },
      [{ name: 'Project A', path: 'C:/project-a', lastOpened: Date.parse('2026-08-04T13:03:00Z') }],
      [],
    );

    expect(index.projects.map((project) => project.name)).toEqual(['Project A', 'Project B']);
    expect(index.recentSessions.map((session) => session.title)).toEqual(['Newest', 'Older']);
    expect(index.projects[1].sessions[0].mode).toBe('build');

    const hidden = mergeVortexProjectSessionIndex(
      {
        projects: [
          {
            id: 'project-a',
            name: 'Project A',
            path: 'C:/project-a',
            last_activity_at: '2026-08-04 10:01:00',
            sessions: [conversation('session-a', 'Older', '2026-08-04 10:01:00')],
          },
        ],
        recent_sessions: [],
      },
      [],
      ['c:\\PROJECT-A\\'],
    );

    expect(hidden.projects).toEqual([]);
  });

  it('falls back to chat for database modes added by newer clients', () => {
    const index = mergeVortexProjectSessionIndex(
      {
        projects: [
          {
            id: 'project',
            name: 'Project',
            path: 'C:/project',
            last_activity_at: '2026-08-04 10:00:00',
            sessions: [conversation('session', 'Future mode', '2026-08-04 10:00:00', 'future')],
          },
        ],
        recent_sessions: [],
      },
      [],
      [],
    );

    expect(index.projects[0].sessions[0].mode).toBe('chat');
  });

  it('combines sessions from equivalent Windows path representations', () => {
    const index = mergeVortexProjectSessionIndex(
      {
        projects: [
          {
            id: 'project-slash',
            name: 'HysCode',
            path: 'C:/Users/estev/Hyscode',
            last_activity_at: '2026-08-04 20:37:14',
            sessions: [conversation('new-session', 'New session', '2026-08-04 20:37:14')],
          },
          {
            id: 'project-backslash',
            name: 'HysCode',
            path: 'C:\\Users\\estev\\Hyscode',
            last_activity_at: '2026-08-04 16:07:22',
            sessions: [conversation('old-session', 'Old session', '2026-08-04 16:07:22')],
          },
        ],
        recent_sessions: [],
      },
      [{ name: 'HysCode', path: 'C:/Users/estev/Hyscode', lastOpened: 20 }],
      [],
    );

    expect(index.projects).toHaveLength(1);
    expect(index.projects[0].sessions.map((session) => session.id)).toEqual([
      'new-session',
      'old-session',
    ]);
  });
});
