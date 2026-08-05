import type { AgentMode, SessionSummary } from '@/stores/agent-store';
import type {
  DatabaseConversationRow,
  VortexProjectSessionIndexRow,
  VortexSessionRow,
} from './tauri-invoke';
import { tauriInvoke } from './tauri-invoke';
import type { RecentProject } from '@/stores/project-store';
import { normalizeProjectPath, projectPathKey } from './project-path';
import type { VortexRuntimeSnapshot } from './vortex-runtime-types';
import { isPlaceholderVortexSessionTitle } from './vortex-session-titles';

export interface VortexSessionSummary extends SessionSummary {
  projectId: string;
  projectName: string;
  projectPath: string;
}

export interface VortexProjectSummary {
  id: string;
  name: string;
  path: string;
  lastActivityAt: string | null;
  lastOpened: number | null;
  sessions: VortexSessionSummary[];
}

export interface VortexProjectSessionIndex {
  projects: VortexProjectSummary[];
  recentSessions: VortexSessionSummary[];
}

export const VORTEX_SESSION_INDEX_UPDATED_EVENT = 'hyscode:vortex-session-index-updated';

export function notifyVortexProjectSessionIndexUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(VORTEX_SESSION_INDEX_UPDATED_EVENT));
  }
}

const AGENT_MODES: readonly AgentMode[] = ['chat', 'build', 'review', 'debug', 'plan'];

export function toAgentMode(mode: string): AgentMode {
  return AGENT_MODES.includes(mode as AgentMode) ? (mode as AgentMode) : 'chat';
}

function mapSession(
  row: DatabaseConversationRow,
  projectId: string,
  projectName: string,
  projectPath: string,
): VortexSessionSummary {
  return {
    id: row.id,
    title: row.title,
    mode: toAgentMode(row.mode),
    modelId: row.model_id,
    providerId: row.provider_id,
    messageCount: row.message_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectId,
    projectName,
    projectPath,
  };
}

function mapIndexedSession(row: VortexSessionRow): VortexSessionSummary {
  return mapSession(row, row.project_id, row.project_name, row.project_path);
}

