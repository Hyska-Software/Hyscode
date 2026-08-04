import type { AgentMode, SessionSummary } from '@/stores/agent-store';
import type {
  DatabaseConversationRow,
  VortexProjectSessionIndexRow,
  VortexSessionRow,
} from './tauri-invoke';
import { tauriInvoke } from './tauri-invoke';
import type { RecentProject } from '@/stores/project-store';
import { normalizeProjectPath, projectPathKey } from './project-path';

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
    projectsByKey.set(pathKey, {
      id: project.id,
      name: project.name || recentProject?.name || normalizedPath,
      path: normalizedPath,
      lastActivityAt: project.last_activity_at || null,
      lastOpened: recentProject?.lastOpened ?? null,
      sessions: project.sessions.map((session) =>
        mapSession(session, project.id, project.name || recentProject?.name || normalizedPath, normalizedPath),
      ),
    });
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

export async function loadVortexProjectSessionIndex(
  recentProjects: RecentProject[],
  hiddenProjectPaths: string[],
): Promise<VortexProjectSessionIndex> {
  const database = await tauriInvoke('db_list_vortex_project_sessions', {});
  return mergeVortexProjectSessionIndex(database, recentProjects, hiddenProjectPaths);
}
