// ─── Provider Setup Guide Modal ─────────────────────────────────────────────
// Inline modal that opens when the user clicks the "?" button on GitHub Copilot
// or Codex rows in the AI settings tab.

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Copy, Check, ChevronRight } from 'lucide-react';

type GuideId = 'github-copilot' | 'codex';

interface ProviderSetupGuideProps {
  guide: GuideId;
  open: boolean;
  onClose: () => void;
}

export function ProviderSetupGuide({ guide, open, onClose }: ProviderSetupGuideProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div       className="relative w-full max-w-[520px] max-h-[80vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            {guide === 'github-copilot' ? 'GitHub Copilot Setup' : 'Codex Setup'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          {guide === 'github-copilot' ? <GitHubCopilotGuide /> : <CodexGuide />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── GitHub Copilot Guide ───────────────────────────────────────────────────

function GitHubCopilotGuide() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        GitHub Copilot uses the OAuth Device Flow to authenticate. Billing is
        credit-based — you purchase credits that are consumed per request
        depending on the model tier.
      </p>

      <StepList>
        <Step number={1} title="Create a GitHub OAuth App">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Register a new OAuth App in your GitHub settings. Set the callback URL
            to{' '}
            <CodeSnippet text="http://localhost" />{' '}
            (it won't be used — the device flow doesn't redirect).
          </p>
          <ExternalLinkButton
            href="https://github.com/settings/applications/new"
            label="Create OAuth App on GitHub"
          />
        </Step>

        <Step number={2} title="Copy your Client ID">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            After creating the app, copy the <Kbd>Client ID</Kbd> (starts with{' '}
            <CodeSnippet text="Iv1." /> or <CodeSnippet text="Ov23li" />
            ). You do <span className="font-medium text-foreground">not</span>{' '}
            need a Client Secret for the device flow.
          </p>
        </Step>

        <Step number={3} title="Enter the Client ID">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            In the <Kbd>GitHub Copilot</Kbd> section above, paste the Client ID
            into the <Kbd>OAuth Client ID</Kbd> field.
          </p>
        </Step>

        <Step number={4} title="Sign in with GitHub">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Click the <Kbd>Sign in with GitHub</Kbd> button. You'll receive a
            one-time code — copy it and open the GitHub verification page to
            authorize the app. HysCode will detect the authorization automatically.
          </p>
        </Step>

        <Step number={5} title="Start using it" last>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Once connected, select <Kbd>GitHub Copilot</Kbd> as your provider.
            Models available:
          </p>
          <ModelList
            models={[
              { name: 'GPT-5.5', desc: 'Free tier' },
              { name: 'GPT-5 Mini', desc: 'Free tier' },
              { name: 'Raptor Mini', desc: 'Free tier · preview' },
              { name: 'Gemini 3.5 Flash', desc: 'Low credits' },
              { name: 'Gemini 3.5 Flash-Lite', desc: 'Low credits' },
              { name: 'Gemini 3.6 Flash', desc: 'Low credits' },
              { name: 'Claude Haiku 4.5', desc: 'Low credits' },
              { name: 'Gemini 3 Flash', desc: 'Low credits' },
              { name: 'GPT-5.4 Mini', desc: 'Low credits' },
              { name: 'GPT-5.6', desc: 'Low credits' },
              { name: 'Claude Sonnet 4.5 / 4.6 / 5', desc: 'Standard credits' },
              { name: 'Gemini 3.1 Pro', desc: 'Standard credits' },
              { name: 'GPT-5.3-Codex', desc: 'Standard credits' },
              { name: 'GPT-5.4', desc: 'Standard credits' },
              { name: 'Claude Opus 4.5 / 4.6 / 4.7 / 4.8 / 5', desc: 'Premium credits' },
            ]}
          />
        </Step>
      </StepList>

      <InfoBox>
        Your GitHub OAuth tokens are stored locally in the system keychain.
        A Copilot session token is refreshed automatically when it expires.
        You can disconnect at any time from the settings panel.
      </InfoBox>
    </div>
  );
}

// ─── Codex Guide ────────────────────────────────────────────────────────────

