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
        origin: 'managed',
        mandatory: false,
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

  it('discovers both native names from the root to a nested target', async () => {
    const workspacePath = 'C:/workspace';
    const directories = new Map<string, Array<{ name: string; is_dir: boolean }>>([
      [workspacePath, [
        { name: 'agents.md', is_dir: false },
        { name: 'CLAUDE.MD', is_dir: false },
      ]],
      [`${workspacePath}/src`, [{ name: 'AGENTS.md', is_dir: false }]],
      [`${workspacePath}/src/deep`, [{ name: 'claude.md', is_dir: false }]],
    ]);
    const contents = new Map<string, string>([
      [`${workspacePath}/agents.md`, 'root agents'],
      [`${workspacePath}/CLAUDE.MD`, 'root claude'],
      [`${workspacePath}/src/AGENTS.md`, 'src agents'],
      [`${workspacePath}/src/deep/claude.md`, 'deep claude'],
    ]);
    const config = loaderConfig({
      pathExists: vi.fn(async () => false),
      readDir: vi.fn(async (path) => {
        const entries = directories.get(path);
        if (!entries) throw new Error('not a directory');
        return entries;
      }),
      readFile: vi.fn(async (path) => {
        const content = contents.get(path);
        if (content === undefined) throw new Error('not found');
        return content;
      }),
    });

    const rules = await new RuleLoader(config).loadAll([`${workspacePath}/src/deep/file.ts`]);

    expect(rules.map((rule) => rule.name)).toEqual([
      'agents.md',
      'CLAUDE.MD',
      'AGENTS.md',
      'claude.md',
    ]);
    expect(rules.every((rule) => rule.origin === 'native' && rule.mandatory)).toBe(true);
    expect(rules.map((rule) => rule.appliesFrom)).toEqual([
      workspacePath,
      workspacePath,
      `${workspacePath}/src`,
      `${workspacePath}/src/deep`,
    ]);
    expect(rules.map((rule) => rule.id)).toEqual([
      'native:c:/workspace/agents.md',
      'native:c:/workspace/claude.md',
      'native:c:/workspace/src/agents.md',
      'native:c:/workspace/src/deep/claude.md',
    ]);
  });

  it('deduplicates shared ancestors and ignores targets outside the workspace', async () => {
    const workspacePath = 'C:/workspace';
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => path.includes('/src/')),
      readDir: vi.fn(async (path) => {
        if (path === workspacePath) return [{ name: 'AGENTS.md', is_dir: false }];
        if (path === `${workspacePath}/src`) return [];
        throw new Error('not a directory');
      }),
      readFile: vi.fn(async () => 'instruction'),
    });
    const loader = new RuleLoader(config);

    const rules = await loader.loadAll([
      `${workspacePath}/src/one.ts`,
      `${workspacePath}/src/two.ts`,
      'C:/other-project/file.ts',
    ]);

    expect(rules).toHaveLength(1);
    expect(loader.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'outside-workspace', path: 'C:/other-project/file.ts' }),
    ]));
    const rootReads = (config.readDir as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([path]) => path === workspacePath,
    );
    expect(rootReads).toHaveLength(1);
  });

  it('reports empty, unreadable, oversized, and inaccessible native files without failing', async () => {
    const workspacePath = 'C:/workspace';
    const config = loaderConfig({
      maxNativeFileBytes: 4,
      pathExists: vi.fn(async () => false),
      readDir: vi.fn(async (path) => {
        if (path === workspacePath) {
          return [
            { name: 'AGENTS.md', is_dir: false },
            { name: 'CLAUDE.md', is_dir: false },
          ];
        }
        if (path === `${workspacePath}/src`) throw new Error('permission denied');
        throw new Error('not a directory');
      }),
      readFile: vi.fn(async (path) => {
        if (path.endsWith('/AGENTS.md')) return '';
        throw new Error('permission denied');
      }),
    });
    const loader = new RuleLoader(config);

    await loader.loadAll([`${workspacePath}/src/file.ts`]);

    expect(loader.getAll()).toEqual([]);
    expect(loader.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty-file' }),
      expect.objectContaining({ code: 'file-unreadable' }),
      expect.objectContaining({ code: 'directory-unreadable' }),
    ]));

    const oversizedConfig = loaderConfig({
      maxNativeFileBytes: 4,
      pathExists: vi.fn(async () => false),
      readDir: vi.fn(async (path) => path === workspacePath
        ? [{ name: 'AGENTS.md', is_dir: false }]
        : (() => { throw new Error('not a directory'); })()),
      readFile: vi.fn(async () => '12345'),
    });
    const oversizedLoader = new RuleLoader(oversizedConfig);
    await oversizedLoader.loadAll();
    expect(oversizedLoader.getDiagnostics()).toEqual([
      expect.objectContaining({ code: 'file-too-large' }),
    ]);

    const totalConfig = loaderConfig({
      maxNativeTotalBytes: 5,
      pathExists: vi.fn(async () => false),
      readDir: vi.fn(async (path) => path === workspacePath
        ? [
            { name: 'AGENTS.md', is_dir: false },
            { name: 'CLAUDE.md', is_dir: false },
          ]
        : (() => { throw new Error('not a directory'); })()),
      readFile: vi.fn(async () => '1234'),
    });
    const totalLoader = new RuleLoader(totalConfig);
    await totalLoader.loadAll();
    expect(totalLoader.getAll()).toHaveLength(1);
    expect(totalLoader.getDiagnostics()).toEqual([
      expect.objectContaining({ code: 'total-size-exceeded' }),
    ]);

    const missingConfig = loaderConfig({
      pathExists: vi.fn(async () => false),
      readDir: vi.fn(async (path) => path === workspacePath
        ? [{ name: 'AGENTS.md', is_dir: false }]
        : (() => { throw new Error('not a directory'); })()),
      readFile: vi.fn(async () => 'root instruction'),
    });
    const missingLoader = new RuleLoader(missingConfig);
    await missingLoader.loadAll([`${workspacePath}/deleted.ts`]);
    expect(missingLoader.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-file', path: `${workspacePath}/deleted.ts` }),
    ]));
  });

  it('keeps native instructions mandatory and isolates fork state', async () => {
    const workspacePath = 'C:/workspace';
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => path === config.globalPath),
      readDir: vi.fn(async (path) => {
        if (path === config.globalPath) return [{ name: 'managed.md', is_dir: false }];
        if (path === workspacePath) return [{ name: 'AGENTS.md', is_dir: false }];
        throw new Error('not a directory');
      }),
      readFile: vi.fn(async (path) => path.endsWith('managed.md') ? 'managed' : 'native'),
    });
    const loader = new RuleLoader(config);
    await loader.loadAll();

    const native = loader.getAll().find((rule) => rule.origin === 'native');
    expect(native).toBeDefined();
    expect(loader.disable(native!.id)).toBe(false);
    expect(loader.setEnabled(native!.id, false)).toBe(false);
    expect(loader.getActive()).toContainEqual(native);

    const child = loader.fork();
    expect(child.disable('global:managed')).toBe(true);
    expect(loader.getById('global:managed')?.enabled).toBe(true);
    expect(child.getById(native!.id)).not.toBe(loader.getById(native!.id));
  });

  it('replaces native results when the target project directory changes', async () => {
    const workspacePath = 'C:/workspace';
    let activeProject = 'a';
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => path.includes(`/${activeProject}/`)),
      readDir: vi.fn(async (path) => {
        if (path === `${workspacePath}/${activeProject}`) {
          return [{ name: 'AGENTS.md', is_dir: false }];
        }
        throw new Error('not a directory');
      }),
      readFile: vi.fn(async (path) => `instructions for ${path.includes('/a/') ? 'a' : 'b'}`),
    });
    const loader = new RuleLoader(config);

    const first = await loader.loadAll([`${workspacePath}/a/src/file.ts`]);
    activeProject = 'b';
    const second = await loader.loadAll([`${workspacePath}/b/src/file.ts`]);

    expect(first.map((rule) => rule.filePath)).toEqual(['C:/workspace/a/AGENTS.md']);
    expect(second.map((rule) => rule.filePath)).toEqual(['C:/workspace/b/AGENTS.md']);
    expect(second.some((rule) => rule.filePath.includes('/a/'))).toBe(false);
  });
});
