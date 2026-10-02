// ─── Model Details ──────────────────────────────────────────────────────────
// Automatic metadata lookup for model tooltips: pricing, context window, vision
// and thinking capabilities.
//
// Resolution order for the runtime `AIModel`:
//   1. Provider registry (live instance — includes models discovered at runtime
//      from the Ollama daemon / Zen / Go gateways)
//   2. Canonical catalog (static, works before/without API keys — same source
//      that feeds the desktop picker)
//   3. null → callers degrade gracefully instead of guessing values.

import { getProviderCatalog, getProviderRegistry } from '@hyscode/ai-providers';
import type { AIModel } from '@hyscode/ai-providers';
import { getModelProfile } from '@hyscode/agent-harness';
import { resolveContextWindow } from './context-window';
import { PROVIDERS } from './provider-catalog';
import type { ModelInfo } from './provider-catalog';

export interface ModelDetails {
  providerName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
  cachedInputPricePerMToken: number | null;
  supportsVision: boolean | null;
  thinkingLabel: string | null;
  thinkingDefault: string | null;
}

function findRuntimeModel(providerId: string, modelId: string): AIModel | null {
  const registered = getProviderRegistry()
    .get(providerId)
    ?.models.find((m) => m.id === modelId);
  if (registered) {
    return registered;
  }
  return (
    getProviderCatalog()
      .find((p) => p.id === providerId)
      ?.models.find((m) => m.id === modelId) ?? null
  );
}

function resolveThinking(
  aiModel: AIModel | null,
  catalogModel: ModelInfo | undefined,
): { label: string | null; defaultLevel: string | null } {
  const variants = aiModel?.thinkingVariants;
  if (variants && variants.kind !== 'none') {
    const label = variants.levels?.length
      ? variants.levels.join(' · ')
      : variants.modes?.length
        ? variants.modes.join(' · ')
        : 'Enabled';
    return { label, defaultLevel: variants.defaultLevel ?? variants.defaultMode ?? null };
  }
  if (catalogModel?.supportsThinking) {
    const label = catalogModel.thinkingLevels?.length
      ? catalogModel.thinkingLevels.join(' · ')
      : catalogModel.thinkingModes?.length
        ? catalogModel.thinkingModes.join(' · ')
        : 'Enabled';
    return { label, defaultLevel: null };
  }
  // A resolved model or catalog entry without thinking info means the provider
  // declared the model as non-thinking. Unknown (custom) models stay null.
  if (aiModel || catalogModel) {
    return { label: 'No', defaultLevel: null };
  }
  return { label: null, defaultLevel: null };
}

export function getModelDetails(providerId: string, modelId: string): ModelDetails {
  const aiModel = findRuntimeModel(providerId, modelId);
  const catalogProvider = PROVIDERS.find((p) => p.id === providerId);
  const catalogModel = catalogProvider?.models.find((m) => m.id === modelId);
  const thinking = resolveThinking(aiModel, catalogModel);

  return {
    providerName: catalogProvider?.name ?? providerId,
    contextWindow: resolveContextWindow(aiModel, modelId),
    maxOutputTokens:
      aiModel?.maxOutputTokens ?? getModelProfile(modelId)?.recommendedMaxOutput ?? null,
    inputPricePerMToken: aiModel?.inputPricePerMToken ?? null,
    outputPricePerMToken: aiModel?.outputPricePerMToken ?? null,
    cachedInputPricePerMToken: aiModel?.cachedInputPricePerMToken ?? null,
    supportsVision: aiModel?.supportsVision ?? null,
    thinkingLabel: thinking.label,
    thinkingDefault: thinking.defaultLevel,
  };
}

/** 200_000 → "200k", 1_000_000 → "1M", 1_500_000 → "1.5M", 999 → "999". */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    const millions = (count / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${millions}M`;
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}k`;
  }
  return `${count}`;
}

/** 3 → "$3.00", 0.15 → "$0.15". */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
