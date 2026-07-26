import { Bot } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import type { AgentMode } from '../../../stores/agent-store';
import { SettingRow, SettingSection, SettingSelect, SettingSlider, SettingToggle } from '../controls';

type SubAgentMode = Exclude<AgentMode, 'chat'>;

export function SubAgentsTab() {
  const store = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title="General">
        <SettingRow
          label="Enable Sub-agents"
          description="Allow the agent to spawn specialized sub-agents during task execution. Disabled in chat mode regardless."
        >
          <SettingToggle
            checked={store.subAgentEnabled}
            onChange={(v) => store.set('subAgentEnabled', v)}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Behavior">
        <SettingRow
          label="Default Mode"
          description="Fallback mode when the agent does not explicitly choose one for a sub-task"
        >
          <SettingSelect<SubAgentMode>
            value={store.subAgentDefaultMode}
            onChange={(v) => store.set('subAgentDefaultMode', v)}
            options={[
              { value: 'build',  label: 'Build — implement code' },
              { value: 'review', label: 'Review — analyze quality' },
              { value: 'debug',  label: 'Debug — investigate bugs' },
              { value: 'plan',   label: 'Plan — create roadmap' },
            ]}
            disabled={!store.subAgentEnabled}
          />
        </SettingRow>

        <SettingRow
          label="Max Iterations"
          description="Maximum tool-call iterations per sub-agent run (independent of main agent limit)"
        >
          <SettingSlider
            value={store.subAgentMaxIterations}
            onChange={(v) => store.set('subAgentMaxIterations', v)}
            min={1}
            max={500}
            disabled={!store.subAgentEnabled}
          />
        </SettingRow>

        <SettingRow
          label="Auto-approve Sub-agent Tools"
          description="Sub-agents skip the approval dialog — all their tool calls are automatically approved"
        >
          <SettingToggle
            checked={store.subAgentAutoApprove}
            onChange={(v) => store.set('subAgentAutoApprove', v)}
            disabled={!store.subAgentEnabled}
          />
        </SettingRow>
      </SettingSection>

      {!store.subAgentEnabled && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5">
          <Bot className="h-4 w-4 shrink-0 text-warning" />
          <span className="text-[11px] text-warning/80">
            Sub-agents are disabled. The <code className="rounded bg-muted px-1">spawn_subagent</code> tool will not be available to the agent.
          </span>
        </div>
      )}
    </div>
  );
}
