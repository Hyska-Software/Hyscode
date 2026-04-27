// ─── Provider Initialization ─────────────────────────────────────────────────
// Initializes the ProviderRegistry singleton with API keys from the Tauri keychain.
// Must be called once at app startup before any agent messages are sent.

import { getProviderRegistry } from '@hyscode/ai-providers';
import { tauriKeyStore } from './tauri-key-store';
import { createTauriFetch } from './tauri-ai-transport';
import { createClaudeAgentInvoke } from './tauri-claude-agent-transport';
import { tauriInvoke } from './tauri-invoke';

let _initialized = false;
let _tauriFetch: ReturnType<typeof createTauriFetch> | null = null;
let _claudeAgentInvoke: ReturnType<typeof createClaudeAgentInvoke> | null = null;

function getTauriFetch() {
  if (!_tauriFetch) {
    _tauriFetch = createTauriFetch();
  }
  return _tauriFetch;
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
  await registry.reinitializeProvider(providerId, tauriKeyStore, undefined, getTauriFetch(), getClaudeAgentInvoke());
}
