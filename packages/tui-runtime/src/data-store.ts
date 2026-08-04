import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentType, Memory, MemoryType } from '@hyscode/agent-harness';
import type { Message } from '@hyscode/ai-providers';
import type { ProjectSummary, SessionMessage, SessionRecord, SessionSummary } from './protocol';

type MemoryRow = {
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
};

type PersistedConversation = {
  id: string;
  projectId: string;
  title: string;
  workspacePath: string;
  mode: AgentType;
  providerId: string | null;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
};

type PersistedData = {
  conversations: PersistedConversation[];
  memories: Memory[];
  sddSessions: Record<string, string>;
  sddTasks: Record<string, string[]>;
  traces: Array<Record<string, unknown>>;
};

const EMPTY_DATA: PersistedData = {
  conversations: [],
  memories: [],
  sddSessions: {},
  sddTasks: {},
  traces: [],
};

function defaultDataPath(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hyscode', 'tui-data.json');
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, 'hyscode', 'tui-data.json');
  return path.join(os.homedir(), '.local', 'share', 'hyscode', 'tui-data.json');
}

function now(): string {
  return new Date().toISOString();
}

function cloneData(data: PersistedData): PersistedData {
  return JSON.parse(JSON.stringify(data)) as PersistedData;
}

function memoryToRow(memory: Memory): MemoryRow {
  return {
    id: memory.id,
    project_id: memory.projectId ?? null,
    memory_type: memory.type,
    title: memory.title,
    content: memory.content,
    summary: memory.summary,
    tags: JSON.stringify(memory.tags),
    source_conversation_id: memory.sourceConversationId ?? null,
    relevance_score: memory.relevanceScore,
    access_count: memory.accessCount,
    last_accessed_at: memory.lastAccessedAt ?? null,
    created_by: memory.createdBy,
    status: memory.status,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
  };
}

