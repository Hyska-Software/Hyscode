import { describe, expect, it, vi } from 'vitest';

import { SkillLoader, type SkillLoaderConfig } from './skill-loader';

const SKILL_MD = `---
name: my-skill
description: A test skill
version: "2.1.0"
activation: trigger
trigger: when user mentions testing
agents: [build, debug]
---

# My Skill

Body content here.
`;

function loaderConfig(overrides: Partial<SkillLoaderConfig> = {}): SkillLoaderConfig {
  return {
    builtInPath: 'C:/app/skills',
    globalPath: 'C:/home/.agents/skills',
    workspacePath: 'C:/workspace',
    readDir: vi.fn(async () => []),
    readFile: vi.fn(async () => ''),
    pathExists: vi.fn(async () => false),
    ...overrides,
  };
}

describe('SkillLoader', () => {
  const BUILT_IN = 'C:/app/skills';

  it('loads a flat skill file with frontmatter and body', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => path === BUILT_IN),
      readDir: vi.fn(async () => [{ name: 'my-skill.md', is_dir: false }]),
      readFile: vi.fn(async () => SKILL_MD),
    });
    const loader = new SkillLoader(config);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'built-in:my-skill',
      content: '# My Skill\n\nBody content here.',
      status: 'ok',
      active: false,
      frontmatter: {
        name: 'my-skill',
        description: 'A test skill',
        version: '2.1.0',
        activation: 'trigger',
        trigger: 'when user mentions testing',
      },
    });
  });

  it('loads folder-per-skill layouts and falls back to the directory name', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => path === BUILT_IN || path.endsWith('SKILL.md')),
      readDir: vi.fn(async () => [{ name: 'deploy-tool', is_dir: true }]),
      readFile: vi.fn(async () => SKILL_MD),
    });
    const loader = new SkillLoader(config);
    const skills = await loader.loadAll();
    expect(skills[0].id).toBe('built-in:my-skill');
    expect(skills[0].filePath).toContain('deploy-tool/SKILL.md');
  });

  it('emits missing-content stubs for folders without a skill file', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => path === BUILT_IN),
      readDir: vi.fn(async () => [{ name: 'orphan', is_dir: true }]),
    });
    const loader = new SkillLoader(config);
    const skills = await loader.loadAll();
    expect(skills[0]).toMatchObject({
      id: 'built-in:orphan',
      status: 'missing-content',
      active: false,
    });
  });

  it('falls back to the legacy workspace skills directory', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async (path) => path.includes('.hyscode')),
      readDir: vi.fn(async (path) =>
        path.includes('.hyscode')
          ? [{ name: 'legacy.md', is_dir: false }]
          : [],
      ),
      readFile: vi.fn(async () => SKILL_MD.replace('my-skill', 'legacy')),
    });
    const loader = new SkillLoader(config);
    const skills = await loader.loadAll();
    expect(skills.some((s) => s.frontmatter.scope === 'workspace')).toBe(true);
  });

  it('merges workspace over global over built-in by name', async () => {
    const makeFile = (name: string, desc: string) =>
      `---\nname: ${name}\ndescription: ${desc}\nactivation: manual\n---\n\nbody`;
    const config = loaderConfig({
      pathExists: vi.fn(async () => true),
      readDir: vi.fn(async () => [{ name: 'shared.md', is_dir: false }]),
      readFile: vi.fn(async () => makeFile('shared', 'x')),
    });
    const loader = new SkillLoader(config);
    const skills = await loader.loadAll();
    expect(skills).toHaveLength(1);
    expect(skills[0].frontmatter.scope).toBe('workspace');
  });

  it('activates, deactivates and lists active skills', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async () => true),
      readDir: vi.fn(async () => [{ name: 'a.md', is_dir: false }]),
      readFile: vi.fn(async () => SKILL_MD),
    });
    const loader = new SkillLoader(config);
    await loader.loadAll();

    expect(loader.activate('my-skill')).toBe(true);
    expect(loader.getActive()).toHaveLength(1);
    expect(loader.activate('nope')).toBe(false);
    expect(loader.deactivate('my-skill')).toBe(true);
    expect(loader.getActive()).toHaveLength(0);
    expect(loader.deactivate('nope')).toBe(false);
    expect(loader.getByName('my-skill')?.frontmatter.name).toBe('my-skill');
  });

  it('returns always-active skills, filtered by agent type', async () => {
    const make = (name: string, activation: string, agents?: string) =>
      `---\nname: ${name}\ndescription: d\nactivation: ${activation}${agents ? `\nagents: ${agents}` : ''}\n---\n\nb`;
    const config = loaderConfig({
      pathExists: vi.fn(async () => true),
      readDir: vi.fn(async () => [
        { name: 'always-all.md', is_dir: false },
        { name: 'always-build.md', is_dir: false },
        { name: 'manual.md', is_dir: false },
      ]),
      readFile: vi.fn(async (path) => {
        if (path.endsWith('always-all.md')) return make('always-all', 'always');
        if (path.endsWith('always-build.md')) return make('always-build', 'always', '[build]');
        return make('manual', 'manual');
      }),
    });
    const loader = new SkillLoader(config);
    await loader.loadAll();

    expect(loader.getAlwaysActive('build').map((s) => s.frontmatter.name)).toEqual([
      'always-all',
      'always-build',
    ]);
    expect(loader.getAlwaysActive('debug').map((s) => s.frontmatter.name)).toEqual([
      'always-all',
    ]);
  });

  it('triggers skills whose trigger keywords match the message', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async () => true),
      readDir: vi.fn(async () => [
        { name: 'testing-skill.md', is_dir: false },
        { name: 'other-skill.md', is_dir: false },
      ]),
      readFile: vi.fn(async (path) => {
        if (path.endsWith('testing-skill.md'))
          return `---\nname: testing-skill\ndescription: d\nactivation: trigger\ntrigger: when user mentions testing\n---\n\nb`;
        return `---\nname: other-skill\ndescription: d\nactivation: trigger\ntrigger: when user mentions databases\n---\n\nb`;
      }),
    });
    const loader = new SkillLoader(config);
    await loader.loadAll();

    const triggered = loader.checkTriggers('please run the testing suite for me');
    expect(triggered.map((s) => s.frontmatter.name)).toEqual(['testing-skill']);
    expect(loader.checkTriggers('how do I migrate the db?')).toEqual([]);
  });

  it('matches by skill name mentioned directly in the message', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async () => true),
      readDir: vi.fn(async () => [{ name: 'commit.md', is_dir: false }]),
      readFile: vi.fn(async () =>
        `---\nname: commit\ndescription: d\nactivation: trigger\ntrigger: when user mentions commits\n---\n\nb`,
      ),
    });
    const loader = new SkillLoader(config);
    await loader.loadAll();
    expect(loader.checkTriggers('write a good commit message')).toHaveLength(1);
  });

  it('ignores triggers for already-active skills', async () => {
    const config = loaderConfig({
      pathExists: vi.fn(async () => true),
      readDir: vi.fn(async () => [{ name: 'testing-skill.md', is_dir: false }]),
      readFile: vi.fn(async () =>
        `---\nname: testing-skill\ndescription: d\nactivation: trigger\ntrigger: when user mentions testing\n---\n\nb`,
      ),
    });
    const loader = new SkillLoader(config);
    await loader.loadAll();
    loader.activate('testing-skill');
    expect(loader.checkTriggers('please run the tests')).toEqual([]);
  });
});
