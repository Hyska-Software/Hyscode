import {
  appendBounded,
  frameMarker,
  looksLikeTerminalPrompt,
  MAX_CAPTURE_CHARS,
  parseTerminalFrame,
  type ParsedTerminalFrame,
} from './terminal-protocol';
import {
  asTerminalRuntimeFailure,
  validateTerminalExitCode,
  validateTerminalFailure,
  validateTerminalSequence,
  validateTerminalSnapshot,
  validateTerminalString,
} from './terminal-runtime-validation';
import type { TerminalRuntimeFailure, TerminalSnapshot } from './types';

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
  | { kind: 'background_ready'; output: string; sequence: number }
  | {
      kind: 'error';
      output: string;
      exitCode: number | null;
      sequence: number;
      failure: TerminalRuntimeFailure;
    };

/**
 * Consumes raw terminal output for one framed command and decides what the
 * runner should do next: keep waiting, suspend at an interactive prompt, or
 * finish. Live chunks (`pushData`) and full authoritative snapshots
 * (`syncFullSnapshot`) feed the same accumulator. Positive-sequence snapshots
 * are deltas for output readers and are intentionally not accepted here.
 */
export class CommandWatch {
  private rawOutput = '';
  private maxSequence = 0;
  private lastDataAt: number;
  private exited = false;
  private exitValue: number | null = null;
  private outputTruncated = false;
  private runtimeFailure: TerminalRuntimeFailure | null = null;
  private failureBeforeCompletion: TerminalRuntimeFailure | null = null;
  private completionObserved = false;
  private commandBaselineEstablished = false;
  private preserveBaselineOutput = false;
  private commandBaselineOutput = '';
  private commandCaptureLength = 0;
  constructor(private readonly config: CommandWatchConfig) {
    this.lastDataAt = config.startedAt;
  }

  markCommandBaseline(options: { preserveOutput?: boolean } = {}): void {
    if (this.exited) return;
    this.commandBaselineEstablished = true;
    this.preserveBaselineOutput = options.preserveOutput === true;
    this.commandBaselineOutput = this.rawOutput;
    if (this.preserveBaselineOutput) {
      const beginIndex = this.rawOutput.indexOf(frameMarker('BEGIN', this.config.nonce));
      if (beginIndex >= 0) {
        this.commandBaselineOutput = this.rawOutput.slice(beginIndex);
        this.rawOutput = this.commandBaselineOutput;
      }
    }
    this.commandCaptureLength = 0;
    if (!this.preserveBaselineOutput) this.rawOutput = '';
    this.outputTruncated = false;
    this.completionObserved = false;
    this.lastDataAt = Date.now();
  }

  pushData(sequence: unknown, chunk: unknown): boolean {
    try {
      const normalizedSequence = validateTerminalSequence(sequence, 'sequence', 'event');
      const normalizedChunk = validateTerminalString(chunk, 'data', 'event');
      if (normalizedSequence <= this.maxSequence) return false;
      const nextCaptureLength = this.commandCaptureLength + normalizedChunk.length;
      const exceedsCapture = this.commandBaselineEstablished
        && (nextCaptureLength > MAX_CAPTURE_CHARS
          || this.rawOutput.length + normalizedChunk.length > MAX_CAPTURE_CHARS);
      if (exceedsCapture) {
        this.outputTruncated = true;
        this.pushFailure({
          operation: 'protocol',
          message: `Terminal output exceeded the ${MAX_CAPTURE_CHARS}-character capture limit.`,
        });
      }
      this.rawOutput = appendBounded(this.rawOutput, normalizedChunk);
      if (this.commandBaselineEstablished) this.commandCaptureLength = nextCaptureLength;
      this.maxSequence = normalizedSequence;
      this.lastDataAt = Date.now();
      if (this.parsed().complete) this.completionObserved = true;
      return true;
    } catch (error) {
      this.pushFailure(asTerminalRuntimeFailure(error, 'event'));
      return false;
    }
  }

  private snapshotOutput(data: string): {
    output: string;
    capturedLength: number;
    reconciled: boolean;
  } {
    if (!this.commandBaselineEstablished) {
      return { output: data, capturedLength: 0, reconciled: true };
    }
    if (this.preserveBaselineOutput) {
      const baselineIndex = data.indexOf(this.commandBaselineOutput);
      if (baselineIndex < 0) {
        return {
          output: this.rawOutput,
          capturedLength: this.commandCaptureLength,
          reconciled: false,
        };
      }
      const output = data.slice(baselineIndex);
      return {
        output,
        capturedLength: output.length - this.commandBaselineOutput.length,
        reconciled: true,
      };
    }
    const beginIndex = data.indexOf(frameMarker('BEGIN', this.config.nonce));
    if (beginIndex < 0) {
      return {
        output: this.rawOutput,
        capturedLength: this.commandCaptureLength,
        reconciled: false,
      };
    }
    return {
      output: data.slice(beginIndex),
      capturedLength: data.length - beginIndex,
      reconciled: true,
    };
  }

