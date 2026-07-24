import { ExternalLink, Github, Heart, RefreshCw, Loader2, CheckCircle, ArrowUpCircle } from 'lucide-react';
import { useUpdateStore } from '../../../stores/update-store';
import { BrandMark } from '../../brand-mark';
import { SettingInfoRow, SettingSection } from '../controls';

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
        <div className="flex h-16 w-16 items-center justify-center rounded-xl">
          <BrandMark className="h-12 w-12" />
        </div>
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
            <span className="flex items-center gap-1.5 text-[11px] text-success">
              <CheckCircle className="h-3 w-3" />
              You're up to date
            </span>
          )}

          {(updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && releaseInfo && (
            <button
              onClick={openDialog}
              className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
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
            <span className="text-[10px] text-destructive">
              Failed to check — click to retry
            </span>
          )}
        </div>
      </div>

      {/* Details */}
      <SettingSection title="Application">
        <SettingInfoRow label="Name" value={APP_NAME} />
        <SettingInfoRow label="Version" value={APP_VERSION} />
        <SettingInfoRow label="Identifier" value={APP_IDENTIFIER} />
        <SettingInfoRow label="Framework" value="Tauri 2 + React + Monaco Editor" />
        <SettingInfoRow label="License" value="MIT" />
      </SettingSection>

      {/* Tech Stack */}
      <SettingSection title="Tech Stack">
        <SettingInfoRow label="Frontend" value="React, TypeScript, Tailwind CSS" />
        <SettingInfoRow label="Editor" value="Monaco Editor" />
        <SettingInfoRow label="Backend" value="Tauri (Rust)" />
        <SettingInfoRow label="AI" value="Multi-provider (Anthropic, OpenAI, Copilot, etc.)" />
        <SettingInfoRow label="Package Manager" value="pnpm (monorepo)" />
      </SettingSection>

      {/* Links */}
      <SettingSection title="Links">
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
      </SettingSection>

      {/* Footer */}
      <div className="flex items-center justify-center gap-1.5 py-2 text-[10px] text-muted-foreground">
        Made with <Heart className="h-3 w-3 text-destructive" /> by the HysCode team
      </div>
    </div>
  );
}
