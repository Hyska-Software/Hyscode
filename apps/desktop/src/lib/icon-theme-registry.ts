/**
 * Icon Theme Registry
 *
 * Module-level singleton that holds resolved icon themes and language icon
 * overrides. All SVG assets are pre-loaded as base64 data URLs so that
 * getFileIconUrl / getFolderIconUrl are synchronous and safe to call during
 * React renders.
 *
 * Priority order for file icon resolution:
 *   1. Active full icon theme pack (highest)
 *   2. Language-contribution icon overrides (per-extension language icons)
 *   3. Built-in SVG React components (fallback — handled in file-icons.tsx)
 */

import type { IconThemeDefinition } from '@hyscode/extension-api';

// ── Internal types ────────────────────────────────────────────────────────────

interface ResolvedIconTheme {
  id: string;
  label: string;
  extensionName: string;
  /** icon id → data URL */
  iconDataUrls: Map<string, string>;
  file?: string;
  folder?: string;
  folderExpanded?: string;
  /** normalized lowercase ext (no dot) → icon id */
  fileExtensions: Record<string, string>;
  /** normalized lowercase filename → icon id */
  fileNames: Record<string, string>;
  /** normalized lowercase folder name → icon id */
  folderNames: Record<string, string>;
  /** normalized lowercase folder name → icon id (open state) */
  folderNamesExpanded: Record<string, string>;
}

// ── State ─────────────────────────────────────────────────────────────────────

const _themes = new Map<string, ResolvedIconTheme>();
let _activeThemeId = 'default';
const _changeListeners = new Set<(themeId: string) => void>();

/**
 * Language-level icon overrides contributed by individual extensions.
 * Keys: `ext:<extension>` or `name:<filename>` (lowercase, ext without dot).
 */
const _languageIcons = new Map<string, string>();

// ── Normalization helpers ────────────────────────────────────────────────────

function normalizeExt(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase();
}

function normalizeName(name: string): string {
  return name.toLowerCase();
}

function normalizeRecord(rec: Record<string, string> | undefined): Record<string, string> {
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[normalizeName(k)] = v;
  }
  return out;
}

