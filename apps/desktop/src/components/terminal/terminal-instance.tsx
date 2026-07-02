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

interface TerminalInstanceProps {
  sessionId: string;
  isActive: boolean;
}

export function TerminalInstance({ sessionId, isActive }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
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
  const extensionThemesVersion = useExtensionStore((s) => s.extensionThemesVersion);
  // Keep a ref so the one-time init effect always reads the latest themeId
  const themeIdRef = useRef(themeId);
  useEffect(() => {
    themeIdRef.current = themeId;
  }, [themeId]);

  // Update xterm theme whenever the theme setting or extension themes change
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.theme = getXtermTheme(themeId);
  }, [themeId, extensionThemesVersion]);

  const handleResize = useCallback(() => {
    const container = containerRef.current;
    if (!fitAddonRef.current || !ptyIdRef.current || !xtermRef.current) return;
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) return;
    try {
      fitAddonRef.current.fit();
      invoke('pty_resize', {
        ptyId: ptyIdRef.current,
        cols: xtermRef.current.cols,
        rows: xtermRef.current.rows,
      }).catch(() => {});
    } catch {
      // ignore fit errors when container is invisible
    }
  }, []);

  // Initialize xterm + PTY. Uses a `cancelled` flag to handle React StrictMode's
  // double-invocation: if the cleanup fires before the async PTY spawn completes,
  // we kill the orphaned process and bail out.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const unlistenFns: UnlistenFn[] = [];

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'Geist Mono', 'Cascadia Code', 'Consolas', monospace",
      lineHeight: 1.4,
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

      try {
        fitAddon.fit();
      } catch {
        /* not yet visible */
      }

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
            shell: null,
            cwd: sessionCwd ?? null,
            env: null,
          });

          if (cancelled) {
            await invoke('pty_kill', { ptyId }).catch(() => {});
            return;
          }

          setPtyId(sessionId, ptyId);
        }

        ptyIdRef.current = ptyId;

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

        if (!cancelled && term.cols && term.rows) {
          await invoke('pty_resize', { ptyId, cols: term.cols, rows: term.rows });
        }
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
      }}
    />
  );
}
