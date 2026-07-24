// ─── Provider Setup Guide Modal ─────────────────────────────────────────────
// Inline modal that opens when the user clicks the "?" button on Claude Agent
// or GitHub Copilot rows in the AI settings tab.

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Copy, Check, ChevronRight } from 'lucide-react';

type GuideId = 'claude-agent' | 'github-copilot';

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
      <div className="relative w-full max-w-[520px] max-h-[80vh] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            {guide === 'claude-agent' ? 'Claude Agent Setup' : 'GitHub Copilot Setup'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          {guide === 'claude-agent' ? <ClaudeAgentGuide /> : <GitHubCopilotGuide />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Claude Agent Guide ─────────────────────────────────────────────────────

function ClaudeAgentGuide() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Claude Agent uses the Anthropic API with Claude's agentic capabilities.
        It reuses your existing Anthropic API key — no extra configuration needed.
      </p>

      <StepList>
        <Step number={1} title="Get an Anthropic API key">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            If you don't have one yet, create an account and generate an API key
            from the Anthropic Console.
          </p>
          <ExternalLinkButton
            href="https://console.anthropic.com/settings/keys"
            label="Open Anthropic Console"
          />
        </Step>

        <Step number={2} title="Enter your API key">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            In the <Kbd>API Keys</Kbd> section above, paste your key into the
            <Kbd>Anthropic</Kbd> field and click <Kbd>Save</Kbd>.
            Claude Agent will automatically use this same key.
          </p>
        </Step>

        <Step number={3} title="Select a Claude Agent model">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            In the <Kbd>Active Provider & Model</Kbd> section, select
            <Kbd>Claude Agent</Kbd> as the provider. Available models:
          </p>
          <ModelList
            models={[
              { name: 'Claude Sonnet 4 (Agent)', desc: 'Best balance of speed and quality' },
              { name: 'Claude Opus 4 (Agent)', desc: 'Maximum capability for complex tasks' },
              { name: 'Claude Haiku 4 (Agent)', desc: 'Fastest and most cost-effective' },
            ]}
          />
        </Step>

        <Step number={3} title="Start using it" last>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Open the chat panel and start a conversation. Claude Agent can execute
            multi-step tasks, use tools, and work with your codebase autonomously.
          </p>
        </Step>
      </StepList>

      <InfoBox>
        Claude Agent runs as a local sidecar process. Your API key is stored securely
        in the system keychain and is never sent to any third-party services.
      </InfoBox>
    </div>
  );
}

// ─── GitHub Copilot Guide ───────────────────────────────────────────────────

function GitHubCopilotGuide() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        GitHub Copilot uses the OAuth Device Flow to authenticate. You need
        an active GitHub Copilot subscription and a GitHub OAuth App to connect.
      </p>

      <StepList>
        <Step number={1} title="Create a GitHub OAuth App">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Register a new OAuth App in your GitHub settings. Set the callback URL
            to <CodeSnippet text="http://localhost" /> (it won't be used — the device
            flow doesn't redirect).
          </p>
          <ExternalLinkButton
            href="https://github.com/settings/applications/new"
            label="Create OAuth App on GitHub"
          />
        </Step>

        <Step number={2} title="Copy your Client ID">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            After creating the app, copy the <Kbd>Client ID</Kbd> (starts
            with <CodeSnippet text="Iv1." /> or <CodeSnippet text="Ov23li" />).
            You do <span className="font-medium text-foreground">not</span> need
            a Client Secret for the device flow.
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
            Click the <Kbd>Sign in with GitHub</Kbd> button. You'll receive
            a one-time code — copy it and open the GitHub verification page to
            authorize the app. HysCode will detect the authorization automatically.
          </p>
        </Step>

        <Step number={5} title="Start using it" last>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Once connected, select <Kbd>GitHub Copilot</Kbd> as your provider.
            Models available depend on your Copilot plan:
          </p>
          <ModelList
            models={[
              { name: 'GPT-4.1', desc: '0× · free · all plans' },
              { name: 'GPT-4o', desc: '0× · free · LTS fallback' },
              { name: 'GPT-5 Mini', desc: '0× · free · all plans' },
              { name: 'Raptor Mini', desc: '0× · preview · fine-tuned GPT-5 Mini' },
              { name: 'Grok Code Fast 1', desc: '0.25× · xAI · fast coding' },
              { name: 'Claude Haiku 4.5', desc: '0.33× · fast lightweight' },
              { name: 'Gemini 3 Flash', desc: '0.33× · preview · Google' },
              { name: 'GPT-5.4 Mini', desc: '0.33× · fast agentic' },
              { name: 'Claude Sonnet 4 / 4.5 / 4.6', desc: '1× · balanced reasoning' },
              { name: 'Gemini 2.5 Pro / 3.1 Pro', desc: '1× · long context reasoning' },
              { name: 'GPT-5.2 / 5.2-Codex / 5.3-Codex', desc: '1× · agentic coding' },
              { name: 'GPT-5.4', desc: '1× · deep reasoning (Xhigh)' },
              { name: 'Claude Opus 4.5 / 4.6', desc: '3× · most powerful' },
            ]}
          />
        </Step>
      </StepList>

      <InfoBox>
        Your GitHub OAuth tokens are stored locally in the system keychain.
        A Copilot session token is refreshed automatically when it expires.
        You can disconnect at any time from the settings panel.
      </InfoBox>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5">
        <p className="text-[11px] leading-relaxed text-amber-400/90">
          <span className="font-medium">Requirement:</span> You must have an active
          GitHub Copilot subscription (Free, Pro, Pro+, Business, or Enterprise).
          Models marked 1× or 3× consume premium requests. Free-tier plans have
          limited premium request allowance.
        </p>
      </div>
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
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-[11px] text-foreground transition-colors hover:bg-muted w-fit mt-1"
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