function normalizeExtRecord(rec: Record<string, string> | undefined): Record<string, string> {
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[normalizeExt(k)] = v;
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a fully resolved icon theme.
 *
 * @param id              Unique theme id (from `IconThemeContribution.id`)
 * @param label           Human-readable label
 * @param extensionName   Name of the contributing extension
 * @param def             Parsed `IconThemeDefinition` JSON
 * @param svgLoader       Async function that maps an SVG path (relative to the
 *                        theme JSON file's dir) → base64 data URL string.
 *                        Return `null` if the asset cannot be loaded.
 */
export async function registerIconTheme(
  id: string,
  label: string,
  extensionName: string,
  def: IconThemeDefinition,
  svgLoader: (svgPath: string) => Promise<string | null>,
): Promise<void> {
  const iconDataUrls = new Map<string, string>();

  for (const [iconId, imgDef] of Object.entries(def.iconDefinitions)) {
    if (!imgDef.svgPath) continue;
    try {
      const dataUrl = await svgLoader(imgDef.svgPath);
      if (dataUrl) iconDataUrls.set(iconId, dataUrl);
    } catch {
      // silently skip unloadable icons
    }
  }

  const resolved: ResolvedIconTheme = {
    id,
    label,
    extensionName,
    iconDataUrls,
    file: def.file,
    folder: def.folder,
    folderExpanded: def.folderExpanded,
    fileExtensions: normalizeExtRecord(def.fileExtensions),
    fileNames: normalizeRecord(def.fileNames),
    folderNames: normalizeRecord(def.folderNames),
    folderNamesExpanded: normalizeRecord(def.folderNamesExpanded),
  };

  _themes.set(id, resolved);
}

/** Remove a previously registered icon theme. */
export function unregisterIconTheme(id: string): void {
  _themes.delete(id);
  if (_activeThemeId === id) {
    setActiveIconThemeId('default');
  }
}

/** Set the active icon theme. Use `'default'` to restore built-ins. */
export function setActiveIconThemeId(id: string): void {
  _activeThemeId = id;
  _changeListeners.forEach((fn) => fn(id));
}

/** Returns the id of the currently active icon theme. */
export function getActiveIconThemeId(): string {
  return _activeThemeId;
}

/** Returns metadata for all registered icon themes (for the settings UI). */
export function getRegisteredIconThemes(): Array<{ id: string; label: string; extensionName: string }> {
  return Array.from(_themes.values()).map(({ id, label, extensionName }) => ({ id, label, extensionName }));
}

/** Subscribe to icon theme changes. Returns an unsubscribe function. */
export function subscribeIconThemeChange(listener: (themeId: string) => void): () => void {
  _changeListeners.add(listener);
  return () => _changeListeners.delete(listener);
}

// ── Language icon overrides ───────────────────────────────────────────────────

/**
 * Register a language-level icon override from an individual extension.
 * Lower priority than a full icon theme pack.
 *
 * @param extensions  File extensions without leading dot, e.g. `['ts', 'tsx']`
 * @param fileNames   Exact file names, e.g. `['package.json']`
 * @param dataUrl     The SVG as a data URL
 */
export function registerLanguageIcon(
  extensions: string[],
  fileNames: string[],
  dataUrl: string,
): void {
  for (const ext of extensions) {
    _languageIcons.set(`ext:${normalizeExt(ext)}`, dataUrl);
  }
  for (const name of fileNames) {
    _languageIcons.set(`name:${normalizeName(name)}`, dataUrl);
  }
}

/**
 * Remove all language icon overrides contributed by a specific extension.
 * Since multiple extensions may contribute icons for the same keys, this
 * performs a full rebuild from the retained entries instead of key-by-key
 * deletion.  Callers (extension-store) are expected to call
 * `loadLanguageIcons` after unregistering to rebuild from remaining sources.
 */
export function clearLanguageIcons(keys: Array<{ ext?: string; name?: string }>): void {
  for (const entry of keys) {
    if (entry.ext !== undefined) _languageIcons.delete(`ext:${normalizeExt(entry.ext)}`);
    if (entry.name !== undefined) _languageIcons.delete(`name:${normalizeName(entry.name)}`);
  }
}

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Resolve the icon data URL for a file name.
 * Returns `null` when no registered theme matches (fall back to built-ins).
 */
export function resolveFileIconUrl(fileName: string): string | null {
  const lower = normalizeName(fileName);
  const ext = lower.split('.').pop() ?? '';

  // 1. Active full icon theme
  if (_activeThemeId !== 'default') {
    const theme = _themes.get(_activeThemeId);
    if (theme) {
      const iconId =
        theme.fileNames[lower] ??
        theme.fileExtensions[ext] ??
        theme.file;
      if (iconId) {
        const url = theme.iconDataUrls.get(iconId);
        if (url) return url;
      }
    }
  }

  // 2. Language icon overrides
  const langByName = _languageIcons.get(`name:${lower}`);
  if (langByName) return langByName;
  const langByExt = _languageIcons.get(`ext:${ext}`);
  if (langByExt) return langByExt;

  return null;
}

/**
 * Resolve the icon data URL for a folder name.
 * Returns `null` when no registered theme matches (fall back to built-ins).
 */
export function resolveFolderIconUrl(folderName: string, isOpen: boolean): string | null {
  const lower = normalizeName(folderName);

  if (_activeThemeId !== 'default') {
    const theme = _themes.get(_activeThemeId);
    if (theme) {
      let iconId: string | undefined;
      if (isOpen) {
        iconId = theme.folderNamesExpanded[lower] ?? theme.folderNames[lower] ?? theme.folderExpanded ?? theme.folder;
      } else {
        iconId = theme.folderNames[lower] ?? theme.folder;
      }
      if (iconId) {
        const url = theme.iconDataUrls.get(iconId);
        if (url) return url;
      }
    }
  }

  return null;
}
