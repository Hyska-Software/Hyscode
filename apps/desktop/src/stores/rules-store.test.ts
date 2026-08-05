import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

import type { Rule } from '@hyscode/agent-harness';
import { useRulesStore } from './rules-store';

const managedRule: Rule = {
  id: 'workspace:managed',
  name: 'managed',
  filePath: 'C:/workspace/.hyscode/rules/managed.md',
  scope: 'workspace',
  origin: 'managed',
  mandatory: false,
  content: 'Managed content',
  enabled: true,
};

const nativeRule: Rule = {
  id: 'native:c:/workspace/agents.md',
  name: 'AGENTS.md',
  filePath: 'C:/workspace/AGENTS.md',
  scope: 'workspace',
  origin: 'native',
  mandatory: true,
  appliesFrom: 'C:/workspace',
  content: 'Native content',
  enabled: true,
};

describe('rules store native project instructions', () => {
  beforeEach(() => {
    useRulesStore.setState({
      rules: [],
      loading: false,
      enabledMap: {},
      ruleEditorOpen: false,
      ruleEditorScope: 'global',
      ruleEditorExistingId: null,
    });
  });

  it('ignores persisted disabled preferences for mandatory native rules', () => {
    useRulesStore.setState({
      enabledMap: {
        [nativeRule.id]: false,
        [managedRule.id]: false,
      },
    });

    useRulesStore.getState().setDiscoveredRules([nativeRule, managedRule]);

    expect(useRulesStore.getState().rules).toEqual([
      expect.objectContaining({ id: nativeRule.id, enabled: true, mandatory: true, origin: 'native' }),
      expect.objectContaining({ id: managedRule.id, enabled: false, mandatory: false, origin: 'managed' }),
    ]);
    expect(useRulesStore.getState().enabledMap[nativeRule.id]).toBeUndefined();
  });

  it('does not toggle, disable, or remove native instructions', () => {
    useRulesStore.getState().setDiscoveredRules([nativeRule]);

    useRulesStore.getState().toggleRule(nativeRule.id);
    useRulesStore.getState().setRuleEnabled(nativeRule.id, false);
    useRulesStore.getState().removeRule(nativeRule.id);

    expect(useRulesStore.getState().rules).toEqual([
      expect.objectContaining({ id: nativeRule.id, enabled: true }),
    ]);
    expect(useRulesStore.getState().getActiveRules()).toHaveLength(1);
  });
});
