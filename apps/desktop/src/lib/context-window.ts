// ─── Context Window Resolver ────────────────────────────────────────────────
// Single source of truth for resolving the active model's context window.
// Returns null (not a hardcoded fallback) when the model is unknown, so the
// UI can surface "unknown" instead of misleading percentages.

import type { AIModel } from '@hyscode/ai-providers';
import { getModelProfile } from '@hyscode/agent-harness';

export const MIN_KNOWN_CONTEXT_WINDOW = 8_000;

let hasWarnedForModelId: string | null = null;

/**
 * Resolve the context window for a model. Resolution order:
 * 1. `model.contextWindow` if it's a positive number
 * 2. `mode-policies.ts` `ModelProfile.maxContext` for the model id (fallback
 *    when the model registry doesn't carry a `contextWindow` value)
 * 3. `null` (unknown) — the caller should render an "unknown" state instead
 *    of a hardcoded 200_000 that would mislead the user.
 */
export function resolveContextWindow(
  model: AIModel | null,
  modelId?: string,
): number | null {
  if (model && Number.isFinite(model.contextWindow) && model.contextWindow > 0) {
    return model.contextWindow;
  }

  if (modelId) {
    const profile = getModelProfile(modelId);
    if (profile && profile.maxContext > 0) {
      return profile.maxContext;
    }
  }

  if (model?.id && hasWarnedForModelId !== model.id) {
    hasWarnedForModelId = model.id;
    console.warn(
      `[context-window] No context window known for model "${model.id}". UI will display "unknown" instead of a misleading percentage.`,
    );
  }
  return null;
}
