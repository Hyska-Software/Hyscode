import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  deriveThemeColors,
  type ThemeSummary,
  type ThemeType,
} from '@hyscode/theme';

type ThemeCatalogOptions = {
  extensionsPath?: string;
  extensionStatePath?: string;
};

type JsonObject = Record<string, unknown>;

type ExtensionThemeContribution = {
  id?: unknown;
  label?: unknown;
  uiTheme?: unknown;
  path?: unknown;
};

const DEFAULT_EXTENSIONS_PATH = path.join(os.homedir(), '.hyscode', 'extensions');

/**
 * Reads the same enabled extension theme contributions used by the desktop.
 * Theme files are data-only definitions, so the TUI does not execute extension
 * JavaScript just to build its presentation catalog.
 */
export async function loadThemeCatalog(options: ThemeCatalogOptions = {}): Promise<ThemeSummary[]> {
  const catalog = new Map(BUILTIN_THEMES.map((theme) => [theme.id, theme]));
  const extensionsPath = path.resolve(
    options.extensionsPath ?? process.env.HYSCODE_EXTENSIONS_PATH ?? DEFAULT_EXTENSIONS_PATH,
  );
  const extensionStatePath = path.resolve(
    options.extensionStatePath
      ?? process.env.HYSCODE_EXTENSION_STATE_PATH
      ?? path.join(path.dirname(extensionsPath), 'extension-state.json'),
  );
  const disabledExtensions = await readDisabledExtensions(extensionStatePath);

  let entries;
  try {
    entries = await readdir(extensionsPath, { withFileTypes: true });
  } catch {
    return [...catalog.values()];
  }

  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    if (disabledExtensions.has(entry.name)) continue;
    const extensionPath = path.join(extensionsPath, entry.name);
    const manifest = await readJson(path.join(extensionPath, 'extension.json'));
    if (!manifest) continue;
    const contributions = asRecord(manifest.contributes).themes;
    if (!Array.isArray(contributions)) continue;

    for (const rawContribution of contributions) {
      const contribution = asRecord(rawContribution) as ExtensionThemeContribution;
      const assetPath = stringValue(contribution.path);
      const contributionId = stringValue(contribution.id);
      if (!assetPath || !contributionId) continue;
      const themePath = path.resolve(extensionPath, assetPath);
      if (!isWithin(extensionPath, themePath)) continue;

      const definition = await readJson(themePath);
      if (!definition || catalog.has(contributionId)) continue;
      const definitionType: ThemeType = definition.type === 'light'
        ? 'light'
        : definition.type === 'dark'
          ? 'dark'
          : contribution.uiTheme === 'hyscode-light' ? 'light' : 'dark';
      const extensionName = stringValue(manifest.displayName) || stringValue(manifest.name) || entry.name;
      const displayName = extensionName;
      const label = stringValue(definition.label) || stringValue(contribution.label) || contributionId;
      catalog.set(contributionId, {
        id: contributionId,
        name: label,
        description: `${displayName} extension theme`,
        type: definitionType,
        source: 'extension',
        extensionName,
        colors: deriveThemeColors(definitionType, asRecord(definition.colors)),
      });
    }
  }

  return [...catalog.values()];
}

export function findTheme(catalog: readonly ThemeSummary[], themeId: string): ThemeSummary | undefined {
  return catalog.find((theme) => theme.id === themeId);
}

export function normalizeThemeId(catalog: readonly ThemeSummary[], themeId: unknown): string {
  const requested = typeof themeId === 'string' ? themeId : '';
  return findTheme(catalog, requested)?.id ?? catalog[0]?.id ?? DEFAULT_THEME_ID;
}

async function readDisabledExtensions(statePath: string): Promise<Set<string>> {
  const state = await readJson(statePath);
  const states = asRecord(state?.states);
  return new Set(
    Object.entries(states)
      .filter(([, enabled]) => enabled === false)
      .map(([name]) => name),
  );
}

async function readJson(filePath: string): Promise<JsonObject | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export type { ThemeSummary, ThemeType };
