import { tauriInvokeRaw } from './tauri-invoke';
import { useSettingsStore } from '@/stores/settings-store';

type SharedSettingsPayload = {
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

let writeQueue: Promise<void> = Promise.resolve();

function sharedSettingsPath(homePath: string): string {
  if (navigator.userAgent.includes('Windows')) return `${homePath}/AppData/Local/hyscode/settings.json`;
  if (navigator.userAgent.includes('Mac')) return `${homePath}/Library/Application Support/hyscode/settings.json`;
  return `${homePath}/.local/share/hyscode/settings.json`;
}

function buildPayload(): SharedSettingsPayload {
  const settings = useSettingsStore.getState();
  return {
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
  await tauriInvokeRaw('write_file', {
    path: sharedSettingsPath(homePath),
    content: `${JSON.stringify(buildPayload(), null, 2)}\n`,
  });
}

function enqueueWrite(): void {
  writeQueue = writeQueue.then(() => writeSharedSettings()).catch((error: unknown) => {
    console.warn('[shared-config] Failed to sync shared settings:', error);
  });
}

export function startSharedConfigSync(): () => void {
  enqueueWrite();
  return useSettingsStore.subscribe(() => enqueueWrite());
}
