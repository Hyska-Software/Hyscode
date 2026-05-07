import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  GitCommit,
  GitBranch,
  GitMerge,
  X,
  Loader2,
  User,
  Clock,
  Copy,
  ExternalLink,
  TreePine,
  Table2,
  Braces,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { useGitStore, useEditorStore } from '../../stores';
import type { GraphCommit } from '../../stores/git-store';

type ViewMode = 'tree' | 'compact' | 'mermaid' | 'grid';

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

/* ── Graph layout engine ─────────────────────────────────────────────── */

const ROW_H = 26;
const LANE_W = 16;
const DOT_R = 4;
const LANE_COLORS_SVG = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];
function lc(n: number) { return LANE_COLORS_SVG[n % LANE_COLORS_SVG.length]; }

interface ActiveEdge { lane: number; color: number; targetHash: string; }
interface Segment { fromLane: number; toLane: number; color: number; }
interface RowData {
  commit: GraphCommit;
  dotLane: number;
  dotColor: number;
  topSegs: Segment[];
  botSegs: Segment[];
}

function computeRows(commits: GraphCommit[]): { rows: RowData[]; maxLane: number } {
  const rows: RowData[] = [];
  let active: ActiveEdge[] = [];
  let colorIdx = 0;
  const occ = new Set<number>();
  const alloc = () => { let l = 0; while (occ.has(l)) l++; occ.add(l); return l; };
  const free = (l: number) => occ.delete(l);
  let maxLane = 0;

  for (const commit of commits) {
    const inc = active.filter(e => e.targetHash === commit.hash);
    const rest = active.filter(e => e.targetHash !== commit.hash);

    let dotLane: number, dotColor: number;
    if (inc.length > 0) {
      dotLane = inc[0].lane;
      dotColor = inc[0].color;
      for (let i = 1; i < inc.length; i++) free(inc[i].lane);
    } else {
      dotLane = alloc();
      dotColor = colorIdx++;
    }
    maxLane = Math.max(maxLane, dotLane);

    const out: ActiveEdge[] = [];
    for (let i = 0; i < commit.parents.length; i++) {
      const ph = commit.parents[i];
      if (rest.find(e => e.targetHash === ph)) {
        // Parent already tracked — free dotLane if first parent has no outgoing slot
        if (i === 0) free(dotLane);
        continue;
      }
      if (i === 0) {
        if (!occ.has(dotLane)) occ.add(dotLane);
        out.push({ lane: dotLane, color: dotColor, targetHash: ph });
      } else {
        const nl = alloc();
        maxLane = Math.max(maxLane, nl);
        out.push({ lane: nl, color: colorIdx++, targetHash: ph });
      }
    }
    if (commit.parents.length === 0) free(dotLane);

    rows.push({
      commit, dotLane, dotColor,
      topSegs: [
        ...rest.map(e => ({ fromLane: e.lane, toLane: e.lane, color: e.color })),
        ...inc.map(e => ({ fromLane: e.lane, toLane: dotLane, color: e.color })),
      ],
      botSegs: [
        ...rest.map(e => ({ fromLane: e.lane, toLane: e.lane, color: e.color })),
        ...out.map(e => ({ fromLane: dotLane, toLane: e.lane, color: e.color })),
      ],
    });
    active = [...rest, ...out];
  }
  return { rows, maxLane };
}

/* ── Mermaid formatter ───────────────────────────────────────────────── */

function formatMermaid(commits: GraphCommit[]): string {
  const lines: string[] = ['gitGraph TB:'];
  const sorted = [...commits].reverse();
  let branchCounter = 0;
  const branchOf = new Map<string, string>();

  function getBranch(hash: string): string {
    if (!branchOf.has(hash)) {
      branchOf.set(hash, `b${branchCounter++}`);
    }
    return branchOf.get(hash)!;
  }

  for (const c of sorted) {
    const b = getBranch(c.hash);
    if (!lines.includes(`    branch ${b}`)) {
      lines.splice(1, 0, `    branch ${b}`);
    }
    lines.push(`    checkout ${b}`);
    const msg = c.message.split('\n')[0].replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 30);
    lines.push(`    commit id: "${c.short_hash}" message: "${msg || 'commit'}"`);
    if (c.parents.length > 1) {
      const pb = getBranch(c.parents[1]);
      lines.push(`    merge ${pb}`);
    }
  }

  return lines.join('\n');
}

