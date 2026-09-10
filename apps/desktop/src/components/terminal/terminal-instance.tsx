import { useEffect, useRef, useCallback, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { asTerminalRuntimeFailure } from '@hyscode/agent-harness';
import { canUserWriteToTerminal, useTerminalStore } from '../../stores/terminal-store';
import { useProjectStore } from '../../stores/project-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useExtensionStore } from '../../stores/extension-store';
import { getXtermTheme } from '../../lib/monaco-themes';
import { desktopTerminalRuntime } from '../../lib/terminal-runtime';
import { resolveTerminalFontFamily } from './terminal-font';

interface TerminalInstanceProps {
  sessionId: string;
  isActive: boolean;
}

type TerminalViewport = { cols: number; rows: number };

const DEFAULT_TERMINAL_VIEWPORT: TerminalViewport = { cols: 80, rows: 24 };
const MAX_TERMINAL_DIMENSION = 4096;
const OUTPUT_SEQUENCE_STORE_INTERVAL = 16;

function detectWindowsConpty(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
}

function TerminalInstanceComponent({ sessionId, isActive }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const pendingViewportRef = useRef<TerminalViewport | null>(null);
  const lastResizeRef = useRef<{ ptyId: string; viewport: TerminalViewport } | null>(null);
  const pendingResizeRef = useRef<{ ptyId: string; viewport: TerminalViewport } | null>(null);
  const resizingRef = useRef(false);
  /** Tracks what the user is typing so we can log commands on Enter */
  const inputBufferRef = useRef<string>('');
  /** Last sequence pushed to the store; intermediate chunks are coalesced. */
  const lastStoredSequenceRef = useRef(0);

  const setPtyId = useTerminalStore((s) => s.setPtyId);
  const markPtyDead = useTerminalStore((s) => s.markPtyDead);
  const setLastCommand = useTerminalStore((s) => s.setLastCommand);
  const appendCommandHistory = useTerminalStore((s) => s.appendCommandHistory);
  const rootPath = useProjectStore((s) => s.rootPath);
  const session = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
  const sessionCwd = session?.cwd ?? rootPath;
  const themeId = useSettingsStore((s) => s.themeId);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const terminalFontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const terminalScrollback = useSettingsStore((s) => s.terminalScrollback);
  const terminalShell = useSettingsStore((s) => s.terminalShell);
  const terminalCursorStyle = useSettingsStore((s) => s.terminalCursorStyle);
  const extensionThemesVersion = useExtensionStore((s) => s.extensionThemesVersion);
  // Keep a ref so the one-time init effect always reads the latest themeId
  const themeIdRef = useRef(themeId);
  useEffect(() => {
    themeIdRef.current = themeId;
  }, [themeId]);

  const terminalSettingsRef = useRef({
    fontSize: terminalFontSize,
    fontFamily: terminalFontFamily,
    scrollback: terminalScrollback,
    shell: terminalShell,
    cursorStyle: terminalCursorStyle,
  });
  useEffect(() => {
    terminalSettingsRef.current = {
      fontSize: terminalFontSize,
      fontFamily: terminalFontFamily,
      scrollback: terminalScrollback,
      shell: terminalShell,
      cursorStyle: terminalCursorStyle,
    };
  }, [terminalCursorStyle, terminalFontFamily, terminalFontSize, terminalScrollback, terminalShell]);

  // Update xterm theme whenever the theme setting or extension themes change
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.theme = getXtermTheme(themeId);
  }, [themeId, extensionThemesVersion]);

  const measureViewport = useCallback((): TerminalViewport | null => {
    const container = containerRef.current;
    if (!fitAddonRef.current || !xtermRef.current) return null;
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) return null;
    try {
      fitAddonRef.current.fit();
      const cols = Math.min(MAX_TERMINAL_DIMENSION, Math.max(1, xtermRef.current.cols));
      const rows = Math.min(MAX_TERMINAL_DIMENSION, Math.max(1, xtermRef.current.rows));
      return { cols, rows };
    } catch {
      return null;
    }
  }, []);
  const quarantinePty = useCallback((): void => {
    void desktopTerminalRuntime.kill(sessionId).then((stop) => {
      if (stop.status !== 'stopped') {
        console.error('[Terminal] PTY quarantine was not confirmed', { sessionId, stop });
      }
    }).catch((error: unknown) => {
      const failure = asTerminalRuntimeFailure(error, 'kill');
      console.error('[Terminal] PTY quarantine failed', { sessionId, error: failure.message });
    });
  }, [sessionId]);
  const queueResize = useCallback((ptyId: string, viewport: TerminalViewport): void => {
    const previous = lastResizeRef.current;
    if (previous?.ptyId === ptyId && previous.viewport.cols === viewport.cols && previous.viewport.rows === viewport.rows) return;
    lastResizeRef.current = { ptyId, viewport };
    pendingResizeRef.current = { ptyId, viewport };
    if (resizingRef.current) return;
    resizingRef.current = true;
    void (async () => {
      while (pendingResizeRef.current) {
        const next = pendingResizeRef.current;
        pendingResizeRef.current = null;
        if (ptyIdRef.current !== next.ptyId) continue;
        try {
          await desktopTerminalRuntime.resize(sessionId, next.viewport.cols, next.viewport.rows);
        } catch (error: unknown) {
          const failure = asTerminalRuntimeFailure(error, 'event');
          useTerminalStore.getState().markPtyDead(sessionId, null, failure);
          quarantinePty();
          console.error('[Terminal] PTY resize failed', {
            ptyId: next.ptyId,
            cols: next.viewport.cols,
            rows: next.viewport.rows,
            error: failure.message,
          });
        }
      }
      resizingRef.current = false;
    })();
  }, [quarantinePty, sessionId]);

  const handleResize = useCallback(() => {
    const viewport = measureViewport();
    if (!viewport) return;
    pendingViewportRef.current = viewport;
    if (ptyIdRef.current) queueResize(ptyIdRef.current, viewport);
  }, [measureViewport, queueResize]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.fontSize = terminalFontSize;
    term.options.fontFamily = resolveTerminalFontFamily(terminalFontFamily);
    term.options.scrollback = terminalScrollback;
    term.options.cursorStyle = terminalCursorStyle;
    term.options.letterSpacing = 0;
    requestAnimationFrame(handleResize);
  }, [handleResize, terminalCursorStyle, terminalFontFamily, terminalFontSize, terminalScrollback]);

  // Initialize xterm + PTY. Uses a `cancelled` flag to handle React StrictMode's
  // double-invocation: if the cleanup fires before the async PTY spawn completes,
  // we kill the orphaned process and bail out.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const unlistenFns: Array<() => void> = [];

    const terminalSettings = terminalSettingsRef.current;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: terminalSettings.cursorStyle,
      fontSize: terminalSettings.fontSize,
      fontFamily: resolveTerminalFontFamily(terminalSettings.fontFamily),
      scrollback: terminalSettings.scrollback,
      letterSpacing: 0,
      lineHeight: 1,
      theme: getXtermTheme(themeIdRef.current),
      ...(detectWindowsConpty() ? { windowsPty: { backend: 'conpty' as const } } : {}),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.open(container);

    // Forward user keystrokes to the PTY and track commands
    const session = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
    const isAgentSession = session?.isAgentSession ?? false;
    const onDataDisposable = term.onData((data) => {
      if (ptyIdRef.current) {
        const liveSession = useTerminalStore
          .getState()
          .sessions.find((item) => item.id === sessionId);
        if (liveSession) {
          const approvalMode = useSettingsStore.getState().approvalMode;
          if (!canUserWriteToTerminal(liveSession, approvalMode)) return;
          if (liveSession.isAgentSession && (data === '\r' || data === '\n')) {
            useTerminalStore.getState().setAwaitingInput(sessionId, false);
          }
        }
        void desktopTerminalRuntime.write(sessionId, data).catch((error: unknown) => {
          const failure = asTerminalRuntimeFailure(error, 'write');
          useTerminalStore.getState().markPtyDead(sessionId, null, failure);
          quarantinePty();
          if (!cancelled) term.writeln(`\r\n\x1b[31m[Terminal write failed] ${failure.message}\x1b[0m`);
        });
      }
      // Track user-typed commands (non-agent sessions only)
      if (!isAgentSession) {
        if (data === '\r' || data === '\n') {
          const cmd = inputBufferRef.current.trim();
          if (cmd) {
            setLastCommand(sessionId, cmd, '', null);
            appendCommandHistory(sessionId, {
              command: cmd,
              output: '',
              exitCode: null,
              timestamp: Date.now(),
              source: 'user',
            });
          }
          inputBufferRef.current = '';
        } else if (data === '\x7f') {
          // Backspace
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        } else if (data.length === 1 && data >= ' ') {
          inputBufferRef.current += data;
        }
      }
    });

    // Refit on container resize
    const observer = new ResizeObserver(() => {
      if (!cancelled) handleResize();
    });
    observer.observe(container);

    // Spawn PTY after a frame so the container has real pixel dimensions
    // For agent sessions, the bridge may have already spawned a PTY — reuse it.
    let rafId: number;
    rafId = requestAnimationFrame(async () => {
      if (cancelled) return;
      const measuredViewport = measureViewport();
      const initialViewport = measuredViewport ?? pendingViewportRef.current ?? DEFAULT_TERMINAL_VIEWPORT;
      pendingViewportRef.current = initialViewport;
      let operation: 'acquire' | 'subscribe' = 'acquire';

      try {
        // Check if a PTY was already spawned (e.g., by the harness bridge for agent sessions)
        const existingSession = useTerminalStore
          .getState()
          .sessions.find((s) => s.id === sessionId);
        let ptyId: string;

        if (existingSession?.ptyId && !existingSession.isDead) {
          ptyId = existingSession.ptyId;
        } else {
          ptyId = await desktopTerminalRuntime.spawnUserTerminal(
            sessionId,
            sessionCwd ?? '',
            initialViewport.cols,
            initialViewport.rows,
            !isAgentSession,
          );

          if (cancelled) {
            quarantinePty();
            return;
          }

          setPtyId(sessionId, ptyId);
        }

        ptyIdRef.current = ptyId;
        lastResizeRef.current = null;
        operation = 'subscribe';
        const unsubscribe = await desktopTerminalRuntime.subscribe(
          sessionId,
          (data, sequence) => {
            if (!cancelled) {
              term.write(data);
              if (sequence - lastStoredSequenceRef.current >= OUTPUT_SEQUENCE_STORE_INTERVAL) {
                lastStoredSequenceRef.current = sequence;
                useTerminalStore.getState().setOutputSequence(sessionId, sequence);
              }
            }
          },
          (exitCode, failure) => {
            if (!cancelled) {
              term.writeln(failure
                ? `\r\n\x1b[31m[Terminal ${failure.operation} failure] ${failure.message}\x1b[0m`
                : exitCode === null
                  ? '\r\n\x1b[90m[Process exited]\x1b[0m'
                  : `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`);
            }
            markPtyDead(sessionId, exitCode, failure);
            if (failure) quarantinePty();
          },
        );
        unlistenFns.push(unsubscribe);

        if (!cancelled) queueResize(ptyId, pendingViewportRef.current ?? initialViewport);
      } catch (err) {
        if (!cancelled) {
          const failure = asTerminalRuntimeFailure(err, operation);
          markPtyDead(sessionId, null, failure);
          quarantinePty();
          term.writeln(`\x1b[31mFailed to ${operation === 'subscribe' ? 'attach' : 'spawn'} terminal: ${failure.message}\x1b[0m`);
        }
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      onDataDisposable.dispose();
      observer.disconnect();
      unlistenFns.forEach((fn) => fn());
      // The backend owns PTY lifecycle. Hiding, moving, or remounting this view
      // only detaches xterm; explicit terminal close performs pty_kill.
      ptyIdRef.current = null;
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  // When switching to this tab, refit and focus
  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        handleResize();
        xtermRef.current?.focus();
      });
    }
  }, [isActive, handleResize]);

  return (
    // Absolute fill — all instances overlay each other; only the active one is visible.
    // This preserves PTY state without re-spawning shells on tab switches.
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        display: isActive ? 'block' : 'none',
        overflow: 'hidden',
        minWidth: 0,
        minHeight: 0,
      }}
    />
  );
}

export const TerminalInstance = memo(TerminalInstanceComponent);
