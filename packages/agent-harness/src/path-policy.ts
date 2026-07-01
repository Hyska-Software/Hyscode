const WINDOWS_ABSOLUTE = /^[a-zA-Z]:\//;

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function splitAbsolute(path: string): { root: string; segments: string[] } {
  const normalized = normalize(path);
  const root = WINDOWS_ABSOLUTE.test(normalized)
    ? normalized.slice(0, 2).toLowerCase()
    : normalized.startsWith('/')
      ? '/'
      : '';
  const remainder = root === '/' ? normalized.slice(1) : normalized.slice(root.length + 1);
  return { root, segments: remainder.split('/').filter(Boolean) };
}

function collapse(root: string, segments: string[]): string {
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) throw new Error('Path escapes its filesystem root.');
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return root === '/' ? `/${resolved.join('/')}` : `${root}/${resolved.join('/')}`;
}

export type WorkspacePathOptions = { allowExternalAbsolute?: boolean };

/** Resolve a path and enforce workspace containment unless external access is explicit. */
export function resolveWorkspacePath(
  path: string,
  workspacePath: string,
  options: WorkspacePathOptions = {},
): string {
  if (!path.trim()) throw new Error('Path must not be empty.');
  const workspaceParts = splitAbsolute(workspacePath);
  const workspace = collapse(workspaceParts.root, workspaceParts.segments);
  const input = normalize(path);
  const absolute = input.startsWith('/') || WINDOWS_ABSOLUTE.test(input);
  const inputParts = absolute ? splitAbsolute(input) : workspaceParts;
  const candidate = collapse(
    inputParts.root,
    absolute ? inputParts.segments : [...workspaceParts.segments, ...input.split('/')],
  );

  if (absolute && options.allowExternalAbsolute) return candidate;
  const workspaceKey = workspace.toLowerCase();
  const candidateKey = candidate.toLowerCase();
  if (candidateKey !== workspaceKey && !candidateKey.startsWith(`${workspaceKey}/`)) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return candidate;
}
