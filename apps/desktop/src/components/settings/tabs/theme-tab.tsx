import { Check } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import { useExtensionStore } from '../../../stores/extension-store';
import { getCustomThemeMetas } from '../../../lib/monaco-themes';
import {
  getRegisteredIconThemes,
  setActiveIconThemeId,
  getIconPreviewSamples,
} from '../../../lib/icon-theme-registry';
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

// ── Icon Theme Card ────────────────────────────────────────────────────────────

const PREVIEW_FILES = ['index.ts', 'styles.css', 'package.json', 'readme.md'];
const PREVIEW_FOLDER = 'src';

const FILE_PREVIEW_COLORS: Record<string, string> = {
  ts: '#3b82f6', tsx: '#3b82f6',
  js: '#f59e0b', jsx: '#f59e0b',
  css: '#ec4899', scss: '#ec4899',
  json: '#10b981',
  md: '#94a3b8',
  rs: '#f97316',
};

function DefaultFilePreviewIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const color = FILE_PREVIEW_COLORS[ext] ?? '#6b7280';
  return (
    <svg viewBox="0 0 12 14" className="h-3.5 w-3 shrink-0" fill="none">
      <path
        d="M1 2C1 1.45 1.45 1 2 1H8L11 4V12C11 12.55 10.55 13 10 13H2C1.45 13 1 12.55 1 12V2Z"
        fill={color}
        fillOpacity="0.2"
        stroke={color}
        strokeWidth="1"
      />
      <path d="M8 1L11 4H8V1Z" fill={color} fillOpacity="0.4" />
    </svg>
  );
}

function DefaultFolderPreviewIcon() {
  return (
    <svg viewBox="0 0 14 12" className="h-3 w-3.5 shrink-0" fill="none">
      <path
        d="M1 2.5C1 2 1.45 1.5 2 1.5H5L6.5 3H12C12.55 3 13 3.45 13 4V10C13 10.55 12.55 11 12 11H2C1.45 11 1 10.55 1 10V2.5Z"
        fill="#fbbf24"
        fillOpacity="0.3"
        stroke="#fbbf24"
        strokeWidth="1"
      />
    </svg>
  );
}

function IconThemeCard({
  id,
  label,
  source,
  isActive,
  onSelect,
}: {
  id: string;
  label: string;
  source: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const isDefault = id === 'default';
  const samples = isDefault ? null : getIconPreviewSamples(id, PREVIEW_FILES, [PREVIEW_FOLDER]);

  return (
    <button
      onClick={onSelect}
      className={`relative flex flex-col gap-2.5 rounded-xl p-3 text-left transition-all ${
        isActive
          ? 'bg-accent/10 ring-2 ring-accent shadow-sm'
          : 'bg-surface-raised/30 ring-1 ring-border/50 hover:bg-surface-raised/60 hover:ring-border'
      }`}
    >
      {/* Icon preview pane */}
      <div className="flex flex-col gap-[5px] rounded-lg border border-border/30 bg-background/50 p-2.5 min-h-[90px]">
        <div className="flex items-center gap-1.5">
          {samples?.folders[0]?.url ? (
            <img src={samples.folders[0].url} className="h-3.5 w-3.5 shrink-0 object-contain" alt="" />
          ) : (
            <DefaultFolderPreviewIcon />
          )}
          <span className="text-[9px] font-medium text-muted-foreground/60">{PREVIEW_FOLDER}</span>
        </div>
        {PREVIEW_FILES.map((name, i) => {
          const url = samples?.files[i]?.url ?? null;
          return (
            <div key={name} className="flex items-center gap-1.5 pl-4">
              {url ? (
                <img src={url} className="h-3.5 w-3.5 shrink-0 object-contain" alt="" />
              ) : (
                <DefaultFilePreviewIcon name={name} />
              )}
              <span className="text-[9px] text-muted-foreground/50">{name}</span>
            </div>
          );
        })}
      </div>

      {/* Label row */}
      <div className="flex flex-col gap-0.5 pr-6">
        <span className="text-[11px] font-semibold text-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">{source}</span>
      </div>

      {isActive && (
        <div className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
          <Check className="h-2.5 w-2.5 text-accent-foreground" />
        </div>
      )}
    </button>
  );
}

export function ThemeTab() {
  const store = useSettingsStore();
  const themeId = store.themeId;
  const setThemeId = store.setThemeId;
  const iconThemeId = store.iconThemeId;
  const setIconThemeId = store.setIconThemeId;
  const notifyIconThemeChanged = useExtensionStore((s) => s.notifyIconThemeChanged);
  // Re-render when extension themes finish loading
  useExtensionStore((s) => s.extensionThemesVersion);
  useExtensionStore((s) => s.extensionIconThemesVersion);
  const customMetas = getCustomThemeMetas();
  const extensionIconThemes = getRegisteredIconThemes();

  function handleSelectIconTheme(id: string) {
    setIconThemeId(id);
    setActiveIconThemeId(id);
    notifyIconThemeChanged();
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
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-[12px] font-semibold text-foreground">Icon Theme</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 mb-3">
          Changes file and folder icons throughout the IDE.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <IconThemeCard
            id="default"
            label="Default"
            source="Built-in"
            isActive={iconThemeId === 'default'}
            onSelect={() => handleSelectIconTheme('default')}
          />
          {extensionIconThemes.map((t) => (
            <IconThemeCard
              key={t.id}
              id={t.id}
              label={t.label}
              source={`from ${t.extensionName}`}
              isActive={iconThemeId === t.id}
              onSelect={() => handleSelectIconTheme(t.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Rounded Borders Toggle ────────────────────────────────── */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[12px] text-foreground">Disable Rounded Borders</span>
            <span className="text-[10px] text-muted-foreground">
              Remove all rounded corners for a sharper, squared-off UI
            </span>
          </div>
          <button
            onClick={() => store.set('disableRoundedBorders', !store.disableRoundedBorders)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              store.disableRoundedBorders ? 'bg-accent' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-foreground transition-transform ${
                store.disableRoundedBorders ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
