import { useSettingsStore } from '../../../stores';
import type { ApprovalMode, UpdateChannel } from '../../../stores/settings-store';
import { useUpdateStore } from '../../../stores/update-store';
import { useOnboardingStore } from '../../../stores/onboarding-store';
import { Loader2, CheckCircle, ArrowUpCircle, RefreshCw, RotateCcw } from 'lucide-react';

export function GeneralTab() {
  const store = useSettingsStore();
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding);
  const updateStatus = useUpdateStore((s) => s.status);
  const releaseInfo = useUpdateStore((s) => s.releaseInfo);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const openDialog = useUpdateStore((s) => s.openDialog);

  return (
    <div className="flex flex-col gap-6">
      <Section title="Application">
        <Row
          label="Confirm Before Close"
          description="Show a confirmation dialog when closing the application"
        >
          <Toggle
            checked={store.confirmOnClose}
            onChange={(v) => store.set('confirmOnClose', v)}
          />
        </Row>
        <Row
          label="Show Welcome on Startup"
          description="Display welcome page when no project is open"
        >
          <Toggle
            checked={store.showWelcomeOnStartup}
            onChange={(v) => store.set('showWelcomeOnStartup', v)}
          />
        </Row>
        <Row
          label="Reduced Motion"
          description="Minimize animations across the application"
        >
          <Toggle
            checked={store.reducedMotion}
            onChange={(v) => store.set('reducedMotion', v)}
          />
        </Row>
      </Section>

      <Section title="Updates">
        <Row
          label="Update Channel"
          description="Stable receives tested releases; Pre-release gets latest builds"
        >
          <SelectInput<UpdateChannel>
            value={store.updateChannel}
            onChange={(v) => store.set('updateChannel', v)}
            options={[
              { value: 'stable', label: 'Stable' },
              { value: 'pre-release', label: 'Pre-release' },
            ]}
          />
        </Row>
        <Row
          label="Check on Startup"
          description="Automatically check for updates when the app launches"
        >
          <Toggle
            checked={store.checkForUpdatesOnStartup}
            onChange={(v) => store.set('checkForUpdatesOnStartup', v)}
          />
        </Row>
        <Row
          label="Auto-download"
          description="Download available updates automatically in the background"
        >
          <Toggle
            checked={store.autoDownload}
            onChange={(v) => store.set('autoDownload', v)}
          />
        </Row>
        <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-foreground">Current status</span>
            {updateStatus === 'idle' && (
              <span className="text-[10px] text-muted-foreground">Not checked yet</span>
            )}
            {updateStatus === 'checking' && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking...
              </span>
            )}
            {updateStatus === 'up-to-date' && (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <CheckCircle className="h-3 w-3" /> Up to date
              </span>
            )}
            {(updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && releaseInfo && (
              <span className="flex items-center gap-1 text-[10px] text-accent">
                <ArrowUpCircle className="h-3 w-3" />
                {updateStatus === 'ready' ? 'Ready to install' : `${releaseInfo.version} available`}
              </span>
            )}
            {updateStatus === 'error' && (
              <span className="text-[10px] text-red-400">Check failed</span>
            )}
          </div>
          <div className="flex gap-2">
            {(updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && (
              <button
                onClick={openDialog}
                className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                {updateStatus === 'ready' ? 'Install' : 'View'}
              </button>
            )}
            <button
              onClick={() => void checkForUpdates()}
              disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              className="flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors border border-border disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-3 w-3 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
              Check Now
            </button>
          </div>
        </div>
      </Section>

      <Section title="Agent">
        <Row label="Approval Mode">
          <SelectInput<ApprovalMode>
            value={store.approvalMode}
            onChange={(v) => store.set('approvalMode', v)}
            options={[
              { value: 'manual',        label: 'Manual – review every call' },
              { value: 'smart',         label: 'Smart – auto-approve safe tools' },
              { value: 'session-trust', label: 'Session Trust – approve once per tool' },
              { value: 'notify',        label: 'Notify Only – auto-approve, log all' },
              { value: 'yolo',          label: 'Auto-approve – approve everything' },
              { value: 'custom',        label: 'Custom Rules – per-category config' },
            ]}
          />
        </Row>
        <Row
          label="Limit Interactions"
          description="Off by default. Loop detection, cancellation, and request timeouts remain active."
        >
          <Toggle
            checked={store.interactionLimitEnabled}
            onChange={(v) => store.set('interactionLimitEnabled', v)}
          />
        </Row>
        {store.interactionLimitEnabled && (
          <Row label="Max Interactions">
            <NumberInput
              value={store.maxIterations}
              onChange={(v) => store.set('maxIterations', v)}
              min={1}
              max={500}
            />
          </Row>
        )}
        <Row label="Temperature">
          <NumberInput
            value={store.temperature}
            onChange={(v) => store.set('temperature', v)}
            min={0}
            max={2}
            step={0.1}
          />
        </Row>
        <Row label="Max Output Tokens">
          <NumberInput
            value={store.maxTokens}
            onChange={(v) => store.set('maxTokens', v)}
            min={256}
            max={32768}
            step={256}
          />
        </Row>
      </Section>

      <Section title="Layout">
        <Row
          label="Show Agent Tab"
          description="Display the Agent mode tab in the title bar"
        >
          <Toggle
            checked={store.showAgentTab}
            onChange={(v) => store.set('showAgentTab', v)}
          />
        </Row>
        <Row
          label="Show Review Tab"
          description="Display the Review mode tab in the title bar"
        >
          <Toggle
            checked={store.showReviewTab}
            onChange={(v) => store.set('showReviewTab', v)}
          />
        </Row>
        <Row
          label="Show Agent Chat Panel"
          description="Display the agent chat panel on the right side of the editor"
        >
          <Toggle
            checked={store.showAgentChatPanel}
            onChange={(v) => store.set('showAgentChatPanel', v)}
          />
        </Row>
        <Row
          label="Terminal in Agent Center"
          description="Replace chat with terminal tabs in the agent layout center panel"
        >
          <Toggle
            checked={store.agentCenterPanelMode === 'terminal'}
            onChange={(v) => store.set('agentCenterPanelMode', v ? 'terminal' : 'chat')}
          />
        </Row>
      </Section>

      <Section title="Onboarding">
        <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-foreground">Restart Setup Wizard</span>
            <span className="text-[10px] text-muted-foreground">
              Re-run the onboarding wizard to reconfigure theme, AI provider and editor preferences
            </span>
          </div>
          <button
            onClick={resetOnboarding}
            className="flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors border border-border"
          >
            <RotateCcw className="h-3 w-3" />
            Redo Onboarding
          </button>
        </div>
      </Section>
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

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="flex flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        {description && (
          <span className="text-[10px] text-muted-foreground">{description}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-muted accent-accent"
      />
      <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {step < 1 ? value.toFixed(1) : value}
      </span>
    </div>
  );
}

function SelectInput<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-7 rounded-md bg-muted px-2 text-[12px] text-foreground outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-foreground transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
