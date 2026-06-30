// ─── Mode Policies ──────────────────────────────────────────────────────────
// Per-mode execution profiles that replace hardcoded values scattered across
// agent definitions and the default config. Policies centralize:
//   - Iteration limits
//   - Token budgets (input + output)
//   - Turn timeouts
//   - Approval mode defaults
//   - Verification requirements
//   - Tool category access
//   - Skill trigger suggestions
//
// The default policies are built-in. Users can override them via the database
// (mode_policies table) — the bridge loads overrides at startup.

import type { AgentType, ApprovalMode, ToolCategory } from './types';

// ─── Policy Type ────────────────────────────────────────────────────────────

export interface ModePolicy {
  mode: AgentType;
  /** Max LLM iterations per turn */
  maxIterations: number;
  /** Max input tokens per turn */
  maxInputTokens: number;
  /** Max output tokens per turn */
  maxOutputTokens: number;
  /** Turn timeout in ms */
  turnTimeoutMs: number;
  /** Default approval mode for this agent mode */
  approvalMode: ApprovalMode;
  /** Whether verification middleware is active for this mode */
  verificationRequired: boolean;
  /** Tool categories this mode can access */
  allowedToolCategories: ToolCategory[];
  /** Per-tool allow/deny overrides */
  toolOverrides?: { allow?: string[]; deny?: string[] };
  /** Skills to suggest activating when this mode starts */
  skillTriggers?: string[];
}

// ─── Default Policies ───────────────────────────────────────────────────────

const DEFAULT_POLICIES: Record<AgentType, ModePolicy> = {
  chat: {
    mode: 'chat',
    maxIterations: 10,
    maxInputTokens: 128_000,
    maxOutputTokens: 8_000,
    turnTimeoutMs: 120_000, // 2 minutes
    approvalMode: 'smart',
    verificationRequired: false,
    allowedToolCategories: ['filesystem', 'git', 'browser', 'meta'],
    toolOverrides: {
      deny: [
        'write_file',
        'create_file',
        'edit_file',
        'replace_lines',
        'insert_lines',
        'delete_file',
        'rename_file',
        'copy_file',
        'run_terminal_command',
        'run_code',
        'git_commit',
        'git_add',
        'git_push',
        'git_pull',
        'git_checkout',
        'git_merge',
        'git_reset',
        'git_stash',
        'docker_run',
        'create_skill',
      ],
    },
  },
  build: {
    mode: 'build',
    maxIterations: 25,
    maxInputTokens: 200_000,
    maxOutputTokens: 16_000,
    turnTimeoutMs: 300_000, // 5 minutes
    approvalMode: 'smart',
    verificationRequired: true,
    allowedToolCategories: [
      'filesystem',
      'terminal',
      'git',
      'code',
      'browser',
      'mcp',
      'meta',
      'docker',
    ],
  },
  review: {
    mode: 'review',
    maxIterations: 15,
    maxInputTokens: 200_000,
    maxOutputTokens: 12_000,
    turnTimeoutMs: 180_000, // 3 minutes
    approvalMode: 'notify',
    verificationRequired: false,
    allowedToolCategories: ['filesystem', 'git', 'code', 'meta'],
    toolOverrides: {
      allow: ['request_mode_switch'],
      deny: [
        'write_file',
        'create_file',
        'edit_file',
        'replace_lines',
        'insert_lines',
        'delete_file',
        'rename_file',
        'copy_file',
        'run_terminal_command',
        'run_code',
        'git_commit',
        'git_add',
        'git_push',
        'git_pull',
        'git_checkout',
        'git_merge',
        'git_reset',
        'git_stash',
        'docker_run',
        'create_skill',
      ],
    },
  },
  debug: {
    mode: 'debug',
    maxIterations: 20,
    maxInputTokens: 200_000,
    maxOutputTokens: 16_000,
    turnTimeoutMs: 300_000, // 5 minutes
    approvalMode: 'session-trust',
    verificationRequired: true,
    allowedToolCategories: ['filesystem', 'terminal', 'git', 'code', 'mcp', 'meta', 'docker'],
  },
  plan: {
    mode: 'plan',
    maxIterations: 20,
    maxInputTokens: 200_000,
    maxOutputTokens: 12_000,
    turnTimeoutMs: 300_000, // 5 minutes — plans need more analysis time
    approvalMode: 'notify',
    verificationRequired: false,
    allowedToolCategories: ['filesystem', 'git', 'meta'],
    toolOverrides: {
      allow: ['write_file', 'create_file', 'request_mode_switch'],
      deny: [
        'edit_file',
        'replace_lines',
        'insert_lines',
        'delete_file',
        'rename_file',
        'copy_file',
        'run_terminal_command',
        'run_code',
        'git_commit',
        'git_add',
        'git_push',
        'git_pull',
        'git_checkout',
        'git_merge',
        'git_reset',
        'git_stash',
        'docker_run',
        'create_skill',
      ],
    },
  },
};

