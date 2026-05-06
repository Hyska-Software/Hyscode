import { Bot } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import type { AgentMode } from '../../../stores/agent-store';

type SubAgentMode = Exclude<AgentMode, 'chat'>;

export function SubAgentsTab() {
  const store = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      <Section title="General">
        <Row
          label="Enable Sub-agents"
          description="Allow the agent to spawn specialized sub-agents during task execution. Disabled in chat mode regardless."
        >
          <Toggle
            checked={store.subAgentEnabled}
            onChange={(v) => store.set('subAgentEnabled', v)}
          />
        </Row>
      </Section>

      <Section title="Behavior">
        <Row
          label="Default Mode"
          description="Fallback mode when the agent does not explicitly choose one for a sub-task"
        >
          <SelectInput<SubAgentMode>
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
        </Row>

        <Row
          label="Max Iterations"
          description="Maximum tool-call iterations per sub-agent run (independent of main agent limit)"
        >
          <NumberInput
            value={store.subAgentMaxIterations}
            onChange={(v) => store.set('subAgentMaxIterations', v)}
            min={1}
            max={500}
            disabled={!store.subAgentEnabled}
          />
        </Row>

        <Row
          label="Auto-approve Sub-agent Tools"
          description="Sub-agents skip the approval dialog — all their tool calls are automatically approved"
        >
          <Toggle
            checked={store.subAgentAutoApprove}
            onChange={(v) => store.set('subAgentAutoApprove', v)}
            disabled={!store.subAgentEnabled}
          />
        </Row>
      </Section>

      {!store.subAgentEnabled && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
          <Bot className="h-4 w-4 shrink-0 text-yellow-400" />
          <span className="text-[11px] text-yellow-300/80">
            Sub-agents are disabled. The <code className="rounded bg-muted px-1">spawn_subagent</code> tool will not be available to the agent.
          </span>
        </div>
      )}
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
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-accent disabled:cursor-not-allowed"
      />
      <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

function SelectInput<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-7 rounded-md bg-muted px-2 text-[12px] text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-40"
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
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
