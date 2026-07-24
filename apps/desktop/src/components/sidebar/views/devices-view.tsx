import { useEffect } from 'react';
import {
  Smartphone,
  Tablet,
  Monitor,
  Globe,
  RefreshCw,
  Play,
  Rocket,
  CircleDot,
  CircleOff,
  AlertCircle,
} from 'lucide-react';
import { useDeviceStore, type DeviceInfo, type EmulatorInfo } from '../../../stores/device-store';
import { useProjectStore } from '../../../stores';
import { cn } from '../../../lib/utils';

// ── Platform Icons ───────────────────────────────────────────────────────────

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  switch (platform) {
    case 'android':
      return <Smartphone className={className} />;
    case 'ios':
      return <Tablet className={className} />;
    case 'web':
      return <Globe className={className} />;
    case 'linux':
    case 'macos':
    case 'windows':
      return <Monitor className={className} />;
    default:
      return <Smartphone className={className} />;
  }
}

// ── Device Row ───────────────────────────────────────────────────────────────

function DeviceRow({ device }: { device: DeviceInfo }) {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const selectDevice = useDeviceStore((s) => s.selectDevice);
  const runOnDevice = useDeviceStore((s) => s.runOnDevice);
  const rootPath = useProjectStore((s) => s.rootPath);
  const runningPtyIds = useDeviceStore((s) => s.runningPtyIds);
  const isSelected = selectedDeviceId === device.id;
  const isRunning = device.id in runningPtyIds;

  const handleRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!rootPath) return;
    await runOnDevice(device.id, rootPath, device.platform);
  };

  return (
    <button
      onClick={() => selectDevice(device.id)}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
        isSelected
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground',
      )}
    >
      <PlatformIcon platform={device.platform} className="h-3.5 w-3.5 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="truncate text-[11px] font-medium">{device.name}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-muted-foreground capitalize">{device.platform}</span>
          {device.emulator && (
            <span className="text-[9px] text-muted-foreground/60">• emulator</span>
          )}
        </div>
      </div>

      {/* Status indicator */}
      {device.available ? (
        <CircleDot className="h-2.5 w-2.5 shrink-0 text-success" />
      ) : (
        <CircleOff className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
      )}

      {/* Run button */}
      {isSelected && device.available && rootPath && !isRunning && (
        <button
          onClick={handleRun}
          className="shrink-0 rounded p-0.5 text-primary hover:bg-primary/20 transition-colors opacity-0 group-hover:opacity-100"
          title={`Run on ${device.name}`}
        >
          <Play className="h-3 w-3" />
        </button>
      )}

      {isRunning && (
        <span className="text-[9px] text-primary font-medium">Running</span>
      )}
    </button>
  );
}

// ── Emulator Row ─────────────────────────────────────────────────────────────

function EmulatorRow({ emulator }: { emulator: EmulatorInfo }) {
  const startEmulator = useDeviceStore((s) => s.startEmulator);

  const handleLaunch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await startEmulator(emulator.id);
  };

  return (
    <div className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-surface-raised hover:text-foreground transition-colors">
      <PlatformIcon platform={emulator.platform} className="h-3.5 w-3.5 shrink-0 opacity-50" />

      <div className="flex-1 min-w-0">
        <div className="truncate text-[11px]">{emulator.name}</div>
        <span className="text-[9px] text-muted-foreground/60 capitalize">{emulator.platform}</span>
      </div>

      <button
        onClick={handleLaunch}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-primary hover:bg-primary/20 transition-colors opacity-0 group-hover:opacity-100"
        title={`Launch ${emulator.name}`}
      >
        <Rocket className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-1 py-1">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
      {count > 0 && (
        <span className="text-[9px] tabular-nums text-muted-foreground/60">{count}</span>
      )}
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────────────────

export function DevicesView() {
  const devices = useDeviceStore((s) => s.devices);
  const emulators = useDeviceStore((s) => s.emulators);
  const isRefreshing = useDeviceStore((s) => s.isRefreshing);
  const flutterAvailable = useDeviceStore((s) => s.flutterAvailable);
  const refreshDevices = useDeviceStore((s) => s.refreshDevices);

  // Auto-refresh on mount
  useEffect(() => {
    refreshDevices();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-muted-foreground">Device Manager</span>
        <button
          onClick={() => refreshDevices()}
          disabled={isRefreshing}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          title="Refresh devices"
        >
          <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Flutter not found warning */}
      {flutterAvailable === false && (
        <div className="flex items-start gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-[10px] text-warning">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Flutter not found.</span>{' '}
            Install Flutter SDK or set the path in Settings → Mobile.
          </div>
        </div>
      )}

      {/* Connected Devices */}
      <div>
        <SectionHeader title="Connected Devices" count={devices.length} />
        {devices.length === 0 && !isRefreshing ? (
          <div className="px-2 py-3 text-center text-[10px] text-muted-foreground/60">
            No devices connected
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {devices.map((device) => (
              <DeviceRow key={device.id} device={device} />
            ))}
          </div>
        )}
      </div>

      {/* Emulators */}
      <div>
        <SectionHeader title="Emulators" count={emulators.length} />
        {emulators.length === 0 && !isRefreshing ? (
          <div className="px-2 py-3 text-center text-[10px] text-muted-foreground/60">
            No emulators configured
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {emulators.map((emu) => (
              <EmulatorRow key={emu.id} emulator={emu} />
            ))}
          </div>
        )}
      </div>

      {/* Refresh hint */}
      {isRefreshing && (
        <div className="px-2 text-center text-[9px] text-muted-foreground/60">
          Scanning devices…
        </div>
      )}
    </div>
  );
}
