import { Check } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import { useExtensionStore } from '../../../stores/extension-store';
import { getCustomThemeMetas } from '../../../lib/monaco-themes';
import { getRegisteredIconThemes, setActiveIconThemeId } from '../../../lib/icon-theme-registry';
import type { ThemeId } from '../../../stores/settings-store';

interface ThemeOption {
  id: ThemeId;
  name: string;
  description: string;
  colors: {
    bg: string;
    surface: string;
    sidebar: string;
    accent: string;
    fg: string;
    muted: string;
  };
}

const THEMES: ThemeOption[] = [
  {
    id: 'hyscode-dark',
    name: 'HysCode Dark',
    description: 'Default dark theme with purple accents',
    colors: {
      bg: '#0d0d0d',
      surface: '#181818',
      sidebar: '#111111',
      accent: '#a855f7',
      fg: '#e8e8e8',
      muted: '#888888',
    },
  },
  {
    id: 'hyscode-light',
    name: 'HysCode Light',
    description: 'Clean light theme for daytime work',
    colors: {
      bg: '#f5f5f5',
      surface: '#ffffff',
      sidebar: '#eaeaea',
      accent: '#7c3aed',
      fg: '#1a1a1a',
      muted: '#666666',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Cool arctic blues inspired by the polar night',
    colors: {
      bg: '#2e3440',
      surface: '#3b4252',
      sidebar: '#292e39',
      accent: '#88c0d0',
      fg: '#d8dee9',
      muted: '#a0a8b7',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    description: 'Classic warm theme with vibrant colors',
    colors: {
      bg: '#1e1f1c',
      surface: '#272822',
      sidebar: '#1a1b18',
      accent: '#f92672',
      fg: '#f8f8f2',
      muted: '#8f908a',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Dark theme with purple-pink tones',
    colors: {
      bg: '#282a36',
      surface: '#2d2f3d',
      sidebar: '#21222c',
      accent: '#bd93f9',
      fg: '#f8f8f2',
      muted: '#a0a4b8',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    description: 'Dark theme inspired by GitHub interface',
    colors: {
      bg: '#0d1117',
      surface: '#161b22',
      sidebar: '#010409',
      accent: '#58a6ff',
      fg: '#c9d1d9',
      muted: '#8b949e',
    },
  },
];

function ThemeCard({
  id,
  name,
  description,
  colors,
  isActive,
  onSelect,
}: {
  id: string;
  name: string;
  description: string;
  colors: ThemeOption['colors'];
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      key={id}
      onClick={onSelect}
      className={`group relative flex flex-col overflow-hidden rounded-lg transition-all ${
        isActive
          ? 'ring-2 ring-accent ring-offset-1 ring-offset-background'
          : 'hover:ring-1 hover:ring-muted-foreground/30'
      }`}
    >
      {/* Theme preview */}
      <div className="flex h-24 w-full flex-col p-2" style={{ background: colors.bg }}>
        <div className="flex flex-1 gap-1">
          <div className="w-5 rounded-sm" style={{ background: colors.sidebar }} />
          <div
            className="flex flex-1 flex-col gap-1 rounded-sm p-1.5"
            style={{ background: colors.surface }}
          >
            <div className="flex gap-1">
              <div className="h-1 w-6 rounded-full" style={{ background: colors.accent, opacity: 0.8 }} />
              <div className="h-1 w-10 rounded-full" style={{ background: colors.fg, opacity: 0.3 }} />
            </div>
            <div className="flex gap-1">
              <div className="h-1 w-3 rounded-full" style={{ background: colors.muted, opacity: 0.5 }} />
              <div className="h-1 w-8 rounded-full" style={{ background: colors.fg, opacity: 0.25 }} />
              <div className="h-1 w-5 rounded-full" style={{ background: colors.accent, opacity: 0.5 }} />
            </div>
            <div className="flex gap-1">
              <div className="h-1 w-8 rounded-full" style={{ background: colors.fg, opacity: 0.2 }} />
            </div>
            <div className="flex gap-1">
              <div className="h-1 w-4 rounded-full" style={{ background: colors.accent, opacity: 0.6 }} />
              <div className="h-1 w-12 rounded-full" style={{ background: colors.fg, opacity: 0.15 }} />
            </div>
          </div>
        </div>
      </div>

      {/* Label */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: colors.surface }}>
        {isActive && (
          <Check className="h-3 w-3 shrink-0" style={{ color: colors.accent }} />
        )}
        <div className="flex flex-col items-start">
          <span className="text-[11px] font-medium" style={{ color: colors.fg }}>
            {name}
          </span>
          <span className="text-[10px]" style={{ color: colors.muted }}>
            {description}
          </span>
        </div>
      </div>

      {/* Color swatches */}
      <div
        className="flex gap-0 border-t"
        style={{ borderColor: `${colors.muted}33`, background: colors.surface }}
      >
        {[colors.bg, colors.surface, colors.sidebar, colors.accent, colors.fg, colors.muted].map(
          (color, i) => (
            <div key={i} className="h-2 flex-1" style={{ background: color }} />
          ),
        )}
      </div>
    </button>
  );
}

export function ThemeTab() {
  const themeId = useSettingsStore((s) => s.themeId);
  const setThemeId = useSettingsStore((s) => s.setThemeId);
  const iconThemeId = useSettingsStore((s) => s.iconThemeId);
  const setIconThemeId = useSettingsStore((s) => s.setIconThemeId);
  // Re-render when extension themes finish loading
  useExtensionStore((s) => s.extensionThemesVersion);
  useExtensionStore((s) => s.extensionIconThemesVersion);
  const customMetas = getCustomThemeMetas();
  const extensionIconThemes = getRegisteredIconThemes();

  function handleSelectIconTheme(id: string) {
    setIconThemeId(id);
    setActiveIconThemeId(id);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-muted-foreground">
        Choose a color theme for the entire application. Changes apply immediately.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            id={theme.id}
            name={theme.name}
            description={theme.description}
            colors={theme.colors}
            isActive={themeId === theme.id}
            onSelect={() => setThemeId(theme.id)}
          />
        ))}
      </div>

      {customMetas.length > 0 && (
        <>
          <div className="mt-2 border-t border-border pt-3">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">
              Extension Themes
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {customMetas.map((meta) => (
              <ThemeCard
                key={meta.themeId}
                id={meta.themeId as ThemeId}
                name={meta.label}
                description={meta.extensionName ? `from ${meta.extensionName}` : 'Custom theme'}
                colors={meta.colors}
                isActive={themeId === meta.themeId}
                onSelect={() => setThemeId(meta.themeId as ThemeId)}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Icon Themes ──────────────────────────────────────────────────── */}
      <div className="mt-2 border-t border-border pt-3">
        <p className="text-[11px] font-medium text-foreground mb-1">Icon Theme</p>
        <p className="text-[10px] text-muted-foreground mb-3">
          Changes file and folder icons throughout the IDE.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        {/* Built-in default option */}
        <IconThemeRow
          id="default"
          label="Default"
          description="Built-in material-style icons"
          isActive={iconThemeId === 'default'}
          onSelect={() => handleSelectIconTheme('default')}
        />
        {extensionIconThemes.map((t) => (
          <IconThemeRow
            key={t.id}
            id={t.id}
            label={t.label}
            description={`from ${t.extensionName}`}
            isActive={iconThemeId === t.id}
            onSelect={() => handleSelectIconTheme(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function IconThemeRow({
  label,
  description,
  isActive,
  onSelect,
}: {
  id: string;
  label: string;
  description: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
        isActive
          ? 'bg-accent/15 ring-1 ring-accent'
          : 'hover:bg-muted/40'
      }`}
    >
      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
        isActive ? 'border-accent bg-accent' : 'border-muted-foreground/40'
      }`}>
        {isActive && <Check className="h-2.5 w-2.5 text-accent-foreground" />}
      </div>
      <div className="flex flex-col">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">{description}</span>
      </div>
    </button>
  );
}
