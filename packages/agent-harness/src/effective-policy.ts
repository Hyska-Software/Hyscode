import type { ApprovalConfig, ApprovalMode, AgentType, HarnessConfig } from './types';
import {
  adjustPolicyForModel,
  getModePolicy,
  getPerRequestIterationCap,
  type ModePolicy,
} from './mode-policies';

export type EffectiveAgentPolicy = Omit<ModePolicy, 'maxIterations'> & {
  maxIterations: number | null;
  approval: ApprovalConfig;
};

export type EffectivePolicyPreferences = {
  approvalMode?: ApprovalMode;
  customApproval?: Omit<ApprovalConfig, 'mode'>;
  maxIterations?: number | null;
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
  const costCap = getPerRequestIterationCap(mode, modelId, providerId);
  const requestedLimit = preferences.maxIterations ?? null;
  const maxIterations =
    costCap === null
      ? requestedLimit
      : requestedLimit === null
        ? costCap
        : Math.min(requestedLimit, costCap);
  const approvalMode = preferences.approvalMode ?? modelPolicy.approvalMode;
  const approval: ApprovalConfig = {
    mode: approvalMode,
    ...(approvalMode === 'custom' ? preferences.customApproval : {}),
  };

  return {
    ...modelPolicy,
    maxIterations,
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