function activityTimestamp(project: VortexProjectSummary): number {
  if (project.lastOpened !== null) return project.lastOpened;
  if (project.lastActivityAt) {
    const timestamp = Date.parse(project.lastActivityAt);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return 0;
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

function mergeRuntimeTitle(currentTitle: string, runtimeTitle: string): string {
  if (isPlaceholderVortexSessionTitle(runtimeTitle) && !isPlaceholderVortexSessionTitle(currentTitle)) {
    return currentTitle;
  }
  return runtimeTitle || currentTitle;
}

function mergeSessions(
  current: VortexSessionSummary[],
  incoming: VortexSessionSummary[],
): VortexSessionSummary[] {
  const sessionsById = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    const existing = sessionsById.get(session.id);
    if (!existing || session.updatedAt.localeCompare(existing.updatedAt) > 0) {
      sessionsById.set(session.id, session);
    }
  }
  return [...sessionsById.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

/**
 * Merge durable database projects with the local recent-project registry.
 * The local registry is needed for projects opened before they had a session,
 * while SQLite remains authoritative for all persisted conversations.
 */
export function mergeVortexProjectSessionIndex(
  database: VortexProjectSessionIndexRow,
  recentProjects: RecentProject[],
  hiddenProjectPaths: string[],
): VortexProjectSessionIndex {
  const hiddenKeys = new Set(hiddenProjectPaths.map(projectPathKey));
  const recentByKey = new Map(
    recentProjects.map((project) => [projectPathKey(project.path), project]),
  );
  const projectsByKey = new Map<string, VortexProjectSummary>();

  for (const project of database.projects) {
    const normalizedPath = normalizeProjectPath(project.path);
    const pathKey = projectPathKey(normalizedPath);
    if (hiddenKeys.has(pathKey)) continue;
    const recentProject = recentByKey.get(pathKey);
    const nextProject: VortexProjectSummary = {
      id: project.id,
      name: project.name || recentProject?.name || normalizedPath,
      path: normalizedPath,
      lastActivityAt: project.last_activity_at || null,
      lastOpened: recentProject?.lastOpened ?? null,
      sessions: project.sessions.map((session) =>
        mapSession(session, project.id, project.name || recentProject?.name || normalizedPath, normalizedPath),
      ),
    };
    const existingProject = projectsByKey.get(pathKey);
    if (existingProject) {
      projectsByKey.set(pathKey, {
        ...existingProject,
        name: recentProject?.name || existingProject.name || nextProject.name,
        lastActivityAt: latestTimestamp(existingProject.lastActivityAt, nextProject.lastActivityAt),
        lastOpened: Math.max(existingProject.lastOpened ?? 0, nextProject.lastOpened ?? 0) || null,
        sessions: mergeSessions(existingProject.sessions, nextProject.sessions),
      });
    } else {
      projectsByKey.set(pathKey, nextProject);
    }
  }

  for (const recentProject of recentProjects) {
    const normalizedPath = normalizeProjectPath(recentProject.path);
    const pathKey = projectPathKey(normalizedPath);
    if (hiddenKeys.has(pathKey) || projectsByKey.has(pathKey)) continue;
    projectsByKey.set(pathKey, {
      id: normalizedPath,
      name: recentProject.name,
      path: normalizedPath,
      lastActivityAt: null,
      lastOpened: recentProject.lastOpened,
      sessions: [],
    });
  }

  const projects = [...projectsByKey.values()].sort((left, right) => {
    const activityDifference = activityTimestamp(right) - activityTimestamp(left);
    if (activityDifference !== 0) return activityDifference;
    return left.name.localeCompare(right.name);
  });

  const recentSessions = database.recent_sessions
    .filter((session) => !hiddenKeys.has(projectPathKey(session.project_path)))
    .map(mapIndexedSession)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return { projects, recentSessions };
}

/** Overlay live runtimes so sessions are visible before their next DB refresh. */
export function mergeVortexRuntimeSessions(
  index: VortexProjectSessionIndex,
  runtimes: VortexRuntimeSnapshot[],
  hiddenProjectPaths: string[] = [],
): VortexProjectSessionIndex {
  const hiddenKeys = new Set(hiddenProjectPaths.map(projectPathKey));
  const projectsByKey = new Map(
    index.projects.map((project) => [
      projectPathKey(project.path),
      { ...project, sessions: [...project.sessions] },
    ]),
  );

  for (const runtime of runtimes) {
    const normalizedPath = normalizeProjectPath(runtime.projectPath);
    const pathKey = projectPathKey(normalizedPath);
    if (hiddenKeys.has(pathKey)) continue;

    const updatedAt = new Date(runtime.updatedAt).toISOString();
    const existingProject = projectsByKey.get(pathKey);
    const runtimeSession: VortexSessionSummary = {
      id: runtime.conversationId,
      title: runtime.title,
      mode: runtime.mode,
      modelId: null,
      providerId: null,
      messageCount: runtime.messageCount,
      createdAt: new Date(runtime.startedAt).toISOString(),
      updatedAt,
      projectId: existingProject?.id ?? normalizedPath,
      projectName: existingProject?.name ?? runtime.projectName,
      projectPath: normalizedPath,
    };

    if (existingProject) {
      const sessionIndex = existingProject.sessions.findIndex(
        (session) => session.id === runtime.conversationId,
      );
      const sessions = [...existingProject.sessions];
      if (sessionIndex >= 0) {
        const current = sessions[sessionIndex];
        sessions[sessionIndex] = {
          ...current,
          title: mergeRuntimeTitle(current.title, runtime.title),
          mode: runtime.mode,
          messageCount: Math.max(current.messageCount, runtime.messageCount),
          updatedAt: updatedAt > current.updatedAt ? updatedAt : current.updatedAt,
        };
      } else {
        sessions.push(runtimeSession);
      }
      sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      projectsByKey.set(pathKey, {
        ...existingProject,
        lastActivityAt: latestTimestamp(existingProject.lastActivityAt, updatedAt),
        sessions,
      });
    } else {
      projectsByKey.set(pathKey, {
        id: normalizedPath,
        name: runtime.projectName,
        path: normalizedPath,
        lastActivityAt: updatedAt,
        lastOpened: runtime.startedAt,
        sessions: [runtimeSession],
      });
    }
  }

  const recentById = new Map(index.recentSessions.map((session) => [session.id, session]));
  for (const project of projectsByKey.values()) {
    for (const session of project.sessions) {
      const runtime = runtimes.find(
        (item) =>
          item.conversationId === session.id &&
          projectPathKey(item.projectPath) === projectPathKey(project.path),
      );
      if (runtime) {
        recentById.set(session.id, {
          ...session,
          title: mergeRuntimeTitle(session.title, runtime.title),
          mode: runtime.mode,
          messageCount: Math.max(session.messageCount, runtime.messageCount),
          updatedAt: new Date(runtime.updatedAt).toISOString(),
        });
      }
    }
  }

  const projects = [...projectsByKey.values()].sort((left, right) => {
    const activityDifference = activityTimestamp(right) - activityTimestamp(left);
    if (activityDifference !== 0) return activityDifference;
    return left.name.localeCompare(right.name);
  });
  const recentSessions = [...recentById.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return { projects, recentSessions };
}

export async function loadVortexProjectSessionIndex(
  recentProjects: RecentProject[],
  hiddenProjectPaths: string[],
): Promise<VortexProjectSessionIndex> {
  const database = await tauriInvoke('db_list_vortex_project_sessions', {});
  return mergeVortexProjectSessionIndex(database, recentProjects, hiddenProjectPaths);
}
