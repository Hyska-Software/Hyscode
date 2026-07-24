import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  Play,
  Square,
  RotateCw,
  Trash2,
  RefreshCw,
  ScrollText,
  AlertCircle,
  Search,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { useDockerStore, type ContainerInfo, type ImageInfo } from '../../../stores/docker-store';
import { useSettingsStore } from '../../../stores';
import { cn } from '../../../lib/utils';
import { TabBadge } from '../../ui/tab-badge';

// ── Status helpers ───────────────────────────────────────────────────────────

function stateColor(state: string): string {
  switch (state.toLowerCase()) {
    case 'running':
      return 'bg-success';
    case 'paused':
      return 'bg-warning';
    case 'restarting':
      return 'bg-blue-500';
    default:
      return 'bg-destructive/70';
  }
}

function timeAgo(ts: number | null): string {
  if (!ts) return '';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// ── Container Row ────────────────────────────────────────────────────────────

function ContainerRow({ container }: { container: ContainerInfo }) {
  const selectedId = useDockerStore((s) => s.selectedContainerId);
  const setSelected = useDockerStore((s) => s.setSelectedContainer);
  const startContainer = useDockerStore((s) => s.startContainer);
  const stopContainer = useDockerStore((s) => s.stopContainer);
  const restartContainer = useDockerStore((s) => s.restartContainer);
  const removeContainer = useDockerStore((s) => s.removeContainer);

  const isSelected = selectedId === container.id;
  const isRunning = container.state.toLowerCase() === 'running';
  const isStopped = ['exited', 'created', 'dead'].includes(container.state.toLowerCase());

  return (
    <div
      onClick={() => setSelected(isSelected ? null : container.id)}
      className={cn(
        'group flex w-full flex-col rounded-md transition-colors cursor-pointer',
        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50',
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        {/* Status dot */}
        <span className={cn('h-2 w-2 shrink-0 rounded-full', stateColor(container.state))} />

        {/* Name + image */}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-foreground">
            {container.name}
          </span>
          <span className="block truncate text-[9px] text-muted-foreground">
            {container.image}
          </span>
        </div>

        {/* Ports badge */}
        {container.ports && (
          <span className="hidden shrink-0 rounded bg-muted px-1 py-0.5 text-[8px] text-muted-foreground group-hover:inline">
            {container.ports.split(',')[0]?.trim().split('->')[1] ?? container.ports.split(',')[0]?.trim()}
          </span>
        )}

        {/* Hover actions */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {isStopped && (
            <ActionBtn
              icon={Play}
              title="Start"
              onClick={(e) => { e.stopPropagation(); startContainer(container.id); }}
            />
          )}
          {isRunning && (
            <ActionBtn
              icon={Square}
              title="Stop"
              onClick={(e) => { e.stopPropagation(); stopContainer(container.id); }}
            />
          )}
          <ActionBtn
            icon={RotateCw}
            title="Restart"
            onClick={(e) => { e.stopPropagation(); restartContainer(container.id); }}
          />
          <ActionBtn
            icon={Trash2}
            title="Remove"
            className="hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); removeContainer(container.id, true); }}
          />
        </div>
      </div>

      {/* Expanded detail */}
      {isSelected && <ContainerDetail container={container} />}
    </div>
  );
}

// ── Logs Modal ───────────────────────────────────────────────────────────────

function LogsModal({
  container,
  onClose,
}: {
  container: ContainerInfo;
  onClose: () => void;
}) {
  const fetchLogs = useDockerStore((s) => s.fetchLogs);
  const [logs, setLogs] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await fetchLogs(container.id, 500);
      setLogs(result);
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setLoading(false);
    }
  }, [container.id, fetchLogs]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!loading && logs !== null && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loading, logs]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const lineCount = logs ? logs.split('\n').filter(Boolean).length : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex h-[72vh] w-[82vw] max-w-5xl flex-col rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {container.name}
            </span>
            <span className="block text-[10px] font-mono text-muted-foreground">
              {container.id.slice(0, 12)}
            </span>
          </div>
          <span className={cn('h-2 w-2 shrink-0 rounded-full', stateColor(container.state))} />
          <span className="text-[10px] text-muted-foreground">{container.state}</span>
          <button
            onClick={loadLogs}
            disabled={loading}
            title="Refresh logs"
            className="ml-1 rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Log body */}
        <div
          ref={scrollContainerRef}
          className="relative min-h-0 flex-1 overflow-auto bg-[#0d1117] p-4 font-mono text-[11px] leading-relaxed"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Loading logs…</span>
            </div>
          ) : fetchError ? (
            <div className="flex h-full items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="break-all">{fetchError}</span>
            </div>
          ) : logs ? (
            <pre className="whitespace-pre-wrap break-all text-success/90">{logs}</pre>
          ) : (
            <div className="flex h-full items-center justify-center italic text-muted-foreground">
              No logs available
            </div>
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2">
          <span className="text-[10px] text-muted-foreground">
            {lineCount > 0 ? `${lineCount} lines` : ''}
          </span>
          <button
            onClick={() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className="h-3 w-3" />
            Jump to bottom
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ContainerDetail({ container }: { container: ContainerInfo }) {
  const [showLogsModal, setShowLogsModal] = useState(false);

  return (
    <div className="border-t border-border/50 px-2 py-1.5 text-[9px] text-muted-foreground">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <span>ID</span>
        <span className="truncate font-mono text-foreground/70">{container.id.slice(0, 12)}</span>
        <span>State</span>
        <span className="text-foreground/70">{container.state}</span>
        <span>Status</span>
        <span className="text-foreground/70">{container.status}</span>
        {container.ports && (
          <>
            <span>Ports</span>
            <span className="text-foreground/70 truncate">{container.ports}</span>
          </>
        )}
        <span>Created</span>
        <span className="text-foreground/70">{container.created}</span>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); setShowLogsModal(true); }}
        className="mt-1.5 flex items-center gap-1 text-[9px] text-primary hover:underline"
      >
        <ScrollText className="h-2.5 w-2.5" />
        View Logs
      </button>

      {showLogsModal && (
        <LogsModal container={container} onClose={() => setShowLogsModal(false)} />
      )}
    </div>
  );
}

