import { useState } from 'react';
import { CheckCircle2, Loader2, Search, XCircle } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import { pickFolder } from '../../../lib/tauri-dialog';
import { useDeviceStore, type SdkPaths } from '../../../stores/device-store';
import { SettingRow, SettingSection, SettingPathInput, SettingToggle } from '../controls';

export function MobileTab() {
  const store = useSettingsStore();
  const checkSdkPaths = useDeviceStore((s) => s.checkSdkPaths);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<SdkPaths | null>(null);

  const browse = async (key: 'flutterSdkPath' | 'androidSdkPath') => {
    const folder = await pickFolder();
    if (folder) store.set(key, folder);
  };

  const detect = async () => {
    setDetecting(true);
    try {
      const result = await checkSdkPaths();
      setDetected(result);
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title="Flutter / Dart">
        <SettingRow label="Flutter SDK Path">
          <SettingPathInput
            value={store.flutterSdkPath}
            onChange={(v) => store.set('flutterSdkPath', v)}
            placeholder="Auto-detect (leave empty)"
            onBrowse={() => browse('flutterSdkPath')}
          />
        </SettingRow>
        <SettingRow label="Android SDK Path">
          <SettingPathInput
            value={store.androidSdkPath}
            onChange={(v) => store.set('androidSdkPath', v)}
            placeholder="Auto-detect (leave empty)"
            onBrowse={() => browse('androidSdkPath')}
          />
        </SettingRow>
        <div className="flex justify-end px-1">
          <button
            onClick={detect}
            disabled={detecting}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {detecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {detecting ? 'Detecting…' : 'Detect SDKs'}
          </button>
        </div>
        {detected && <SdkResults paths={detected} />}
      </SettingSection>

      <SettingSection title="React Native">
        <SettingRow label="Auto-detect Projects">
          <SettingToggle
            checked={store.reactNativeAutoDetect}
            onChange={(v) => store.set('reactNativeAutoDetect', v)}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Info">
        <div className="rounded-lg bg-surface-raised px-3 py-3 text-[11px] text-muted-foreground leading-relaxed">
          <p className="mb-2">
            <strong className="text-foreground">Flutter / Dart:</strong> If the SDK path is left
            empty, HysCode will try to find Flutter in your system PATH, then check{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-primary">FLUTTER_ROOT</code>.
          </p>
          <p>
            <strong className="text-foreground">Android SDK:</strong> Checks{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-primary">ANDROID_SDK_ROOT</code>,{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-primary">ANDROID_HOME</code> and
            common install locations automatically.
          </p>
        </div>
      </SettingSection>
    </div>
  );
}

// ── SDK detection results ─────────────────────────────────────────────────────

function SdkResults({ paths }: { paths: SdkPaths }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-[11px] flex flex-col gap-2">
      <SdkRow
        label="Flutter"
        found={!!paths.flutterBin}
        version={paths.flutterVersion}
        source={paths.flutterSource}
        path={paths.flutterBin}
      />
      <SdkRow
        label="ADB"
        found={!!paths.adbBin}
        version={paths.adbVersion}
        source={paths.adbSource}
        path={paths.adbBin}
      />
      {paths.androidSdkRoot && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="w-14 shrink-0 font-medium text-foreground">SDK Root</span>
          <span className="truncate font-mono text-[10px]">{paths.androidSdkRoot}</span>
        </div>
      )}
    </div>
  );
}

function SdkRow({
  label,
  found,
  version,
  source,
  path,
}: {
  label: string;
  found: boolean;
  version: string | null;
  source: string | null;
  path: string | null;
}) {
  return (
    <div className="flex items-start gap-2">
      {found ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          {found ? (
            <>
              {version && <span className="text-muted-foreground">v{version}</span>}
              {source && (
                <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
                  {source}
                </span>
              )}
            </>
          ) : (
            <span className="text-destructive">Not found</span>
          )}
        </div>
        {path && (
          <span className="font-mono text-[10px] text-muted-foreground truncate max-w-xs">{path}</span>
        )}
      </div>
    </div>
  );
}
