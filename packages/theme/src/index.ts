export type ThemeType = 'dark' | 'light';

export type ThemeColors = {
  bg: string;
  surface: string;
  sidebar: string;
  accent: string;
  fg: string;
  muted: string;
  soft: string;
  panel: string;
  warning: string;
  success: string;
  error: string;
};

export type ThemeSummary = {
  id: string;
  name: string;
  description: string;
  type: ThemeType;
  source: 'builtin' | 'extension';
  extensionName?: string;
  colors: ThemeColors;
};

export const DEFAULT_THEME_ID = 'hyscode-dark';

export const BUILTIN_THEMES: readonly ThemeSummary[] = [
  {
    id: 'hyscode-dark',
    name: 'HysCode Dark',
    description: 'Deep editor-matched surfaces with a teal accent',
    type: 'dark',
    source: 'builtin',
    colors: {
      bg: '#18191d',
      surface: '#202123',
      sidebar: '#18191d',
      accent: '#10a37f',
      fg: '#ececf1',
      muted: '#8e8ea0',
      soft: '#c5c5d2',
      panel: '#3a3b44',
      warning: '#facc15',
      success: '#4ade80',
      error: '#f87171',
    },
  },
  {
    id: 'aura',
    name: 'Aura',
    description: 'Purple focus with mint controls and warm syntax accents',
    type: 'dark',
    source: 'builtin',
    colors: {
      bg: '#110f18',
      surface: '#15141b',
      sidebar: '#110f18',
      accent: '#a277ff',
      fg: '#edecee',
      muted: '#adacae',
      soft: '#cdccce',
      panel: '#3b334b',
      warning: '#ffca85',
      success: '#61ffca',
      error: '#ff6767',
    },
  },
  {
    id: 'hyscode-light',
    name: 'HysCode Light',
    description: 'Editor-matched light surfaces with a teal accent',
    type: 'light',
    source: 'builtin',
    colors: {
      bg: '#f1f2f4',
      surface: '#ffffff',
      sidebar: '#f1f2f4',
      accent: '#0d8a6c',
      fg: '#0d0d0f',
      muted: '#6e6e80',
      soft: '#374151',
      panel: '#d9d9e3',
      warning: '#d97706',
      success: '#16a34a',
      error: '#dc2626',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Editor-matched arctic surfaces with a cyan accent',
    type: 'dark',
    source: 'builtin',
    colors: {
      bg: '#292e39',
      surface: '#2e3440',
      sidebar: '#292e39',
      accent: '#88c0d0',
      fg: '#d8dee9',
      muted: '#a0a8b7',
      soft: '#d8dee9',
      panel: '#4c566a',
      warning: '#ebcb8b',
      success: '#a3be8c',
      error: '#bf616a',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    description: 'Editor-matched warm surfaces with vibrant accents',
    type: 'dark',
    source: 'builtin',
    colors: {
      bg: '#1e1f1c',
      surface: '#272822',
      sidebar: '#1a1b18',
      accent: '#f92672',
      fg: '#f8f8f2',
      muted: '#8f908a',
      soft: '#f8f8f2',
      panel: '#4e4f47',
      warning: '#f4bf75',
      success: '#a6e22e',
      error: '#f92672',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Editor-matched dark surfaces with purple-pink accents',
    type: 'dark',
    source: 'builtin',
    colors: {
      bg: '#21222c',
      surface: '#282a36',
      sidebar: '#21222c',
      accent: '#bd93f9',
      fg: '#f8f8f2',
      muted: '#a0a4b8',
      soft: '#f8f8f2',
      panel: '#44475a',
      warning: '#f1fa8c',
      success: '#50fa7b',
      error: '#ff5555',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    description: 'Editor-matched GitHub dark surfaces',
    type: 'dark',
    source: 'builtin',
    colors: {
      bg: '#010409',
      surface: '#0d1117',
      sidebar: '#010409',
      accent: '#58a6ff',
      fg: '#c9d1d9',
      muted: '#8b949e',
      soft: '#c9d1d9',
      panel: '#30363d',
      warning: '#d29922',
      success: '#3fb950',
      error: '#f85149',
    },
  },
];

export function getBuiltinTheme(themeId: string): ThemeSummary | undefined {
  return BUILTIN_THEMES.find((theme) => theme.id === themeId);
}

export function deriveThemeColors(
  type: ThemeType,
  colors: Record<string, unknown>,
): ThemeColors {
  const background = type === 'light' ? '#ffffff' : '#1a1a1a';
  const foreground = type === 'light' ? '#1a1a1a' : '#e8e8e8';
  const bg = color(colors['editor.background'], color(colors.background, background));
  const fg = color(colors['editor.foreground'], color(colors.foreground, foreground));
  const muted = color(colors['editorLineNumber.foreground'], color(colors['tab.inactiveForeground'], '#888888'));
  const accent = color(
    colors.focusBorder,
    color(colors['button.background'], color(colors['editorCursor.foreground'], '#10a37f')),
  );

  return {
    bg,
    surface: color(colors['panel.background'], color(colors['sideBar.background'], bg)),
    sidebar: color(colors['activityBar.background'], color(colors['sideBar.background'], bg)),
    accent,
    fg,
    muted,
    soft: fg,
    panel: color(colors['panel.border'], color(colors['sideBar.border'], color(colors['editorWidget.border'], muted))),
    warning: color(colors['terminal.ansiYellow'], color(colors['editorOverviewRuler.modifiedForeground'], '#facc15')),
    success: color(colors['terminal.ansiGreen'], color(colors['gitDecoration.addedResourceForeground'], '#4ade80')),
    error: color(colors.errorForeground, color(colors['terminal.ansiRed'], '#f87171')),
  };
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
