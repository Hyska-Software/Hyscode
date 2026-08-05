import {
  ProjectInstructionResolver,
  type ProjectInstructionDirectoryEntry,
  type ProjectInstructionReadFile,
} from './project-instructions';
import type { Rule, RuleDiagnostic, RuleScope } from './types';

export type ReadDirFn = (path: string) => Promise<Array<ProjectInstructionDirectoryEntry>>;
export type ReadFileFn = ProjectInstructionReadFile;
export type PathExistsFn = (path: string) => Promise<boolean>;

export interface RuleLoaderConfig {
  globalPath: string;
  workspacePath?: string;
  readDir: ReadDirFn;
  readFile: ReadFileFn;
  pathExists: PathExistsFn;
  maxNativeFileBytes?: number;
  maxNativeTotalBytes?: number;
}

export class RuleLoader {
  private rules: Rule[] = [];
  private diagnostics: RuleDiagnostic[] = [];
  private config: RuleLoaderConfig;

  constructor(config: RuleLoaderConfig) {
    this.config = config;
  }

  async loadAll(targetPaths: readonly string[] = []): Promise<Rule[]> {
    const previousEnabled = new Map(this.rules.map((rule) => [rule.id, rule.enabled]));
    const global = await this.loadFromDir(this.config.globalPath, 'global');

    let workspace: Rule[] = [];
    let native: Rule[] = [];
    let diagnostics: RuleDiagnostic[] = [];
    if (this.config.workspacePath) {
      const wsRulesPath = `${this.config.workspacePath}/.hyscode/rules`;
      workspace = await this.loadFromDir(wsRulesPath, 'workspace');

      const resolver = new ProjectInstructionResolver({
        workspacePath: this.config.workspacePath,
        readDir: this.config.readDir,
        readFile: this.config.readFile,
        pathExists: this.config.pathExists,
        maxFileBytes: this.config.maxNativeFileBytes,
        maxTotalBytes: this.config.maxNativeTotalBytes,
      });
      const resolution = await resolver.resolve(targetPaths);
      diagnostics = resolution.diagnostics;
      native = resolution.files.map((instruction): Rule => ({
        id: instruction.id,
        name: instruction.name,
        filePath: instruction.filePath,
        scope: 'workspace',
        origin: 'native',
        mandatory: true,
        appliesFrom: instruction.appliesFrom,
        content: instruction.content,
        enabled: true,
      }));
    }

    const merged = [...this.mergeRules(global, workspace), ...native];
    this.rules = merged.map((rule) => ({
      ...rule,
      enabled: rule.mandatory ? true : previousEnabled.get(rule.id) ?? rule.enabled,
    }));
    this.diagnostics = diagnostics;
    return this.rules;
  }

  getAll(): Rule[] {
    return this.rules;
  }

  getActive(): Rule[] {
    return this.rules.filter((rule) => rule.enabled || rule.mandatory);
  }

  getDiagnostics(): RuleDiagnostic[] {
    return [...this.diagnostics];
  }

  /** Update the managed global-rule directory before the next refresh. */
  setGlobalPath(globalPath: string): void {
    this.config = { ...this.config, globalPath };
  }

  /** Create an isolated loader for a child harness without sharing mutable rule state. */
  fork(): RuleLoader {
    const child = new RuleLoader(this.config);
    child.rules = this.rules.map((rule) => ({ ...rule }));
    child.diagnostics = [...this.diagnostics];
    return child;
  }

  getById(id: string): Rule | undefined {
    return this.rules.find((rule) => rule.id === id);
  }

  /** Enable a rule by id. Native project instructions are always enabled. */
  enable(id: string): boolean {
    const rule = this.getById(id);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  /** Disable a managed rule by id. Native project instructions cannot be disabled. */
  disable(id: string): boolean {
    const rule = this.getById(id);
    if (!rule || rule.mandatory) return false;
    rule.enabled = false;
    return true;
  }

  /** Set enabled state for a rule by id while preserving mandatory instructions. */
  setEnabled(id: string, enabled: boolean): boolean {
    return enabled ? this.enable(id) : this.disable(id);
  }

  /** Compute the file path for a new managed rule. */
  getRulePath(name: string, scope: RuleScope): string {
    const dir = scope === 'global'
      ? this.config.globalPath
      : `${this.config.workspacePath}/.hyscode/rules`;
    return `${dir}/${name}.md`;
  }

  private async loadFromDir(dirPath: string, scope: RuleScope): Promise<Rule[]> {
    try {
      const exists = await this.config.pathExists(dirPath);
      if (!exists) return [];

      const entries = await this.config.readDir(dirPath);
      const rules: Rule[] = [];

      for (const entry of entries) {
        if (entry.is_dir || !entry.name.toLowerCase().endsWith('.md')) continue;

        try {
          const filePath = `${dirPath}/${entry.name}`;
          const content = (await this.config.readFile(filePath)).trim();
          const name = entry.name.replace(/\.md$/i, '');

          rules.push({
            id: `${scope}:${name}`,
            name,
            filePath,
            scope,
            origin: 'managed',
            mandatory: false,
            content,
            enabled: true,
          });
        } catch {
          // Managed rule files remain best-effort for backward compatibility.
        }
      }

      return rules;
    } catch {
      return [];
    }
  }

  private mergeRules(global: Rule[], workspace: Rule[]): Rule[] {
    const byName = new Map<string, Rule>();

    for (const rule of global) byName.set(rule.name, rule);
    for (const rule of workspace) byName.set(rule.name, rule);

    return Array.from(byName.values());
  }
}
