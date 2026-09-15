// ─── Document URI helpers ────────────────────────────────────────────────────
// LSP requests must carry canonical `file:` URIs. Monaco models created from
// raw filesystem paths (`monaco.Uri.parse('D:\\a\\b.rs')`) end up with a
// one-letter scheme and backslashes, which servers reject with errors such as
// `url is not a file`. These helpers normalize paths and model URIs to the same
// canonical form Monaco/vscode-uri emits (`file:///d%3A/...`).

export interface UriLike {
  scheme?: string;
  path?: string;
  toString(): string;
}

/**
 * Percent-encode a path segment the same way vscode-uri/Monaco does, so model
 * URIs and bridge URIs compare equal (`encodeURIComponent` leaves `!'()*`
 * unencoded, Monaco encodes them).
 */
function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canonical `file:` URI for a filesystem path. Backslashes are normalized,
 * every path segment is percent-encoded and Windows drive letters are
 * lowercased with an encoded colon (`file:///d%3A/...`).
 */
export function pathToFileUri(filePath: string): string {
  const slashNormalized = filePath.replace(/\\/g, '/');
  if (/^file:/i.test(slashNormalized)) return slashNormalized;
  const encoded = slashNormalized
    .split('/')
    .map((segment) => encodePathSegment(segment))
    .join('/');
  const withDrive = encoded.replace(
    /^([A-Za-z])%3A/,
    (_match, drive: string) => `${drive.toLowerCase()}%3A`,
  );
  if (withDrive.startsWith('//')) return `file:${withDrive}`;
  return withDrive.startsWith('/') ? `file://${withDrive}` : `file:///${withDrive}`;
}

/**
 * Filesystem path for a `file:` URI (`file:///d%3A/a.rs` → `d:/a.rs`). Returns
 * the input unchanged for other schemes.
 */
export function fileUriToPath(uri: string): string {
  const match = /^file:(.*)$/i.exec(uri);
  if (!match) return uri;
  try {
    const parsed = new URL(uri);
    const pathname = decodeURIComponent(parsed.pathname);
    if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') {
      return `//${parsed.hostname}${pathname}`;
    }
    return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    try {
      return decodeURIComponent(match[1]).replace(/^\/([A-Za-z]:)/, '$1');
    } catch {
      return match[1];
    }
  }
}

/**
 * LSP document URI for a Monaco model. `file` models are returned as-is;
 * models parsed from raw Windows paths are rebuilt as canonical `file:` URIs.
 * Returns `null` for non-file models (history snapshots, diff/in-memory
 * models, untitled buffers) so providers can skip requests to the server.
 */
export function documentUriFromModelUri(uri: UriLike): string | null {
  const scheme = typeof uri.scheme === 'string' ? uri.scheme : '';
  if (scheme === 'file') return uri.toString();
  if (typeof uri.scheme !== 'string') {
    return /^file:/i.test(uri.toString()) ? uri.toString() : null;
  }
  if (scheme === '' || /^[A-Za-z]$/.test(scheme)) {
    const path = typeof uri.path === 'string' ? uri.path : '';
    const raw = scheme === '' ? path : `${scheme}:${path}`;
    return raw.length > 0 ? pathToFileUri(raw) : null;
  }
  return null;
}
