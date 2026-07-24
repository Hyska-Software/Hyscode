import { useState } from 'react';
import { useSettingsStore } from '../../../stores';
import { tauriInvoke } from '../../../lib/tauri-invoke';
import { SettingRow, SettingSection, SettingSlider, SettingTextInput, SettingToggle } from '../controls';

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
      <SettingSection title="Connection">
        <SettingRow label="Docker Socket Path">
          <div className="flex items-center gap-2">
            <SettingTextInput
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
        </SettingRow>
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
      </SettingSection>

      <SettingSection title="Display">
        <SettingRow label="Show Stopped Containers">
          <SettingToggle
            checked={store.dockerShowStopped}
            onChange={(v) => store.set('dockerShowStopped', v)}
          />
        </SettingRow>
        <SettingRow label="Auto-Refresh Interval (seconds)">
          <SettingSlider
            value={store.dockerAutoRefreshInterval}
            onChange={(v) => store.set('dockerAutoRefreshInterval', v)}
            min={0}
            max={60}
          />
        </SettingRow>
        <p className="px-1 text-[9px] text-muted-foreground">
          Set to 0 to disable auto-refresh. Changes are detected in the background and only pushed when container state changes.
        </p>
      </SettingSection>

      <SettingSection title="Compose">
        <SettingRow label="Default Compose File">
          <SettingTextInput
            value={store.dockerComposeFile}
            onChange={(v) => store.set('dockerComposeFile', v)}
            placeholder="docker-compose.yml"
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