export class CliDataStore {
  private readonly dataPath: string;
  private data: PersistedData = cloneData(EMPTY_DATA);
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataPath = process.env.HYSCODE_TUI_DATA_PATH || defaultDataPath()) {
    this.dataPath = path.resolve(dataPath);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.dataPath, 'utf8')) as Partial<PersistedData>;
      this.data = {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        sddSessions: parsed.sddSessions ?? {},
        sddTasks: parsed.sddTasks ?? {},
        traces: Array.isArray(parsed.traces) ? parsed.traces : [],
      };
    } catch {
      this.data = cloneData(EMPTY_DATA);
    }
    this.loaded = true;
  }

  get path(): string {
    return this.dataPath;
  }

  async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.load();
    switch (command) {
      case 'db_ensure_project':
        return undefined as T;
      case 'db_create_memory':
        return (await this.createMemory(args)) as T;
      case 'db_list_memories':
        return this.listMemories(args) as T;
      case 'db_search_memories':
        return this.searchMemories(args) as T;
      case 'db_update_memory':
        await this.updateMemory(args);
        return undefined as T;
      case 'db_delete_memory':
        await this.deleteMemory(String(args.id ?? ''));
        return undefined as T;
      case 'db_track_memory_access':
        await this.trackMemory(String(args.id ?? ''));
        return undefined as T;
      case 'db_decay_memories':
        return this.decayMemories(args) as T;
      case 'db_get_memory_stats':
        return this.memoryStats(args) as T;
      case 'db_sdd_upsert_session':
        await this.upsertSddSession(String(args.sessionJson ?? ''));
        return undefined as T;
      case 'db_sdd_get_session':
        return (this.data.sddSessions[String(args.id ?? '')] ?? null) as T;
      case 'db_sdd_list_sessions':
        return this.listSddSessions(String(args.projectId ?? '')) as T;
      case 'db_sdd_upsert_task':
        await this.upsertSddTask(String(args.taskJson ?? ''));
        return undefined as T;
      case 'db_sdd_get_tasks':
        return (this.data.sddTasks[String(args.sessionId ?? '')] ?? []) as T;
      case 'db_sdd_get_task':
        return this.getSddTask(String(args.id ?? '')) as T;
      case 'db_create_trace':
        this.data.traces.push({ ...args, created_at: now() });
        await this.persist();
        return undefined as T;
      case 'db_list_traces':
        return this.data.traces.filter((trace) => trace.conversationId === args.conversationId) as T;
      default:
        throw new Error(`CLI data store does not implement command "${command}"`);
    }
  }

  listSessions(workspacePath: string): SessionSummary[] {
    return this.data.conversations
      .filter((conversation) => conversation.workspacePath === workspacePath)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((conversation) => this.toSummary(conversation));
  }

  listProjects(): ProjectSummary[] {
    const projects = new Map<string, ProjectSummary>();
    for (const conversation of this.data.conversations) {
      const current = projects.get(conversation.workspacePath);
      if (!current) {
        projects.set(conversation.workspacePath, {
          workspacePath: conversation.workspacePath,
          sessionCount: 1,
          updatedAt: conversation.updatedAt,
        });
        continue;
      }
      current.sessionCount += 1;
      if (conversation.updatedAt > current.updatedAt) current.updatedAt = conversation.updatedAt;
    }
    return Array.from(projects.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  loadSession(id: string): SessionRecord | null {
    const conversation = this.data.conversations.find((candidate) => candidate.id === id);
    return conversation ? { ...this.toSummary(conversation), messages: [...conversation.messages] } : null;
  }

  async saveSession(session: SessionRecord): Promise<void> {
    const existing = this.data.conversations.findIndex((conversation) => conversation.id === session.id);
    const record: PersistedConversation = {
      id: session.id,
      projectId: session.id,
      title: session.title,
      workspacePath: session.workspacePath,
      mode: session.agentType,
      providerId: session.providerId,
      modelId: session.modelId,
      createdAt: existing >= 0 ? this.data.conversations[existing].createdAt : session.updatedAt,
      updatedAt: session.updatedAt,
      messages: [...session.messages],
    };
    if (existing >= 0) this.data.conversations[existing] = record;
    else this.data.conversations.push(record);
    await this.persist();
  }

  async createSession(workspacePath: string, agentType: AgentType, providerId: string | null, modelId: string | null): Promise<SessionRecord> {
    const timestamp = now();
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      title: 'New session',
      workspacePath,
      providerId,
      modelId,
      agentType,
      updatedAt: timestamp,
      messageCount: 0,
      messages: [],
    };
    await this.saveSession(session);
    return session;
  }

  private toSummary(conversation: PersistedConversation): SessionSummary {
    return {
      id: conversation.id,
      title: conversation.title,
      workspacePath: conversation.workspacePath,
      providerId: conversation.providerId,
      modelId: conversation.modelId,
      agentType: conversation.mode,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
    };
  }

  private async createMemory(args: Record<string, unknown>): Promise<MemoryRow> {
    const timestamp = now();
    const memory: Memory = {
      id: String(args.id ?? crypto.randomUUID()),
      projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
      type: String(args.memoryType ?? 'fact') as MemoryType,
      title: String(args.title ?? ''),
      content: String(args.content ?? ''),
      summary: String(args.summary ?? String(args.content ?? '').slice(0, 280)),
      tags: parseJsonArray(args.tags),
      sourceConversationId: typeof args.sourceConversationId === 'string' ? args.sourceConversationId : undefined,
      relevanceScore: numberValue(args.relevanceScore, 0.7),
      accessCount: 0,
      createdBy: String(args.createdBy ?? 'agent') as Memory['createdBy'],
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.data.memories.push(memory);
    await this.persist();
    return memoryToRow(memory);
  }

  private listMemories(args: Record<string, unknown>): MemoryRow[] {
    const projectId = typeof args.projectId === 'string' ? args.projectId : null;
    const status = typeof args.status === 'string' ? args.status : 'active';
    const memoryType = typeof args.memoryType === 'string' ? args.memoryType : null;
    const offset = numberValue(args.offset, 0);
    const limit = numberValue(args.limit, 50);
    return this.data.memories
      .filter((memory) => (projectId === null || memory.projectId === projectId) && memory.status === status && (memoryType === null || memory.type === memoryType))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(offset, offset + limit)
      .map(memoryToRow);
  }

  private searchMemories(args: Record<string, unknown>): MemoryRow[] {
    const terms = String(args.query ?? '').toLowerCase().split(/\s+or\s+|\s+/).filter(Boolean);
    const projectId = typeof args.projectId === 'string' ? args.projectId : null;
    const minRelevance = numberValue(args.minRelevance, 0);
    const limit = numberValue(args.limit, 20);
    return this.data.memories
      .filter((memory) => {
        const haystack = `${memory.title} ${memory.summary} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase();
        return (projectId === null || memory.projectId === projectId) && memory.status === 'active' && memory.relevanceScore >= minRelevance && terms.some((term) => haystack.includes(term));
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit)
      .map(memoryToRow);
  }

  private async updateMemory(args: Record<string, unknown>): Promise<void> {
    const memory = this.data.memories.find((candidate) => candidate.id === String(args.id ?? ''));
    if (!memory) return;
    if (typeof args.title === 'string') memory.title = args.title;
    if (typeof args.content === 'string') memory.content = args.content;
    if (typeof args.summary === 'string') memory.summary = args.summary;
    if (args.tags !== null && args.tags !== undefined) memory.tags = parseJsonArray(args.tags);
    if (typeof args.relevanceScore === 'number') memory.relevanceScore = args.relevanceScore;
    if (typeof args.status === 'string') memory.status = args.status as Memory['status'];
    memory.updatedAt = now();
    await this.persist();
  }

  private async deleteMemory(id: string): Promise<void> {
    this.data.memories = this.data.memories.filter((memory) => memory.id !== id);
    await this.persist();
  }

  private async trackMemory(id: string): Promise<void> {
    const memory = this.data.memories.find((candidate) => candidate.id === id);
    if (!memory) return;
    memory.accessCount += 1;
    memory.lastAccessedAt = now();
    await this.persist();
  }

  private async decayMemories(args: Record<string, unknown>): Promise<number> {
    const projectId = typeof args.projectId === 'string' ? args.projectId : null;
    const factor = numberValue(args.decayFactor, 0.95);
    const threshold = numberValue(args.archiveThreshold, 0.08);
    const cutoff = Date.now() - numberValue(args.inactiveDays, 7) * 24 * 60 * 60 * 1000;
    let archived = 0;
    for (const memory of this.data.memories) {
      if (memory.status !== 'active' || (projectId !== null && memory.projectId !== projectId)) continue;
      if (Date.parse(memory.lastAccessedAt ?? memory.updatedAt) > cutoff) continue;
      memory.relevanceScore *= factor;
      memory.updatedAt = now();
      if (memory.relevanceScore < threshold) {
        memory.status = 'archived';
        archived += 1;
      }
    }
    await this.persist();
    return archived;
  }

  private memoryStats(args: Record<string, unknown>): { total: number; by_type: string; archived: number } {
    const projectId = typeof args.projectId === 'string' ? args.projectId : null;
    const memories = this.data.memories.filter((memory) => projectId === null || memory.projectId === projectId);
    const byType: Record<string, number> = {};
    for (const memory of memories) byType[memory.type] = (byType[memory.type] ?? 0) + 1;
    return {
      total: memories.filter((memory) => memory.status === 'active').length,
      by_type: JSON.stringify(byType),
      archived: memories.filter((memory) => memory.status === 'archived').length,
    };
  }

  private async upsertSddSession(raw: string): Promise<void> {
    const session = JSON.parse(raw) as { id: string };
    this.data.sddSessions[session.id] = raw;
    await this.persist();
  }

  private listSddSessions(projectId: string): string[] {
    return Object.values(this.data.sddSessions).filter((raw) => {
      try {
        return (JSON.parse(raw) as { projectId?: string }).projectId === projectId;
      } catch {
        return false;
      }
    });
  }

  private async upsertSddTask(raw: string): Promise<void> {
    const task = JSON.parse(raw) as { id: string; sessionId: string };
    const existing = this.data.sddTasks[task.sessionId] ?? [];
    const index = existing.findIndex((candidate) => {
      try {
        return (JSON.parse(candidate) as { id: string }).id === task.id;
      } catch {
        return false;
      }
    });
    if (index >= 0) existing[index] = raw;
    else existing.push(raw);
    this.data.sddTasks[task.sessionId] = existing;
    await this.persist();
  }

  private getSddTask(id: string): string | null {
    for (const rows of Object.values(this.data.sddTasks)) {
      const match = rows.find((raw) => {
        try {
          return (JSON.parse(raw) as { id?: string }).id === id;
        } catch {
          return false;
        }
      });
      if (match) return match;
    }
    return null;
  }

  private async persist(): Promise<void> {
    const snapshot = cloneData(this.data);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.dataPath), { recursive: true });
      const temporaryPath = `${this.dataPath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.dataPath);
    });
    await this.writeQueue;
  }
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function makeSessionMessage(message: Message, tokenUsage?: SessionMessage['tokenUsage']): SessionMessage {
  return {
    ...message,
    id: crypto.randomUUID(),
    createdAt: now(),
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}
