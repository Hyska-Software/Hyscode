import { describe, expect, it, vi } from 'vitest';
import { SubAgentCoordinator } from './sub-agent-coordinator';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SubAgentCoordinator', () => {
  it('caps concurrent shared children at the configured limit', async () => {
    const coordinator = new SubAgentCoordinator(2);
    let active = 0;
    let peak = 0;

    const runs = Array.from({ length: 4 }, (_, index) =>
      coordinator.submit(`child-${index}`, 'review', 'shared', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await delay(20);
        active -= 1;
        return `done-${index}`;
      }),
    );

    const results = await Promise.all(runs);
    expect(results).toEqual(['done-0', 'done-1', 'done-2', 'done-3']);
    expect(peak).toBe(2);
  });

  it('serializes exclusive children behind shared ones', async () => {
    const coordinator = new SubAgentCoordinator(2);
    const startedOrder: string[] = [];
    const lock: string[] = [];

    const shared1 = coordinator.submit('review-1', 'review', 'shared', async () => {
      startedOrder.push('review-1');
      lock.push('review-1');
      await delay(10);
      lock.splice(lock.indexOf('review-1'), 1);
    });
    const exclusive = coordinator.submit('build-1', 'build', 'exclusive', async () => {
      startedOrder.push('build-1');
      expect(lock).toHaveLength(0);
      lock.push('build-1');
      await delay(10);
      lock.splice(lock.indexOf('build-1'), 1);
    });
    const shared2 = coordinator.submit('review-2', 'review', 'shared', async () => {
      startedOrder.push('review-2');
      // Review-2 must start only after the exclusive build finished.
      expect(startedOrder.indexOf('build-1')).toBeGreaterThanOrEqual(0);
    });

    await Promise.all([shared1, exclusive, shared2]);
    expect(startedOrder.indexOf('build-1')).toBeLessThan(startedOrder.indexOf('review-2'));
  });

  it('reports queue positions and clears them when children start', async () => {
    const positions: Array<Array<{ id: string; queuePosition: number }>> = [];
    const coordinator = new SubAgentCoordinator(1, (updates) => positions.push(updates));

    const runs = Array.from({ length: 3 }, (_, index) =>
      coordinator.submit(`child-${index}`, 'review', 'shared', async () => {
        await delay(10);
      }),
    );

    await Promise.all(runs);
    expect(positions.some((snapshot) => snapshot.length === 2)).toBe(true);
    expect(
      positions.some((snapshot) =>
        snapshot.some((entry) => entry.id === 'child-2' && entry.queuePosition === 2),
      ),
    ).toBe(true);
  });

  it('cancels queued children without running them', async () => {
    const coordinator = new SubAgentCoordinator(1);
    const factory = vi.fn(async () => 'ran');
    const first = coordinator.submit('child-0', 'review', 'shared', factory);
    const queued = coordinator.submit('child-1', 'review', 'shared', factory);

    coordinator.cancelQueued((id) => id === 'child-1');

    await expect(queued).rejects.toThrow('cancelled before it started');
    await first;
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
