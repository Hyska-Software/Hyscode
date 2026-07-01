import type { TurnStatus } from './types';

export type TurnPhase =
  | 'idle'
  | 'streaming'
  | 'awaiting_interaction'
  | 'executing_tools'
  | 'completing'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** Owns the lifecycle and cancellation signal for exactly one active turn. */
export class TurnController {
  private phase: TurnPhase = 'idle';
  private turnId = '';
  private controller: AbortController | null = null;
  private terminalStatus: TurnStatus | null = null;

  begin(): { turnId: string; signal: AbortSignal } {
    if (this.controller && !this.terminalStatus) {
      throw new Error('An agent turn is already active.');
    }
    this.turnId = crypto.randomUUID();
    this.controller = new AbortController();
    this.terminalStatus = null;
    this.phase = 'streaming';
    return { turnId: this.turnId, signal: this.controller.signal };
  }

  transition(phase: TurnPhase): void {
    if (this.terminalStatus) return;
    this.phase = phase;
  }

  cancel(): void {
    if (!this.controller || this.terminalStatus) return;
    this.phase = 'cancelled';
    this.controller.abort(new DOMException('Agent turn cancelled', 'AbortError'));
  }

  finish(status: TurnStatus): boolean {
    if (this.terminalStatus) return false;
    this.terminalStatus = status;
    this.phase =
      status === 'cancelled' || status === 'cancelled_partial'
        ? 'cancelled'
        : status === 'error'
          ? 'failed'
          : 'completed';
    return true;
  }

  get id(): string {
    return this.turnId;
  }

  get signal(): AbortSignal {
    if (!this.controller) throw new Error('No active agent turn.');
    return this.controller.signal;
  }

  get currentPhase(): TurnPhase {
    return this.phase;
  }
}
