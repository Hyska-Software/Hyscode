import { tauriInvokeRaw } from './tauri-invoke';
import { useSettingsStore, type ModelThinkingConfig, type ThemeId } from '@/stores/settings-store';

type SharedSettingsPayload = {
  themeId: ThemeId;
  activeProviderId: string | null;
  activeModelId: string | null;
  agentType: string;
  approvalMode: string;
  customApprovalRules: unknown;
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
  thinkingSettings: Record<string, unknown>;
  mcpServers: unknown[];
  skillsPath: string;
  globalRulesPath: string;
  terminalShell: string;
  subAgentEnabled: boolean;
  subAgentDefaultMode: string;
  subAgentMaxIterations: number;
  subAgentAutoApprove: boolean;
  subAgentMaxConcurrent: number;
};

type SharedSettingsImport = {
  themeId?: ThemeId;
  activeProviderId: string | null;
  activeModelId: string | null;
  thinkingSettings: Record<string, ModelThinkingConfig>;
};

type PreservedTuiSettings = {
  sidebarVisible?: boolean;
};

let writeQueue: Promise<void> = Promise.resolve();

function sharedSettingsPath(homePath: string): string {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (userAgent.includes('Windows')) return `${homePath}/AppData/Local/hyscode/settings.json`;
  if (userAgent.includes('Mac')) return `${homePath}/Library/Application Support/hyscode/settings.json`;
  return `${homePath}/.local/share/hyscode/settings.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: unknown): value is NonNullable<ModelThinkingConfig['level']> {
  return value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'enabled'
    || value === 'disabled'
    || value === 'none'
    || value === 'minimal'
    || value === 'xhigh'
    || value === 'max'
    || value === 'adaptive'
    || value === 'default';
}

function parseThinkingConfig(value: unknown): ModelThinkingConfig | null {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') return null;
  const config: ModelThinkingConfig = { enabled: value.enabled };
  if (isThinkingLevel(value.level)) config.level = value.level;
  if (value.mode === 'standard' || value.mode === 'pro') config.mode = value.mode;
  if (typeof value.budgetTokens === 'number' && Number.isFinite(value.budgetTokens) && value.budgetTokens > 0) {
    config.budgetTokens = Math.floor(value.budgetTokens);
  }
  if (value.type === 'enabled' || value.type === 'adaptive' || value.type === 'disabled') config.type = value.type;
  if (value.display === 'summarized' || value.display === 'omitted') config.display = value.display;
  return config;
}

function parseSharedSettings(value: unknown): SharedSettingsImport | null {
  if (!isRecord(value)) return null;
  if (!((typeof value.activeProviderId === 'string' || value.activeProviderId === null)
    && (typeof value.activeModelId === 'string' || value.activeModelId === null))) {
    return null;
  }
  const thinkingSettings: Record<string, ModelThinkingConfig> = {};
  if (isRecord(value.thinkingSettings)) {
    for (const [key, config] of Object.entries(value.thinkingSettings)) {
      const parsed = parseThinkingConfig(config);
      if (parsed) thinkingSettings[key] = parsed;
    }
  }
  return {
    ...(typeof value.themeId === 'string' && value.themeId.trim() ? { themeId: value.themeId as ThemeId } : {}),
    activeProviderId: value.activeProviderId,
    activeModelId: value.activeModelId,
    thinkingSettings,
  };
}

function buildPayload(): SharedSettingsPayload {
  const settings = useSettingsStore.getState();
  return {
    themeId: settings.themeId,
    activeProviderId: settings.activeProviderId,
    activeModelId: settings.activeModelId,
    agentType: settings.agentType,
    approvalMode: settings.approvalMode,
    customApprovalRules: settings.customApprovalRules,
    interactionLimitEnabled: settings.interactionLimitEnabled,
    maxIterations: settings.maxIterations,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    topP: settings.topP,
    agentMaxRetries: settings.agentMaxRetries,
    agentRetryBaseDelayMs: settings.agentRetryBaseDelayMs,
    agentRetryMaxDelayMs: settings.agentRetryMaxDelayMs,
    agentRequestTimeoutMs: settings.agentRequestTimeoutMs,
    agentStreamIdleTimeoutMs: settings.agentStreamIdleTimeoutMs,
    thinkingSettings: settings.thinkingSettings,
    mcpServers: settings.mcpServers,
    skillsPath: settings.skillsPath,
    globalRulesPath: settings.globalRulesPath,
    terminalShell: settings.terminalShell,
    subAgentEnabled: settings.subAgentEnabled,
    subAgentDefaultMode: settings.subAgentDefaultMode,
    subAgentMaxIterations: settings.subAgentMaxIterations,
    subAgentAutoApprove: settings.subAgentAutoApprove,
    subAgentMaxConcurrent: settings.subAgentMaxConcurrent,
  };
}

async function writeSharedSettings(): Promise<void> {
  const homePath = await tauriInvokeRaw<string>('get_home_dir', {});
  const preservedTuiSettings = await readPreservedTuiSettings(homePath);
  await tauriInvokeRaw('write_file', {
    path: sharedSettingsPath(homePath),
    content: `${JSON.stringify({ ...buildPayload(), ...preservedTuiSettings }, null, 2)}\n`,
  });
}

async function readPreservedTuiSettings(homePath: string): Promise<PreservedTuiSettings> {
  try {
    const content = await tauriInvokeRaw<string>('read_file', {
      path: sharedSettingsPath(homePath),
    });
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) && typeof parsed.sidebarVisible === 'boolean'
      ? { sidebarVisible: parsed.sidebarVisible }
      : {};
  } catch {
    return {};
  }
}

export async function hydrateSharedSettings(): Promise<boolean> {
  try {
    const homePath = await tauriInvokeRaw<string>('get_home_dir', {});
    const content = await tauriInvokeRaw<string>('read_file', {
      path: sharedSettingsPath(homePath),
    });
    const imported = parseSharedSettings(JSON.parse(content) as unknown);
    if (!imported) return false;
    const current = useSettingsStore.getState();
    useSettingsStore.setState({
      ...(imported.themeId ? { themeId: imported.themeId } : {}),
      activeProviderId: imported.activeProviderId,
      activeModelId: imported.activeModelId,
      thinkingSettings: {
        ...current.thinkingSettings,
        ...imported.thinkingSettings,
      },
    });
    return true;
  } catch {
    return false;
  }
}

function enqueueWrite(): void {
  writeQueue = writeQueue.then(() => writeSharedSettings()).catch((error: unknown) => {
    console.warn('[shared-config] Failed to sync shared settings:', error);
  });
}

export function startSharedConfigSync(): () => void {
  let active = true;
  let hydrated = false;
  const unsubscribe = useSettingsStore.subscribe(() => {
    if (hydrated) enqueueWrite();
  });
  void hydrateSharedSettings().finally(() => {
    hydrated = true;
    if (active) enqueueWrite();
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
