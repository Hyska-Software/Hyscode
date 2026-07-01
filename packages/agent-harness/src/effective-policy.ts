import type { ApprovalConfig, ApprovalMode, AgentType, HarnessConfig } from './types';
import { adjustPolicyForModel, getModePolicy, type ModePolicy } from './mode-policies';

export type EffectiveAgentPolicy = ModePolicy & {
  approval: ApprovalConfig;
};

export type EffectivePolicyPreferences = {
  approvalMode?: ApprovalMode;
  customApproval?: Omit<ApprovalConfig, 'mode'>;
  maxIterations?: number;
  maxOutputTokens?: number;
};

/** Resolve one authoritative policy for a turn. Explicit user preferences win. */
export function resolveEffectiveAgentPolicy(
  mode: AgentType,
  modelId: string,
  providerId: string,
  preferences: EffectivePolicyPreferences = {},
): EffectiveAgentPolicy {
  const modelPolicy = adjustPolicyForModel(getModePolicy(mode), modelId, providerId);
  const approvalMode = preferences.approvalMode ?? modelPolicy.approvalMode;
  const approval: ApprovalConfig = {
    mode: approvalMode,
    ...(approvalMode === 'custom' ? preferences.customApproval : {}),
  };

  return {
    ...modelPolicy,
    maxIterations: preferences.maxIterations ?? modelPolicy.maxIterations,
    maxOutputTokens: preferences.maxOutputTokens ?? modelPolicy.maxOutputTokens,
    approval,
  };
}

export function effectivePolicyConfig(policy: EffectiveAgentPolicy): Partial<HarnessConfig> {
  return {
    maxIterations: policy.maxIterations,
    maxInputTokens: policy.maxInputTokens,
    maxOutputTokens: policy.maxOutputTokens,
    turnTimeoutMs: policy.turnTimeoutMs,
    approval: policy.approval,
  };
}
