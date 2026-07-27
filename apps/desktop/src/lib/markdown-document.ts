export type MarkdownLinkTarget =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'external'; url: string }
  | { kind: 'workspace'; path: string; anchor: string | null }
  | { kind: 'blocked' };

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const IMAGE_MIME_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const driveMatch = normalized.match(/^[A-Za-z]:/);
  const drive = driveMatch?.[0] ?? '';
  const absolute = drive.length > 0 || normalized.startsWith('/');
  const pathWithoutDrive = drive ? normalized.slice(drive.length) : normalized;
  const segments: string[] = [];

  for (const segment of pathWithoutDrive.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const prefix = drive ? `${drive}/` : absolute ? '/' : '';
  return `${prefix}${segments.join('/')}`;
}

function directoryName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : '';
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\');
}

function isWithinRoot(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase();
  const normalizedRoot = normalizePath(rootPath).replace(/\/+$/, '').toLowerCase();
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function splitLocalTarget(value: string): { path: string; anchor: string | null } {
  const hashIndex = value.indexOf('#');
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const anchor = hashIndex >= 0 ? safeDecode(value.slice(hashIndex + 1)) : null;
  const queryIndex = withoutHash.indexOf('?');
  return {
    path: queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash,
    anchor,
  };
}

export function resolveMarkdownLink(
  href: string,
  documentPath: string,
  rootPath: string,
): MarkdownLinkTarget {
  const trimmed = href.trim();
  if (!trimmed) return { kind: 'blocked' };

  if (trimmed.startsWith('#')) {
    const anchor = safeDecode(trimmed.slice(1));
    return anchor === null ? { kind: 'blocked' } : { kind: 'anchor', anchor };
  }

  if (trimmed.startsWith('//')) {
    return { kind: 'external', url: `https:${trimmed}` };
  }

  const protocolMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9+.-]*:)/);
  if (protocolMatch) {
    const protocol = protocolMatch[1].toLowerCase();
    if (EXTERNAL_PROTOCOLS.has(protocol)) return { kind: 'external', url: trimmed };
    if (!/^[A-Za-z]:[\\/]/.test(trimmed)) return { kind: 'blocked' };
  }

  const local = splitLocalTarget(trimmed);
  const decodedPath = safeDecode(local.path);
  if (decodedPath === null || decodedPath.includes('\0')) return { kind: 'blocked' };

  const candidate = isAbsolutePath(decodedPath)
    ? decodedPath.startsWith('/') && /^[A-Za-z]:/.test(rootPath)
      ? `${normalizePath(rootPath).replace(/\/+$/, '')}/${decodedPath.replace(/^[/\\]+/, '')}`
      : decodedPath
    : `${directoryName(documentPath)}/${decodedPath}`;
  const normalizedCandidate = normalizePath(candidate);

  if (!isWithinRoot(normalizedCandidate, rootPath)) return { kind: 'blocked' };
  return { kind: 'workspace', path: normalizedCandidate, anchor: local.anchor };
}

export function getImageMimeType(path: string): string | null {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME_TYPES[extension] ?? null;
}

export function slugifyMarkdownHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

