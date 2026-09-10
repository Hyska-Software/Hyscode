/**
 * Keybinding Store
 *
 * Parses keybinding strings (e.g. "ctrl+shift+p") from extensions and
 * built-in commands, listens for keyboard events, and dispatches to the
 * command store.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParsedKeybinding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string; // normalised lowercase, e.g. "p", "f5", "enter"
}

export interface RegisteredKeybinding {
  command: string;
  /** Raw string from the manifest, e.g. "ctrl+shift+p" */
  raw: string;
  parsed: ParsedKeybinding;
  /** Display label e.g. "Ctrl+Shift+P" */
  label: string;
  when?: string;
  extensionName?: string;
}

interface KeybindingState {
  bindings: RegisteredKeybinding[];

  /**
   * Register a keybinding. Returns dispose function.
   */
  register: (binding: {
    command: string;
    key: string;
    when?: string;
    extensionName?: string;
  }) => () => void;

  /**
   * Remove all keybindings from a specific extension.
   */
  removeExtensionBindings: (extensionName: string) => void;

  /**
   * Find keybinding(s) for a command id.
   */
  findByCommand: (commandId: string) => RegisteredKeybinding | undefined;

  /**
   * Get display label for a command's keybinding.
   */
  getLabelForCommand: (commandId: string) => string | undefined;

  /**
   * Match a keyboard event against registered bindings. Returns command id or null.
   */
  match: (e: KeyboardEvent) => string | null;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

// navigator is not defined in Node < 21 (CI test runners) - guard module scope.
const isMac =
  typeof navigator !== 'undefined' ? (navigator.platform?.startsWith('Mac') ?? false) : false;

/**
 * Parse a keybinding string like "ctrl+shift+p" into structured form.
 */
export function parseKeybinding(raw: string): ParsedKeybinding {
  const parts = raw.toLowerCase().split('+').map((p) => p.trim());
  const result: ParsedKeybinding = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: '',
  };

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        result.ctrl = true;
        break;
      case 'shift':
        result.shift = true;
        break;
      case 'alt':
      case 'opt':
      case 'option':
        result.alt = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
      case 'win':
      case 'super':
        result.meta = true;
        break;
      default:
        result.key = part;
    }
  }

  return result;
}

/**
 * Build a human-readable label, e.g. "Ctrl+Shift+P" or "⌘+Shift+P".
 */
export function buildLabel(parsed: ParsedKeybinding): string {
  const parts: string[] = [];

  if (parsed.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (parsed.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (parsed.shift) parts.push('Shift');
  if (parsed.meta) parts.push(isMac ? '⌘' : 'Win');

  // Capitalise key nicely
  const keyDisplay = parsed.key.length === 1
    ? parsed.key.toUpperCase()
    : parsed.key.charAt(0).toUpperCase() + parsed.key.slice(1);
  parts.push(keyDisplay);

  return parts.join('+');
}

/**
 * Build a human-readable label for a chord sequence, e.g. "Ctrl+K R".
 * Chords are handled by the global dispatcher, not by `match()`.
 */
export function buildChordLabel(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((chord) => buildLabel(parseKeybinding(chord)))
    .join(' ');
}

/**
 * Normalise a KeyboardEvent.key to match our keybinding keys.
 */
function normaliseEventKey(e: KeyboardEvent): string {
  // Map common KeyboardEvent.key values
  const key = e.key.toLowerCase();
  // Already lowercase letters/numbers
  if (key.length === 1) return key;
  // Function keys, etc.
  switch (key) {
    case 'escape': return 'escape';
    case 'enter': return 'enter';
    case 'tab': return 'tab';
    case 'backspace': return 'backspace';
    case 'delete': return 'delete';
    case 'arrowup': return 'up';
    case 'arrowdown': return 'down';
    case 'arrowleft': return 'left';
    case 'arrowright': return 'right';
    case ' ': return 'space';
    default: return key; // f1, f2, etc. are already fine
  }
}

/**
 * Minimal evaluator for keybinding `when` clauses. Only `editorTextFocus`
 * (and its negation) is supported; unknown clauses stay active so extension
 * bindings without focus context keep working.
 */
function evaluateWhen(
  when: string | undefined,
  context: { editorTextFocus: boolean },
): boolean {
  if (!when || !when.trim()) return true;
  for (const raw of when.split('&&')) {
    let clause = raw.trim();
    let negated = false;
    if (clause.startsWith('!')) {
      negated = true;
      clause = clause.slice(1).trim();
    }
    if (clause.toLowerCase() !== 'editortextfocus') continue;
    if (negated ? context.editorTextFocus : !context.editorTextFocus) return false;
  }
  return true;
}

function isEditorFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  return !!active && typeof active.closest === 'function' && !!active.closest('.monaco-editor');
}

/**
 * Check if a KeyboardEvent matches a parsed keybinding.
 */
function matchesEvent(parsed: ParsedKeybinding, e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || (isMac && e.metaKey);
  const meta = isMac ? false : e.metaKey;

  if (parsed.ctrl !== ctrl) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;
  if (parsed.meta !== meta) return false;

  return normaliseEventKey(e) === parsed.key;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useKeybindingStore = create<KeybindingState>()(
  immer((set, get) => ({
    bindings: [],

    register: (binding) => {
      const parsed = parseKeybinding(binding.key);
      const label = /\s/.test(binding.key.trim())
        ? buildChordLabel(binding.key)
        : buildLabel(parsed);
      const entry: RegisteredKeybinding = {
        command: binding.command,
        raw: binding.key,
        parsed,
        label,
        when: binding.when,
        extensionName: binding.extensionName,
      };

      set((s) => {
        s.bindings.push(entry);
      });

      return () => {
        set((s) => {
          const idx = s.bindings.findIndex(
            (b) => b.command === binding.command && b.raw === binding.key && b.extensionName === binding.extensionName,
          );
          if (idx !== -1) s.bindings.splice(idx, 1);
        });
      };
    },

    removeExtensionBindings: (extensionName) => {
      set((s) => {
        s.bindings = s.bindings.filter((b) => b.extensionName !== extensionName);
      });
    },

    findByCommand: (commandId) => {
      return get().bindings.find((b) => b.command === commandId);
    },

    getLabelForCommand: (commandId) => {
      return get().bindings.find((b) => b.command === commandId)?.label;
    },

    match: (e) => {
      // Later matches take priority (extension overrides)
      const bindings = get().bindings;
      const context = { editorTextFocus: isEditorFocused() };
      for (let i = bindings.length - 1; i >= 0; i--) {
        const binding = bindings[i];
        if (!evaluateWhen(binding.when, context)) continue;
        if (matchesEvent(binding.parsed, e)) {
          return binding.command;
        }
      }
      return null;
    },
  })),
);
