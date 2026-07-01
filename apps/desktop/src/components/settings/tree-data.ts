/**
 * Settings sidebar tree data
 *
 * Defines the hierarchical group structure for the redesigned settings sidebar,
 * plus helpers for search, navigation, modified-tab detection, and reset.
 *
 * The tree is intentionally two levels deep (group → leaf). Built-in leaves
 * map 1:1 to existing BuiltinTabId values. Extension-contributed tabs form
 * a synthetic "extensions" group at the end.
 */

import {
  Code2,
  Palette,
  Terminal,
  GitBranch,
  Settings2,
  BrainCircuit,
  Braces,
  Smartphone,
  Container,
  Info,
  Blocks,
  BookText,
  Bot,
  Briefcase,
  Pencil,
  Sparkles,
  Plug,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settings-store';
import { SETTINGS_DEFAULTS, type SettingsKey } from '../../stores/settings-store-defaults';

// ── Types ────────────────────────────────────────────────────────────────────

export type BuiltinTabId =
  | 'editor'
  | 'theme'
  | 'terminal'
  | 'git'
  | 'general'
  | 'ai'
  | 'languages'
  | 'mobile'
  | 'docker'
  | 'extensions'
  | 'rules'
  | 'sub-agents'
  | 'about';

export type GroupId = 'workspace' | 'editor' | 'source-control' | 'intelligence' | 'integrations' | 'about' | 'extensions';

export type LeafId = BuiltinTabId | string;

export interface SettingsLeaf {
  kind: 'leaf';
  id: LeafId;
  label: string;
  icon: LucideIcon;
  /** Searchable aliases beyond the label (lowercased). */
  keywords?: string[];
}

export interface SettingsGroup {
  kind: 'group';
  id: GroupId;
  label: string;
  icon: LucideIcon;
  leaves: SettingsLeaf[];
}

export type SettingsNode = SettingsGroup | SettingsLeaf;

export interface ExtensionTabRef {
  id: string;
  label: string;
  icon: LucideIcon;
  extensionName: string;
}

// ── Built-in groups ──────────────────────────────────────────────────────────

export const BUILTIN_GROUPS: SettingsGroup[] = [
  {
    kind: 'group',
    id: 'workspace',
    label: 'Workspace',
    icon: Briefcase,
    leaves: [
      {
        kind: 'leaf',
        id: 'general',
        label: 'General',
        icon: Settings2,
        keywords: ['updates', 'application', 'app', 'startup', 'welcome'],
      },
    ],
  },
  {
    kind: 'group',
    id: 'editor',
    label: 'Editor',
    icon: Pencil,
    leaves: [
      {
        kind: 'leaf',
        id: 'editor',
        label: 'Editor',
        icon: Code2,
        keywords: ['font', 'text', 'cursor', 'format', 'whitespace', 'bracket', 'autosave'],
      },
      {
        kind: 'leaf',
        id: 'theme',
        label: 'Themes',
        icon: Palette,
        keywords: ['color', 'appearance', 'monokai', 'nord', 'dracula', 'icon', 'border'],
      },
      {
        kind: 'leaf',
        id: 'languages',
        label: 'Languages',
        icon: Braces,
        keywords: ['lsp', 'language server', 'binary'],
      },
      {
        kind: 'leaf',
        id: 'terminal',
        label: 'Terminal',
        icon: Terminal,
        keywords: ['shell', 'xterm', 'font'],
      },
    ],
  },
  {
    kind: 'group',
    id: 'source-control',
    label: 'Source Control',
    icon: GitBranch,
    leaves: [
      {
        kind: 'leaf',
        id: 'git',
        label: 'Git',
        icon: GitBranch,
        keywords: ['commit', 'branch', 'fetch', 'blame', 'identity', 'user'],
      },
    ],
  },
  {
    kind: 'group',
    id: 'intelligence',
    label: 'Intelligence',
    icon: Sparkles,
    leaves: [
      {
        kind: 'leaf',
        id: 'ai',
        label: 'AI & Providers',
        icon: BrainCircuit,
        keywords: [
          'model',
          'provider',
          'claude',
          'openai',
          'gemini',
          'mcp',
          'thinking',
          'inline',
          'approval',
          'temperature',
          'token',
        ],
      },
      {
        kind: 'leaf',
        id: 'rules',
        label: 'Rules',
        icon: BookText,
        keywords: ['global', 'system prompt', 'instructions', 'guidelines'],
      },
      {
        kind: 'leaf',
        id: 'sub-agents',
        label: 'Sub-agents',
        icon: Bot,
        keywords: ['agent', 'spawn', 'iteration', 'subagent'],
      },
    ],
  },
  {
    kind: 'group',
    id: 'integrations',
    label: 'Integrations',
    icon: Plug,
    leaves: [
      {
        kind: 'leaf',
        id: 'extensions',
        label: 'Extensions',
        icon: Blocks,
        keywords: ['plugin', 'add-on', 'marketplace'],
      },
      {
        kind: 'leaf',
        id: 'mobile',
        label: 'Mobile',
        icon: Smartphone,
        keywords: ['flutter', 'android', 'react native', 'sdk', 'ios'],
      },
      {
        kind: 'leaf',
        id: 'docker',
        label: 'Docker',
        icon: Container,
        keywords: ['container', 'compose', 'socket'],
      },
    ],
  },
  {
    kind: 'group',
    id: 'about',
    label: 'About',
    icon: Info,
    leaves: [{ kind: 'leaf', id: 'about', label: 'About', icon: Info }],
  },
];

export const EXTENSIONS_GROUP_ID: GroupId = 'extensions';
export const EXTENSIONS_GROUP_LABEL = 'Extensions';
export const EXTENSIONS_GROUP_ICON: LucideIcon = Puzzle;

// ── Default keys per tab (for modified detection & reset) ──────────────────

export const TAB_DEFAULT_KEYS: Record<BuiltinTabId, readonly SettingsKey[]> = {
  editor: [
    'fontSize',
    'fontFamily',
    'lineHeight',
    'tabSize',
    'insertSpaces',
    'wordWrap',
    'minimap',
    'lineNumbers',
    'cursorStyle',
    'renderWhitespace',
    'bracketPairColorization',
    'scrollBeyondLastLine',
    'smoothScrolling',
    'autoClosingBrackets',
    'autoClosingQuotes',
    'formatOnPaste',
    'formatOnType',
    'autoSave',
    'autoSaveDelay',
    'gitBlameInline',
  ],
  theme: ['themeId', 'iconThemeId', 'disableRoundedBorders'],
  terminal: ['terminalFontSize', 'terminalFontFamily', 'terminalScrollback', 'terminalShell', 'terminalCursorStyle'],
  git: [
    'gitUserName',
    'gitUserEmail',
    'gitDefaultBranch',
    'gitAutoFetch',
    'gitAutoFetchInterval',
    'gitConfirmDiscard',
    'commitAiProviderId',
    'commitAiModelId',
  ],
  general: ['confirmOnClose', 'showWelcomeOnStartup', 'reducedMotion', 'updateChannel', 'checkForUpdatesOnStartup', 'autoDownload'],
  ai: [
    'activeProviderId',
    'activeModelId',
    'useAllProviders',
    'agentType',
    'providers',
    'approvalMode',
    'customApprovalRules',
    'maxIterations',
    'temperature',
    'maxTokens',
    'topP',
    'inlineCompletionEnabled',
    'inlineCompletionProviderId',
    'inlineCompletionModelId',
    'inlineCompletionDelay',
    'inlineCompletionMaxTokens',
    'inlineCompletionTemperature',
    'enabledModels',
    'customModels',
    'thinkingSettings',
    'mcpServers',
    'skillsPath',
  ],
  languages: ['lspCustomBinaryPaths'],
  mobile: ['flutterSdkPath', 'androidSdkPath', 'reactNativeAutoDetect'],
  docker: ['dockerSocketPath', 'dockerShowStopped', 'dockerAutoRefreshInterval', 'dockerComposeFile'],
  extensions: [],
  rules: ['globalRulesPath'],
  'sub-agents': ['subAgentEnabled', 'subAgentDefaultMode', 'subAgentMaxIterations', 'subAgentAutoApprove'],
  about: [],
};

// ── Resolution helpers ──────────────────────────────────────────────────────

const ALL_LEAVES_BY_ID = new Map<LeafId, { leaf: SettingsLeaf; groupId: GroupId }>();
for (const g of BUILTIN_GROUPS) {
  for (const l of g.leaves) ALL_LEAVES_BY_ID.set(l.id, { leaf: l, groupId: g.id });
}

export function findBuiltinLeaf(id: string): { leaf: SettingsLeaf; groupId: GroupId } | undefined {
  return ALL_LEAVES_BY_ID.get(id);
}

export function findGroupForBuiltin(id: string): GroupId | undefined {
  return ALL_LEAVES_BY_ID.get(id)?.groupId;
}

export function getBuiltinGroup(id: GroupId): SettingsGroup | undefined {
  return BUILTIN_GROUPS.find((g) => g.id === id);
}

export function buildExtensionsGroup(extensionTabs: ExtensionTabRef[]): SettingsGroup | null {
  if (extensionTabs.length === 0) return null;
  return {
    kind: 'group',
    id: EXTENSIONS_GROUP_ID,
    label: EXTENSIONS_GROUP_LABEL,
    icon: EXTENSIONS_GROUP_ICON,
    leaves: extensionTabs.map((t) => ({
      kind: 'leaf',
      id: t.id,
      label: t.label,
      icon: t.icon,
      keywords: [t.extensionName.toLowerCase()],
    })),
  };
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Case-insensitive AND-token substring match.
 * Empty query always matches.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.toLowerCase().includes(token));
}