// ─── Policy Registry ────────────────────────────────────────────────────────

/** In-memory policy store. Starts with defaults, overlaid by DB overrides. */
const policyStore = new Map<AgentType, ModePolicy>(
  Object.entries(DEFAULT_POLICIES).map(([k, v]) => [k as AgentType, { ...v }]),
);

/** Get the effective policy for a mode. Falls back to 'build' if unknown. */
export function getModePolicy(mode: AgentType): ModePolicy {
  return policyStore.get(mode) ?? policyStore.get('build')!;
}

/** Get all policies. */
export function getAllModePolicies(): ModePolicy[] {
  return [...policyStore.values()];
}

/** Get the default (built-in) policy for a mode, ignoring overrides. */
export function getDefaultPolicy(mode: AgentType): ModePolicy {
  return DEFAULT_POLICIES[mode] ?? DEFAULT_POLICIES.build;
}

/**
 * Apply a partial override to a mode's policy.
 * Called by the bridge at startup with DB-loaded overrides.
 */
export function applyPolicyOverride(mode: AgentType, patch: Partial<ModePolicy>): void {
  const current = policyStore.get(mode) ?? {
    ...(DEFAULT_POLICIES[mode] ?? DEFAULT_POLICIES.build),
  };
  policyStore.set(mode, { ...current, ...patch, mode });
}

/**
 * Reset a mode's policy back to defaults.
 */
export function resetPolicy(mode: AgentType): void {
  const defaultPolicy = DEFAULT_POLICIES[mode];
  if (defaultPolicy) {
    policyStore.set(mode, { ...defaultPolicy });
  }
}

/**
 * Reset all policies to defaults.
 */
export function resetAllPolicies(): void {
  for (const [mode, policy] of Object.entries(DEFAULT_POLICIES)) {
    policyStore.set(mode as AgentType, { ...policy });
  }
}

// ─── Model-Specific Adjustments ─────────────────────────────────────────────
// Some models have known limitations that warrant budget adjustments.

export interface ModelProfile {
  /** Model name pattern (regex) */
  pattern: string;
  /** Max context window tokens */
  maxContext: number;
  /** Recommended max output tokens */
  recommendedMaxOutput: number;
  /** Whether this model supports tool calling natively */
  supportsToolCalling: boolean;
  /** Whether this model supports thinking/reasoning */
  supportsThinking: boolean;
}

const MODEL_PROFILES: ModelProfile[] = [
  {
    pattern: 'claude-sonnet-4-6',
    maxContext: 1_000_000,
    recommendedMaxOutput: 128_000,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'claude-3-5-sonnet|claude-3.5-sonnet|claude-sonnet-4$|claude-sonnet-4-5',
    maxContext: 200_000,
    recommendedMaxOutput: 64_000,
    supportsToolCalling: true,
    supportsThinking: false,
  },
  {
    pattern: 'claude-3-5-haiku|claude-3.5-haiku|claude-haiku-3.5|claude-haiku-4-5',
    maxContext: 200_000,
    recommendedMaxOutput: 64_000,
    supportsToolCalling: true,
    supportsThinking: false,
  },
  {
    pattern: 'claude-fable-5|claude-opus-4-8|claude-opus-4-7|claude-opus-4-6',
    maxContext: 1_000_000,
    recommendedMaxOutput: 128_000,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'claude-opus-4-5|claude-opus-4-1|claude-opus-4$',
    maxContext: 200_000,
    recommendedMaxOutput: 32_000,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'gpt-5\\.5',
    maxContext: 1_050_000,
    recommendedMaxOutput: 128_000,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'gpt-5\\.4',
    maxContext: 1_000_000,
    recommendedMaxOutput: 128_000,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'gpt-5\\.4-mini|gpt-5\\.4-nano|gpt-5-mini|raptor-mini',
    maxContext: 400_000,
    recommendedMaxOutput: 128_000,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'gpt-4o|gpt-4-turbo',
    maxContext: 128_000,
    recommendedMaxOutput: 16_384,
    supportsToolCalling: true,
    supportsThinking: false,
  },
  {
    pattern: 'gpt-4o-mini',
    maxContext: 128_000,
    recommendedMaxOutput: 8_000,
    supportsToolCalling: true,
    supportsThinking: false,
  },
  {
    pattern: 'o1-preview|o1-mini|o3|o4-mini',
    maxContext: 128_000,
    recommendedMaxOutput: 32_768,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'gemini-2\\.0|gemini-1\\.5-pro',
    maxContext: 1_000_000,
    recommendedMaxOutput: 8_192,
    supportsToolCalling: true,
    supportsThinking: false,
  },
  {
    pattern: 'gemini-2\\.5|gemini-3(?:\\.1|\\.5)?',
    maxContext: 1_048_576,
    recommendedMaxOutput: 65_536,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'kimi-k2\\.5|kimi-k2\\.6|kimi-k2\\.7-code',
    maxContext: 262_144,
    recommendedMaxOutput: 16_384,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'glm-5\\.1|glm-5',
    maxContext: 200_000,
    recommendedMaxOutput: 128_000,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'minimax-m2\\.7|minimax-m2\\.5',
    maxContext: 204_800,
    recommendedMaxOutput: 16_384,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'qwen3\\.6-plus|qwen3\\.5-plus',
    maxContext: 131_072,
    recommendedMaxOutput: 32_768,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'deepseek-v4-pro|deepseek-v4-flash',
    maxContext: 128_000,
    recommendedMaxOutput: 8_192,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'mimo-v2-pro|mimo-v2-omni|mimo-v2\\.5-pro|mimo-v2\\.5',
    maxContext: 128_000,
    recommendedMaxOutput: 8_192,
    supportsToolCalling: true,
    supportsThinking: true,
  },
  {
    pattern: 'deepseek-coder|deepseek-chat',
    maxContext: 64_000,
    recommendedMaxOutput: 8_000,
    supportsToolCalling: true,
    supportsThinking: false,
  },
  {
    pattern: 'deepseek-coder|deepseek-chat',
    maxContext: 64_000,
    recommendedMaxOutput: 8_000,
    supportsToolCalling: true,
    supportsThinking: false,
  },
  {
    pattern: 'llama|codellama|mixtral|mistral',
    maxContext: 32_000,
    recommendedMaxOutput: 4_096,
    supportsToolCalling: false,
    supportsThinking: false,
  },
];

