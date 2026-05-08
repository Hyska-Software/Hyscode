import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  Palette,
  Brain,
  Type,
  Rocket,
  Eye,
  EyeOff,
  X,
  LogIn,
  LogOut,
  Loader2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { useOnboardingStore, ONBOARDING_TOTAL_STEPS } from '../../stores/onboarding-store';
import { useSettingsStore } from '../../stores/settings-store';
import { BrandMark } from '../brand-mark';
import { tauriInvoke } from '../../lib/tauri-invoke';
import { reinitProvider } from '../../lib/init-providers';
import { PROVIDERS } from '../../lib/provider-catalog';
import type { ThemeId } from '../../stores/settings-store';

// ── Theme options ─────────────────────────────────────────────────────────────

interface ThemeOption {
  id: ThemeId;
  name: string;
  desc: string;
  bg: string;
  surface: string;
  accent: string;
  fg: string;
  muted: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'hyscode-dark',
    name: 'Dark',
    desc: 'Default dark with purple',
    bg: '#0d0d0d',
    surface: '#181818',
    accent: '#a855f7',
    fg: '#e8e8e8',
    muted: '#555',
  },
  {
    id: 'hyscode-light',
    name: 'Light',
    desc: 'Clean and minimal',
    bg: '#f5f5f5',
    surface: '#ffffff',
    accent: '#7c3aed',
    fg: '#1a1a1a',
    muted: '#999',
  },
  {
    id: 'nord',
    name: 'Nord',
    desc: 'Arctic blues',
    bg: '#2e3440',
    surface: '#3b4252',
    accent: '#88c0d0',
    fg: '#eceff4',
    muted: '#616e88',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    desc: 'Dark with vibrant colors',
    bg: '#282a36',
    surface: '#313444',
    accent: '#bd93f9',
    fg: '#f8f8f2',
    muted: '#6272a4',
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    desc: 'GitHub\'s dark theme',
    bg: '#0d1117',
    surface: '#161b22',
    accent: '#58a6ff',
    fg: '#c9d1d9',
    muted: '#484f58',
  },
  {
    id: 'monokai',
    name: 'Monokai',
    desc: 'Classic warm tones',
    bg: '#272822',
    surface: '#3e3d32',
    accent: '#a6e22e',
    fg: '#f8f8f2',
    muted: '#75715e',
  },
];

// ── Font options ──────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  { id: 'Geist Mono', name: 'Geist Mono', preview: 'const x = 42;' },
  { id: 'JetBrains Mono', name: 'JetBrains Mono', preview: 'const x = 42;' },
  { id: 'Fira Code', name: 'Fira Code', preview: 'const x = 42;' },
  { id: 'Cascadia Code', name: 'Cascadia Code', preview: 'const x = 42;' },
  { id: 'monospace', name: 'System Monospace', preview: 'const x = 42;' },
];

// ── AI Providers for onboarding (main ones only) ──────────────────────────────

const ONBOARDING_PROVIDERS = PROVIDERS.filter((p) =>
  ['anthropic', 'openai', 'gemini', 'github-copilot'].includes(p.id),
);

// ── Step components ───────────────────────────────────────────────────────────

