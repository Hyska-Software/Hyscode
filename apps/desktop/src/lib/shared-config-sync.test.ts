import { afterEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

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

vi.mock('./tauri-invoke', () => ({
  tauriInvokeRaw: (command: string, args?: Record<string, unknown>) => invokeMock(command, args),
}));

import { hydrateSharedSettings } from './shared-config-sync';
import { useSettingsStore } from '@/stores/settings-store';

afterEach(() => {
  invokeMock.mockReset();
  useSettingsStore.setState({
    activeProviderId: null,
    activeModelId: null,
    thinkingSettings: {},
    thinkingCollapsedByDefault: false,
  });
});

describe('shared desktop configuration import', () => {
  it('imports the persisted model and thinking state without touching desktop-only settings', async () => {
    useSettingsStore.setState({
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.5',
      thinkingSettings: { 'openai::gpt-5.5': { enabled: false } },
      thinkingCollapsedByDefault: true,
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_home_dir') return 'C:/Users/test';
      return JSON.stringify({
        activeProviderId: 'anthropic',
        activeModelId: 'claude-sonnet-4-6',
        thinkingSettings: {
          'anthropic::claude-sonnet-4-6': {
            enabled: true,
            level: 'high',
            mode: 'pro',
            budgetTokens: 4096.9,
            type: 'adaptive',
            display: 'summarized',
          },
        },
      });
    });

    await expect(hydrateSharedSettings()).resolves.toBe(true);

    const state = useSettingsStore.getState();
    expect(state.activeProviderId).toBe('anthropic');
    expect(state.activeModelId).toBe('claude-sonnet-4-6');
    expect(state.thinkingSettings['anthropic::claude-sonnet-4-6']).toEqual({
      enabled: true,
      level: 'high',
      mode: 'pro',
      budgetTokens: 4096,
      type: 'adaptive',
      display: 'summarized',
    });
    expect(state.thinkingCollapsedByDefault).toBe(true);
  });

  it('keeps the local desktop state when the shared file is missing or malformed', async () => {
    useSettingsStore.setState({
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.5',
      thinkingSettings: { 'openai::gpt-5.5': { enabled: true, level: 'medium' } },
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_home_dir') return 'C:/Users/test';
      return '{not-json';
    });

    await expect(hydrateSharedSettings()).resolves.toBe(false);

    const state = useSettingsStore.getState();
    expect(state.activeProviderId).toBe('openai');
    expect(state.activeModelId).toBe('gpt-5.5');
    expect(state.thinkingSettings['openai::gpt-5.5']).toEqual({ enabled: true, level: 'medium' });
  });

  it('keeps the local desktop state when the shared file cannot be read', async () => {
    useSettingsStore.setState({
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.5',
      thinkingSettings: { 'openai::gpt-5.5': { enabled: true, level: 'medium' } },
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_home_dir') return 'C:/Users/test';
      throw new Error('shared settings file does not exist');
    });

    await expect(hydrateSharedSettings()).resolves.toBe(false);

    const state = useSettingsStore.getState();
    expect(state.activeProviderId).toBe('openai');
    expect(state.activeModelId).toBe('gpt-5.5');
    expect(state.thinkingSettings['openai::gpt-5.5']).toEqual({ enabled: true, level: 'medium' });
  });
});
