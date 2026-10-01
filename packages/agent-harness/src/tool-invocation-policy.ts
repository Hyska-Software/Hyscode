import type { ExternalPathAccess } from './external-path-access';
import { resolveAuthorizedPath } from './path-policy';

const PATH_ARGUMENT_KEYS = new Set([
  'path',
  'paths',
  'from',
  'to',
  'cwd',
  'root',
  'rootPath',
  'root_path',
  'repoPath',
  'repo_path',
  'workspacePath',
  'workspace_path',
  'directory',
  'dir',
  'inputPath',
  'input_path',
  'outputPath',
  'output_path',
  'targetPath',
  'target_path',
]);

function looksLikePathValue(value: string): boolean {
  if (!value.trim()) return false;
  // Never rewrite multi-line content (code snippets, file bodies) as paths.
  // Tauri invoke path args are always single-line filesystem paths.
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) return false;
  if (value.length > 4096) return false;
  return true;
}

function authorizeValue(
  value: unknown,
  workspacePath: string,
  externalPathAccess?: ExternalPathAccess,
): unknown {
  if (typeof value === 'string') {
    if (!looksLikePathValue(value)) return value;
    return resolveAuthorizedPath(value, workspacePath, externalPathAccess);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => authorizeValue(entry, workspacePath, externalPathAccess));
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const nested: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      nested[nestedKey] = PATH_ARGUMENT_KEYS.has(nestedKey)
        ? authorizeValue(nestedValue, workspacePath, externalPathAccess)
        : nestedValue;
    }
    return nested;
  }
  return value;
}

/** Normalize every path-bearing invoke argument at the host boundary. */
export function authorizeToolInvocationArgs(
  args: Record<string, unknown> | undefined,
  workspacePath: string,
  externalPathAccess?: ExternalPathAccess,
): Record<string, unknown> | undefined {
  if (!args) return args;
  const authorized: Record<string, unknown> = { ...args };
  for (const [key, value] of Object.entries(authorized)) {
    if (!PATH_ARGUMENT_KEYS.has(key)) continue;
    authorized[key] = authorizeValue(value, workspacePath, externalPathAccess);
  }
  return authorized;
}
