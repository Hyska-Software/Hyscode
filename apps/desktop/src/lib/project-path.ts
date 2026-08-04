/**
 * Canonical project path helpers shared by persistence and the VORTEX index.
 * The desktop app receives paths from Windows and Tauri with mixed separators,
 * so comparisons must not depend on the representation returned by a picker.
 */
export function normalizeProjectPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/');
  if (normalized.length <= 1) return normalized;
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized;
  return normalized.replace(/\/$/, '');
}

export function projectPathKey(path: string): string {
  const normalized = normalizeProjectPath(path);
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function areSameProjectPath(left: string | null, right: string | null): boolean {
  if (!left || !right) return left === right;
  return projectPathKey(left) === projectPathKey(right);
}
