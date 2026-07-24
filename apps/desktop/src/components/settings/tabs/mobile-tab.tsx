import { useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Search, XCircle } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import { pickFolder } from '../../../lib/tauri-dialog';
import { useDeviceStore, type SdkPaths } from '../../../stores/device-store';

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
      <Section title="Flutter / Dart">
        <Row label="Flutter SDK Path">
          <PathInput
            value={store.flutterSdkPath}
            onChange={(v) => store.set('flutterSdkPath', v)}
            placeholder="Auto-detect (leave empty)"
            onBrowse={() => browse('flutterSdkPath')}
          />
        </Row>
        <Row label="Android SDK Path">
          <PathInput
            value={store.androidSdkPath}
            onChange={(v) => store.set('androidSdkPath', v)}
            placeholder="Auto-detect (leave empty)"
            onBrowse={() => browse('androidSdkPath')}
          />
        </Row>
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
      </Section>

      <Section title="React Native">
        <Row label="Auto-detect Projects">
          <Toggle
            checked={store.reactNativeAutoDetect}
            onChange={(v) => store.set('reactNativeAutoDetect', v)}
          />
        </Row>
      </Section>

      <Section title="Info">
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
      </Section>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <span className="text-[12px] text-foreground">{label}</span>
      {children}
    </div>
  );
}

function PathInput({
  value,
  onChange,
  placeholder,
  onBrowse,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBrowse: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-44 rounded-md bg-muted px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        onClick={onBrowse}
        className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
        title="Browse folder"
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
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
