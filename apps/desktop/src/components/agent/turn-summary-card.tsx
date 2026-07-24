import { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Files,
  GitCompare,
  RotateCcw,
  SquarePen,
} from 'lucide-react';
import type { TurnSummary, TurnSummaryFile, TurnSummaryFileKind } from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { useLayoutStore } from '@/stores/layout-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { cn } from '@/lib/utils';

const INITIAL_FILE_COUNT = 3;

const GROUPS: Array<{ kind: TurnSummaryFileKind; label: string }> = [
  { kind: 'created', label: 'Created' },
  { kind: 'edited', label: 'Edited' },
  { kind: 'deleted', label: 'Deleted' },
];

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function statusLabel(status: TurnSummary['status']): string {
  if (status === 'complete') return 'Task completed';
  if (status === 'error' || status === 'recoverable_error') return 'Task needs attention';
  if (status === 'cancelled' || status === 'cancelled_partial') return 'Task cancelled';
  return 'Task stopped';
}

function FileRow({ file }: { file: TurnSummaryFile }) {
  const setSelectedFile = useLayoutStore((state) => state.setAgentSelectedChangeFile);
  return (
    <button
      type="button"
      onClick={() => setSelectedFile(file.filePath)}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04]"
    >
      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" />
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground/80">
        {file.filePath}
      </span>
      <span className="flex shrink-0 gap-1 text-[10px] tabular-nums">
        {file.added > 0 && <span className="text-emerald-400">+{file.added}</span>}
        {file.removed > 0 && <span className="text-destructive">-{file.removed}</span>}
      </span>
      {file.resolution !== 'pending' && (
        <span className="text-[9px] text-muted-foreground/55">
          {file.resolution === 'kept' ? 'Kept' : 'Undone'}
        </span>
      )}
      <ChevronRight className="h-3 w-3 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60" />
    </button>
  );
}

function FileGroup({
  kind,
  label,
  files,
}: {
  kind: TurnSummaryFileKind;
  label: string;
  files: TurnSummaryFile[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const visibleFiles = expanded ? files : files.slice(0, INITIAL_FILE_COUNT);
  const hiddenCount = files.length - visibleFiles.length;
  return (
    <div className="border-t border-foreground/[0.06] px-2 py-1.5">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
        <span className="text-[9px] text-muted-foreground/45">{files.length}</span>
      </div>
      {visibleFiles.map((file) => (
        <FileRow key={`${kind}:${file.sessionId}`} file={file} />
      ))}
      {files.length > INITIAL_FILE_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

export function TurnSummaryCard({ summary }: { summary: TurnSummary }) {
  const liveSummary =
    useAgentStore(
      (state) =>
        state.messages.find((message) => message.turnSummary?.turnId === summary.turnId)
          ?.turnSummary,
    ) ?? summary;
  const grouped = useMemo(
    () =>
      new Map(
        GROUPS.map(({ kind }) => [kind, liveSummary.files.filter((file) => file.kind === kind)]),
      ),
    [liveSummary.files],
  );
  const totals = useMemo(
    () =>
      liveSummary.files.reduce(
        (total, file) => ({
          added: total.added + file.added,
          removed: total.removed + file.removed,
        }),
        { added: 0, removed: 0 },
      ),
    [liveSummary.files],
  );
  const hasPending = liveSummary.files.some((file) => file.resolution === 'pending');
  const openReview = (): void => useLayoutStore.getState().setAgentRightTab('changes');

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-foreground/[0.09] bg-foreground/[0.018] shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            liveSummary.status === 'complete'
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400',
          )}
        >
          {liveSummary.status === 'complete' ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <SquarePen className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-foreground/90">
            {statusLabel(liveSummary.status)}
          </div>
          <div className="mt-0.5 text-[9.5px] text-muted-foreground/60">
            {formatDuration(liveSummary.durationMs)} · {liveSummary.toolCallCount}{' '}
            {liveSummary.toolCallCount === 1 ? 'action' : 'actions'}
          </div>
        </div>
        {liveSummary.files.length > 0 && (
          <button
            type="button"
            onClick={openReview}
            className="inline-flex items-center gap-1 rounded-md border border-foreground/[0.09] px-2 py-1 text-[10px] text-foreground/80 transition-colors hover:bg-foreground/[0.05]"
          >
            <GitCompare className="h-3 w-3" /> Review
          </button>
        )}
      </div>

      {liveSummary.files.length === 0 ? (
        <div className="flex items-center gap-2 border-t border-foreground/[0.06] px-3 py-2 text-[10px] text-muted-foreground/65">
          <Files className="h-3.5 w-3.5" /> No files changed in this turn
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-t border-foreground/[0.06] px-3 py-2">
            <span className="text-[10.5px] font-medium text-foreground/80">
              {liveSummary.files.length} {liveSummary.files.length === 1 ? 'file' : 'files'} changed
            </span>
            <span className="flex gap-1 text-[10px] tabular-nums">
              {totals.added > 0 && <span className="text-emerald-400">+{totals.added}</span>}
              {totals.removed > 0 && <span className="text-destructive">-{totals.removed}</span>}
            </span>
            {hasPending && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    void HarnessBridge.get().resolveTurnEditSessions(liveSummary.turnId, true)
                  }
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/10"
                >
                  <Check className="h-3 w-3" /> Keep
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void HarnessBridge.get().resolveTurnEditSessions(liveSummary.turnId, false)
                  }
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" /> Undo
                </button>
              </div>
            )}
          </div>
          {GROUPS.map(({ kind, label }) => (
            <FileGroup key={kind} kind={kind} label={label} files={grouped.get(kind) ?? []} />
          ))}
        </>
      )}
    </section>
  );
}
