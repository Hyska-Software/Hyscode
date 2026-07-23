// ─── Session-wide file changes model for the Agent (Vortex) Changes panel ─────
// Merges agent edit sessions with git status/diff so the panel reflects the
// whole conversation, not just the current streaming turn.

import type { AgentEditSession } from '@/stores/agent-store';
import type { GitFile } from '@/stores/git-store';
import { countDiffLines } from './compute-diff';
import { tauriInvoke } from './tauri-invoke';

export type ChangeFilter = 'session' | 'last-turn' | 'staged' | 'working';
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';
export type ChangeSource = 'agent' | 'git' | 'both';

export interface SessionChangeEntry {
  /** Normalized relative path used for deduplication and stable selection. */
  key: string;
  /** Absolute path on disk (when a project is open). */
  filePath: string;
  /** Path relative to the repository root, forward-slash separated. */
  relPath: string;
  kind: ChangeKind;
  source: ChangeSource;
  added: number;
  removed: number;
  /** True when the git status for this file is staged. */
  staged?: boolean;
  /** Associated agent edit session, if any. */
  agentSession?: AgentEditSession;
  /** Associated git status entry, if any. */
  gitFile?: GitFile;
}

export interface GitCounts {
  added: number;
  removed: number;
}

// ─── Path normalization ─────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function normalizePathKey(filePath: string, rootPath: string | null): string {
  if (!rootPath) return toPosix(filePath);
  const root = toPosix(rootPath).replace(/\/$/, '');
  const fp = toPosix(filePath);
  if (fp === root) return '';
  if (fp.startsWith(`${root}/`)) return fp.slice(root.length + 1);
  return fp;
}

export function absoluteFromRel(relPath: string, rootPath: string | null): string {
  if (!rootPath) return relPath;
  return `${toPosix(rootPath).replace(/\/$/, '')}/${toPosix(relPath)}`;
}

// ─── Kind helpers ───────────────────────────────────────────────────────────

function agentSessionKind(session: AgentEditSession): ChangeKind {
  if (session.isNewFile || session.originalContent === null) return 'added';
  if (session.newContent.length === 0) return 'deleted';
  return 'modified';
}

function gitStatusKind(status: GitFile['status']): ChangeKind {
  switch (status) {
    case 'A':
    case 'C':
    case '?':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'M':
    case 'T':
    case 'U':
    default:
      return 'modified';
  }
}

function agentSessionCounts(session: AgentEditSession): GitCounts {
  return countDiffLines(session.hunks);
}

// ─── Async count loading for git-only entries ────────────────────────────────

export async function loadGitChangeCount(
  relPath: string,
  rootPath: string,
  staged: boolean,
): Promise<GitCounts> {
  try {
    const hunks = await tauriInvoke('git_diff_hunks', {
      repoPath: rootPath,
      filePath: relPath,
      staged,
    });
    return hunks.reduce(
      (acc, hunk) => ({
        added: acc.added + hunk.new_lines,
        removed: acc.removed + hunk.old_lines,
      }),
      { added: 0, removed: 0 },
    );
  } catch {
    return { added: 0, removed: 0 };
  }
}

// ─── Build the unified session change list ──────────────────────────────────

export interface BuildSessionChangesInput {
  filter: ChangeFilter;
  agentEditSessions: AgentEditSession[];
  lastTurnId: string | null;
  git: {
    staged: GitFile[];
    unstaged: GitFile[];
    untracked: GitFile[];
    conflicts: GitFile[];
  };
  rootPath: string | null;
}

