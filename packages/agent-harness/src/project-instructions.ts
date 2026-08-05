import { resolveWorkspacePath } from './path-policy';
import type { RuleDiagnostic } from './types';

export type ProjectInstructionDirectoryEntry = {
  name: string;
  is_dir: boolean;
};

export type ProjectInstructionReadDir = (
  path: string,
) => Promise<Array<ProjectInstructionDirectoryEntry>>;

export type ProjectInstructionReadFile = (path: string) => Promise<string>;
export type ProjectInstructionPathExists = (path: string) => Promise<boolean>;

export const NATIVE_PROJECT_INSTRUCTION_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const;
export const MAX_NATIVE_INSTRUCTION_FILE_BYTES = 64 * 1024;
export const MAX_NATIVE_INSTRUCTION_TOTAL_BYTES = 256 * 1024;

export interface ProjectInstruction {
  id: string;
  name: string;
  filePath: string;
  appliesFrom: string;
  content: string;
}

export interface ProjectInstructionResolution {
  files: ProjectInstruction[];
  diagnostics: RuleDiagnostic[];
}

export interface ProjectInstructionResolverConfig {
  workspacePath: string;
  readDir: ProjectInstructionReadDir;
  readFile: ProjectInstructionReadFile;
  pathExists?: ProjectInstructionPathExists;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export class ProjectInstructionResolver {
  private readonly config: ProjectInstructionResolverConfig;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;

  constructor(config: ProjectInstructionResolverConfig) {
    this.config = config;
    this.maxFileBytes = config.maxFileBytes ?? MAX_NATIVE_INSTRUCTION_FILE_BYTES;
    this.maxTotalBytes = config.maxTotalBytes ?? MAX_NATIVE_INSTRUCTION_TOTAL_BYTES;
  }

  async resolve(targetPaths: readonly string[] = []): Promise<ProjectInstructionResolution> {
    const diagnostics: RuleDiagnostic[] = [];
    const directories = await this.resolveDirectories(targetPaths, diagnostics);
    const files: ProjectInstruction[] = [];
    const encoder = new TextEncoder();
    let totalBytes = 0;

    for (const directory of directories) {
      let entries: ProjectInstructionDirectoryEntry[];
      try {
        entries = await this.config.readDir(directory);
      } catch {
        diagnostics.push({
          code: 'directory-unreadable',
          path: directory,
          message: `Could not inspect project-instruction directory: ${directory}`,
        });
        continue;
      }

      const filesByName = new Map<string, ProjectInstructionDirectoryEntry>();
      const sortedEntries = entries
        .filter((entry) => !entry.is_dir)
        .sort((left, right) => {
          const leftName = left.name.toLowerCase();
          const rightName = right.name.toLowerCase();
          if (leftName < rightName) return -1;
          if (leftName > rightName) return 1;
          if (left.name < right.name) return -1;
          if (left.name > right.name) return 1;
          return 0;
        });
      for (const entry of sortedEntries) {
        if (!filesByName.has(entry.name.toLowerCase())) {
          filesByName.set(entry.name.toLowerCase(), entry);
        }
      }

      for (const expectedName of NATIVE_PROJECT_INSTRUCTION_NAMES) {
        const entry = filesByName.get(expectedName.toLowerCase());
        if (!entry) continue;

        const filePath = joinPath(directory, entry.name);
        let rawContent: string;
        try {
          rawContent = await this.config.readFile(filePath);
        } catch {
          diagnostics.push({
            code: 'file-unreadable',
            path: filePath,
            message: `Could not read project instruction file: ${filePath}`,
          });
          continue;
        }

        const content = rawContent.trim();
        if (!content) {
          diagnostics.push({
            code: 'empty-file',
            path: filePath,
            message: `Project instruction file is empty: ${filePath}`,
          });
          continue;
        }

        const fileBytes = encoder.encode(rawContent).byteLength;
        if (fileBytes > this.maxFileBytes) {
          diagnostics.push({
            code: 'file-too-large',
            path: filePath,
            message: `Project instruction file exceeds the ${this.maxFileBytes}-byte limit: ${filePath}`,
          });
          continue;
        }
        if (totalBytes + fileBytes > this.maxTotalBytes) {
          diagnostics.push({
            code: 'total-size-exceeded',
            path: filePath,
            message: `Project instruction total exceeds the ${this.maxTotalBytes}-byte limit: ${filePath}`,
          });
          continue;
        }

        totalBytes += fileBytes;
        files.push({
          id: `native:${pathKey(filePath)}`,
          name: entry.name,
          filePath,
          appliesFrom: directory,
          content,
        });
      }
    }

    return { files, diagnostics };
  }

  private async resolveDirectories(
    targetPaths: readonly string[],
    diagnostics: RuleDiagnostic[],
  ): Promise<string[]> {
    const targets = targetPaths.length > 0 ? targetPaths : [this.config.workspacePath];
    const directories = new Map<string, { path: string; depth: number }>();

    for (const targetPath of targets) {
      let resolvedTarget: string;
      try {
        resolvedTarget = resolveWorkspacePath(targetPath, this.config.workspacePath);
      } catch {
        diagnostics.push({
          code: 'outside-workspace',
          path: targetPath,
          message: `Project-instruction target is outside the workspace: ${targetPath}`,
        });
        continue;
      }

      if (
        this.config.pathExists &&
        pathKey(resolvedTarget) !== pathKey(this.config.workspacePath)
      ) {
        let exists = true;
        try {
          exists = await this.config.pathExists(resolvedTarget);
        } catch {
          exists = false;
        }
        if (!exists) {
          diagnostics.push({
            code: 'missing-file',
            path: targetPath,
            message: `Project-instruction target does not exist: ${targetPath}`,
          });
        }
      }

      const targetDirectory = await this.asDirectoryOrParent(resolvedTarget);
      const ancestors = getWorkspaceAncestors(this.config.workspacePath, targetDirectory);
      if (!ancestors) {
        diagnostics.push({
          code: 'outside-workspace',
          path: targetPath,
          message: `Project-instruction target is outside the workspace: ${targetPath}`,
        });
        continue;
      }

      ancestors.forEach((path, depth) => {
        directories.set(pathKey(path), { path, depth });
      });
    }

    return Array.from(directories.values())
      .sort((left, right) => {
        if (left.depth !== right.depth) return left.depth - right.depth;
        const leftKey = pathKey(left.path);
        const rightKey = pathKey(right.path);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      })
      .map((entry) => entry.path);
  }

  private async asDirectoryOrParent(path: string): Promise<string> {
    if (pathKey(path) === pathKey(this.config.workspacePath)) {
      return normalizePath(this.config.workspacePath);
    }
    try {
      await this.config.readDir(path);
      return path;
    } catch {
      return parentPath(path);
    }
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized.length <= 3) return normalized;
  return normalized.replace(/\/$/, '');
}

function pathKey(path: string): string {
  const normalized = normalizePath(path);
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function joinPath(directory: string, name: string): string {
  const normalized = normalizePath(directory);
  return normalized.endsWith('/') ? `${normalized}${name}` : `${normalized}/${name}`;
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf('/');
  if (separator <= 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  if (separator <= 0) return '/';
  return normalized.slice(0, separator);
}

function getWorkspaceAncestors(workspacePath: string, targetDirectory: string): string[] | null {
  const workspace = normalizePath(workspacePath);
  const target = normalizePath(targetDirectory);
  const workspaceKey = pathKey(workspace);
  const targetKey = pathKey(target);

  if (targetKey !== workspaceKey && !targetKey.startsWith(`${workspaceKey}/`)) return null;

  const relative = target.slice(workspace.length).replace(/^\/+/, '');
  const segments = relative ? relative.split('/').filter(Boolean) : [];
  const ancestors = [workspace];
  let current = workspace;
  for (const segment of segments) {
    current = joinPath(current, segment);
    ancestors.push(current);
  }
  return ancestors;
}