/* ── Main component ──────────────────────────────────────────────────── */

interface GitGraphViewProps {
  onClose?: () => void;
}

export function GitGraphView({ onClose }: GitGraphViewProps) {
  const graphLog = useGitStore((s) => s.graphLog);
  const fetchLogGraph = useGitStore((s) => s.fetchLogGraph);
  const openCommitTab = useEditorStore((s) => s.openCommitTab);
  const openGitGraphTab = useEditorStore((s) => s.openGitGraphTab);

  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [loading, setLoading] = useState(true);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchLogGraph(200).finally(() => setLoading(false));
  }, [fetchLogGraph]);

  const { rows } = useMemo(() => {
    if (graphLog.length === 0) return { rows: [], maxLane: 0 };
    return computeRows(graphLog);
  }, [graphLog]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchLogGraph(200).finally(() => setIsRefreshing(false));
  }, [fetchLogGraph]);

  const handleCopyHash = useCallback((hash: string) => {
    navigator.clipboard.writeText(hash);
  }, []);

  const handleOpenInEditor = useCallback(
    (hash: string, shortHash: string, message: string) => {
      openCommitTab(hash, shortHash, message);
    },
    [openCommitTab],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (graphLog.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <GitCommit className="mb-2 h-6 w-6 opacity-30" />
        <p className="text-[11px]">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-accent" />
          <span className="text-[11px] font-medium text-foreground">Git Graph</span>
          <span className="text-[10px] text-muted-foreground">({graphLog.length})</span>
        </div>
        <div className="flex items-center gap-0.5">
          <ModeBtn icon={TreePine} active={viewMode === 'tree'} onClick={() => setViewMode('tree')} title="Tree" />
          <ModeBtn icon={GitBranch} active={viewMode === 'compact'} onClick={() => setViewMode('compact')} title="Compact" />
          <ModeBtn icon={Braces} active={viewMode === 'mermaid'} onClick={() => setViewMode('mermaid')} title="Mermaid" />
          <ModeBtn icon={Table2} active={viewMode === 'grid'} onClick={() => setViewMode('grid')} title="Grid" />
          <div className="mx-1 h-3 w-px bg-border" />
          <button
            onClick={openGitGraphTab}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Open in editor"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            onClick={handleRefresh}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Refresh"
          >
            {isRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'tree' && (
          <TreeView
            rows={rows}
            expandedCommit={expandedCommit}
            onToggleExpand={setExpandedCommit}
            onCopyHash={handleCopyHash}
            onOpenInEditor={handleOpenInEditor}
          />
        )}
        {viewMode === 'compact' && (
          <CompactView
            commits={graphLog}
            expandedCommit={expandedCommit}
            onToggleExpand={setExpandedCommit}
            onCopyHash={handleCopyHash}
            onOpenInEditor={handleOpenInEditor}
          />
        )}
        {viewMode === 'mermaid' && <MermaidView commits={graphLog} />}
        {viewMode === 'grid' && (
          <GridView
            commits={graphLog}
            expandedCommit={expandedCommit}
            onToggleExpand={setExpandedCommit}
            onCopyHash={handleCopyHash}
            onOpenInEditor={handleOpenInEditor}
          />
        )}
      </div>
    </div>
  );
}

/* ── Mode button ─────────────────────────────────────────────────────── */

