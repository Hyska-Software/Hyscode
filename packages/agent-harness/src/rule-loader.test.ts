import { describe, expect, it, vi } from 'vitest';

import { RuleLoader, type RuleLoaderConfig } from './rule-loader';

function loaderConfig(overrides: Partial<RuleLoaderConfig> = {}): RuleLoaderConfig {
  return {
    globalPath: 'C:/home/.config/hyscode/rules',
    workspacePath: 'C:/workspace',
    readDir: vi.fn(async () => []),
    readFile: vi.fn(async () => ''),
    pathExists: vi.fn(async () => false),
    ...overrides,
  };
}

describe('RuleLoader', () => {
  it('loads markdown rules from the global directory', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => !path.includes('.hyscode')),
      readDir: vi.fn(async () => [
        { name: 'always-commit.md', is_dir: false },
        { name: 'notes.txt', is_dir: false },
        { name: 'subdir', is_dir: true },
      ]),
      readFile: vi.fn(async () => '  Always run lint.  '),
    });
    const loader = new RuleLoader(config);

    const rules = await loader.loadAll();
    expect(rules).toEqual([
      {
        id: 'global:always-commit',
        name: 'always-commit',
        filePath: 'C:/home/.config/hyscode/rules/always-commit.md',
        scope: 'global',
        content: 'Always run lint.',
        enabled: true,
      },
    ]);
  });

  it('merges workspace rules over global rules by name', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async () => true),
      readDir: vi.fn(async (path) =>
        path.includes('.hyscode')
          ? [{ name: 'style.md', is_dir: false }]
          : [{ name: 'style.md', is_dir: false }, { name: 'global-only.md', is_dir: false }],
      ),
      readFile: vi.fn(async () => 'content'),
    });
    const loader = new RuleLoader(config);
    const rules = await loader.loadAll();

    expect(rules).toHaveLength(2);
    const style = rules.find((r) => r.name === 'style');
    expect(style?.scope).toBe('workspace');
    expect(style?.filePath).toBe('C:/workspace/.hyscode/rules/style.md');
  });

  it('skips missing directories and unreadable files', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async () => false),
      readFile: vi.fn(async () => {
        throw new Error('denied');
      }),
    });
    const loader = new RuleLoader(config);
    expect(await loader.loadAll()).toEqual([]);
  });

  it('enables, disables and filters active rules', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => !path.includes('.hyscode')),
      readDir: vi.fn(async () => [
        { name: 'a.md', is_dir: false },
        { name: 'b.md', is_dir: false },
      ]),
      readFile: vi.fn(async () => 'x'),
    });
    const loader = new RuleLoader(config);
    await loader.loadAll();

    expect(loader.getActive()).toHaveLength(2);
    expect(loader.disable('global:a')).toBe(true);
    expect(loader.getActive().map((r) => r.name)).toEqual(['b']);
    expect(loader.enable('global:a')).toBe(true);
    expect(loader.setEnabled('global:b', false)).toBe(true);
    expect(loader.getActive().map((r) => r.name)).toEqual(['a']);
    expect(loader.enable('missing')).toBe(false);
    expect(loader.disable('missing')).toBe(false);
    expect(loader.getById('global:a')?.name).toBe('a');
  });

  it('computes rule file paths per scope', () => {
    const loader = new RuleLoader(loaderConfig());
    expect(loader.getRulePath('lint', 'global')).toBe(
      'C:/home/.config/hyscode/rules/lint.md',
    );
    expect(loader.getRulePath('lint', 'workspace')).toBe('C:/workspace/.hyscode/rules/lint.md');
  });
});
