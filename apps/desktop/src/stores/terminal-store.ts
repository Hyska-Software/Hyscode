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
}

const MAX_HISTORY = 50;

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  nextIndex: number;
  createSession: (name?: string, isAgentSession?: boolean, cwd?: string, location?: 'panel' | 'editor') => string;
  closeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  setPtyId: (sessionId: string, ptyId: string | null) => void;
  /** Mark a session's PTY as dead (exited / killed) so it won't be reused */
  markPtyDead: (sessionId: string) => void;
  /** Record a finished command on a session */
  setLastCommand: (sessionId: string, command: string, output: string, exitCode: number | null) => void;
  /** Append a command to the rolling history */
  appendCommandHistory: (sessionId: string, entry: CommandHistoryEntry) => void;
  /** Find or create a dedicated agent terminal session.
   *  If `name` is provided, looks for an existing agent session with that exact name.
   *  If `reuseHealthy` is true (default), reuses an existing agent session that still has a PTY.
   *  Otherwise creates a fresh one. */
  ensureAgentSession: (opts?: { name?: string; reuseHealthy?: boolean }) => string;
  /** Get all agent sessions */
  getAgentSessions: () => TerminalSession[];
  /** Get the first agent session (legacy compat) */
  getAgentSession: () => TerminalSession | undefined;
  /** Find an agent session that has a live PTY */
  findHealthyAgentSession: () => TerminalSession | undefined;
  /** Kill the PTY and remove the session from store */
  removeAgentSession: (id: string) => void;
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

    createSession: (name?: string, isAgentSession = false, cwd?: string, location: 'panel' | 'editor' = 'panel') => {
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
          session.ptyId = null;
          session.isDead = true;
        }
      }),

    setLastCommand: (sessionId: string, command: string, output: string, exitCode: number | null) =>
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.lastCommand = { command, output, exitCode, timestamp: Date.now(), source: 'user' };
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

    ensureAgentSession: (opts?: { name?: string; reuseHealthy?: boolean }) => {
      const { name, reuseHealthy = true } = opts ?? {};

      // 1) If a specific name is requested, try to find an existing one
      if (name) {
        const named = get().sessions.find((s) => s.isAgentSession && s.name === name);
        if (named) return named.id;
      }

      // 2) If reuse is allowed, pick any healthy agent session
      if (reuseHealthy) {
        const healthy = get().sessions.find((s) => s.isAgentSession && !s.isDead && s.ptyId);
        if (healthy) return healthy.id;
      }

      // 3) Create a fresh agent session
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
          cwd: null,
          lastCommand: null,
          commandHistory: [],
          isDead: false,
        });
        state.nextIndex = idx + 1;
      });
      return id;
    },

    getAgentSessions: () => {
      return get().sessions.filter((s) => s.isAgentSession);
    },

    getAgentSession: () => {
      return get().sessions.find((s) => s.isAgentSession);
    },

    findHealthyAgentSession: () => {
      return get().sessions.find((s) => s.isAgentSession && !s.isDead && s.ptyId);
    },

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
  })),
);
