// ─── Provider Initialization ─────────────────────────────────────────────────
// Initializes the ProviderRegistry singleton with API keys from the Tauri keychain.
// Must be called once at app startup before any agent messages are sent.

import { getProviderRegistry } from '@hyscode/ai-providers';
import { tauriKeyStore } from './tauri-key-store';
import { createTauriFetch } from './tauri-ai-transport';
import { createClaudeAgentInvoke } from './tauri-claude-agent-transport';
import { tauriInvoke } from './tauri-invoke';
import type { ResilienceConfig } from '@hyscode/ai-providers';

let _initialized = false;
let _tauriFetch: ReturnType<typeof createTauriFetch> | null = null;
let _claudeAgentInvoke: ReturnType<typeof createClaudeAgentInvoke> | null = null;

function getTauriFetch() {
  if (!_tauriFetch) {
    _tauriFetch = createTauriFetch();
  }
  return _tauriFetch;
}

export function configureProviderResilience(config: ResilienceConfig): void {
  const normalized: ResilienceConfig = {
    maxRetries: Math.min(10, Math.max(0, Math.trunc(config.maxRetries))),
    baseDelayMs: Math.min(30_000, Math.max(100, config.baseDelayMs)),
    maxDelayMs: Math.min(120_000, Math.max(1_000, config.maxDelayMs)),
    requestTimeoutMs: Math.min(600_000, Math.max(10_000, config.requestTimeoutMs)),
    streamIdleTimeoutMs: Math.min(600_000, Math.max(10_000, config.streamIdleTimeoutMs)),
  };
  normalized.baseDelayMs = Math.min(normalized.baseDelayMs, normalized.maxDelayMs);
  getProviderRegistry().setRetryConfig({
    maxRetries: normalized.maxRetries,
    baseDelayMs: normalized.baseDelayMs,
    maxDelayMs: normalized.maxDelayMs,
  });
  _tauriFetch = createTauriFetch(normalized);
}

function getClaudeAgentInvoke() {
  if (!_claudeAgentInvoke) {
    _claudeAgentInvoke = createClaudeAgentInvoke();
  }
  return _claudeAgentInvoke;
}

async function refreshCopilotToken(): Promise<void> {
  try {
    const authed = await tauriInvoke('github_copilot_is_authenticated', {});
    if (!authed) return;
    // Refresh short-lived token from stored long-lived OAuth access token
    await tauriInvoke('github_copilot_ensure_token', {});
  } catch (err) {
    // Silently ignore — if token is revoked or network is down,
    // user will re-auth from the AI & Providers tab.
    console.warn('[init-providers] Copilot token refresh failed:', err);
  }
}

export async function initProviders(): Promise<void> {
  if (_initialized) return;

  // Refresh GitHub Copilot token before registry init so the keychain
  // holds a valid short-lived token when registry.initialize reads it.
  await refreshCopilotToken();

  const registry = getProviderRegistry();
  await registry.initialize(tauriKeyStore, undefined, getTauriFetch(), getClaudeAgentInvoke());
  _initialized = true;
}

export async function reinitProvider(providerId: string): Promise<void> {
  const registry = getProviderRegistry();
  await registry.reinitializeProvider(
    providerId,
    tauriKeyStore,
    undefined,
    getTauriFetch(),
    getClaudeAgentInvoke(),
  );
}
