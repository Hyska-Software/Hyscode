import { StringDecoder } from 'node:string_decoder';
import type { Key } from './types';

const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';
const ESCAPE_SEQUENCES = ['\u001b[A', '\u001b[B', '\u001b[C', '\u001b[D', '\u001b[H', '\u001b[F', '\u001bOA', '\u001bOB', '\u001bOC', '\u001bOD', '\u001bOH', '\u001bOF', '\u001b[Z', '\u001b[1~', '\u001b[3~', '\u001b[4~', '\u001b[5~', '\u001b[6~', '\u001bOP', '\u001b[11~', '\u001b[27;2;13~', '\u001b[13;2u'];

export function parseKeys(input: string): Key[] {
  return decodeKeys(input, false).keys;
}

function decodeKeys(input: string, preserveIncomplete: boolean): { keys: Key[]; remainder: string } {
  const keys: Key[] = [];
  let remaining = input;
  while (remaining) {
    if (remaining.startsWith(PASTE_START)) {
      const end = remaining.indexOf(PASTE_END, PASTE_START.length);
      if (end < 0) return { keys, remainder: preserveIncomplete ? remaining : '' };
      const content = remaining.slice(PASTE_START.length, end);
      if (content) keys.push({ type: 'character', value: content.replace(/\r\n/g, '\n').replace(/\r/g, '\n') });
      remaining = remaining.slice(end + PASTE_END.length);
      continue;
    }
    if (preserveIncomplete && remaining === '\u001b') return { keys, remainder: remaining };
    const mouseSequence = parseMouseSequence(remaining);
    if (mouseSequence) {
      if (mouseSequence.key) keys.push(mouseSequence.key);
      remaining = remaining.slice(mouseSequence.length);
      continue;
    }
    if (preserveIncomplete && isPotentialMouseSequence(remaining)) return { keys, remainder: remaining };
    const sequence = parseEscapeSequence(remaining);
    if (!sequence && preserveIncomplete && ESCAPE_SEQUENCES.some((candidate) => candidate.startsWith(remaining))) return { keys, remainder: remaining };
    if (!sequence && preserveIncomplete && remaining.startsWith('\u001b')) {
      keys.push({ type: 'escape' });
      remaining = remaining.slice(1);
      continue;
    }
    if (sequence) {
      keys.push(sequence.key);
      remaining = remaining.slice(sequence.length);
      continue;
    }
    const code = remaining.codePointAt(0);
    if (code === undefined) break;
    const character = String.fromCodePoint(code);
    remaining = remaining.slice(character.length);
    if (code === 3) keys.push({ type: 'ctrl', value: 'c' });
    else if (code === 11) keys.push({ type: 'ctrl', value: 'k' });
    else if (code === 20) keys.push({ type: 'ctrl', value: 't' });
    else if (code === 21) keys.push({ type: 'ctrl', value: 'u' });
    else if (code === 23) keys.push({ type: 'ctrl', value: 'w' });
    else if (code === 1) keys.push({ type: 'home' });
    else if (code === 5) keys.push({ type: 'end' });
    else if (code === 2) keys.push({ type: 'left' });
    else if (code === 6) keys.push({ type: 'right' });
    else if (code === 13 || code === 10) keys.push({ type: 'enter' });
    else if (code === 9) keys.push({ type: 'tab' });
    else if (code === 127 || code === 8) keys.push({ type: 'backspace' });
    else if (code >= 32) keys.push({ type: 'character', value: character });
  }
  return { keys, remainder: remaining };
}

