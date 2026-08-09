export type TerminalViewport = {
  cols: number;
  rows: number;
};

export const DEFAULT_TERMINAL_VIEWPORT: TerminalViewport = { cols: 120, rows: 32 };
export const MAX_TERMINAL_COLS = 4096;
export const MAX_TERMINAL_ROWS = 4096;

export type TerminalDataHandler = (data: string, sequence: number) => void;
export type TerminalExitHandler = (exitCode: number | null) => void;

export type TerminalHandoff = {
  terminalId: string;
  subscribe(onData: TerminalDataHandler, onExit: TerminalExitHandler): Promise<() => void>;
  write(data: string): Promise<void>;
  resize(viewport: TerminalViewport): Promise<void>;
  detach(): Promise<void>;
};

export function normalizeTerminalViewport(
  cols: unknown,
  rows: unknown,
  fallback: TerminalViewport = DEFAULT_TERMINAL_VIEWPORT,
): TerminalViewport {
  return {
    cols: normalizeDimension(cols, fallback.cols, MAX_TERMINAL_COLS),
    rows: normalizeDimension(rows, fallback.rows, MAX_TERMINAL_ROWS),
  };
}

export function sameTerminalViewport(left: TerminalViewport, right: TerminalViewport): boolean {
  return left.cols === right.cols && left.rows === right.rows;
}

function normalizeDimension(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}
