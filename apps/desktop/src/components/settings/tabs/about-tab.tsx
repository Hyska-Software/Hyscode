import { ExternalLink, Github, Heart, RefreshCw, Loader2, CheckCircle, ArrowUpCircle } from 'lucide-react';
import { useUpdateStore } from '../../../stores/update-store';

const APP_NAME = 'HysCode';
const APP_VERSION = '0.2.1';
const APP_IDENTIFIER = 'com.hyscode.app';
const APP_DESCRIPTION =
  'A modern, AI-powered code editor built with Tauri, React, and Monaco. Designed for developers who want an intelligent, fast, and extensible coding experience.';
const REPO_URL = 'https://github.com/Hyska-Software/Hyscode';

export function AboutTab() {
  const updateStatus = useUpdateStore((s) => s.status);
  const releaseInfo = useUpdateStore((s) => s.releaseInfo);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const openDialog = useUpdateStore((s) => s.openDialog);

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 rounded-xl bg-surface-raised px-6 py-8">
        <img
          src="/img-logos/logo-150px.png"
          alt={APP_NAME}
          className="h-16 w-16 rounded-xl"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-[18px] font-bold tracking-tight text-foreground">
            {APP_NAME}
          </h2>
          <span className="text-[12px] text-muted-foreground">
            Version {APP_VERSION}
          </span>
        </div>
        <p className="max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
          {APP_DESCRIPTION}
        </p>

        {/* Update check button */}
        <div className="mt-2 flex flex-col items-center gap-1.5">
          {updateStatus === 'checking' && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking for updates...
            </span>
          )}

          {updateStatus === 'up-to-date' && (
            <span className="flex items-center gap-1.5 text-[11px] text-green-400">
              <CheckCircle className="h-3 w-3" />
              You're up to date
            </span>
          )}

          {(updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && releaseInfo && (
            <button
              onClick={openDialog}
              className="flex items-center gap-1.5 rounded-md bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors"
            >
              <ArrowUpCircle className="h-3.5 w-3.5" />
              {updateStatus === 'ready' ? 'Restart to update' : `${releaseInfo.version} available`}
            </button>
          )}

          {(updateStatus === 'idle' || updateStatus === 'up-to-date' || updateStatus === 'error') && (
            <button
              onClick={() => void checkForUpdates()}
              className="flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted transition-colors border border-border"
            >
              <RefreshCw className="h-3 w-3" />
              Check for Updates
            </button>
          )}

          {updateStatus === 'error' && (
            <span className="text-[10px] text-red-400">
              Failed to check — click to retry
            </span>
          )}
        </div>
      </div>

      {/* Details */}
      <Section title="Application">
        <Row label="Name" value={APP_NAME} />
        <Row label="Version" value={APP_VERSION} />
        <Row label="Identifier" value={APP_IDENTIFIER} />
        <Row label="Framework" value="Tauri 2 + React + Monaco Editor" />
        <Row label="License" value="MIT" />
      </Section>

      {/* Tech Stack */}
      <Section title="Tech Stack">
        <Row label="Frontend" value="React, TypeScript, Tailwind CSS" />
        <Row label="Editor" value="Monaco Editor" />
        <Row label="Backend" value="Tauri (Rust)" />
        <Row label="AI" value="Multi-provider (Anthropic, OpenAI, Copilot, etc.)" />
        <Row label="Package Manager" value="pnpm (monorepo)" />
      </Section>

      {/* Links */}
      <Section title="Links">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-lg bg-surface-raised px-3 py-2.5 text-[12px] text-foreground transition-colors hover:bg-muted"
        >
          <Github className="h-4 w-4 text-muted-foreground" />
          GitHub Repository
          <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
        </a>
      </Section>

      {/* Footer */}
      <div className="flex items-center justify-center gap-1.5 py-2 text-[10px] text-muted-foreground">
        Made with <Heart className="h-3 w-3 text-red-400" /> by the HysCode team
      </div>
    </div>
  );
}

// ── Shared atoms ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <span className="text-[12px] text-foreground">{label}</span>
      <span className="text-[11px] text-muted-foreground">{value}</span>
    </div>
  );
}
