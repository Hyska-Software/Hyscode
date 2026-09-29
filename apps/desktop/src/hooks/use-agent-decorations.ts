import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agent-store';
import { useSettingsStore } from '../stores/settings-store';
import type { AgentEditSession } from '../stores/agent-store';
import type * as monacoEditor from 'monaco-editor';

type IEditor = monacoEditor.editor.IStandaloneCodeEditor;
type IMonaco = typeof monacoEditor;
type IDecorationsCollection = monacoEditor.editor.IEditorDecorationsCollection;

// ── One-time CSS injection (ref-counted) ─────────────────────────────────────

const AGENT_STYLE_ID = 'hyscode-agent-decorations-css';

let agentCssRefCount = 0;

function ensureAgentCss(): void {
  agentCssRefCount += 1;
  if (document.getElementById(AGENT_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = AGENT_STYLE_ID;
  el.textContent = `
    /* Agent edit gutter bars */
    .monaco-editor .agent-gutter-added {
      border-left: 3px solid #a855f7;
      margin-left: 3px;
      box-sizing: border-box;
    }
    .monaco-editor .agent-gutter-modified {
      border-left: 3px solid #c084fc;
      margin-left: 3px;
      box-sizing: border-box;
    }
    .monaco-editor .agent-gutter-deleted {
      bottom: 0;
      width: 0 !important;
      height: 0 !important;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 7px solid #f85149;
      margin-left: 5px;
      margin-top: -3px;
    }

    /* Agent edit line highlight (glow effect) */
    .monaco-editor .agent-line-added {
      background: rgba(168, 85, 247, 0.08);
    }
    .monaco-editor .agent-line-modified {
      background: rgba(192, 132, 252, 0.08);
    }

    /* Streaming pulse animation */
    @keyframes agent-pulse {
      0%, 100% { opacity: 0.08; }
      50% { opacity: 0.16; }
    }
    .monaco-editor .agent-line-streaming {
      animation: agent-pulse 1.5s ease-in-out infinite;
      background: rgba(168, 85, 247, 0.08);
    }

    /* Reduced motion: no animation */
    @media (prefers-reduced-motion: reduce) {
      .monaco-editor .agent-line-streaming {
        animation: none;
        background: rgba(168, 85, 247, 0.08);
      }
    }
    .agent-reduced-motion .monaco-editor .agent-line-streaming {
      animation: none;
      background: rgba(168, 85, 247, 0.08);
    }
  `;
  document.head.appendChild(el);
}

function releaseAgentCss(): void {
  agentCssRefCount = Math.max(0, agentCssRefCount - 1);
  if (agentCssRefCount === 0) {
    document.getElementById(AGENT_STYLE_ID)?.remove();
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Applies Monaco decorations for agent edit sessions on the active file.
 * Similar pattern to useGitDecorations but driven by AgentEditSession hunks.
 */
export function useAgentDecorations(
  editorRef: React.MutableRefObject<IEditor | null>,
  monacoRef: React.MutableRefObject<IMonaco | null>,
  filePath: string | null,
  editorVersion: number,
) {
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const collectionRef = useRef<IDecorationsCollection | null>(null);

  // Subscribe to the active edit session for this file
  const session = useAgentStore((s) =>
    filePath
      ? s.agentEditSessions.find(
          (es) =>
            es.filePath === filePath &&
            (es.phase === 'streaming' || es.phase === 'pending_review'),
        ) ?? null
      : null,
  );

  useEffect(() => {
    ensureAgentCss();
    return () => {
      releaseAgentCss();
    };
  }, []);

  // Toggle reduced-motion class on body
  useEffect(() => {
    if (reducedMotion) {
      document.body.classList.add('agent-reduced-motion');
    } else {
      document.body.classList.remove('agent-reduced-motion');
    }
  }, [reducedMotion]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) return;

    if (!session) {
      collectionRef.current?.clear();
      return;
    }

    const decorations = hunksToDecorations(session, monaco, reducedMotion);

    if (!collectionRef.current) {
      collectionRef.current = editor.createDecorationsCollection(decorations);
    } else {
      collectionRef.current.set(decorations);
    }
  }, [session, reducedMotion, editorVersion]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      collectionRef.current?.clear();
    };
  }, []);

  return session;
}

function hunksToDecorations(
  session: AgentEditSession,
  monaco: IMonaco,
  reducedMotion: boolean,
): monacoEditor.editor.IModelDeltaDecoration[] {
  const decorations: monacoEditor.editor.IModelDeltaDecoration[] = [];
  const isStreaming = session.phase === 'streaming';

  // If new file, highlight everything
  if (session.isNewFile) {
    const lineCount = session.newContent.split('\n').length;
    decorations.push({
      range: new monaco.Range(1, 1, lineCount, 1),
      options: {
        linesDecorationsClassName: 'agent-gutter-added',
        className: isStreaming && !reducedMotion ? 'agent-line-streaming' : 'agent-line-added',
        minimap: {
          color: '#a855f7',
          position: monaco.editor.MinimapPosition.Inline,
        },
        overviewRuler: {
          color: '#a855f7',
          position: monaco.editor.OverviewRulerLane.Right,
        },
        isWholeLine: true,
      },
    });
    return decorations;
  }

  for (const hunk of session.hunks) {
    switch (hunk.type) {
      case 'add': {
        const endLine = Math.max(hunk.newStart, hunk.newStart + hunk.newLines - 1);
        decorations.push({
          range: new monaco.Range(hunk.newStart, 1, endLine, 1),
          options: {
            linesDecorationsClassName: 'agent-gutter-added',
            className: isStreaming && !reducedMotion ? 'agent-line-streaming' : 'agent-line-added',
            minimap: {
              color: '#a855f7',
              position: monaco.editor.MinimapPosition.Inline,
            },
            overviewRuler: {
              color: '#a855f7',
              position: monaco.editor.OverviewRulerLane.Right,
            },
            isWholeLine: true,
          },
        });
        break;
      }
      case 'modify': {
        const endLine = Math.max(hunk.newStart, hunk.newStart + hunk.newLines - 1);
        decorations.push({
          range: new monaco.Range(hunk.newStart, 1, endLine, 1),
          options: {
            linesDecorationsClassName: 'agent-gutter-modified',
            className: isStreaming && !reducedMotion ? 'agent-line-streaming' : 'agent-line-modified',
            minimap: {
              color: '#c084fc',
              position: monaco.editor.MinimapPosition.Inline,
            },
            overviewRuler: {
              color: '#c084fc',
              position: monaco.editor.OverviewRulerLane.Right,
            },
            isWholeLine: true,
          },
        });
        break;
      }
      case 'delete': {
        const line = Math.max(1, hunk.newStart);
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            linesDecorationsClassName: 'agent-gutter-deleted',
            minimap: {
              color: '#f85149',
              position: monaco.editor.MinimapPosition.Inline,
            },
            overviewRuler: {
              color: '#f85149',
              position: monaco.editor.OverviewRulerLane.Right,
            },
          },
        });
        break;
      }
    }
  }

  return decorations;
}
