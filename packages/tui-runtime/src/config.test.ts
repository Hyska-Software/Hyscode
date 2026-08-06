import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SharedConfigStore, SharedKeyStore, buildApprovalConfig, buildThinkingConfig } from './config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('shared desktop configuration compatibility', () => {
  it('reads the desktop provider settings and preserves MCP transport fields', async () => {
    const directory = await temporaryDirectory();
    const settingsPath = path.join(directory, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      activeProviderId: 'openai',
      activeModelId: 'gpt-5',
      themeId: 'dracula',
      sidebarVisible: false,
      agentType: 'build',
      approvalMode: 'custom',
      customApprovalRules: { categoryRules: { filesystem: true }, toolRules: { shell: false } },
      mcpServers: [{
        id: 'docs',
        name: 'Docs',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { DOCS_TOKEN: 'fixture' },
        capabilities: { allowedTools: ['search'], allowedResources: '*', maxConcurrentCalls: 2, timeoutMs: 5000 },
        autoConnect: true,
      }],
    }));

    const store = new SharedConfigStore(settingsPath);
    const settings = await store.load();

    expect(settings.activeProviderId).toBe('openai');
    expect(settings.activeModelId).toBe('gpt-5');
    expect(settings.themeId).toBe('dracula');
    expect(settings.sidebarVisible).toBe(false);
    expect(settings.agentType).toBe('build');
    expect(settings.mcpServers[0]).toMatchObject({
      id: 'docs',
      env: { DOCS_TOKEN: 'fixture' },
      capabilities: { allowedTools: ['search'], maxConcurrentCalls: 2, timeoutMs: 5000 },
    });
    expect(buildApprovalConfig(settings)).toMatchObject({
      mode: 'custom',
      categoryOverrides: { filesystem: false },
      toolOverrides: { shell: true },
    });
  });

  it('uses the desktop keychain account naming convention', async () => {
    const directory = await temporaryDirectory();
    const keychainPath = path.join(directory, 'keychain.json');
    await writeFile(keychainPath, JSON.stringify({ 'hyscode:openai_api_key': 'fixture-key' }));

    const store = new SharedKeyStore(keychainPath);
    await store.load();
    expect(await store.get('openai_api_key')).toBe('fixture-key');

    await store.set('anthropic_api_key', 'new-key');
    const persisted = JSON.parse(await readFile(keychainPath, 'utf8')) as Record<string, string>;
    expect(persisted['hyscode:anthropic_api_key']).toBe('new-key');
    await store.delete('openai_api_key');
    expect(await store.get('openai_api_key')).toBeNull();
  });

  it('normalizes the model thinking contract used by the provider registry', async () => {
    const directory = await temporaryDirectory();
    const store = new SharedConfigStore(path.join(directory, 'settings.json'));
    const settings = await store.load();
    settings.thinkingSettings['openai::gpt-5'] = {
      enabled: true,
      level: 'high',
      mode: 'pro',
      budgetTokens: 4096,
      type: 'enabled',
      display: 'summarized',
    };
    expect(buildThinkingConfig(settings, 'openai', 'gpt-5')).toEqual(settings.thinkingSettings['openai::gpt-5']);
  });
});