function ModeBtn({
  icon: Icon,
  active,
  onClick,
  title,
}: {
  icon: typeof TreePine;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-5 w-5 items-center justify-center rounded-sm transition-colors ${
        active ? 'bg-accent text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
      title={title}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

/* ── Tree View (SVG lane graph, VS Code style) ───────────────────────── */

function GraphSvg({ row }: { row: RowData }) {
  const PAD = 4;
  // Width = only what this row actually uses
  const allLanes = [
    row.dotLane,
    ...row.topSegs.flatMap(s => [s.fromLane, s.toLane]),
    ...row.botSegs.flatMap(s => [s.fromLane, s.toLane]),
  ];
  const rowMax = allLanes.length > 0 ? Math.max(...allLanes) : 0;
  const svgW = (rowMax + 1) * LANE_W + PAD * 2;
  const cx = PAD + row.dotLane * LANE_W + LANE_W / 2;
  const mid = ROW_H / 2;
  const isMerge = row.commit.parents.length > 1;

  function segPath(f: number, t: number, y0: number, y1: number): string {
    const x1 = PAD + f * LANE_W + LANE_W / 2;
    const x2 = PAD + t * LANE_W + LANE_W / 2;
    if (x1 === x2) return `M ${x1} ${y0} L ${x1} ${y1}`;
    const yc = (y0 + y1) / 2;
    return `M ${x1} ${y0} C ${x1} ${yc},${x2} ${yc},${x2} ${y1}`;
  }

  return (
    <svg width={svgW} height={ROW_H} style={{ display: 'block', flexShrink: 0 }}>
      {row.topSegs.map((s, i) => (
        <path key={`t${i}`} d={segPath(s.fromLane, s.toLane, 0, mid)}
          stroke={lc(s.color)} strokeWidth={1.5} fill="none" opacity={0.8} />
      ))}
      {row.botSegs.map((s, i) => (
        <path key={`b${i}`} d={segPath(s.fromLane, s.toLane, mid, ROW_H)}
          stroke={lc(s.color)} strokeWidth={1.5} fill="none" opacity={0.8} />
      ))}
      <circle cx={cx} cy={mid} r={isMerge ? 4.5 : DOT_R}
        fill={lc(row.dotColor)} stroke="hsl(var(--background))" strokeWidth={1.5} />
      {isMerge && <circle cx={cx} cy={mid} r={1.5} fill="hsl(var(--background))" opacity={0.6} />}
    </svg>
  );
}

function TreeView({
  rows,
  expandedCommit,
  onToggleExpand,
  onCopyHash,
  onOpenInEditor,
}: {
  rows: RowData[];
  expandedCommit: string | null;
  onToggleExpand: (h: string | null) => void;
  onCopyHash: (h: string) => void;
  onOpenInEditor: (h: string, s: string, m: string) => void;
}) {
  return (
    <div className="min-w-max">
      {rows.map((row) => {
        const { commit } = row;
        const isExpanded = expandedCommit === commit.hash;
        return (
          <div key={commit.hash}>
            <button
              onClick={() => onToggleExpand(isExpanded ? null : commit.hash)}
              className="flex w-full items-center border-b border-border/40 text-left hover:bg-surface-raised transition-colors"
              style={{ height: ROW_H }}
            >
              <GraphSvg row={row} />
              <span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 font-mono text-[10px] text-accent mr-1.5">
                {commit.short_hash}
              </span>
              <span className="truncate text-[11px] text-foreground">
                {commit.message.split('\n')[0]}
              </span>
              {commit.refs.length > 0 && (
                <div className="ml-1.5 flex shrink-0 items-center gap-1">
                  {commit.refs.slice(0, 3).map((ref) => {
                    const isTag = ref.startsWith('tag:');
                    const label = isTag ? ref.slice(4) : ref;
                    return (
                      <span key={ref} className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                        isTag ? 'bg-yellow-500/10 text-yellow-400' : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {isTag
                          ? <span className="flex items-center gap-0.5"><Tag className="h-2 w-2" />{label}</span>
                          : <span className="flex items-center gap-0.5"><GitBranch className="h-2 w-2" />{label}</span>
                        }
                      </span>
                    );
                  })}
                  {commit.refs.length > 3 && (
                    <span className="text-[9px] text-muted-foreground">+{commit.refs.length - 3}</span>
                  )}
                </div>
              )}
              <span className="ml-2 shrink-0 text-[10px] text-muted-foreground/70 pr-3">
                {commit.author.split(' ').slice(0, 2).join(' ')}
              </span>
            </button>
            {isExpanded && (
              <CommitDetailRow commit={commit} onCopyHash={onCopyHash} onOpenInEditor={onOpenInEditor} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Compact View ────────────────────────────────────────────────────── */

function CompactView({
  commits,
  expandedCommit,
  onToggleExpand,
  onCopyHash,
  onOpenInEditor,
}: {
  commits: GraphCommit[];
  expandedCommit: string | null;
  onToggleExpand: (h: string | null) => void;
  onCopyHash: (h: string) => void;
  onOpenInEditor: (h: string, s: string, m: string) => void;
}) {
  return (
    <div className="divide-y divide-border/50">
      {commits.map((commit) => {
        const isMerge = commit.parents.length > 1;
        const isExpanded = expandedCommit === commit.hash;

        return (
          <div key={commit.hash}>
            <button
              onClick={() => onToggleExpand(isExpanded ? null : commit.hash)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-raised transition-colors"
            >
              <div className="flex shrink-0 items-center justify-center h-5 w-5">
                {isMerge ? (
                  <GitMerge className="h-3 w-3 text-purple-400" />
                ) : (
                  <GitCommit className="h-3 w-3 text-accent" />
                )}
              </div>
              <span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 font-mono text-[10px] text-accent">
                {commit.short_hash}
              </span>
              <span className="truncate text-[11px] text-foreground">
                {commit.message.split('\n')[0]}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {commit.refs.slice(0, 2).map((ref) => {
                  const isTag = ref.startsWith('tag:');
                  const label = isTag ? ref.slice(4) : ref;
                  return (
                    <span
                      key={ref}
                      className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                        isTag
                          ? 'bg-yellow-500/10 text-yellow-400'
                          : 'bg-blue-500/10 text-blue-400'
                      }`}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
              <span className="hidden sm:block shrink-0 text-[10px] text-muted-foreground">
                {commit.author}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatRelativeTime(commit.timestamp)}
              </span>
            </button>

            {isExpanded && (
              <CommitDetailRow
                commit={commit}
                onCopyHash={onCopyHash}
                onOpenInEditor={onOpenInEditor}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Grid View ───────────────────────────────────────────────────────── */

function GridView({
  commits,
  expandedCommit,
  onToggleExpand,
  onCopyHash,
  onOpenInEditor,
}: {
  commits: GraphCommit[];
  expandedCommit: string | null;
  onToggleExpand: (h: string | null) => void;
  onCopyHash: (h: string) => void;
  onOpenInEditor: (h: string, s: string, m: string) => void;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-1.5 w-20">Hash</th>
            <th className="px-3 py-1.5">Message</th>
            <th className="px-3 py-1.5 w-28">Author</th>
            <th className="px-3 py-1.5 w-24">Refs</th>
            <th className="px-3 py-1.5 w-12">Parents</th>
            <th className="px-3 py-1.5 w-20">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {commits.map((commit) => (
            <>
              <tr
                key={commit.hash}
                onClick={() => onToggleExpand(expandedCommit === commit.hash ? null : commit.hash)}
                className="hover:bg-surface-raised transition-colors cursor-pointer"
              >
                <td className="px-3 py-1.5 font-mono text-[10px] text-accent">
                  {commit.short_hash}
                </td>
                <td className="px-3 py-1.5 text-[11px] text-foreground truncate max-w-[300px]">
                  {commit.message.split('\n')[0]}
                </td>
                <td className="px-3 py-1.5 text-[11px] text-muted-foreground truncate">
                  {commit.author}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    {commit.refs.filter((r) => !r.startsWith('tag:')).slice(0, 1).map((r) => (
                      <span key={r} className="rounded bg-blue-500/10 px-1 py-0.5 text-[9px] text-blue-400">
                        {r}
                      </span>
                    ))}
                    {commit.refs.filter((r) => r.startsWith('tag:')).slice(0, 1).map((r) => (
                      <span key={r} className="rounded bg-yellow-500/10 px-1 py-0.5 text-[9px] text-yellow-400">
                        {r.slice(4)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-[10px] text-muted-foreground font-mono">
                  {commit.parents.length}
                </td>
                <td className="px-3 py-1.5 text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatRelativeTime(commit.timestamp)}
                </td>
              </tr>
              {expandedCommit === commit.hash && (
                <tr>
                  <td colSpan={6} className="bg-muted/20">
                    <CommitDetailRow
                      commit={commit}
                      onCopyHash={onCopyHash}
                      onOpenInEditor={onOpenInEditor}
                    />
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Mermaid View ────────────────────────────────────────────────────── */

function MermaidView({ commits }: { commits: GraphCommit[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawMode, setRawMode] = useState(false);

  const mermaidCode = useMemo(() => formatMermaid(commits), [commits]);

  useEffect(() => {
    if (!containerRef.current || rawMode) return;
    let cancelled = false;

    const render = async () => {
      try {
        const mermaid = await import('mermaid').then((m) => m.default);
        mermaid.initialize({
          theme: 'base',
          themeVariables: {
            gitBranchLabel0: '#a855f7',
            gitBranchLabel1: '#22c55e',
            gitBranchLabel2: '#3b82f6',
            gitBranchLabel3: '#f59e0b',
            commitLabelBackground: '#181818',
            commitLabelColor: '#e2e8f0',
            tagLabelBackground: '#f59e0b',
            tagLabelColor: '#181818',
            mainBranchColor: '#a855f7',
            lineColor: '#4a5568',
          },
        });
        const { svg } = await mermaid.render('git-graph-mermaid', mermaidCode);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to render');
      }
    };
    render();
    return () => { cancelled = true; };
  }, [mermaidCode, rawMode]);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          Mermaid gitGraph ({commits.length} commits)
        </span>
        <button
          onClick={() => setRawMode(!rawMode)}
          className="rounded-sm px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {rawMode ? 'Diagram' : 'Raw'}
        </button>
      </div>

      {error && (
        <div className="mb-2 rounded-sm bg-red-500/10 px-3 py-1.5 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {rawMode ? (
        <pre className="overflow-auto rounded-lg bg-muted/30 p-3 text-[10px] font-mono text-foreground/80 leading-relaxed">
          {mermaidCode}
        </pre>
      ) : (
        <div
          ref={containerRef}
          className="flex justify-center overflow-auto rounded-lg bg-muted/10 p-3 min-h-[200px]"
        />
      )}
    </div>
  );
}

/* ── Commit Detail Row (shared) ──────────────────────────────────────── */

function CommitDetailRow({
  commit,
  onCopyHash,
  onOpenInEditor,
}: {
  commit: GraphCommit;
  onCopyHash: (h: string) => void;
  onOpenInEditor: (h: string, s: string, m: string) => void;
}) {
  return (
    <div className="border-t border-b border-border/50 bg-muted/20 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <button
              onClick={() => onCopyHash(commit.hash)}
              className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/20 transition-colors"
              title="Copy hash"
            >
              {commit.short_hash}
              <Copy className="h-2.5 w-2.5" />
            </button>
            {commit.refs.map((ref) => {
              const isTag = ref.startsWith('tag:');
              const label = isTag ? ref.slice(4) : ref;
              return (
                <span
                  key={ref}
                  className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                    isTag
                      ? 'bg-yellow-500/10 text-yellow-400'
                      : 'bg-blue-500/10 text-blue-400'
                  }`}
                >
                  {isTag ? (
                    <span className="flex items-center gap-0.5">
                      <Tag className="h-2 w-2" />
                      {label}
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5">
                      <GitBranch className="h-2 w-2" />
                      {label}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <p className="text-[11px] text-foreground whitespace-pre-wrap leading-snug mb-1">
            {commit.message}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <User className="h-2.5 w-2.5" />
              {commit.author}
            </span>
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatDate(commit.timestamp)}
            </span>
            {commit.parents.length > 0 && (
              <span className="text-muted-foreground/60">
                Parents: {commit.parents.map((p) => p.slice(0, 7)).join(', ')}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onOpenInEditor(commit.hash, commit.short_hash, commit.message)}
          className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Open in editor"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </button>
      </div>
    </div>
  );
}
