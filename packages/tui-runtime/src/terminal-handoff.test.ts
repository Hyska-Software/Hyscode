import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_VIEWPORT,
  normalizeTerminalViewport,
  sameTerminalViewport,
} from './terminal-handoff';

describe('terminal viewport contract', () => {
  it('normalizes invalid and fractional dimensions without producing zero-sized PTYs', () => {
    expect(normalizeTerminalViewport(Number.NaN, undefined)).toEqual(DEFAULT_TERMINAL_VIEWPORT);
    expect(normalizeTerminalViewport(17.8, 8.9)).toEqual({ cols: 17, rows: 8 });
    expect(normalizeTerminalViewport(-10, 10)).toEqual({ cols: 1, rows: 10 });
  });

  it('clamps pathological dimensions and compares effective viewports', () => {
    const viewport = normalizeTerminalViewport(10_000, 10_000);
    expect(viewport.cols).toBeLessThanOrEqual(4096);
    expect(viewport.rows).toBeLessThanOrEqual(4096);
    expect(sameTerminalViewport(viewport, { ...viewport })).toBe(true);
    expect(sameTerminalViewport(viewport, { cols: viewport.cols - 1, rows: viewport.rows })).toBe(false);
  });
});
