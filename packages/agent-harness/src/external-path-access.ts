import { resolveWorkspacePath } from './path-policy';

export type ExternalPathOperation = 'read' | 'write' | 'execute';
export type ExternalPathGrant = 'once' | 'session-directory';
export type ExternalPathFieldKind = 'target' | 'directory';

export type ExternalPathField = {
  key: string;
  kind: ExternalPathFieldKind;
};

export type ExternalPathAccessDefinition = {
  operation: ExternalPathOperation;
  fields: readonly ExternalPathField[];
};

export type ExternalPathAccessRequest = {
  operation: ExternalPathOperation;
  /** Canonical external paths involved in the current tool call. */
  paths: string[];
  /** Directory roots offered by the UI for a session grant. */
  directories: string[];
  /** Directory targets that may include descendants during this call. */
  directoryScopes: string[];
};

export type ExternalPathAccess = {
  /** Resolve a path only when it is inside the workspace or authorized. */
  resolve(path: string): string;
};

function normalizeForComparison(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized === '/') return '/';
  if (/^[a-zA-Z]:\/$/.test(normalized)) return normalized.toLowerCase();
  return normalized.replace(/\/+$/, '').toLowerCase();
}

function isWithin(parent: string, candidate: string): boolean {
  const parentKey = normalizeForComparison(parent);
  const candidateKey = normalizeForComparison(candidate);
  const separator = parentKey.endsWith('/') ? '' : '/';
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}${separator}`);
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');
  if (separator < 0) return normalized;
  if (/^[a-zA-Z]:\/$/.test(normalized.slice(0, separator + 1))) {
    return normalized.slice(0, separator + 1);
  }
  return normalized.slice(0, separator) || '/';
}

function valuesForField(input: Record<string, unknown>, field: ExternalPathField): string[] {
  const raw = input[field.key];
  if (raw === undefined || raw === null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

/**
 * Session-scoped external path grants shared by a parent harness and all of
 * its child harnesses. Grants are operation-specific and are never persisted.
 */
export class ExternalPathAccessRegistry {
  private readonly sessionDirectories = new Map<ExternalPathOperation, Set<string>>();

  inspect(
    definition: ExternalPathAccessDefinition,
    input: Record<string, unknown>,
    workspacePath: string,
  ): ExternalPathAccessRequest | null {
    const paths = new Set<string>();
    const directories = new Set<string>();
    const directoryScopes = new Set<string>();

    for (const field of definition.fields) {
      for (const rawPath of valuesForField(input, field)) {
        const resolved = resolveWorkspacePath(rawPath, workspacePath, {
          allowExternalAbsolute: true,
        });
        if (isWithin(workspacePath, resolved)) continue;

        paths.add(resolved);
        if (field.kind === 'directory') {
          directories.add(resolved);
          directoryScopes.add(resolved);
        } else {
          directories.add(parentDirectory(resolved));
        }
      }
    }

    if (paths.size === 0) return null;
    return {
      operation: definition.operation,
      paths: [...paths],
      directories: [...directories],
      directoryScopes: [...directoryScopes],
    };
  }

  isCovered(request: ExternalPathAccessRequest): boolean {
    return request.paths.every((path) => this.hasSessionDirectoryGrant(request.operation, path));
  }

  grant(request: ExternalPathAccessRequest, grant: ExternalPathGrant): void {
    if (grant !== 'session-directory') return;
    const directories = this.sessionDirectories.get(request.operation) ?? new Set<string>();
    for (const directory of request.directories) directories.add(normalizeForComparison(directory));
    this.sessionDirectories.set(request.operation, directories);
  }

  createAccess(
    request: ExternalPathAccessRequest,
    workspacePath: string,
  ): ExternalPathAccess {
    const invocationPaths = new Set(request.paths.map(normalizeForComparison));
    const invocationDirectories = request.directoryScopes.map(normalizeForComparison);

    return {
      resolve: (rawPath: string): string => {
        const resolved = resolveWorkspacePath(rawPath, workspacePath, {
          allowExternalAbsolute: true,
        });
        if (isWithin(workspacePath, resolved)) return resolved;

        const normalized = normalizeForComparison(resolved);
        const allowedForInvocation =
          invocationPaths.has(normalized) ||
          invocationDirectories.some((directory) => isWithin(directory, resolved));
        const allowedForSession = this.hasSessionDirectoryGrant(request.operation, resolved);
        if (allowedForInvocation || allowedForSession) return resolved;

        throw new Error(`External path access was not approved: ${resolved}`);
      },
    };
  }

  clear(): void {
    this.sessionDirectories.clear();
  }

  private hasSessionDirectoryGrant(operation: ExternalPathOperation, path: string): boolean {
    const directories = this.sessionDirectories.get(operation);
    if (!directories) return false;
    return [...directories].some((directory) => isWithin(directory, path));
  }
}
