import { useState } from 'react';
import { useSettingsStore } from '../../../stores';
import { tauriInvoke } from '../../../lib/tauri-invoke';

export function DockerTab() {
  const store = useSettingsStore();
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'fail'>('idle');

  const handleTestConnection = async () => {
    try {
      const ok = await tauriInvoke('docker_is_available', {});
      setTestResult(ok ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="Connection">
        <Row label="Docker Socket Path">
          <div className="flex items-center gap-2">
            <TextInput
              value={store.dockerSocketPath}
              onChange={(v) => store.set('dockerSocketPath', v)}
              placeholder="Default (auto-detect)"
            />
            <button
              onClick={handleTestConnection}
              className="h-7 rounded-md bg-muted px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/80"
            >
              Test
            </button>
          </div>
        </Row>
        {testResult !== 'idle' && (
          <div
            className={`rounded-md px-3 py-2 text-[11px] ${
              testResult === 'ok'
                ? 'bg-success/10 text-success'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {testResult === 'ok'
              ? 'Docker is available and responding.'
              : 'Could not connect to Docker. Make sure Docker is running and "docker" is on your PATH.'}
          </div>
        )}
      </Section>

      <Section title="Display">
        <Row label="Show Stopped Containers">
          <Toggle
            checked={store.dockerShowStopped}
            onChange={(v) => store.set('dockerShowStopped', v)}
          />
        </Row>
        <Row label="Auto-Refresh Interval (seconds)">
          <NumberInput
            value={store.dockerAutoRefreshInterval}
            onChange={(v) => store.set('dockerAutoRefreshInterval', v)}
            min={0}
            max={60}
          />
        </Row>
        <p className="px-1 text-[9px] text-muted-foreground">
          Set to 0 to disable auto-refresh. Changes are detected in the background and only pushed when container state changes.
        </p>
      </Section>

      <Section title="Compose">
        <Row label="Default Compose File">
          <TextInput
            value={store.dockerComposeFile}
            onChange={(v) => store.set('dockerComposeFile', v)}
            placeholder="docker-compose.yml"
          />
        </Row>
      </Section>
    </div>
  );
}

// ── Shared atoms (same pattern as other tabs) ────────────────────────────────

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <span className="text-[12px] text-foreground">{label}</span>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-7 w-44 rounded-md bg-muted px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-muted primary-primary"
      />
      <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
        {value}
      </span>
    </div>
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
        checked ? 'bg-primary' : 'bg-muted'
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
