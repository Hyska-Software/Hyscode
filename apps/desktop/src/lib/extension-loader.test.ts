/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerExtensionContributions,
  unregisterExtensionContributions,
} from './extension-loader';
import { useCommandStore } from '../stores/command-store';
import { useKeybindingStore } from '../stores/keybinding-store';
import { useExtensionUiStore } from '../stores/extension-ui-store';
import type { InstalledExtension } from '../stores/extension-store';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue('') }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));

const EXT_NAME = 'demo-ext';

function makeExtension(): InstalledExtension {
  return {
    name: EXT_NAME,
    displayName: 'Demo',
    version: '1.0.0',
    description: '',
    publisher: 'test',
    path: 'C:/ext/demo',
    enabled: true,
    installedAt: '',
    icon: null,
    categories: [],
    activationEvents: [],
    hasMain: false,
    manifest: {
      name: EXT_NAME,
      version: '1.0.0',
      contributes: {
        commands: [
          { id: 'demo.format', title: 'Format Demo', icon: 'sparkles', category: 'Demo' },
        ],
        keybindings: [{ command: 'demo.format', key: 'ctrl+alt+d' }],
        menus: {
          'editor/context': [{ command: 'demo.format', group: '1_modification' }],
        },
      },
    },
  } as unknown as InstalledExtension;
}

function contextItems() {
  return useExtensionUiStore
    .getState()
    .contextMenuItems.filter((item) => item.extensionName === EXT_NAME);
}

afterEach(() => {
  useExtensionUiStore.getState().removeAllForExtension(EXT_NAME);
  unregisterExtensionContributions(EXT_NAME);
  useCommandStore.getState().removeExtensionCommands(EXT_NAME);
  vi.clearAllMocks();
});

describe('registerExtensionContributions', () => {
  it('registers command metadata and keybindings from the manifest', () => {
    registerExtensionContributions(makeExtension());

    expect(useCommandStore.getState().hasCommand('demo.format')).toBe(true);
    expect(useKeybindingStore.getState().findByCommand('demo.format')?.raw).toBe('ctrl+alt+d');
  });

  it('does not render manifest editor/context menus in the editor context menu', () => {
    registerExtensionContributions(makeExtension());

    expect(contextItems()).toHaveLength(0);
  });
});
