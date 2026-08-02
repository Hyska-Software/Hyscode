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

import { SETTINGS_DEFAULTS } from './settings-store-defaults';
import { migrateSettingsState, useSettingsStore } from './settings-store';

describe('agent interaction limit settings', () => {
  it('starts disabled for new installations', () => {
    expect(SETTINGS_DEFAULTS.interactionLimitEnabled).toBe(false);
    expect(SETTINGS_DEFAULTS.maxIterations).toBe(25);
  });

  it('defaults sub-agent concurrency to two parallel runs', () => {
    expect(SETTINGS_DEFAULTS.subAgentMaxConcurrent).toBe(2);
  });

  it('keeps thinking blocks expanded by default', () => {
    expect(SETTINGS_DEFAULTS.thinkingCollapsedByDefault).toBe(false);
  });

  it('disables the limit when migrating legacy persisted settings', () => {
    const migrated = migrateSettingsState({ maxIterations: 75 }, 0) as Record<string, unknown>;

    expect(migrated.maxIterations).toBe(75);
    expect(migrated.interactionLimitEnabled).toBe(false);
  });

  it('preserves the explicit setting after the migration version', () => {
    const migrated = migrateSettingsState(
      { interactionLimitEnabled: true, maxIterations: 40 },
      1,
    ) as Record<string, unknown>;

    expect(migrated.interactionLimitEnabled).toBe(true);
    expect(migrated.maxIterations).toBe(40);
  });

  it('defaults existing MCP servers to parent-only access', () => {
    const migrated = migrateSettingsState(
      { mcpServers: [{ id: 'server', name: 'Server', enabled: true }] },
      2,
    ) as { mcpServers: Array<{ agentSafe: boolean }> };

    expect(migrated.mcpServers[0].agentSafe).toBe(false);
  });

  it('clears persisted Claude Agent selections when the provider is disabled', () => {
    const migrated = migrateSettingsState(
      {
        activeProviderId: 'claude-agent',
        activeModelId: 'claude-sonnet-5',
        inlineCompletionProviderId: 'claude-agent',
        inlineCompletionModelId: 'claude-opus-5',
        enabledModels: { 'claude-agent': ['claude-sonnet-5'], openai: ['gpt-5.5'] },
        customModels: [{ providerId: 'claude-agent', modelId: 'my-model', name: 'My Model' }],
        thinkingSettings: {
          'claude-agent::claude-sonnet-5': { enabled: true },
          'openai::gpt-5.5': { enabled: false },
        },
      },
      3,
    ) as Record<string, any>;

    expect(migrated.activeProviderId).toBeNull();
    expect(migrated.activeModelId).toBeNull();
    expect(migrated.inlineCompletionProviderId).toBeNull();
    expect(migrated.inlineCompletionModelId).toBeNull();
    expect(migrated.enabledModels['claude-agent']).toBeUndefined();
    expect(migrated.enabledModels.openai).toEqual(['gpt-5.5']);
    expect(migrated.customModels).toEqual([]);
    expect(migrated.thinkingSettings['claude-agent::claude-sonnet-5']).toBeUndefined();
    expect(migrated.thinkingSettings['openai::gpt-5.5']).toEqual({ enabled: false });
  });

  it('keeps other active providers when migrating', () => {
    const migrated = migrateSettingsState(
      { activeProviderId: 'openai', activeModelId: 'gpt-5.5' },
      3,
    ) as Record<string, unknown>;

    expect(migrated.activeProviderId).toBe('openai');
    expect(migrated.activeModelId).toBe('gpt-5.5');
  });
});

describe('activity bar settings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      sidebarViewOrder: [...SETTINGS_DEFAULTS.sidebarViewOrder],
      visibleSidebarTabs: { ...SETTINGS_DEFAULTS.visibleSidebarTabs },
      visibleExtensionViews: {},
    });
  });

  it('prevents every settings surface from hiding the final available view', () => {
    useSettingsStore.setState({
      sidebarViewOrder: ['files', 'todo.panel'],
      visibleSidebarTabs: {
        ...SETTINGS_DEFAULTS.visibleSidebarTabs,
        search: false,
        git: false,
        skills: false,
        extensions: false,
        agent: false,
        memories: false,
        devices: false,
        docker: false,
      },
      visibleExtensionViews: { 'todo.panel': false },
    });

    const changed = useSettingsStore
      .getState()
      .setSidebarViewVisible('files', false, ['files', 'todo.panel']);

    expect(changed).toBe(false);
    expect(useSettingsStore.getState().visibleSidebarTabs.files).toBe(true);
  });

  it('allows cross-kind visibility changes while another view remains visible', () => {
    const hidden = useSettingsStore
      .getState()
      .setSidebarViewVisible('files', false, ['files', 'todo.panel']);

    expect(hidden).toBe(true);
    expect(useSettingsStore.getState().visibleSidebarTabs.files).toBe(false);
    expect(useSettingsStore.getState().visibleExtensionViews['todo.panel']).not.toBe(false);
  });

  it('restores default order and clears extension visibility overrides', () => {
    useSettingsStore.setState({
      sidebarViewOrder: ['todo.panel', 'git', 'files'],
      visibleSidebarTabs: {
        ...SETTINGS_DEFAULTS.visibleSidebarTabs,
        files: false,
      },
      visibleExtensionViews: {
        'todo.panel': false,
        'unavailable.panel': false,
      },
    });

    useSettingsStore.getState().resetSidebarViews(['files', 'git', 'todo.panel']);

    expect(useSettingsStore.getState().sidebarViewOrder).toEqual([
      ...SETTINGS_DEFAULTS.sidebarViewOrder,
      'todo.panel',
    ]);
    expect(useSettingsStore.getState().visibleSidebarTabs.files).toBe(true);
    expect(useSettingsStore.getState().visibleExtensionViews).toEqual({});
  });
});
