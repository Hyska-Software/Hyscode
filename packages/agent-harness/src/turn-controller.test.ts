import { describe, expect, it } from 'vitest';
import { TurnController } from './turn-controller';

describe('TurnController', () => {
  it('rejects concurrent turns and allows a new turn after completion', () => {
    const controller = new TurnController();
    const first = controller.begin();
    expect(() => controller.begin()).toThrow('already active');
    expect(controller.finish('complete')).toBe(true);
    const second = controller.begin();
    expect(second.turnId).not.toBe(first.turnId);
  });

  it('propagates cancellation and emits only one terminal transition', () => {
    const controller = new TurnController();
    const turn = controller.begin();
    controller.cancel();
    expect(turn.signal.aborted).toBe(true);
    expect(controller.finish('cancelled')).toBe(true);
    expect(controller.finish('error')).toBe(false);
  });
});
