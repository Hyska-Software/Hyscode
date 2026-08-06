import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentType, ApprovalMode, ToolCategory } from '@hyscode/agent-harness';
import type { McpServerConfig } from '@hyscode/mcp-client';
import { DEFAULT_THEME_ID } from '@hyscode/theme';

export type CustomApprovalRules = {
  categoryRules: Partial<Record<ToolCategory, boolean>>;
  toolRules: Record<string, boolean>;
};

export type SharedTuiSettings = {
  themeId: string;
  sidebarVisible: boolean;
  activeProviderId: string | null;
  activeModelId: string | null;
  agentType: AgentType;
  approvalMode: ApprovalMode;
  customApprovalRules: CustomApprovalRules;
  interactionLimitEnabled: boolean;
  maxIterations: number;
  temperature: number;
  maxTokens: number;
  topP: number | null;
  agentMaxRetries: number;
  agentRetryBaseDelayMs: number;
  agentRetryMaxDelayMs: number;
  agentRequestTimeoutMs: number;
  agentStreamIdleTimeoutMs: number;
  thinkingSettings: Record<string, Record<string, unknown>>;
  mcpServers: Array<McpServerConfig & { enabled?: boolean; agentSafe?: boolean }>;
  skillsPath: string;
  globalRulesPath: string;
  terminalShell: string;
  subAgentEnabled: boolean;
  subAgentDefaultMode: Exclude<AgentType, 'chat'>;
  subAgentMaxIterations: number;
  subAgentAutoApprove: boolean;
  subAgentMaxConcurrent: number;
};

const DEFAULT_SETTINGS: SharedTuiSettings = {
  themeId: DEFAULT_THEME_ID,
  sidebarVisible: true,
  activeProviderId: null,
  activeModelId: null,
  agentType: 'chat',
  approvalMode: 'manual',
  customApprovalRules: { categoryRules: {}, toolRules: {} },
  interactionLimitEnabled: false,
  maxIterations: 25,
  temperature: 0,
  maxTokens: 8192,
  topP: null,
  agentMaxRetries: 3,
  agentRetryBaseDelayMs: 1000,
  agentRetryMaxDelayMs: 30000,
  agentRequestTimeoutMs: 120000,
  agentStreamIdleTimeoutMs: 90000,
  thinkingSettings: {},
  mcpServers: [],
  skillsPath: '',
  globalRulesPath: '',
  terminalShell: '',
  subAgentEnabled: true,
  subAgentDefaultMode: 'build',
  subAgentMaxIterations: 20,
  subAgentAutoApprove: false,
  subAgentMaxConcurrent: 2,
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localDataDirectory(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hyscode');
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, 'hyscode');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'hyscode');
  return path.join(os.homedir(), '.local', 'share', 'hyscode');
}

export function defaultSharedSettingsPath(): string {
  return path.join(localDataDirectory(), 'settings.json');
}

export function defaultKeychainPath(): string {
  return path.join(localDataDirectory(), 'keychain.json');
}

