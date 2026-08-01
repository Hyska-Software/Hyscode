import type { AgentMode } from '@/stores/agent-store';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SubAgentResourceMode = 'shared' | 'exclusive';

type QueuedTask<T> = {
  id: string;
  mode: AgentMode;
  resourceMode: SubAgentResourceMode;
  factory: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  cancelled: boolean;
};

// ─── SubAgentCoordinator ────────────────────────────────────────────────────
// FIFO queue that bounds how many sub-agents run at once and serializes
// workspace-exclusive children (build/debug/plan) behind parallel
// read-only children (review). The parent harness already starts spawn
// batches concurrently; this coordinator enforces the app-level policy.

export class SubAgentCoordinator {
  private queue: Array<QueuedTask<unknown>> = [];
  private activeTasks = new Set<string>();
  private maxConcurrent: number;
  private onQueueChange?: (positions: Array<{ id: string; queuePosition: number }>) => void;

  constructor(maxConcurrent = 2, onQueueChange?: (positions: Array<{ id: string; queuePosition: number }>) => void) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.onQueueChange = onQueueChange;
  }

  get activeCount(): number {
    return this.activeTasks.size;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get maxConcurrentCount(): number {
    return this.maxConcurrent;
  }

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, value);
    this.pump();
  }

  /** Submit a child run. The factory is invoked only when a slot is available. */
  submit<T>(
    id: string,
    mode: AgentMode,
    resourceMode: SubAgentResourceMode,
    factory: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id,
        mode,
        resourceMode,
        factory,
        resolve: (value: unknown) => resolve(value as T),
        reject,
        cancelled: false,
      });
      this.emitQueuePositions();
      this.pump();
    });
  }

  /** Cancel queued children that match a predicate without starting them. */
  cancelQueued(predicate: (id: string) => boolean): void {
    let changed = false;
    for (const task of this.queue) {
      if (predicate(task.id)) {
        task.cancelled = true;
        task.reject(new Error('Sub-agent cancelled before it started.'));
        changed = true;
      }
    }
    this.queue = this.queue.filter((task) => !task.cancelled);
    if (changed) {
      this.emitQueuePositions();
      this.pump();
    }
  }

  /** Cancel every queued child immediately. */
  cancelAllQueued(): void {
    this.cancelQueued(() => true);
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const exclusiveQueued = this.queue.some((task) => task.resourceMode === 'exclusive');

      let task: QueuedTask<unknown> | undefined;
      if (exclusiveQueued) {
        // An exclusive child gates the queue: it starts as soon as the
        // workspace drains, and no new shared children start behind it.
        if (this.activeTasks.size === 0) {
          task = this.queue.find((candidate) => candidate.resourceMode === 'exclusive');
        }
      } else if (this.activeTasks.size < this.maxConcurrent) {
        task = this.queue.find((candidate) => candidate.resourceMode === 'shared');
      }
      if (!task) break;

      this.queue = this.queue.filter((candidate) => candidate !== task);
      this.activeTasks.add(task.id);
      this.emitQueuePositions();

      task
        .factory()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeTasks.delete(task.id);
          this.emitQueuePositions();
          this.pump();
        });
    }
  }

  private emitQueuePositions(): void {
    if (!this.onQueueChange) return;
    this.onQueueChange(
      this.queue.map((task, index) => ({ id: task.id, queuePosition: index + 1 })),
    );
  }
}
