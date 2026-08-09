import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
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

export function TerminalInstance({ sessionId, isActive }: TerminalInstanceProps) {
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
          await invoke('pty_resize', { ptyId: next.ptyId, cols: next.viewport.cols, rows: next.viewport.rows });
        } catch (error: unknown) {
          console.error('[Terminal] PTY resize failed', {
            ptyId: next.ptyId,
            cols: next.viewport.cols,
            rows: next.viewport.rows,
            error,
          });
        }
      }
      resizingRef.current = false;
    })();
  }, []);

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
    const unlistenFns: UnlistenFn[] = [];

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
        invoke('pty_write', { ptyId: ptyIdRef.current, data }).catch(() => {});
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

      try {
        // Check if a PTY was already spawned (e.g., by the harness bridge for agent sessions)
        const existingSession = useTerminalStore
          .getState()
          .sessions.find((s) => s.id === sessionId);
        let ptyId: string;

        if (existingSession?.ptyId) {
          ptyId = existingSession.ptyId;
        } else {
          ptyId = await invoke<string>('pty_spawn', {
            shell: terminalSettingsRef.current.shell.trim() || null,
            cwd: sessionCwd ?? null,
            env: null,
            cols: initialViewport.cols,
            rows: initialViewport.rows,
            interactive: !isAgentSession,
          });

          if (cancelled) {
            await invoke('pty_kill', { ptyId }).catch(() => {});
            return;
          }

          setPtyId(sessionId, ptyId);
        }

        ptyIdRef.current = ptyId;
        lastResizeRef.current = null;

        const unsubscribe = await desktopTerminalRuntime.subscribe(
          sessionId,
          (data, sequence) => {
            if (!cancelled) {
              term.write(data);
              useTerminalStore.getState().setOutputSequence(sessionId, sequence);
            }
          },
          () => {
            if (!cancelled) {
              term.writeln('\r\n\x1b[90m[Process exited]\x1b[0m');
              markPtyDead(sessionId);
            }
          },
        );
        unlistenFns.push(unsubscribe);

        if (!cancelled) queueResize(ptyId, pendingViewportRef.current ?? initialViewport);
      } catch (err) {
        if (!cancelled) {
          term.writeln(`\x1b[31mFailed to spawn terminal: ${err}\x1b[0m`);
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
