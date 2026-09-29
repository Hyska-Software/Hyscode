// ─── Skill Loader ───────────────────────────────────────────────────────────
// Loads skill definitions from built-in, global, and workspace directories.
// Parses YAML frontmatter from Markdown skill files.

import type { Skill, SkillFrontmatter, SkillScope, AgentType } from './types';

// ─── Text Normalization Helpers ─────────────────────────────────────────────
// Strip accents/diacritics and normalize text for fuzzy matching.

function normalizeText(text: string): string {
  return text
    .normalize('NFD')                     // decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')      // strip diacritics
    .toLowerCase()
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s,.:;!?()[\]{}<>'"\/\\|@#$%^&*+=~`]+/)
    .filter((t) => t.length > 1);
}

// ─── Frontmatter Parser ─────────────────────────────────────────────────────
// Lightweight YAML-subset parser for skill frontmatter.
// Only handles simple key: value pairs, arrays with - syntax.

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }

  const fmRaw = fmMatch[1];
  const body = fmMatch[2];

  // Try native YAML parsing if available (frontmatter is valid YAML)
  try {
    const yaml = parseYaml(fmRaw);
    if (yaml && typeof yaml === 'object') {
      return { frontmatter: yaml as Record<string, unknown>, body };
    }
  } catch (e) {
    // Fall through to manual parser
    console.warn('[skill-loader] YAML parse failed, using manual parser', e);
  }

  const frontmatter: Record<string, unknown> = {};

  let currentKey = '';
  let currentArray: unknown[] | null = null;

  for (const rawLine of fmRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const trimmed = line.trim();

    // Array item
    if (trimmed.startsWith('- ')) {
      const itemValue = trimmed.slice(2).trim();
      if (currentArray) {
        // Object inside array: "- key: value"
        const objKv = itemValue.match(/^(\w+)\s*:\s*(.*)$/);
        if (objKv && currentArray.length > 0 && typeof currentArray[currentArray.length - 1] === 'object') {
          const obj = currentArray[currentArray.length - 1] as Record<string, unknown>;
          obj[objKv[1]] = parseYamlValue(objKv[2].trim());
        } else if (objKv && !itemValue.includes(': ') && itemValue.includes(':')) {
          // Simple key:value as array item
          currentArray.push({ [objKv[1]]: parseYamlValue(objKv[2].trim()) });
        } else {
          currentArray.push(parseYamlValue(itemValue));
        }
      }
      continue;
    }

    // Key: value
    const kvMatch = trimmed.match(/^(\w+)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentArray = null;
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === '') {
        // Might be followed by array items
        frontmatter[currentKey] = [];
        currentArray = frontmatter[currentKey] as unknown[];
      } else {
        frontmatter[currentKey] = parseYamlValue(value);
      }
    }
  }

  return { frontmatter, body };
}