function leafSearchable(leaf: SettingsLeaf): string {
  return [leaf.label, ...(leaf.keywords ?? [])].join(' ');
}

/** Whether a group contains any node that matches the query. */
export function groupHasMatch(group: SettingsGroup, query: string): boolean {
  if (!query) return true;
  if (matchesQuery(group.label, query)) return true;
  return group.leaves.some((l) => matchesQuery(leafSearchable(l), query));
}

// ── Flatten visible nodes for keyboard navigation ───────────────────────────

export interface FlatNode {
  /** Stable id for keyboard focus & selection. */
  id: LeafId | GroupId;
  kind: 'group' | 'leaf';
  groupId: GroupId;
  /** Depth in the tree (groups are depth 0, leaves are depth 1). */
  depth: 0 | 1;
  /** Reference to the source node. */
  node: SettingsNode;
}

/**
 * Produce the ordered list of nodes that are currently visible in the tree,
 * given the set of expanded group ids and (optionally) an active search query.
 *
 * - When a query is active, groups without matches are omitted.
 * - When a query is active, groups with matches are forced open even if not in `expandedIds`.
 */
export function flattenVisible(
  groups: SettingsGroup[],
  expandedIds: ReadonlySet<GroupId>,
  query: string,
): FlatNode[] {
  const result: FlatNode[] = [];
  const trimmed = query.trim();
  for (const group of groups) {
    if (trimmed && !groupHasMatch(group, trimmed)) continue;
    result.push({ id: group.id, kind: 'group', groupId: group.id, depth: 0, node: group });
    const isOpen = trimmed ? groupHasMatch(group, trimmed) : expandedIds.has(group.id);
    if (!isOpen) continue;
    for (const leaf of group.leaves) {
      if (trimmed && !matchesQuery(leafSearchable(leaf), trimmed)) continue;
      result.push({ id: leaf.id, kind: 'leaf', groupId: group.id, depth: 1, node: leaf });
    }
  }
  return result;
}

// ── Modified detection ──────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** Returns true when at least one key belonging to this tab has a non-default value. */
export function isTabModified(tabId: BuiltinTabId): boolean {
  const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
  for (const key of TAB_DEFAULT_KEYS[tabId]) {
    const current = state[key as string];
    const fallback = SETTINGS_DEFAULTS[key];
    if (!deepEqual(current, fallback)) return true;
  }
  return false;
}

// ── Reset a single tab to defaults ──────────────────────────────────────────

export function resetTabToDefaults(tabId: BuiltinTabId): void {
  const store = useSettingsStore.getState();
  const set = store.set as unknown as (key: string, value: unknown) => void;
  for (const key of TAB_DEFAULT_KEYS[tabId]) {
    set(key, SETTINGS_DEFAULTS[key]);
  }
}

// ── Highlight helpers ──────────────────────────────────────────────────────

/** Split a string into segments marking which substrings match the query. */
export function highlightSegments(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text, match: false }];
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [{ text, match: false }];

  // Build a single regex that matches any token, case-insensitive.
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(${escaped})`, 'gi');
  const parts: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) parts.push({ text: text.slice(lastIndex, idx), match: false });
    parts.push({ text: match[0], match: true });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), match: false });
  return parts;
}
