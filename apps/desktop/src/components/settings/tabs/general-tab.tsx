import { useSettingsStore } from '../../../stores';
import type { ActivityBarPosition, ApprovalMode, UpdateChannel } from '../../../stores/settings-store';
import { useUpdateStore } from '../../../stores/update-store';
import { useOnboardingStore } from '../../../stores/onboarding-store';
import { Loader2, CheckCircle, ArrowUpCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { SettingRow, SettingSection, SettingSelect, SettingSlider, SettingToggle } from '../controls';

export function GeneralTab() {
  const store = useSettingsStore();
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding);
  const updateStatus = useUpdateStore((s) => s.status);
  const releaseInfo = useUpdateStore((s) => s.releaseInfo);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const openDialog = useUpdateStore((s) => s.openDialog);

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title="Application">
        <SettingRow
          label="Confirm Before Close"
          description="Show a confirmation dialog when closing the application"
        >
          <SettingToggle
            checked={store.confirmOnClose}
            onChange={(v) => store.set('confirmOnClose', v)}
          />
        </SettingRow>
        <SettingRow
          label="Show Welcome on Startup"
          description="Display welcome page when no project is open"
        >
          <SettingToggle
            checked={store.showWelcomeOnStartup}
            onChange={(v) => store.set('showWelcomeOnStartup', v)}
          />
        </SettingRow>
        <SettingRow
          label="Reduced Motion"
          description="Minimize animations across the application"
        >
          <SettingToggle
            checked={store.reducedMotion}
            onChange={(v) => store.set('reducedMotion', v)}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Updates">
        <SettingRow
          label="Update Channel"
          description="Stable receives tested releases; Pre-release gets latest builds"
        >
          <SettingSelect<UpdateChannel>
            value={store.updateChannel}
            onChange={(v) => store.set('updateChannel', v)}
            options={[
              { value: 'stable', label: 'Stable' },
              { value: 'pre-release', label: 'Pre-release' },
            ]}
          />
        </SettingRow>
        <SettingRow
          label="Check on Startup"
          description="Automatically check for updates when the app launches"
        >
          <SettingToggle
            checked={store.checkForUpdatesOnStartup}
            onChange={(v) => store.set('checkForUpdatesOnStartup', v)}
          />
        </SettingRow>
        <SettingRow
          label="Auto-download"
          description="Download available updates automatically in the background"
        >
          <SettingToggle
            checked={store.autoDownload}
            onChange={(v) => store.set('autoDownload', v)}
          />
        </SettingRow>
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
              <span className="flex items-center gap-1 text-[10px] text-success">
                <CheckCircle className="h-3 w-3" /> Up to date
              </span>
            )}
            {(updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && releaseInfo && (
              <span className="flex items-center gap-1 text-[10px] text-primary">
                <ArrowUpCircle className="h-3 w-3" />
                {updateStatus === 'ready' ? 'Ready to install' : `${releaseInfo.version} available`}
              </span>
            )}
            {updateStatus === 'error' && (
              <span className="text-[10px] text-destructive">Check failed</span>
            )}
          </div>
          <div className="flex gap-2">
            {(updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && (
              <button
                onClick={openDialog}
                className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
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
      </SettingSection>

      <SettingSection title="Agent">
        <SettingRow label="Approval Mode">
          <SettingSelect<ApprovalMode>
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
        </SettingRow>
        <SettingRow
          label="Limit Interactions"
          description="Off by default. Loop detection, cancellation, and request timeouts remain active."
        >
          <SettingToggle
            checked={store.interactionLimitEnabled}
            onChange={(v) => store.set('interactionLimitEnabled', v)}
          />
        </SettingRow>
        {store.interactionLimitEnabled && (
          <SettingRow label="Max Interactions">
            <SettingSlider
              value={store.maxIterations}
              onChange={(v) => store.set('maxIterations', v)}
              min={1}
              max={500}
            />
          </SettingRow>
        )}
        <SettingRow label="Temperature">
          <SettingSlider
            value={store.temperature}
            onChange={(v) => store.set('temperature', v)}
            min={0}
            max={2}
            step={0.1}
          />
        </SettingRow>
        <SettingRow label="Max Output Tokens">
          <SettingSlider
            value={store.maxTokens}
            onChange={(v) => store.set('maxTokens', v)}
            min={256}
            max={32768}
            step={256}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Layout">
        <SettingRow
          label="Show Agent Tab"
          description="Display the Agent mode tab in the title bar"
        >
          <SettingToggle
            checked={store.showAgentTab}
            onChange={(v) => store.set('showAgentTab', v)}
          />
        </SettingRow>
        <SettingRow
          label="Show Agent Chat Panel"
          description="Display the agent chat panel on the right side of the editor"
        >
          <SettingToggle
            checked={store.showAgentChatPanel}
            onChange={(v) => store.set('showAgentChatPanel', v)}
          />
        </SettingRow>
        <SettingRow
          label="Terminal in Agent Center"
          description="Replace chat with terminal tabs in the agent layout center panel"
        >
          <SettingToggle
            checked={store.agentCenterPanelMode === 'terminal'}
            onChange={(v) => store.set('agentCenterPanelMode', v ? 'terminal' : 'chat')}
          />
        </SettingRow>
        <SettingRow
          label="Activity Bar Position"
          description="Place sidebar icon tabs on the left or at the top"
        >
          <SettingSelect<ActivityBarPosition>
            value={store.activityBarPosition}
            onChange={(v) => store.set('activityBarPosition', v)}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'top', label: 'Top' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Onboarding">
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
      </SettingSection>
    </div>
  );
}
