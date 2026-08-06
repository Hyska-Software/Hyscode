import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from '@hyscode/theme';
import { loadThemeCatalog } from './themes';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-themes-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

describe('TUI theme catalog', () => {
  it('combines built-in themes with enabled extension contributions', async () => {
    const directory = await temporaryDirectory();
    const extensionsPath = path.join(directory, 'extensions');
    const extensionPath = path.join(extensionsPath, 'fixture-theme');
    const disabledPath = path.join(extensionsPath, 'disabled-theme');
    const statePath = path.join(directory, 'extension-state.json');

    await writeJson(path.join(extensionPath, 'extension.json'), {
      name: 'fixture-theme',
      displayName: 'Fixture Theme',
      contributes: {
        themes: [
          {
            id: 'fixture-teal',
            label: 'Fixture Teal',
            uiTheme: 'hyscode-dark',
            path: 'themes/teal.json',
          },
          {
            id: 'outside-theme',
            label: 'Outside Theme',
            uiTheme: 'hyscode-dark',
            path: '../outside.json',
          },
        ],
      },
    });
    await writeJson(path.join(extensionPath, 'themes', 'teal.json'), {
      type: 'dark',
      colors: {
        'editor.background': '#112233',
        'editor.foreground': '#eef2ff',
        focusBorder: '#27c9a8',
        'panel.background': '#1b2433',
        'editorLineNumber.foreground': '#7b8ca8',
      },
    });
    await writeJson(path.join(disabledPath, 'extension.json'), {
      name: 'disabled-theme',
      contributes: {
        themes: [{ id: 'disabled-theme', path: 'theme.json' }],
      },
    });
    await writeJson(path.join(disabledPath, 'theme.json'), {
      colors: { 'editor.background': '#000000' },
    });
    await writeJson(statePath, { states: { 'disabled-theme': false } });

    const catalog = await loadThemeCatalog({ extensionsPath, extensionStatePath: statePath });
    const fixture = catalog.find((theme) => theme.id === 'fixture-teal');

    expect(catalog).toHaveLength(BUILTIN_THEMES.length + 1);
    expect(fixture).toMatchObject({
      name: 'Fixture Teal',
      source: 'extension',
      extensionName: 'Fixture Theme',
      colors: {
        bg: '#112233',
        surface: '#1b2433',
        accent: '#27c9a8',
        fg: '#eef2ff',
        muted: '#7b8ca8',
      },
    });
    expect(catalog.some((theme) => theme.id === 'disabled-theme')).toBe(false);
    expect(catalog.some((theme) => theme.id === 'outside-theme')).toBe(false);
  });

  it('returns only built-ins when the installed extension directory is unavailable', async () => {
    const directory = await temporaryDirectory();
    const catalog = await loadThemeCatalog({
      extensionsPath: path.join(directory, 'missing-extensions'),
      extensionStatePath: path.join(directory, 'missing-state.json'),
    });

    expect(catalog).toEqual([...BUILTIN_THEMES]);
  });
});
