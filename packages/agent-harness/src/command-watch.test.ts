import { describe, expect, it } from 'vitest';

import { CommandWatch, type CommandWatchConfig } from './command-watch';
import { MAX_CAPTURE_CHARS } from './terminal-protocol';

function makeWatch(overrides: Partial<CommandWatchConfig> = {}): CommandWatch {
  return new CommandWatch({
    nonce: 'watch',
    background: false,
    readyPattern: null,
    startedAt: Date.now(),
    ...overrides,
  });
}

describe('CommandWatch accessors', () => {
  it('tracks the highest sequence seen and exposes the raw output', () => {
    const watch = makeWatch();
    watch.pushData(3, 'a');
    watch.pushData(1, 'b');
    watch.pushData(7, 'c');
    expect(watch.sequence).toBe(7);
    expect(watch.output()).toBe('abc');
  });

  it('reports exit state and code', () => {
    const watch = makeWatch();
    expect(watch.hasExited).toBe(false);
    expect(watch.exitCode).toBeNull();
    watch.pushExit(42);
    expect(watch.hasExited).toBe(true);
    expect(watch.exitCode).toBe(42);
    watch.pushExit(null);
    expect(watch.exitCode).toBeNull();
  });

  it('parses the accumulated output against the frame nonce', () => {
    const watch = makeWatch({ nonce: 'n1' });
    watch.pushData(1, '__HYSCODE_BEGIN_n1__\nhi\n');
    expect(watch.parsed()).toMatchObject({ started: true, complete: false, output: 'hi' });
  });
});

describe('CommandWatch syncSnapshot', () => {
  it('replaces the accumulator with the authoritative snapshot', () => {
    const watch = makeWatch();
    watch.pushData(1, 'stale');
    watch.syncSnapshot('__HYSCODE_BEGIN_watch__\nfresh\n__HYSCODE_END_watch__:0\n', 9);
    expect(watch.output()).toBe('__HYSCODE_BEGIN_watch__\nfresh\n__HYSCODE_END_watch__:0\n');
    expect(watch.evaluate(Date.now())).toMatchObject({ kind: 'complete' });
  });

  it('does not let an older snapshot erase newer live output', () => {
    const watch = makeWatch();
    watch.pushData(2, '__HYSCODE_BEGIN_watch__\nlive\n');
    watch.syncSnapshot('stale snapshot', 1);
    expect(watch.output()).toBe('__HYSCODE_BEGIN_watch__\nlive\n');
  });

  it('keeps the current frame while a newer snapshot has not replayed it yet', () => {
    const watch = makeWatch();
    watch.pushData(2, '__HYSCODE_BEGIN_watch__\nlive\n');
    watch.syncSnapshot('older terminal output', 5);
    expect(watch.output()).toBe('__HYSCODE_BEGIN_watch__\nlive\n');
  });

  it('caps oversized snapshots to the capture bound', () => {
    const watch = makeWatch();
    const huge = 'x'.repeat(MAX_CAPTURE_CHARS + 10);
    watch.syncSnapshot(huge, 1);
    expect(watch.output().length).toBe(MAX_CAPTURE_CHARS);
  });
});

describe('CommandWatch evaluate', () => {
  it('returns running until the frame starts', () => {
    const watch = makeWatch();
    watch.pushData(1, 'shell banner');
    expect(watch.evaluate(Date.now()).kind).toBe('running');
  });

  it('completes with the reported exit code', () => {
    const watch = makeWatch();
    watch.pushData(1, '__HYSCODE_BEGIN_watch__\nok\n__HYSCODE_END_watch__:0\n');
    expect(watch.evaluate(Date.now())).toMatchObject({ kind: 'complete', exitCode: 0 });
  });

  it('suspends only after the idle window has passed', () => {
    const watch = makeWatch({ idleMs: 50 });
    const pushedAt = Date.now();
    watch.pushData(1, '__HYSCODE_BEGIN_watch__\nContinue? [Y/n]\n');
    expect(watch.evaluate(pushedAt + 10).kind).toBe('running');
    expect(watch.evaluate(pushedAt + 200).kind).toBe('awaiting_input');
  });

  it('respects a custom idle window', () => {
    const watch = makeWatch({ idleMs: 5_000 });
    watch.pushData(1, '__HYSCODE_BEGIN_watch__\nProceed? [y/N]\n');
    expect(watch.evaluate(Date.now() + 3_000).kind).toBe('running');
    expect(watch.evaluate(Date.now() + 7_000).kind).toBe('awaiting_input');
  });

  it('does not suspend when a data chunk arrives inside the idle window', () => {
    const watch = makeWatch({ idleMs: 400 });
    watch.pushData(1, '__HYSCODE_BEGIN_watch__\nContinue? [Y/n]\n');
    watch.pushData(2, 'still streaming');
    expect(watch.evaluate(Date.now()).kind).toBe('running');
  });

  it('honors the background-ready floor and ready pattern', () => {
    const startedAt = Date.now();
    const watch = new CommandWatch({
      nonce: 'bg',
      background: true,
      readyPattern: /listening/,
      startedAt,
    });
    watch.pushData(1, '__HYSCODE_BEGIN_bg__\nserver listening on :8080\n');
    expect(watch.evaluate(startedAt + 100).kind).toBe('running');
    expect(watch.evaluate(startedAt + 1_000)).toMatchObject({ kind: 'background_ready' });
  });

  it('keeps waiting when the ready pattern does not match', () => {
    const startedAt = Date.now();
    const watch = new CommandWatch({
      nonce: 'bg',
      background: true,
      readyPattern: /ready/,
      startedAt,
    });
    watch.pushData(1, '__HYSCODE_BEGIN_bg__\nstill booting...\n');
    expect(watch.evaluate(startedAt + 1_000).kind).toBe('running');
  });

  it('treats background without a pattern as ready after the floor', () => {
    const startedAt = Date.now();
    const watch = new CommandWatch({ nonce: 'bg', background: true, readyPattern: null, startedAt });
    watch.pushData(1, '__HYSCODE_BEGIN_bg__\nsome output\n');
    expect(watch.evaluate(startedAt + 1_000)).toMatchObject({ kind: 'background_ready' });
  });

  it('lets a prompt win over background readiness', () => {
    const startedAt = Date.now();
    const watch = new CommandWatch({
      nonce: 'bg',
      background: true,
      readyPattern: null,
      startedAt,
    });
    watch.pushData(1, '__HYSCODE_BEGIN_bg__\nInstall? [Y/n]\n');
    expect(watch.evaluate(startedAt + 1_000)).toMatchObject({ kind: 'awaiting_input' });
  });

  it('restricts prompt detection to the delta when a baseline is given', () => {
    const watch = makeWatch();
    const baseline = '__HYSCODE_BEGIN_watch__\nContinue? [Y/n]\n';
    watch.syncSnapshot(baseline, 5);
    const deltaChars = baseline.length;

    expect(watch.evaluate(Date.now() + 10_000, deltaChars).kind).toBe('running');

    watch.pushData(6, 'user typed\nPassword:\n');
    expect(watch.evaluate(Date.now() + 10_000, deltaChars)).toMatchObject({
      kind: 'awaiting_input',
    });
  });
});