function parseEscapeSequence(input: string): { key: Key; length: number } | null {
  if (input === '\u001b') return { key: { type: 'escape' }, length: 1 };
  const sequences: Array<[string, Key]> = [
    ['\u001b[A', { type: 'up' }],
    ['\u001b[B', { type: 'down' }],
    ['\u001b[C', { type: 'right' }],
    ['\u001b[D', { type: 'left' }],
    ['\u001b[H', { type: 'home' }],
    ['\u001b[F', { type: 'end' }],
    ['\u001bOA', { type: 'up' }],
    ['\u001bOB', { type: 'down' }],
    ['\u001bOC', { type: 'right' }],
    ['\u001bOD', { type: 'left' }],
    ['\u001bOH', { type: 'home' }],
    ['\u001bOF', { type: 'end' }],
    ['\u001b[Z', { type: 'shift_tab' }],
    ['\u001b[1~', { type: 'home' }],
    ['\u001b[3~', { type: 'delete' }],
    ['\u001b[4~', { type: 'end' }],
    ['\u001b[5~', { type: 'page_up' }],
    ['\u001b[6~', { type: 'page_down' }],
    ['\u001bOP', { type: 'f1' }],
    ['\u001b[11~', { type: 'f1' }],
    ['\u001b[27;2;13~', { type: 'shift_enter' }],
    ['\u001b[13;2u', { type: 'shift_enter' }],
  ];
  const match = sequences.find(([sequence]) => input.startsWith(sequence));
  return match ? { key: match[1], length: match[0].length } : null;
}

type ParsedMouseSequence = { key: Key | null; length: number };

function parseMouseSequence(input: string): ParsedMouseSequence | null {
  const sgrMatch = /^\u001b\[<(\d+);(\d+);(\d+)([mM])/.exec(input);
  if (sgrMatch) {
    const button = Number(sgrMatch[1]);
    return {
      key: mouseWheelKey(button, Number(sgrMatch[2]), Number(sgrMatch[3])),
      length: sgrMatch[0].length,
    };
  }

  if (!input.startsWith('\u001b[M') || input.length < 6) return null;
  const button = input.charCodeAt(3) - 32;
  return {
    key: mouseWheelKey(button, input.charCodeAt(4) - 32, input.charCodeAt(5) - 32),
    length: 6,
  };
}

function isPotentialMouseSequence(input: string): boolean {
  if (input.startsWith('\u001b[M')) return input.length < 6;
  return /^\u001b\[<\d*(?:;\d*){0,2}$/.test(input);
}

function mouseWheelKey(button: number, x: number, y: number): Key | null {
  if ((button & 64) === 0) return null;
  return { type: 'mouse', action: (button & 1) === 0 ? 'scroll_up' : 'scroll_down', x, y };
}

export type TerminalInputOptions = {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  onKey: (key: Key) => void;
  onResize: (width: number, height: number) => void;
};

export class TerminalInput {
  private readonly decoder = new StringDecoder('utf8');
  private pendingInput = '';
  private escapeTimer: NodeJS.Timeout | null = null;
  private readonly dataHandler = (chunk: Buffer | string): void => {
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
    this.pendingInput += this.decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const decoded = decodeKeys(this.pendingInput, true);
    this.pendingInput = decoded.remainder;
    for (const key of decoded.keys) this.options.onKey(key);
    if (this.pendingInput === '\u001b') {
      if (this.escapeTimer) clearTimeout(this.escapeTimer);
      this.escapeTimer = setTimeout(() => {
        this.escapeTimer = null;
        this.pendingInput = '';
        this.options.onKey({ type: 'escape' });
      }, 30);
    }
  };

  private readonly resizeHandler = (): void => {
    this.options.onResize(this.options.stdout.columns ?? 120, this.options.stdout.rows ?? 32);
  };

  private active = false;

  constructor(private readonly options: TerminalInputOptions) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.options.stdin.setRawMode?.(true);
    this.options.stdin.resume();
    this.options.stdin.on('data', this.dataHandler);
    this.options.stdout.on('resize', this.resizeHandler);
    this.resizeHandler();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.options.stdin.off('data', this.dataHandler);
    this.options.stdout.off('resize', this.resizeHandler);
    this.options.stdin.setRawMode?.(false);
    this.options.stdin.pause();
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
    this.pendingInput = '';
    this.decoder.end();
  }
}

export function enterAlternateScreen(stdout: NodeJS.WriteStream): void {
  stdout.write('\u001b[?1049h\u001b[?25l\u001b[?2004h\u001b[?1000h\u001b[?1006h');
}

export function leaveAlternateScreen(stdout: NodeJS.WriteStream): void {
  stdout.write('\u001b[?1006l\u001b[?1000l\u001b[?2004l\u001b[?25h\u001b[?1049l');
}