  /** Replace the accumulator with a validated full authoritative snapshot. */
  syncFullSnapshot(snapshot: unknown): void {
    let normalized: TerminalSnapshot;
    try {
      normalized = validateTerminalSnapshot(snapshot);
    } catch (error) {
      this.pushFailure(asTerminalRuntimeFailure(error, 'snapshot'));
      return;
    }
    if (normalized.toSequence < this.maxSequence) {
      if (normalized.failure) this.pushFailure(normalized.failure);
      return;
    }
    const current = this.parsed();
    if (current.complete) this.completionObserved = true;
    const snapshotOutput = this.snapshotOutput(normalized.data);
    const captureTruncated = this.commandBaselineEstablished
      && snapshotOutput.capturedLength > MAX_CAPTURE_CHARS;
    const snapshotWasTruncated = normalized.truncated
      && (!this.commandBaselineEstablished || !snapshotOutput.reconciled);
    if (captureTruncated) {
      this.outputTruncated = true;
      this.pushFailure({
        operation: 'protocol',
        message: `Terminal snapshot exceeded the ${MAX_CAPTURE_CHARS}-character capture limit.`,
      });
    }
    const nextOutput = appendBounded('', snapshotOutput.output);
    const next = parseTerminalFrame(nextOutput, this.config.nonce);
    if (next.complete) this.completionObserved = true;
    if (normalized.failure) this.pushFailure(normalized.failure);
    if (next.protocolError) {
      this.pushFailure({ operation: 'protocol', message: next.protocolError });
    }
    if ((current.started && !next.started) || (current.complete && !next.complete)) {
      this.outputTruncated = this.outputTruncated || snapshotWasTruncated;
      if (this.commandBaselineEstablished) this.commandCaptureLength = snapshotOutput.capturedLength;
      this.maxSequence = Math.max(this.maxSequence, normalized.toSequence);
      if (!normalized.alive) this.pushExit(normalized.exitCode, normalized.failure);
      return;
    }
    if (nextOutput !== this.rawOutput) this.lastDataAt = Date.now();
    this.rawOutput = nextOutput;
    this.outputTruncated = this.outputTruncated || snapshotWasTruncated;
    if (this.commandBaselineEstablished) this.commandCaptureLength = snapshotOutput.capturedLength;
    this.maxSequence = Math.max(this.maxSequence, normalized.toSequence);
    if (!normalized.alive) this.pushExit(normalized.exitCode, normalized.failure);
  }


  pushExit(code: unknown, failure?: unknown): void {
    if (this.parsed().complete) this.completionObserved = true;
    let normalizedCode: number | null;
    try {
      normalizedCode = validateTerminalExitCode(code, 'code', 'event');
    } catch (error) {
      this.pushFailure(asTerminalRuntimeFailure(error, 'event'));
      normalizedCode = null;
    }
    try {
      const normalizedFailure = validateTerminalFailure(failure, 'event');
      if (normalizedFailure) this.pushFailure(normalizedFailure);
    } catch (error) {
      this.pushFailure(asTerminalRuntimeFailure(error, 'event'));
    }
    if (this.exitValue !== null && normalizedCode !== null && this.exitValue !== normalizedCode) {
      this.pushFailure({
        operation: 'event',
        message: `Conflicting terminal exit codes: ${this.exitValue} and ${normalizedCode}.`,
      });
    } else if (normalizedCode !== null || this.exitValue === null) {
      this.exitValue = normalizedCode;
    }
    this.exited = true;
  }

  pushFailure(failure: unknown): void {
    try {
      const normalized = validateTerminalFailure(failure, 'event');
      if (normalized) {
        this.runtimeFailure ??= normalized;
        if (!this.completionObserved) this.failureBeforeCompletion ??= normalized;
      }
    } catch (error) {
      const normalized = asTerminalRuntimeFailure(error, 'event');
      this.runtimeFailure ??= normalized;
      if (!this.completionObserved) this.failureBeforeCompletion ??= normalized;
    }
  }

  get commandFailure(): TerminalRuntimeFailure | null {
    return this.failureBeforeCompletion;
  }
  get hasExited(): boolean {
    return this.exited;
  }

  get exitCode(): number | null {
    return this.exitValue;
  }

  get failure(): TerminalRuntimeFailure | null {
    return this.runtimeFailure;
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
    if (parsed.complete) this.completionObserved = true;
    if (parsed.complete && !this.failureBeforeCompletion) {
      return {
        kind: 'complete',
        output: parsed.output,
        exitCode: parsed.exitCode ?? 0,
        sequence: this.maxSequence,
      };
    }
    const failure = this.failureBeforeCompletion
      ?? (parsed.protocolError ? { operation: 'protocol' as const, message: parsed.protocolError } : null);
    if (failure) {
      return {
        kind: 'error',
        output: parsed.output,
        exitCode: this.exitValue,
        sequence: this.maxSequence,
        failure,
      };
    }
    if (this.exited) {
      return {
        kind: 'error',
        output: parsed.output,
        exitCode: this.exitValue,
        sequence: this.maxSequence,
        failure: {
          operation: 'event',
          message: this.exitValue === null
            ? 'Terminal process exited before the completion marker.'
            : `Terminal process exited before the completion marker (exit code: ${this.exitValue}).`,
        },
      };
    }
    const promptSource =
      deltaFromChars === undefined ? parsed.output : this.rawOutput.slice(deltaFromChars);
    if (
      parsed.started
      && looksLikeTerminalPrompt(promptSource)
      && now - this.lastDataAt >= (this.config.idleMs ?? PROMPT_IDLE_MS)
    ) {
      return { kind: 'awaiting_input', output: parsed.output, sequence: this.maxSequence };
    }
    if (
      this.config.background
      && parsed.started
      && now - this.config.startedAt >= MIN_BACKGROUND_READY_MS
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
