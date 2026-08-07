import {
  appendBounded,
  looksLikeTerminalPrompt,
  MAX_CAPTURE_CHARS,
  parseTerminalFrame,
  type ParsedTerminalFrame,
} from './terminal-protocol';

/** Minimum silence after the last output chunk before a prompt-looking line suspends the command. */
export const PROMPT_IDLE_MS = 400;
/** Background commands need at least this much elapsed time before they can become ready. */
export const MIN_BACKGROUND_READY_MS = 500;

export type CommandWatchConfig = {
  /** Frame nonce used to locate the capture markers in the raw output. */
  nonce: string;
  background: boolean;
  readyPattern: RegExp | null;
  /** When the command was written; anchors the background-ready floor. */
  startedAt: number;
  idleMs?: number;
};

export type CommandWatchOutcome =
  | { kind: 'running' }
  | { kind: 'awaiting_input'; output: string; sequence: number }
  | { kind: 'complete'; output: string; exitCode: number; sequence: number }
  | { kind: 'background_ready'; output: string; sequence: number };

/**
 * Consumes raw terminal output for one framed command and decides what the
 * runner should do next: keep waiting, suspend at an interactive prompt, or
 * finish. Live chunks (`pushData`) and authoritative snapshots
 * (`syncSnapshot`) feed the same accumulator, so event gaps cannot corrupt
 * frame parsing.
 */
export class CommandWatch {
  private rawOutput = '';
  private maxSequence = 0;
  private lastDataAt: number;
  private exited = false;
  private exitValue: number | null = null;
  private outputTruncated = false;

  constructor(private readonly config: CommandWatchConfig) {
    this.lastDataAt = config.startedAt;
  }

  pushData(sequence: number, chunk: string): void {
    this.rawOutput = appendBounded(this.rawOutput, chunk);
    this.maxSequence = Math.max(this.maxSequence, sequence);
    this.lastDataAt = Date.now();
  }

  /** Reconcile with an authoritative snapshot without allowing older data to overwrite live output. */
  syncSnapshot(data: string, sequence: number, truncated = false): void {
    if (sequence < this.maxSequence) return;
    this.outputTruncated = this.outputTruncated || truncated;
    const nextOutput = data.length <= MAX_CAPTURE_CHARS ? data : data.slice(-MAX_CAPTURE_CHARS);
    const current = this.parsed();
    const next = parseTerminalFrame(nextOutput, this.config.nonce);
    if ((current.started && !next.started) || (current.complete && !next.complete)) return;
    if (nextOutput !== this.rawOutput) this.lastDataAt = Date.now();
    this.rawOutput = nextOutput;
    this.maxSequence = Math.max(this.maxSequence, sequence);
  }

  pushExit(code: number | null): void {
    this.exited = true;
    this.exitValue = code;
  }

  get hasExited(): boolean {
    return this.exited;
  }

  get exitCode(): number | null {
    return this.exitValue;
  }

  get sequence(): number {
    return this.maxSequence;
  }

  get truncated(): boolean {
    return this.outputTruncated;
  }

  output(): string {
    return this.rawOutput;
  }

  parsed(): ParsedTerminalFrame {
    return parseTerminalFrame(this.rawOutput, this.config.nonce);
  }

  /**
   * Decide the next step. `deltaFromChars` restricts prompt detection to
   * output produced after a baseline (the re-prompt case in `respond`).
   */
  evaluate(now: number, deltaFromChars?: number): CommandWatchOutcome {
    const parsed = this.parsed();
    if (parsed.complete) {
      return {
        kind: 'complete',
        output: parsed.output,
        exitCode: parsed.exitCode ?? 0,
        sequence: this.maxSequence,
      };
    }
    const promptSource =
      deltaFromChars === undefined ? parsed.output : this.rawOutput.slice(deltaFromChars);
    if (
      parsed.started &&
      looksLikeTerminalPrompt(promptSource) &&
      now - this.lastDataAt >= (this.config.idleMs ?? PROMPT_IDLE_MS)
    ) {
      return { kind: 'awaiting_input', output: parsed.output, sequence: this.maxSequence };
    }
    if (
      this.config.background &&
      parsed.started &&
      now - this.config.startedAt >= MIN_BACKGROUND_READY_MS
    ) {
      const ready = this.config.readyPattern
        ? this.config.readyPattern.test(parsed.output)
        : true;
      if (ready) {
        return { kind: 'background_ready', output: parsed.output, sequence: this.maxSequence };
      }
    }
    return { kind: 'running' };
  }
}
