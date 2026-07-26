import { describe, expect, it, vi } from 'vitest';
import { ProviderInitializationCoordinator } from './init-providers';

describe('ProviderInitializationCoordinator', () => {
  it('shares one pending initialization across concurrent callers', async () => {
    const coordinator = new ProviderInitializationCoordinator();
    let release: (() => void) | undefined;
    const initializer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = coordinator.run(initializer);
    const second = coordinator.run(initializer);
    release?.();
    await Promise.all([first, second]);
    await coordinator.run(initializer);

    expect(initializer).toHaveBeenCalledTimes(1);
  });

  it('allows retry after a failed initialization', async () => {
    const coordinator = new ProviderInitializationCoordinator();
    const failure = new Error('failed');
    const initializer = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce();

    await expect(coordinator.run(initializer)).rejects.toBe(failure);
    await expect(coordinator.run(initializer)).resolves.toBeUndefined();

    expect(initializer).toHaveBeenCalledTimes(2);
  });
});