function StepWelcome({ visible }: { visible: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-7 text-center transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface-raised border border-border">
        <BrandMark className="h-9 w-9" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Welcome to <span className="text-accent">HysCode</span>
        </h1>
        <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
          AI-powered code editor. Let's configure a few things before you start.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5 max-w-xs">
        {[
          { icon: Brain, label: 'AI Agent' },
          { icon: Sparkles, label: 'Completions' },
          { icon: Palette, label: 'Themes' },
          { icon: Rocket, label: 'Native Speed' },
        ].map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="flex items-center gap-1.5 rounded-md bg-surface-raised border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
          >
            <Icon className="h-3 w-3 text-accent" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepTheme({ visible }: { visible: boolean }) {
  const { themeId, setThemeId } = useSettingsStore();

  return (
    <div
      className={`flex flex-col gap-5 transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Choose your theme</h2>
        <p className="text-[11px] text-muted-foreground">Changeable anytime in Settings → Themes.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((theme) => {
          const selected = themeId === theme.id;
          return (
            <button
              key={theme.id}
              onClick={() => setThemeId(theme.id)}
              className={`group relative flex flex-col overflow-hidden rounded-lg border transition-all duration-150 ${
                selected
                  ? 'border-accent'
                  : 'border-border hover:border-accent/50'
              }`}
            >
              <div className="flex h-14 flex-col gap-1 p-2" style={{ background: theme.bg }}>
                <div className="flex gap-1">
                  <div className="h-1 w-4 rounded-full opacity-50" style={{ background: theme.muted }} />
                  <div className="h-1 w-6 rounded-full" style={{ background: theme.accent }} />
                  <div className="h-1 w-3 rounded-full opacity-50" style={{ background: theme.muted }} />
                </div>
                <div className="h-1 w-8 rounded-full opacity-30" style={{ background: theme.fg }} />
                <div className="mt-1 flex gap-1 rounded px-1 py-0.5" style={{ background: theme.surface }}>
                  <div className="h-1 w-3 rounded-full" style={{ background: theme.accent }} />
                  <div className="h-1 w-5 rounded-full opacity-50" style={{ background: theme.fg }} />
                </div>
              </div>

              <div
                className="flex items-center justify-between px-2 py-1.5"
                style={{ background: theme.surface }}
              >
                <div>
                  <p className="text-[10px] font-medium" style={{ color: theme.fg }}>{theme.name}</p>
                  <p className="text-[9px] opacity-50" style={{ color: theme.fg }}>{theme.desc}</p>
                </div>
                {selected && (
                  <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: theme.accent }}>
                    <Check className="h-2 w-2 text-white" />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Inline Copilot OAuth flow (device flow, same as CopilotAuthRow) ───────────

type CopilotAuthStep =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'waiting'; userCode: string; verificationUri: string; deviceCode: string; interval: number }
  | { step: 'authenticated' }
  | { step: 'error'; message: string };

function CopilotOAuthPanel({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [auth, setAuth] = useState<CopilotAuthStep>({ step: 'idle' });
  const [copied, setCopied] = useState(false);
  const pollActiveRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    tauriInvoke('github_copilot_is_authenticated', {})
      .then(async (authed) => {
        if (!authed) return;
        await tauriInvoke('github_copilot_ensure_token', {});
        await reinitProvider('github-copilot').catch(console.error);
        setAuth({ step: 'authenticated' });
        onAuthenticated();
      })
      .catch(() => {});
  }, [onAuthenticated]);

  useEffect(() => () => stopPolling(), []);

  const stopPolling = () => {
    pollActiveRef.current = false;
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  };

  const toMsg = (err: unknown): string => {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
      const o = err as Record<string, unknown>;
      if (typeof o.message === 'string') return o.message;
      if (typeof o.error === 'string') return o.error;
    }
    return String(err);
  };

  const startAuth = async () => {
    setAuth({ step: 'loading' });
    stopPolling();
    try {
      const resp = await tauriInvoke('github_oauth_start', {});
      setAuth({
        step: 'waiting',
        userCode: resp.user_code,
        verificationUri: resp.verification_uri,
        deviceCode: resp.device_code,
        interval: resp.interval,
      });

      let intervalMs = Math.max(resp.interval, 5) * 1000;
      const deviceCode = resp.device_code;
      pollActiveRef.current = true;

      const schedulePoll = () => {
        if (!pollActiveRef.current) return;
        pollTimeoutRef.current = setTimeout(doPoll, intervalMs);
      };

      const doPoll = async () => {
        if (!pollActiveRef.current) return;
        try {
          await tauriInvoke('github_oauth_poll', { deviceCode });
          stopPolling();
          await tauriInvoke('github_copilot_ensure_token', {});
          await reinitProvider('github-copilot').catch(console.error);
          setAuth({ step: 'authenticated' });
          onAuthenticated();
        } catch (err) {
          const msg = toMsg(err);
          if (msg === 'slow_down') { intervalMs += 5000; schedulePoll(); }
          else if (msg === 'authorization_pending') schedulePoll();
          else { stopPolling(); setAuth({ step: 'error', message: msg }); }
        }
      };

      schedulePoll();
    } catch (err) {
      setAuth({ step: 'error', message: toMsg(err) });
    }
  };

  const disconnect = async () => {
    stopPolling();
    await tauriInvoke('github_copilot_disconnect', {}).catch(console.error);
    await reinitProvider('github-copilot').catch(console.error);
    setAuth({ step: 'idle' });
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold bg-muted text-muted-foreground">
          GH
        </div>
        <p className="text-[11px] font-medium text-foreground">GitHub Copilot — OAuth</p>
      </div>

      {auth.step === 'idle' && (
        <button
          onClick={startAuth}
          className="flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[12px] font-medium text-white hover:bg-accent/90 transition-colors"
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in with GitHub
        </button>
      )}

      {auth.step === 'loading' && (
        <div className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Starting authentication…
        </div>
      )}

      {auth.step === 'waiting' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">Copy this code, then open GitHub to authorize:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-1.5 text-center font-mono text-sm font-bold tracking-[0.3em] text-foreground">
              {auth.userCode}
            </code>
            <button
              onClick={() => copyCode(auth.userCode)}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <a
            href={auth.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[11px] text-accent hover:bg-surface-raised transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            {auth.verificationUri}
          </a>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for authorization…
          </div>
        </div>
      )}

      {auth.step === 'authenticated' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="text-[11px] text-success font-medium">Connected</span>
          </div>
          <button
            onClick={disconnect}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
          >
            <LogOut className="h-3 w-3" />
            Disconnect
          </button>
        </div>
      )}

      {auth.step === 'error' && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-error truncate">{auth.message}</p>
          <button onClick={startAuth} className="shrink-0 text-[11px] text-accent hover:underline">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

// ── API key panel (all non-OAuth providers) ───────────────────────────────────

function ApiKeyPanel({ providerId, providerName, onSaved }: {
  providerId: string;
  providerName: string;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const store = useSettingsStore();

  // Load existing key on mount
  useEffect(() => {
    tauriInvoke('keychain_get', { service: 'hyscode', account: `${providerId}_api_key` })
      .then((existing) => { if (existing) { setApiKey(existing); setSaved(true); } })
      .catch(() => {});
  }, [providerId]);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await tauriInvoke('keychain_set', {
        service: 'hyscode',
        account: `${providerId}_api_key`,
        password: apiKey.trim(),
      });
      await reinitProvider(providerId).catch(console.error);
      const provider = ONBOARDING_PROVIDERS.find((p) => p.id === providerId);
      const firstModel = provider?.models[0];
      if (firstModel) store.setActiveProvider(providerId, firstModel.id);
      setSaved(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
      <p className="text-[11px] font-medium text-foreground">{providerName} API Key</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
            placeholder="Paste your API key…"
            className="h-7 w-full rounded-md bg-muted px-2.5 pr-7 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent placeholder:text-muted-foreground/50 transition-all"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || saving}
          className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
            saved
              ? 'bg-success/10 text-success border border-success/30'
              : 'bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          {saved ? <><Check className="h-3 w-3" />Saved</> : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Stored in system keychain · synced with Settings → AI &amp; Providers
      </p>
    </div>
  );
}

function StepAI({ visible }: { visible: boolean }) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerSaved, setProviderSaved] = useState<Record<string, boolean>>({});
  const store = useSettingsStore();

  const markSaved = useCallback((id: string) => {
    setProviderSaved((prev) => ({ ...prev, [id]: true }));
  }, []);

  const handleCopilotAuth = useCallback(() => {
    const provider = ONBOARDING_PROVIDERS.find((p) => p.id === 'github-copilot');
    const firstModel = provider?.models[0];
    if (firstModel) store.setActiveProvider('github-copilot', firstModel.id);
    markSaved('github-copilot');
  }, [store, markSaved]);

  return (
    <div
      className={`flex flex-col gap-5 transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Connect an AI provider</h2>
        <p className="text-[11px] text-muted-foreground">
          Required for agent and completions. Configure more in Settings → AI &amp; Providers.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {ONBOARDING_PROVIDERS.map((provider) => {
          const selected = selectedProvider === provider.id;
          const configured = providerSaved[provider.id];
          return (
            <button
              key={provider.id}
              onClick={() => setSelectedProvider(provider.id)}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? 'border-accent bg-accent/5'
                  : 'border-border bg-surface-raised hover:border-accent/40'
              }`}
            >
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[9px] font-bold ${
                  selected ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'
                }`}
              >
                {provider.name.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-foreground truncate">{provider.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {provider.needsKey ? 'API key' : 'OAuth'} · {provider.models.length} models
                </p>
              </div>
              {configured && (
                <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-success/15 border border-success/30">
                  <Check className="h-2 w-2 text-success" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selectedProvider === 'github-copilot' && (
        <CopilotOAuthPanel onAuthenticated={handleCopilotAuth} />
      )}

      {selectedProvider && selectedProvider !== 'github-copilot' && (
        <ApiKeyPanel
          providerId={selectedProvider}
          providerName={ONBOARDING_PROVIDERS.find((p) => p.id === selectedProvider)?.name ?? selectedProvider}
          onSaved={() => markSaved(selectedProvider)}
        />
      )}
    </div>
  );
}

function StepEditor({ visible }: { visible: boolean }) {
  const store = useSettingsStore();

  return (
    <div
      className={`flex flex-col gap-5 transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Editor preferences</h2>
        <p className="text-[11px] text-muted-foreground">Changeable anytime in Settings → Editor.</p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Font family */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Font Family</p>
          <div className="flex flex-col gap-1">
            {FONT_OPTIONS.map((font) => {
              const selected = store.fontFamily === font.id;
              return (
                <button
                  key={font.id}
                  onClick={() => store.set('fontFamily', font.id)}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    selected
                      ? 'border-accent bg-accent/5'
                      : 'border-border bg-surface-raised hover:border-accent/30'
                  }`}
                >
                  <span className="text-[12px] font-medium text-foreground">{font.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground" style={{ fontFamily: font.id }}>
                      {font.preview}
                    </span>
                    {selected && <Check className="h-3 w-3 shrink-0 text-accent" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font size */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Font Size</p>
            <span className="text-[11px] text-accent font-mono tabular-nums">{store.fontSize}px</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => store.set('fontSize', Math.max(10, store.fontSize - 1))}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-raised border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm"
            >
              −
            </button>
            <div className="relative flex-1 h-1 bg-surface-raised rounded-full overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-accent transition-all duration-150"
                style={{ width: `${((store.fontSize - 10) / 14) * 100}%` }}
              />
            </div>
            <button
              onClick={() => store.set('fontSize', Math.min(24, store.fontSize + 1))}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-raised border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepDone({ visible }: { visible: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-6 text-center transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-success/10 border border-success/30">
        <Rocket className="h-7 w-7 text-success" />
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold text-foreground">You're all set</h2>
        <p className="max-w-xs text-[11px] text-muted-foreground leading-relaxed">
          HysCode is ready. Open a folder to start coding with AI assistance.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-1">
        {[
          { label: 'Theme configured', icon: Palette },
          { label: 'AI provider connected', icon: Brain },
          { label: 'Editor personalized', icon: Type },
        ].map(({ label, icon: Icon }) => (
          <div key={label} className="flex items-center gap-2.5 rounded-lg bg-surface-raised border border-border px-3 py-2">
            <div className="flex h-4 w-4 items-center justify-center rounded bg-success/10">
              <Check className="h-2.5 w-2.5 text-success" />
            </div>
            <span className="text-[11px] text-foreground">{label}</span>
            <Icon className="ml-auto h-3 w-3 text-muted-foreground/50" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step config ───────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Welcome', icon: Sparkles, component: StepWelcome },
  { label: 'Theme', icon: Palette, component: StepTheme },
  { label: 'AI', icon: Brain, component: StepAI },
  { label: 'Editor', icon: Type, component: StepEditor },
  { label: 'Done', icon: Rocket, component: StepDone },
];

// ── Main wizard ───────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const { currentStep, nextStep, prevStep, setStep, completeOnboarding, skipOnboarding } =
    useOnboardingStore();
  const [animating, setAnimating] = useState(false);

  const isLast = currentStep === ONBOARDING_TOTAL_STEPS - 1;
  const isFirst = currentStep === 0;

  const goToStep = useCallback((idx: number) => {
    if (animating || idx >= currentStep) return;
    setAnimating(true);
    setTimeout(() => { setStep(idx); setAnimating(false); }, 150);
  }, [animating, currentStep, setStep]);

  const goNext = useCallback(() => {
    if (animating) return;
    if (isLast) { completeOnboarding(); return; }
    setAnimating(true);
    setTimeout(() => { nextStep(); setAnimating(false); }, 150);
  }, [animating, isLast, completeOnboarding, nextStep]);

  const goPrev = useCallback(() => {
    if (animating || isFirst) return;
    setAnimating(true);
    setTimeout(() => { prevStep(); setAnimating(false); }, 150);
  }, [animating, isFirst, prevStep]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext]);

  const ActiveStep = STEPS[currentStep]?.component ?? STEPS[0].component;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="flex overflow-hidden rounded-xl bg-surface shadow-2xl"
        style={{ width: 'min(860px, calc(100vw - 24px))', height: 'min(580px, calc(100vh - 24px))' }}
      >
        {/* ── Left sidebar ── */}
        <nav className="flex w-[200px] shrink-0 flex-col bg-background p-3">
          {/* Branding */}
          <div className="mb-4 flex items-center gap-2 px-2 pt-1">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-raised border border-border">
              <BrandMark className="h-3 w-3" />
            </div>
            <span className="text-[11px] font-semibold text-foreground">HysCode Setup</span>
          </div>

          {/* Step nav */}
          <div className="flex flex-col gap-0.5">
            {STEPS.map((step, i) => {
              const isActive = i === currentStep;
              const isDone = i < currentStep;
              const isFuture = i > currentStep;
              return (
                <button
                  key={step.label}
                  onClick={() => isDone ? goToStep(i) : undefined}
                  disabled={isFuture || isActive}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors text-left ${
                    isActive
                      ? 'bg-surface-raised text-foreground'
                      : isDone
                        ? 'text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground cursor-pointer'
                        : 'text-muted-foreground/40 cursor-default'
                  }`}
                >
                  <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${
                    isActive ? 'bg-accent' : isDone ? 'bg-success/20' : 'bg-muted'
                  }`}>
                    {isDone
                      ? <Check className="h-2.5 w-2.5 text-success" />
                      : <step.icon className={`h-2.5 w-2.5 ${isActive ? 'text-white' : 'text-muted-foreground'}`} />
                    }
                  </div>
                  {step.label}
                </button>
              );
            })}
          </div>

          {/* Skip at bottom */}
          <div className="mt-auto pt-4">
            {!isLast && (
              <button
                onClick={skipOnboarding}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Skip setup
              </button>
            )}
          </div>
        </nav>

        {/* ── Right panel ── */}
        <div className="flex flex-1 flex-col overflow-hidden border-l border-border">
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className={`transition-all duration-300 ${animating ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}`}>
              <ActiveStep visible={!animating} />
            </div>
          </div>

          {/* Pinned footer */}
          <div className="shrink-0 border-t border-border bg-surface px-5 py-3 flex items-center justify-between">
            <button
              onClick={goPrev}
              disabled={isFirst}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-raised hover:text-foreground disabled:opacity-0 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>

            <span className="text-[10px] text-muted-foreground tabular-nums">
              {currentStep + 1} / {ONBOARDING_TOTAL_STEPS}
            </span>

            <button
              onClick={goNext}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
                isLast
                  ? 'bg-success text-white hover:bg-success/90'
                  : 'bg-accent text-white hover:bg-accent/90'
              }`}
            >
              {isLast ? (
                <><Rocket className="h-3.5 w-3.5" />Start Coding</>
              ) : (
                <>{currentStep === 0 ? 'Get Started' : 'Continue'}<ChevronRight className="h-3.5 w-3.5" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