// ─── Per-Request-Cost Provider Detection ────────────────────────────────────
// Providers that charge per API request (not just per token) need stricter
// iteration caps to avoid burning budget. GitHub Copilot uses a multiplier
// model where each request counts as 1× (or more) toward the user's quota.

/** Model ID prefixes known to be served via GitHub Copilot */
const COPILOT_MODEL_IDS = new Set([
  'gpt-5-mini',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'raptor-mini',
  'mai-code-1-flash',
  'claude-sonnet-4.5',
  'claude-sonnet-4.6',
  'claude-haiku-4.5',
  'claude-opus-4.5',
  'claude-opus-4.6',
  'claude-opus-4.7',
  'claude-opus-4.8',
  'claude-opus-4.8-fast',
  'gemini-2.5-pro',
  'gemini-3-flash',
  'gemini-3.1-pro',
  'gemini-3.5-flash',
]);

/** Check if a model ID belongs to a per-request-cost provider. */
export function isPerRequestCostModel(modelId: string, providerId = ''): boolean {
  const provider = providerId.toLowerCase();
  return provider.includes('copilot') && COPILOT_MODEL_IDS.has(modelId);
}

/** Iteration caps for per-request-cost providers (per mode). */
const PER_REQUEST_ITERATION_CAPS: Partial<Record<AgentType, number>> = {
  chat: 3,
  build: 8,
  review: 5,
  debug: 6,
  plan: 5,
};

/**
 * Get the model profile matching the given model ID.
 * Returns null if no profile matches.
 */
export function getModelProfile(modelId: string): ModelProfile | null {
  const lower = modelId.toLowerCase();
  for (const profile of MODEL_PROFILES) {
    if (new RegExp(profile.pattern, 'i').test(lower)) {
      return profile;
    }
  }
  return null;
}

/**
 * Adjust a policy's token budgets based on the model being used.
 * Returns a new policy with adjusted values (does not mutate the original).
 */
export function adjustPolicyForModel(
  policy: ModePolicy,
  modelId: string,
  providerId = '',
): ModePolicy {
  const profile = getModelProfile(modelId);
  let adjusted = profile
    ? {
        ...policy,
        maxInputTokens: Math.min(policy.maxInputTokens, profile.maxContext),
        maxOutputTokens: Math.min(policy.maxOutputTokens, profile.recommendedMaxOutput),
      }
    : { ...policy };

  // Per-request-cost providers (GitHub Copilot): reduce iterations while
  // preserving the mode/DB verification requirement.
  if (isPerRequestCostModel(modelId, providerId)) {
    const cap = PER_REQUEST_ITERATION_CAPS[policy.mode] ?? policy.maxIterations;
    adjusted = {
      ...adjusted,
      maxIterations: Math.min(adjusted.maxIterations, cap),
    };
  }

  return adjusted;
}