function normalizeSettings(raw: unknown): SharedTuiSettings {
  if (!isObject(raw)) return { ...DEFAULT_SETTINGS };
  const custom = isObject(raw.customApprovalRules) ? raw.customApprovalRules : {};
  const mcpServers = Array.isArray(raw.mcpServers)
    ? raw.mcpServers.filter((server): server is McpServerConfig & JsonObject => isObject(server)).map((server) => ({
        id: String(server.id ?? ''),
        name: String(server.name ?? server.id ?? 'MCP server'),
        transport: (server.transport === 'sse' || server.transport === 'websocket' ? server.transport : 'stdio') as McpServerConfig['transport'],
        ...(typeof server.command === 'string' ? { command: server.command } : {}),
        ...(Array.isArray(server.args) ? { args: server.args.map(String) } : {}),
        ...(isStringRecord(server.env) ? { env: server.env } : {}),
        ...(typeof server.url === 'string' ? { url: server.url } : {}),
        ...(isStringRecord(server.headers) ? { headers: server.headers } : {}),
        ...(typeof server.wsUrl === 'string' ? { wsUrl: server.wsUrl } : {}),
        capabilities: normalizeCapabilities(server.capabilities),
        autoConnect: server.autoConnect !== false && server.enabled !== false,
        enabled: server.enabled !== false,
        agentSafe: server.agentSafe === true,
      }))
    : [];
  const agentType = isAgentType(raw.agentType) ? raw.agentType : DEFAULT_SETTINGS.agentType;
  const approvalMode = isApprovalMode(raw.approvalMode)
    ? raw.approvalMode
    : DEFAULT_SETTINGS.approvalMode;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    themeId: typeof raw.themeId === 'string' && raw.themeId.trim() ? raw.themeId : DEFAULT_SETTINGS.themeId,
    sidebarVisible: raw.sidebarVisible !== false,
    activeProviderId: typeof raw.activeProviderId === 'string' ? raw.activeProviderId : null,
    activeModelId: typeof raw.activeModelId === 'string' ? raw.activeModelId : null,
    agentType,
    approvalMode,
    customApprovalRules: {
      categoryRules: isObject(custom.categoryRules) ? (custom.categoryRules as CustomApprovalRules['categoryRules']) : {},
      toolRules: isObject(custom.toolRules) ? (custom.toolRules as Record<string, boolean>) : {},
    },
    interactionLimitEnabled: raw.interactionLimitEnabled === true,
    maxIterations: numberOrDefault(raw.maxIterations, DEFAULT_SETTINGS.maxIterations),
    temperature: numberOrDefault(raw.temperature, DEFAULT_SETTINGS.temperature),
    maxTokens: numberOrDefault(raw.maxTokens, DEFAULT_SETTINGS.maxTokens),
    topP: typeof raw.topP === 'number' ? raw.topP : null,
    agentMaxRetries: numberOrDefault(raw.agentMaxRetries, DEFAULT_SETTINGS.agentMaxRetries),
    agentRetryBaseDelayMs: numberOrDefault(raw.agentRetryBaseDelayMs, DEFAULT_SETTINGS.agentRetryBaseDelayMs),
    agentRetryMaxDelayMs: numberOrDefault(raw.agentRetryMaxDelayMs, DEFAULT_SETTINGS.agentRetryMaxDelayMs),
    agentRequestTimeoutMs: numberOrDefault(raw.agentRequestTimeoutMs, DEFAULT_SETTINGS.agentRequestTimeoutMs),
    agentStreamIdleTimeoutMs: numberOrDefault(raw.agentStreamIdleTimeoutMs, DEFAULT_SETTINGS.agentStreamIdleTimeoutMs),
    thinkingSettings: isObject(raw.thinkingSettings)
      ? (raw.thinkingSettings as Record<string, Record<string, unknown>>)
      : {},
    mcpServers,
    skillsPath: typeof raw.skillsPath === 'string' ? raw.skillsPath : '',
    globalRulesPath: typeof raw.globalRulesPath === 'string' ? raw.globalRulesPath : '',
    terminalShell: typeof raw.terminalShell === 'string' ? raw.terminalShell : '',
    subAgentEnabled: raw.subAgentEnabled !== false,
    subAgentDefaultMode: isAgentType(raw.subAgentDefaultMode) && raw.subAgentDefaultMode !== 'chat'
      ? raw.subAgentDefaultMode
      : DEFAULT_SETTINGS.subAgentDefaultMode,
    subAgentMaxIterations: numberOrDefault(raw.subAgentMaxIterations, DEFAULT_SETTINGS.subAgentMaxIterations),
    subAgentAutoApprove: raw.subAgentAutoApprove === true,
    subAgentMaxConcurrent: numberOrDefault(raw.subAgentMaxConcurrent, DEFAULT_SETTINGS.subAgentMaxConcurrent),
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function normalizeCapabilities(value: unknown): McpServerConfig['capabilities'] {
  if (!isObject(value)) {
    return { allowedTools: '*', allowedResources: '*', maxConcurrentCalls: 4, timeoutMs: 30000 };
  }
  const allowedTools = value.allowedTools === '*' || Array.isArray(value.allowedTools)
    ? value.allowedTools === '*' ? '*' : value.allowedTools.map(String)
    : '*';
  const allowedResources = value.allowedResources === '*' || Array.isArray(value.allowedResources)
    ? value.allowedResources === '*' ? '*' : value.allowedResources.map(String)
    : '*';
  return {
    allowedTools,
    allowedResources,
    maxConcurrentCalls: Math.max(1, numberOrDefault(value.maxConcurrentCalls, 4)),
    timeoutMs: Math.max(1000, numberOrDefault(value.timeoutMs, 30000)),
  };
}

function isAgentType(value: unknown): value is AgentType {
  return value === 'chat' || value === 'build' || value === 'review' || value === 'debug' || value === 'plan';
}

function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === 'manual' || value === 'yolo' || value === 'smart' || value === 'notify' || value === 'session-trust' || value === 'custom';
}