function CodexGuide() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Codex is OpenAI's agentic coding agent. HysCode drives the official
        Codex CLI (not bundled) as a local sidecar. You can sign in with
        ChatGPT (uses your ChatGPT plan) or use an OpenAI API key.
      </p>

      <StepList>
        <Step number={1} title="Install the Codex CLI">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Open a terminal and run:
          </p>
          <CodeSnippet text="npm install -g @openai/codex" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            (macOS/Linux alternative:{' '}
            <CodeSnippet text="curl -fsSL https://chatgpt.com/codex/install.sh | sh" />
            ). Then click <Kbd>I've installed it — check again</Kbd> in the
            settings above.
          </p>
        </Step>

        <Step number={2} title="Sign in with ChatGPT (recommended)">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Click <Kbd>Sign in with ChatGPT</Kbd> above. A browser window opens —
            complete the login and HysCode will detect it automatically. Codex
            then works with your Plus, Pro, Business, Edu, or Enterprise plan.
          </p>
        </Step>

        <Step number={3} title="Or enter an OpenAI API key">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            If you prefer usage-based billing, paste a key from the OpenAI
            dashboard into the <Kbd>Codex</Kbd> field and click <Kbd>Save</Kbd>.
            The key is stored securely in the system keychain.
          </p>
          <ExternalLinkButton
            href="https://platform.openai.com/api-keys"
            label="Open OpenAI API Keys"
          />
        </Step>

        <Step number={4} title="Select a Codex model">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            In the <Kbd>Active Provider & Model</Kbd> section, select
            <Kbd>Codex (Agent)</Kbd> as the provider. Available models:
          </p>
          <ModelList
            models={[
              { name: 'GPT 5.6 Sol (Codex)', desc: 'Flagship — best for complex work' },
              { name: 'GPT 5.6 Terra (Codex)', desc: 'Balanced everyday workhorse' },
              { name: 'GPT 5.6 Luna (Codex)', desc: 'Fast and affordable' },
              { name: 'GPT 5.5 / 5.4 / 5.4 Mini (Codex)', desc: 'Previous generation' },
            ]}
          />
        </Step>

        <Step number={5} title="Start using it" last>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Open the chat panel and start a conversation. Codex executes
            multi-step tasks in your workspace — it can run shell commands,
            edit files, and search the web autonomously.
          </p>
        </Step>
      </StepList>

      <InfoBox>
        Codex runs locally via the Codex CLI you installed. ChatGPT login
        credentials are cached in <CodeSnippet text="~/.codex/auth.json" /> by
        the CLI and are shared with the Codex IDE extension if you have it
        installed.
      </InfoBox>
    </div>
  );
}

// ─── Shared Atoms ───────────────────────────────────────────────────────────

function StepList({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

function Step({
  number,
  title,
  children,
  last,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      {/* Step indicator + line */}
      <div className="flex flex-col items-center">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
          {number}
        </div>
        {!last && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>

      {/* Content */}
      <div className={`flex flex-col gap-2 pb-5 ${last ? 'pb-0' : ''}`}>
        <span className="text-[12px] font-medium text-foreground -mt-0.5">{title}</span>
        {children}
      </div>
    </div>
  );
}

function ExternalLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background w-fit mt-1"
    >
      <ExternalLink className="h-3 w-3 text-muted-foreground" />
      {label}
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </a>
  );
}

function CodeSnippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-colors hover:bg-muted/80"
      title="Click to copy"
    >
      {text}
      {copied ? (
        <Check className="h-2.5 w-2.5 text-success" />
      ) : (
        <Copy className="h-2.5 w-2.5 text-muted-foreground" />
      )}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-foreground mx-0.5">
      {children}
    </span>
  );
}

function ModelList({ models }: { models: { name: string; desc: string }[] }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {models.map((m) => (
        <div key={m.name} className="flex items-baseline gap-2">
          <span className="text-[10px] font-medium text-foreground">{m.name}</span>
          <span className="text-[10px] text-muted-foreground">{m.desc}</span>
        </div>
      ))}
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5">
      <p className="text-[11px] leading-relaxed text-primary/90">{children}</p>
    </div>
  );
}