// ── Image Row ────────────────────────────────────────────────────────────────

function ImageRow({ image }: { image: ImageInfo }) {
  const removeImage = useDockerStore((s) => s.removeImage);

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium text-foreground">
          {image.repository}
          <span className="text-muted-foreground">:{image.tag}</span>
        </span>
        <span className="block text-[9px] text-muted-foreground">
          {image.size} · {image.created}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <ActionBtn
          icon={Trash2}
          title="Remove image"
          className="hover:text-destructive"
          onClick={() => removeImage(image.id, false)}
        />
      </div>
    </div>
  );
}

// ── Action Button ────────────────────────────────────────────────────────────

function ActionBtn({
  icon: Icon,
  title,
  className,
  onClick,
}: {
  icon: typeof Play;
  title: string;
  className?: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

// ── Main Docker View ─────────────────────────────────────────────────────────

export function DockerView() {
  const isAvailable = useDockerStore((s) => s.isAvailable);
  const containers = useDockerStore((s) => s.containers);
  const images = useDockerStore((s) => s.images);
  const loading = useDockerStore((s) => s.loading);
  const error = useDockerStore((s) => s.error);
  const activeTab = useDockerStore((s) => s.activeTab);
  const setActiveTab = useDockerStore((s) => s.setActiveTab);
  const checkAvailability = useDockerStore((s) => s.checkAvailability);
  const refresh = useDockerStore((s) => s.refresh);
  const watchId = useDockerStore((s) => s.watchId);
  const lastUpdated = useDockerStore((s) => s.lastUpdated);
  const startWatch = useDockerStore((s) => s.startWatch);
  const stopWatch = useDockerStore((s) => s.stopWatch);
  const dockerAutoRefreshInterval = useSettingsStore((s) => s.dockerAutoRefreshInterval);

  const [filter, setFilter] = useState('');
  const [timeAgoText, setTimeAgoText] = useState('');

  // Initial load
  useEffect(() => {
    (async () => {
      const available = await checkAvailability();
      if (available) {
        await refresh();
      }
    })();
  }, []);

  // Auto-refresh via Rust watcher
  useEffect(() => {
    if (!isAvailable) return;
    const interval = dockerAutoRefreshInterval;
    if (interval > 0) {
      startWatch(interval * 1000);
    }
    return () => {
      stopWatch();
    };
  }, [isAvailable, dockerAutoRefreshInterval]);

  // Update "time ago" text every second
  useEffect(() => {
    if (!lastUpdated) return;
    const timer = setInterval(() => setTimeAgoText(timeAgo(lastUpdated)), 1000);
    setTimeAgoText(timeAgo(lastUpdated));
    return () => clearInterval(timer);
  }, [lastUpdated]);

  // Filter logic
  const filteredContainers = useMemo(() => {
    if (!filter) return containers;
    const q = filter.toLowerCase();
    return containers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        c.id.toLowerCase().startsWith(q),
    );
  }, [containers, filter]);

  const filteredImages = useMemo(() => {
    if (!filter) return images;
    const q = filter.toLowerCase();
    return images.filter(
      (i) =>
        i.repository.toLowerCase().includes(q) ||
        i.tag.toLowerCase().includes(q) ||
        i.id.toLowerCase().startsWith(q),
    );
  }, [images, filter]);

  // Docker not available
  if (!isAvailable) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <Box className="h-8 w-8 text-muted-foreground/50" />
        <div>
          <p className="text-[11px] font-medium text-foreground">Docker Not Available</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Docker CLI was not found on your system. Install Docker Desktop or ensure <code className="rounded bg-muted px-1">docker</code> is on your PATH.
          </p>
        </div>
        <button
          onClick={() => checkAvailability().then((ok) => { if (ok) refresh(); })}
          className="mt-1 flex items-center gap-1.5 rounded-md bg-surface-raised px-3 py-1.5 text-[10px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  const runningCount = containers.filter((c) => c.state.toLowerCase() === 'running').length;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5">
        {/* Tab toggle */}
        <div className="flex rounded-md bg-muted p-0.5">
          <button
            onClick={() => setActiveTab('containers')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-medium transition-colors',
              activeTab === 'containers'
                ? 'bg-surface-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Containers
            <TabBadge count={runningCount} />
          </button>
          <button
            onClick={() => setActiveTab('images')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-medium transition-colors',
              activeTab === 'images'
                ? 'bg-surface-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Images
            <TabBadge count={images.length} />
          </button>
        </div>

        <div className="flex-1" />

        {/* Last updated */}
        {watchId && timeAgoText && (
          <span className="text-[8px] text-muted-foreground">{timeAgoText}</span>
        )}

        {/* Refresh */}
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="relative flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          {/* Auto-refresh pulse indicator */}
          {watchId && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          )}
        </button>
      </div>

      {/* Filter */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={activeTab === 'containers' ? 'Filter containers...' : 'Filter images...'}
          className="h-6 w-full rounded-md bg-muted pl-6 pr-6 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/50"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[9px] text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Content */}
      {activeTab === 'containers' ? (
        <ContainerList containers={filteredContainers} />
      ) : (
        <ImageList images={filteredImages} />
      )}
    </div>
  );
}

// ── Container List ───────────────────────────────────────────────────────────

function ContainerList({ containers }: { containers: ContainerInfo[] }) {
  if (containers.length === 0) {
    return (
      <div className="py-6 text-center">
        <Box className="mx-auto h-5 w-5 text-muted-foreground/40" />
        <p className="mt-1.5 text-[10px] text-muted-foreground">No containers found</p>
      </div>
    );
  }

  // Group: running first, then the rest
  const running = containers.filter((c) => c.state.toLowerCase() === 'running');
  const other = containers.filter((c) => c.state.toLowerCase() !== 'running');

  return (
    <div className="flex flex-col gap-0.5">
      {running.length > 0 && (
        <CollapsibleGroup title="Running" count={running.length} defaultOpen>
          {running.map((c) => (
            <ContainerRow key={c.id} container={c} />
          ))}
        </CollapsibleGroup>
      )}
      {other.length > 0 && (
        <CollapsibleGroup title="Stopped" count={other.length} defaultOpen={other.length <= 5}>
          {other.map((c) => (
            <ContainerRow key={c.id} container={c} />
          ))}
        </CollapsibleGroup>
      )}
    </div>
  );
}

// ── Image List ───────────────────────────────────────────────────────────────

function ImageList({ images }: { images: ImageInfo[] }) {
  if (images.length === 0) {
    return (
      <div className="py-6 text-center">
        <ImageIcon className="mx-auto h-5 w-5 text-muted-foreground/40" />
        <p className="mt-1.5 text-[10px] text-muted-foreground">No images found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {images.map((i) => (
        <ImageRow key={`${i.repository}:${i.tag}:${i.id}`} image={i} />
      ))}
    </div>
  );
}

// ── Collapsible Group ────────────────────────────────────────────────────────

function CollapsibleGroup({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        {title}
        <span className="text-[8px] font-normal">({count})</span>
      </button>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}