export class SharedConfigStore {
  private readonly settingsPath: string;
  private settings: SharedTuiSettings = { ...DEFAULT_SETTINGS };

  constructor(settingsPath = process.env.HYSCODE_CONFIG_PATH || defaultSharedSettingsPath()) {
    this.settingsPath = path.resolve(settingsPath);
  }

  async load(): Promise<SharedTuiSettings> {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, 'utf8')) as unknown;
      this.settings = normalizeSettings(raw);
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.settings;
  }

  get current(): SharedTuiSettings {
    return this.settings;
  }

  async save(patch: Partial<SharedTuiSettings>): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.settingsPath);
  }

  get path(): string {
    return this.settingsPath;
  }
}

export class SharedKeyStore {
  private readonly keychainPath: string;
  private values = new Map<string, string>();

  constructor(keychainPath = process.env.HYSCODE_KEYCHAIN_PATH || defaultKeychainPath()) {
    this.keychainPath = path.resolve(keychainPath);
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.keychainPath, 'utf8')) as unknown;
      if (isObject(parsed)) {
        this.values = new Map(
          Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
      }
    } catch {
      this.values = new Map();
    }
  }

  async get(key: string): Promise<string | null> {
    const environmentKey = `HYSCODE_${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
    return process.env[environmentKey] ?? this.values.get(`hyscode:${key}`) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(`hyscode:${key}`, value);
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    this.values.delete(`hyscode:${key}`);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.keychainPath), { recursive: true });
    const temporaryPath = `${this.keychainPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(this.values), null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.keychainPath);
  }
}

export function buildApprovalConfig(settings: SharedTuiSettings) {
  if (settings.approvalMode !== 'custom') return { mode: settings.approvalMode } as const;
  return {
    mode: settings.approvalMode,
    categoryOverrides: Object.fromEntries(
      Object.entries(settings.customApprovalRules.categoryRules).map(([category, autoApprove]) => [category, !autoApprove]),
    ),
    toolOverrides: Object.fromEntries(
      Object.entries(settings.customApprovalRules.toolRules).map(([tool, autoApprove]) => [tool, !autoApprove]),
    ),
  } as const;
}

export function buildThinkingConfig(settings: SharedTuiSettings, providerId: string, modelId: string) {
  const raw = settings.thinkingSettings[`${providerId}::${modelId}`];
  if (!raw) return undefined;
  return {
    enabled: raw.enabled === true,
    ...(typeof raw.level === 'string' ? { level: raw.level as never } : {}),
    ...(typeof raw.mode === 'string' ? { mode: raw.mode as never } : {}),
    ...(typeof raw.budgetTokens === 'number' ? { budgetTokens: raw.budgetTokens } : {}),
    ...(typeof raw.type === 'string' ? { type: raw.type as never } : {}),
    ...(typeof raw.display === 'string' ? { display: raw.display as never } : {}),
  };
}
