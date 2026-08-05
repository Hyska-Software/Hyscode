export const DEFAULT_VORTEX_SESSION_TITLE = 'New Chat';

const PLACEHOLDER_SESSION_TITLES = new Set(['new chat', 'new conversation']);
const SESSION_TITLE_MAX_LENGTH = 40;

export function isPlaceholderVortexSessionTitle(title: string | null | undefined): boolean {
  return !title || PLACEHOLDER_SESSION_TITLES.has(title.trim().toLowerCase());
}

export function titleFromVortexUserMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.slice(0, SESSION_TITLE_MAX_LENGTH).trimEnd() +
    (trimmed.length > SESSION_TITLE_MAX_LENGTH ? '…' : '');
}

export function resolveVortexSessionTitle(options: {
  explicitTitle?: string | null;
  persistedTitle?: string | null;
  tabTitle?: string | null;
  firstUserMessage?: string | null;
}): string {
  const explicitTitle = options.explicitTitle?.trim();
  if (explicitTitle && !isPlaceholderVortexSessionTitle(explicitTitle)) return explicitTitle;

  const persistedTitle = options.persistedTitle?.trim();
  if (persistedTitle && !isPlaceholderVortexSessionTitle(persistedTitle)) return persistedTitle;

  const derivedTitle = titleFromVortexUserMessage(options.firstUserMessage);
  if (derivedTitle) return derivedTitle;

  const tabTitle = options.tabTitle?.trim();
  if (tabTitle && !isPlaceholderVortexSessionTitle(tabTitle)) return tabTitle;

  return DEFAULT_VORTEX_SESSION_TITLE;
}