export function buildSessionChanges(input: BuildSessionChangesInput): SessionChangeEntry[] {
  const { filter, agentEditSessions, lastTurnId, git, rootPath } = input;
  const map = new Map<string, SessionChangeEntry>();

  // Helper to merge a git file into the map keyed by relative path.
  const mergeGitFile = (file: GitFile, isStaged: boolean) => {
    const key = normalizePathKey(file.path, rootPath);
    if (!key) return;

    const existing = map.get(key);
    const kind = gitStatusKind(file.status);
    const counts: GitCounts = { added: 0, removed: 0 };

    if (existing) {
      existing.source = 'both';
      existing.gitFile = file;
      existing.staged = isStaged;
      // Git reflects current disk truth, so prefer its kind when conflicting.
      if (existing.kind !== kind && kind !== 'modified') {
        existing.kind = kind;
      }
    } else {
      map.set(key, {
        key,
        filePath: absoluteFromRel(file.path, rootPath),
        relPath: key,
        kind,
        source: 'git',
        added: counts.added,
        removed: counts.removed,
        staged: isStaged,
        gitFile: file,
      });
    }
  };

  // Add agent sessions first.
  for (const session of agentEditSessions) {
    const key = normalizePathKey(session.filePath, rootPath);
    if (!key) continue;

    const existing = map.get(key);
    const counts = agentSessionCounts(session);

    if (existing) {
      // An agent edit on a file already known from git: keep the most recent
      // agent session metadata. If two sessions target the same file in the
      // same turn, the later one wins (createdAt ordering below).
      if (!existing.agentSession || session.createdAt > existing.agentSession.createdAt) {
        existing.agentSession = session;
      }
      if (existing.source === 'git') {
        existing.source = 'both';
      }
    } else {
      map.set(key, {
        key,
        filePath: session.filePath,
        relPath: key,
        kind: agentSessionKind(session),
        source: 'agent',
        added: counts.added,
        removed: counts.removed,
        agentSession: session,
      });
    }
  }

  // Overlay git status (staged, unstaged, untracked, conflicts).
  for (const file of git.staged) mergeGitFile(file, true);
  for (const file of git.unstaged) mergeGitFile(file, false);
  for (const file of git.untracked) mergeGitFile(file, false);
  for (const file of git.conflicts) mergeGitFile(file, false);

  // Apply filters.
  let entries = Array.from(map.values());

  switch (filter) {
    case 'session':
      // Session = every file the agent touched in this conversation,
      // enriched with current git status when available.
      entries = entries.filter((e) => e.source === 'agent' || e.source === 'both');
      break;
    case 'last-turn':
      entries = entries.filter((e) => e.agentSession && e.agentSession.turnId === lastTurnId);
      break;
    case 'staged':
      entries = entries.filter((e) => e.staged);
      break;
    case 'working':
      entries = entries.filter((e) => e.gitFile && !e.staged && e.gitFile.status !== 'U');
      break;
  }

  // Stable alphabetical sort, pending/staged first for visual priority.
  return entries.sort((a, b) => {
    const aPending =
      a.agentSession?.phase === 'pending_review' || a.agentSession?.phase === 'streaming';
    const bPending =
      b.agentSession?.phase === 'pending_review' || b.agentSession?.phase === 'streaming';
    if (aPending && !bPending) return -1;
    if (!aPending && bPending) return 1;
    return a.key.localeCompare(b.key);
  });
}

// ─── Diff content helpers ───────────────────────────────────────────────────

export interface DiffContent {
  original: string;
  modified: string;
  language: string;
}

export function buildAgentDiffContent(session: AgentEditSession): DiffContent {
  return {
    original: session.originalContent ?? '',
    modified: session.newContent,
    language: detectLang(session.filePath),
  };
}

export async function buildGitDiffContent(
  relPath: string,
  rootPath: string,
  kind: ChangeKind,
): Promise<DiffContent> {
  const content = await tauriInvoke('git_file_content', {
    repoPath: rootPath,
    filePath: relPath,
  });

  return {
    original: kind === 'added' ? '' : content.original,
    modified: kind === 'deleted' ? '' : content.modified,
    language: detectLang(relPath),
  };
}

// ─── Language detection (mirrors agent-right-panel.tsx) ─────────────────────

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  rs: 'rust',
  py: 'python',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sh: 'shell',
};

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] || 'plaintext';
}

// ─── Display helpers ────────────────────────────────────────────────────────

export function filterLabel(filter: ChangeFilter): string {
  switch (filter) {
    case 'session':
      return 'Session';
    case 'last-turn':
      return 'Last turn';
    case 'staged':
      return 'Staged';
    case 'working':
      return 'Working';
  }
}

export function kindLabel(kind: ChangeKind): string {
  switch (kind) {
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'modified':
      return 'modified';
  }
}

export function gitStatusLabel(status: GitFile['status']): string {
  switch (status) {
    case 'A':
      return 'staged add';
    case 'M':
      return 'staged mod';
    case 'D':
      return 'staged del';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    case '?':
      return 'untracked';
    case 'U':
      return 'conflict';
    default:
      return status;
  }
}
