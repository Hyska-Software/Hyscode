import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RIGHT_TAB_ORDER,
  DEFAULT_RIGHT_TAB_VISIBILITY,
  normalizeAgentRightTabPrefs,
  type AgentRightTabPrefs,
  type RightTab,
} from './layout-store';

describe('agent right tab preferences', () => {
  it('adds Context hidden by default for new and legacy preferences', () => {
    const defaults = normalizeAgentRightTabPrefs(undefined);
    expect(defaults.order).toEqual(DEFAULT_RIGHT_TAB_ORDER);
    expect(defaults.visible.context).toBe(false);

    const legacy = normalizeAgentRightTabPrefs({
      order: ['terminal', 'changes'],
      visible: {
        ...DEFAULT_RIGHT_TAB_VISIBILITY,
        terminal: true,
        changes: true,
      },
    } as AgentRightTabPrefs);

    expect(legacy.order).toEqual(['terminal', 'changes', 'context', 'files', 'preview']);
    expect(legacy.visible.context).toBe(false);
  });

  it('preserves an explicit Context order and visibility choice', () => {
    const prefs = normalizeAgentRightTabPrefs({
      order: ['context', 'files', 'changes', 'preview', 'terminal'],
      visible: { ...DEFAULT_RIGHT_TAB_VISIBILITY, context: true },
    });

    expect(prefs.order[0]).toBe('context');
    expect(prefs.visible.context).toBe(true);
    expect(prefs.order.every((tab) => DEFAULT_RIGHT_TAB_ORDER.includes(tab as RightTab))).toBe(true);
  });
});
