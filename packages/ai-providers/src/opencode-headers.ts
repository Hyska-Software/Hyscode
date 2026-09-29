// ─── OpenCode Gateway Request Headers ─────────────────────────────────────────
// Shared helper for OpenCode Zen / Go requests (issue: x-opencode-session).
//
// Official docs (opencode.ai/docs/{go,zen}) require:
//   1. a stable `x-opencode-session` header per conversation so the gateway can
//      optimize prompt caching — missing headers may error starting 09/06.
//   2. a non-generic User-Agent identifying the tool (generic `Bun fetch` or a
//      missing UA gets flagged as abusive traffic).
//
// The harness already passes `ChatParams.sessionId` (conversationId) into every
// provider chat call — the base providers below forward it as the header, but
// ONLY for opencode.ai URLs so session ids never leak to unrelated vendors.
// Vortex (Bun) and Hyscode Desktop (Tauri reqwest) share this helper; the Rust
// transport sets the same UA as a fallback because browsers forbid User-Agent.

export const OPENCODE_SESSION_HEADER = 'x-opencode-session';

const HYSCODE_USER_AGENT = 'HysCode';
const VORTEX_USER_AGENT = 'Vortex';

function isBunRuntime(): boolean {
  try {
    return (
      typeof process !== 'undefined' &&
      (process.versions as Record<string, string> | undefined)?.bun !== undefined
    );
  } catch {
    return false;
  }
}

/** Identifiable User-Agent for OpenCode gateway traffic. */
export function opencodeUserAgent(): string {
  return isBunRuntime() ? VORTEX_USER_AGENT : HYSCODE_USER_AGENT;
}

export function isOpencodeUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'opencode.ai' || hostname.endsWith('.opencode.ai');
  } catch {
    return false;
  }
}

/**
 * Extra headers for an OpenCode gateway fetch. Returns an empty object for
 * non-OpenCode URLs. `sessionId` becomes `x-opencode-session` when present;
 * User-Agent is always set so Bun/reqwest defaults never leak through.
 */
export function opencodeRequestHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': opencodeUserAgent() };
  if (sessionId) headers[OPENCODE_SESSION_HEADER] = sessionId;
  return headers;
}

/**
 * Merges OpenCode headers into an existing header record without overwriting
 * caller-provided values (e.g. a test-injected User-Agent wins).
 */
export function withOpencodeHeaders(
  base: Record<string, string>,
  url: string,
  sessionId?: string,
): Record<string, string> {
  if (!isOpencodeUrl(url)) return base;
  const extra = opencodeRequestHeaders(sessionId);
  const merged: Record<string, string> = { ...extra, ...base };
  // Header names are case-insensitive — normalize a caller-provided
  // `user-agent` / `x-opencode-session` spelling so we never send duplicates.
  const lowerKeys = new Map(Object.keys(base).map((k) => [k.toLowerCase(), k]));
  const uaKey = lowerKeys.get('user-agent');
  if (uaKey && uaKey !== 'User-Agent') {
    merged['User-Agent'] = base[uaKey];
    delete merged[uaKey];
  }
  const sessionKey = lowerKeys.get(OPENCODE_SESSION_HEADER);
  if (sessionId && sessionKey && sessionKey !== OPENCODE_SESSION_HEADER) {
    merged[OPENCODE_SESSION_HEADER] = base[sessionKey];
    delete merged[sessionKey];
  }
  return merged;
}