/** Parse a simple YAML scalar value */
function parseYamlValue(value: string): unknown {
  const unquoted = value.replace(/^["']|["']$/g, '');
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (unquoted === 'null' || unquoted === '~') return null;
  if (/^\d+$/.test(unquoted)) return parseInt(unquoted, 10);
  if (/^\d+\.\d+$/.test(unquoted)) return parseFloat(unquoted);
  return unquoted;
}

/** Minimal YAML object parser for flat objects */
function parseYaml(yaml: string): unknown {
  // Best-effort: try to parse as JSON-like object by wrapping keys in quotes
  // This handles simple YAML frontmatter without external deps
  const lines = yaml.split('\n');
  const result: Record<string, unknown> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        result[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch (e) {
        // Heuristic fallback: unquoted YAML flow sequences (e.g. [build]) are
        // not valid JSON — keep the raw string for the manual parser.
        console.debug('[skill-loader] keeping raw array value', key, e);
        result[key] = value;
      }
    } else if (value.startsWith('{') && value.endsWith('}')) {
      try {
        result[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch (e) {
        console.debug('[skill-loader] keeping raw object value', key, e);
        result[key] = value;
      }
    } else {
      result[key] = parseYamlValue(value);
    }
  }

  return result;
}

function validateFrontmatter(fm: Record<string, unknown>, filePath: string): SkillFrontmatter {
  const name = (fm.name as string) || filePath.split('/').pop()?.replace('.md', '') || 'unknown';
  return {
    name,
    description: (fm.description as string) || '',
    version: (fm.version as string) || '1.0.0',
    scope: ((fm.scope as string) || 'built-in') as SkillScope,
    activation: ((fm.activation as string) || 'manual') as 'always' | 'manual' | 'trigger',
    trigger: fm.trigger as string | undefined,
    agents: fm.agents as AgentType[] | undefined,
    globs: fm.globs as string[] | undefined,
  };
}

// ─── Skill Loader ───────────────────────────────────────────────────────────

export type ReadDirFn = (path: string) => Promise<Array<{ name: string; is_dir: boolean }>>;
export type ReadFileFn = (path: string) => Promise<string>;
export type PathExistsFn = (path: string) => Promise<boolean>;

export interface SkillLoaderConfig {
  builtInPath: string;
  globalPath: string;
  workspacePath?: string;
  readDir: ReadDirFn;
  readFile: ReadFileFn;
  pathExists: PathExistsFn;
}

export class SkillLoader {
  private skills: Skill[] = [];
  private config: SkillLoaderConfig;

  constructor(config: SkillLoaderConfig) {
    this.config = config;
  }

  async loadAll(): Promise<Skill[]> {
    const builtIn = await this.loadFromDir(this.config.builtInPath, 'built-in');
    const global = await this.loadFromDir(this.config.globalPath, 'global');

    let workspace: Skill[] = [];
    if (this.config.workspacePath) {
      // Primary: .agents/skills (matches VS Code convention)
      const wsSkillsPath = `${this.config.workspacePath}/.agents/skills`;
      workspace = await this.loadFromDir(wsSkillsPath, 'workspace');
      // Fallback: .hyscode/skills (backwards compat)
      if (workspace.length === 0) {
        const legacyPath = `${this.config.workspacePath}/.hyscode/skills`;
        workspace = await this.loadFromDir(legacyPath, 'workspace');
      }
    }

    // Merge: workspace > global > built-in (by name)
    this.skills = this.mergeSkills(builtIn, global, workspace);
    return this.skills;
  }

  getAll(): Skill[] {
    return this.skills;
  }

  getByName(name: string): Skill | undefined {
    return this.skills.find((s) => s.frontmatter.name === name);
  }

  getActive(): Skill[] {
    return this.skills.filter((s) => s.active);
  }

  /** Get skills that should be always-active for a given agent type */
  getAlwaysActive(agentType?: AgentType): Skill[] {
    return this.skills.filter((s) => {
      if (s.frontmatter.activation !== 'always') return false;
      if (s.frontmatter.agents && agentType) {
        return s.frontmatter.agents.includes(agentType);
      }
      return true;
    });
  }

  /** Activate a skill by name */
  activate(name: string): boolean {
    const skill = this.getByName(name);
    if (!skill) return false;
    skill.active = true;
    return true;
  }

  /** Deactivate a skill by name */
  deactivate(name: string): boolean {
    const skill = this.getByName(name);
    if (!skill) return false;
    skill.active = false;
    return true;
  }

  /** Check if a skill should be triggered based on user message */
  checkTriggers(userMessage: string): Skill[] {
    const triggered: Skill[] = [];
    const normalizedMessage = normalizeText(userMessage);
    const messageTokens = tokenize(normalizedMessage);

    for (const skill of this.skills) {
      if (skill.active) continue; // Already active
      if (skill.frontmatter.activation !== 'trigger') continue;
      if (!skill.frontmatter.trigger) continue;

      const normalizedTrigger = normalizeText(skill.frontmatter.trigger);

      // Extract keywords from trigger description
      // e.g. "when user mentions testing" → check for "testing"
      const keywords = normalizedTrigger
        .replace(/^when\s+(user\s+)?(mentions?|asks?\s+about|discusses?|talks?\s+about|fala\s+sobre|pede|pergunta\s+sobre|menciona)\s+/i, '')
        .split(/[,\s]+/)
        .filter((k) => k.length > 2);

      // Token-overlap matching with a minimum token length guard to avoid
      // over-firing on short substrings (e.g. "a" in "data").
      const match = keywords.some((keyword) => {
        const kw = keyword.toLowerCase();
        return messageTokens.some((token) => {
          const tok = token.toLowerCase();
          if (tok.length < 4 || kw.length < 4) return tok === kw;
          return tok === kw || tok.startsWith(kw) || kw.startsWith(tok);
        });
      });

      if (match) {
        triggered.push(skill);
      }
    }

    // Also match by skill name directly mentioned in message
    for (const skill of this.skills) {
      if (skill.active) continue;
      if (triggered.includes(skill)) continue;
      const skillNameNorm = normalizeText(skill.frontmatter.name);
      if (skillNameNorm.length > 2 && normalizedMessage.includes(skillNameNorm)) {
        triggered.push(skill);
      }
    }

    return triggered;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private async loadFromDir(dirPath: string, scope: SkillScope): Promise<Skill[]> {
    try {
      const exists = await this.config.pathExists(dirPath);
      if (!exists) return [];

      const entries = await this.config.readDir(dirPath);
      const skills: Skill[] = [];

      for (const entry of entries) {
        // ── Flat file: skill.md ──
        if (!entry.is_dir && entry.name.endsWith('.md')) {
          try {
            const filePath = `${dirPath}/${entry.name}`;
            const content = await this.config.readFile(filePath);
            const { frontmatter: fm, body } = parseFrontmatter(content);
            const frontmatter = validateFrontmatter(fm, filePath);
            frontmatter.scope = scope;

            skills.push({
              id: `${scope}:${frontmatter.name}`,
              frontmatter,
              content: body.trim(),
              filePath,
              active: frontmatter.activation === 'always',
              status: 'ok',
            });
          } catch (e) {
            // Skip invalid skill files
            console.warn('[skill-loader] skipping invalid skill file', entry.name, e);
          }
          continue;
        }

        // ── Folder-per-skill: <name>/SKILL.md (or alternative filenames) ──
        if (entry.is_dir) {
          const candidates = ['SKILL.md', 'skill.md', 'README.md', 'index.md'];
          let found = false;

          for (const candidate of candidates) {
            try {
              const candidatePath = `${dirPath}/${entry.name}/${candidate}`;
              const exists = await this.config.pathExists(candidatePath);
              if (!exists) continue;

              const content = await this.config.readFile(candidatePath);
              const { frontmatter: fm, body } = parseFrontmatter(content);
              const frontmatter = validateFrontmatter(fm, candidatePath);
              // Use directory name as fallback skill name
              if (frontmatter.name === 'unknown') {
                frontmatter.name = entry.name;
              }
              frontmatter.scope = scope;

              skills.push({
                id: `${scope}:${frontmatter.name}`,
                frontmatter,
                content: body.trim(),
                filePath: candidatePath,
                active: frontmatter.activation === 'always',
                status: 'ok',
              });
              found = true;
              break;
            } catch (e) {
              // Try next candidate
              console.warn('[skill-loader] failed to load skill candidate', candidate, e);
            }
          }

          // Emit a stub entry for folders with no recognized skill file
          if (!found) {
            skills.push({
              id: `${scope}:${entry.name}`,
              frontmatter: {
                name: entry.name,
                description: `Skill folder detected but no SKILL.md found.`,
                version: '0.0.0',
                scope,
                activation: 'manual',
              },
              content: '',
              filePath: `${dirPath}/${entry.name}`,
              active: false,
              status: 'missing-content',
            });
          }
        }
      }

      return skills;
    } catch (e) {
      console.warn('[skill-loader] loadFromDir failed', dirPath, e);
      return [];
    }
  }

  /** Create an isolated loader for a child harness without sharing mutable skill state. */
  clone(): SkillLoader {
    const child = new SkillLoader({ ...this.config });
    child.skills = this.skills.map((skill) => ({
      ...skill,
      frontmatter: {
        ...skill.frontmatter,
        agents: skill.frontmatter.agents ? [...skill.frontmatter.agents] : undefined,
        globs: skill.frontmatter.globs ? [...skill.frontmatter.globs] : undefined,
      },
    }));
    return child;
  }

  private mergeSkills(builtIn: Skill[], global: Skill[], workspace: Skill[]): Skill[] {
    const byName = new Map<string, Skill>();

    for (const skill of builtIn) {
      byName.set(skill.frontmatter.name, skill);
    }
    for (const skill of global) {
      byName.set(skill.frontmatter.name, skill);
    }
    for (const skill of workspace) {
      byName.set(skill.frontmatter.name, skill);
    }

    return Array.from(byName.values());
  }
}
