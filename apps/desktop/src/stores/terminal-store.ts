import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommandHistoryEntry {
  command: string;
  output: string;
  exitCode: number | null;
  timestamp: number;
  /** Who executed this command */
  source: 'user' | 'agent';
}

export interface TerminalSession {
  id: string;
  name: string;
  ptyId: string | null;
  /** Whether this session is owned by the AI agent */
  isAgentSession: boolean;
  /** Where this session is rendered: 'panel' (bottom/sidebar) or 'editor' (as editor tab) */
  location: 'panel' | 'editor';
  /** Initial working directory for this session */
  cwd: string | null;
  /** Last executed command (for environment context injection) */
  lastCommand: CommandHistoryEntry | null;
  /** Rolling command history (capped at MAX_HISTORY) */
  commandHistory: CommandHistoryEntry[];
  /** When true the PTY exited and should not be reused */
  isDead: boolean;
  /** Conversation that owns an agent terminal. User terminals remain unowned. */
  ownerConversationId: string | null;
  /** Tool currently controlling the PTY; manual input is disabled while set. */
  activeToolCallId: string | null;
  /** Process is paused at an interactive prompt. */
  awaitingInput: boolean;
  /** Latest backend output sequence applied to the xterm view. */
  outputSequence: number;
}

const MAX_HISTORY = 50;

export function canUserWriteToTerminal(
  session: Pick<TerminalSession, 'isAgentSession' | 'activeToolCallId' | 'awaitingInput'>,
  approvalMode: string,
): boolean {
  if (!session.isAgentSession) return true;
  return !session.activeToolCallId && session.awaitingInput && approvalMode !== 'yolo';
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  nextIndex: number;
  createSession: (
    name?: string,
    isAgentSession?: boolean,
    cwd?: string,
    location?: 'panel' | 'editor',
  ) => string;
  closeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  setPtyId: (sessionId: string, ptyId: string | null) => void;
  /** Mark a session's PTY as dead (exited / killed) so it won't be reused */
  markPtyDead: (sessionId: string) => void;
  /** Record a finished command on a session */
  setLastCommand: (
    sessionId: string,
    command: string,
    output: string,
    exitCode: number | null,
    source?: 'user' | 'agent',
  ) => void;
  /** Append a command to the rolling history */
  appendCommandHistory: (sessionId: string, entry: CommandHistoryEntry) => void;
  /** Create a fresh agent terminal session owned by a conversation (or sub-agent). */
  createAgentSession: (opts?: { name?: string; conversationId?: string; cwd?: string }) => string;
  setAgentActivity: (sessionId: string, toolCallId: string | null) => void;
  setAwaitingInput: (sessionId: string, awaiting: boolean) => void;
  setOutputSequence: (sessionId: string, sequence: number) => void;
  /** Kill the PTY and remove the session from store */
  removeAgentSession: (id: string) => void;
  /** Remove every project-owned terminal session and return their PTY ids. */
  clearSessions: () => string[];
}

let _counter = 0;
function genId() {
  return `term-${Date.now()}-${++_counter}`;
}

export const useTerminalStore = create<TerminalState>()(
  immer((set, get) => ({
    sessions: [],
    activeSessionId: null,
    nextIndex: 1,

    createSession: (
      name?: string,
      isAgentSession = false,
      cwd?: string,
      location: 'panel' | 'editor' = 'panel',
    ) => {
      const id = genId();
      const idx = get().nextIndex;
      const sessionName = name ?? `Terminal ${idx}`;
      set((state) => {
        state.sessions.push({
          id,
          name: sessionName,
          ptyId: null,
          isAgentSession,
          location,
          cwd: cwd ?? null,
          lastCommand: null,
          commandHistory: [],
          isDead: false,
          ownerConversationId: null,
          activeToolCallId: null,
          awaitingInput: false,
          outputSequence: 0,
        });
        state.activeSessionId = id;
        state.nextIndex = idx + 1;
      });
      return id;
    },

    closeSession: (id: string) =>
      set((state) => {
        const idx = state.sessions.findIndex((s) => s.id === id);
        if (idx === -1) return;
        state.sessions.splice(idx, 1);
        if (state.activeSessionId === id) {
          // Activate adjacent tab or null
          if (state.sessions.length > 0) {
            const newIdx = Math.min(idx, state.sessions.length - 1);
            state.activeSessionId = state.sessions[newIdx].id;
          } else {
            state.activeSessionId = null;
          }
        }
      }),

    setActiveSession: (id: string) =>
      set((state) => {
        state.activeSessionId = id;
      }),

    renameSession: (id: string, name: string) =>
      set((state) => {
        const session = state.sessions.find((s) => s.id === id);
        if (session) session.name = name;
      }),

    setPtyId: (sessionId: string, ptyId: string | null) =>
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.ptyId = ptyId;
          if (ptyId) session.isDead = false;
        }
      }),

    markPtyDead: (sessionId: string) =>
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.isDead = true;
          session.activeToolCallId = null;
          session.awaitingInput = false;
        }
      }),

    setLastCommand: (sessionId, command, output, exitCode, source = 'user') =>
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.lastCommand = { command, output, exitCode, timestamp: Date.now(), source };
        }
      }),

    appendCommandHistory: (sessionId: string, entry: CommandHistoryEntry) =>
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.commandHistory.push(entry);
          // Cap at MAX_HISTORY
          if (session.commandHistory.length > MAX_HISTORY) {
            session.commandHistory = session.commandHistory.slice(-MAX_HISTORY);
          }
        }
      }),

    createAgentSession: (opts) => {
      const { name, conversationId, cwd } = opts ?? {};
      const id = genId();
      const idx = get().nextIndex;
      const sessionName = name ?? `Agent Terminal ${idx}`;
      set((state) => {
        state.sessions.push({
          id,
          name: sessionName,
          ptyId: null,
          isAgentSession: true,
          location: 'panel',
          cwd: cwd ?? null,
          lastCommand: null,
          commandHistory: [],
          isDead: false,
          ownerConversationId: conversationId ?? null,
          activeToolCallId: null,
          awaitingInput: false,
          outputSequence: 0,
        });
        state.nextIndex = idx + 1;
      });
      return id;
    },

    setAgentActivity: (sessionId, toolCallId) =>
      set((state) => {
        const session = state.sessions.find((item) => item.id === sessionId);
        if (session) session.activeToolCallId = toolCallId;
      }),

    setAwaitingInput: (sessionId, awaiting) =>
      set((state) => {
        const session = state.sessions.find((item) => item.id === sessionId);
        if (session) session.awaitingInput = awaiting;
      }),

    setOutputSequence: (sessionId, sequence) =>
      set((state) => {
        const session = state.sessions.find((item) => item.id === sessionId);
        if (session) session.outputSequence = Math.max(session.outputSequence, sequence);
      }),

    removeAgentSession: (id: string) => {
      set((state) => {
        const idx = state.sessions.findIndex((s) => s.id === id);
        if (idx !== -1) state.sessions.splice(idx, 1);
        if (state.activeSessionId === id) {
          if (state.sessions.length > 0) {
            const newIdx = Math.min(idx, state.sessions.length - 1);
            state.activeSessionId = state.sessions[newIdx]?.id ?? null;
          } else {
            state.activeSessionId = null;
          }
        }
      });
    },

    clearSessions: () => {
      const ptyIds = get()
        .sessions
        .map((session) => session.ptyId)
        .filter((ptyId): ptyId is string => Boolean(ptyId));
      set((state) => {
        state.sessions = [];
        state.activeSessionId = null;
        state.nextIndex = 1;
      });
      return ptyIds;
    },
  })),
);
