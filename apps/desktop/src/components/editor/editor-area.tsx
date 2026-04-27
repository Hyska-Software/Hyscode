import { Suspense, lazy, useEffect, useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { EditorTabs } from './editor-tabs';
import { EditorWelcome } from './editor-welcome';
import { DiffViewer } from './diff-viewer';
import { AgentDiffViewer } from './agent-diff-viewer';
import { PendingChangesBar } from './pending-changes-bar';
import { InlineReviewBar } from './inline-review-bar';
import { EditorContextMenu } from './editor-context-menu';
import { TerminalInstance } from '../terminal/terminal-instance';
import {
  MarkdownViewer,
  ImageViewer,
  PdfViewer,
  SpreadsheetViewer,
  DocxViewer,
  PptxViewer,
} from './viewers';
import { useEditorStore, useFileStore, useSettingsStore } from '../../stores';
import { useAgentStore } from '../../stores/agent-store';
import { useExtensionStore } from '../../stores/extension-store';
import { tauriFs } from '../../lib/tauri-fs';
import { saveFileDialog } from '../../lib/tauri-dialog';
import { useGitDecorations } from '../../hooks/use-git-decorations';
import { useGitBlameDecorations } from '../../hooks/use-git-blame-decorations';
import { useAgentDecorations } from '../../hooks/use-agent-decorations';
import { useDiagnosticsSync } from '../../hooks/use-diagnostics-sync';
import { defineAllMonacoThemes, getMonacoThemeName } from '../../lib/monaco-themes';
import { LspBridge, detectLanguage, detectLspLanguage } from '../../lib/lsp-bridge';
import { registerAllLanguages, disableNativeTypeScriptValidation } from '@hyscode/lsp-client';
import type * as monacoEditor from 'monaco-editor';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

function EditorLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function EditorArea() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const markDirty = useEditorStore((s) => s.markDirty);
  const setMarkdownMode = useEditorStore((s) => s.setMarkdownMode);
  const { fileCache, setFileContent } = useFileStore();

  // Editor settings
  const editorFontSize = useSettingsStore((s) => s.fontSize);
  const editorFontFamily = useSettingsStore((s) => s.fontFamily);
  const editorLineHeight = useSettingsStore((s) => s.lineHeight);
  const editorTabSize = useSettingsStore((s) => s.tabSize);
  const editorInsertSpaces = useSettingsStore((s) => s.insertSpaces);
  const editorWordWrap = useSettingsStore((s) => s.wordWrap);
  const editorMinimap = useSettingsStore((s) => s.minimap);
  const editorLineNumbers = useSettingsStore((s) => s.lineNumbers);
  const editorCursorStyle = useSettingsStore((s) => s.cursorStyle);
  const editorRenderWhitespace = useSettingsStore((s) => s.renderWhitespace);
  const editorBracketPairColorization = useSettingsStore((s) => s.bracketPairColorization);
  const editorScrollBeyondLastLine = useSettingsStore((s) => s.scrollBeyondLastLine);
  const editorSmoothScrolling = useSettingsStore((s) => s.smoothScrolling);
  const editorAutoClosingBrackets = useSettingsStore((s) => s.autoClosingBrackets);
  const editorAutoClosingQuotes = useSettingsStore((s) => s.autoClosingQuotes);
  const editorFormatOnPaste = useSettingsStore((s) => s.formatOnPaste);
  const editorFormatOnType = useSettingsStore((s) => s.formatOnType);
  const autoSave = useSettingsStore((s) => s.autoSave);
  const autoSaveDelay = useSettingsStore((s) => s.autoSaveDelay);
  const themeId = useSettingsStore((s) => s.themeId);
  const monacoTheme = getMonacoThemeName(themeId);
  const extensionThemesVersion = useExtensionStore((s) => s.extensionThemesVersion);

  // Re-define custom themes + re-apply when extension themes finish loading asynchronously
  useEffect(() => {
    const monaco = monacoInstanceRef.current;
    if (!monaco) return;
    defineAllMonacoThemes(monaco);
    monaco.editor.setTheme(getMonacoThemeName(themeId));
  }, [extensionThemesVersion]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<string | null>(null);

  // Agent edit session for the active file (new inline model)
  const editSession = useAgentStore((s) =>
    activeTab?.filePath
      ? s.agentEditSessions.find(
          (es) =>
            es.filePath === activeTab.filePath &&
            (es.phase === 'streaming' || es.phase === 'pending_review'),
        ) ?? null
      : null,
  );

  // When an active edit session is resolved, reload file content to sync editor
  const prevEditSessionRef = useRef(editSession);
  useEffect(() => {
    const prev = prevEditSessionRef.current;
    prevEditSessionRef.current = editSession;
    if (prev && !editSession && activeTab) {
      const cached = useFileStore.getState().fileCache.get(activeTab.filePath);
      if (cached !== undefined) {
        setContent(cached);
        contentRef.current = cached;
        // Also update Monaco model if editor is mounted
        const editor = editorInstanceRef.current;
        const model = editor?.getModel();
        if (model && model.getValue() !== cached) {
          model.setValue(cached);
        }
      }
    }
  }, [editSession, activeTab]);

  // ── Editor context menu (right-click) ──────────────────────────────────────
  const [editorCtxMenu, setEditorCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // Monaco instance refs for decorations
  const editorInstanceRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const monacoInstanceRef = useRef<typeof monacoEditor | null>(null);

  // Auto-save timer ref
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track when editor mounts so decoration hooks re-run
  const [editorVersion, setEditorVersion] = useState(0);

  // ── Shared file-save logic (used by Ctrl+S AND autoSave) ──────────────────
  const saveCurrentFile = useCallback(async () => {
    if (!activeTab) return;
    if (activeTab.filePath.startsWith('untitled:')) return;
    const currentContent = contentRef.current;
    if (currentContent === null) return;
    try {
      await tauriFs.writeFile(activeTab.filePath, currentContent);
      markDirty(activeTab.id, false);
      const lang = detectLspLanguage(activeTab.filePath) ?? activeTab.language ?? 'plaintext';
      LspBridge.onFileSaved(activeTab.filePath, lang, currentContent);
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, [activeTab?.id, activeTab?.filePath, activeTab?.language, markDirty]);

  // Clear pending auto-save timer when tab changes
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [activeTab?.filePath]);

  // Auto-save on focus change
  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (!editor || autoSave !== 'onFocusChange') return;
    const disposable = editor.onDidBlurEditorText(() => {
      saveCurrentFile();
    });
    return () => disposable.dispose();
  }, [editorVersion, autoSave, saveCurrentFile]);

  // ── Real-time Monaco option updates ───────────────────────────────────────
  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    editor.updateOptions({
      fontFamily: `'${editorFontFamily}', 'JetBrains Mono', 'Fira Code', monospace`,
      fontSize: editorFontSize,
      lineHeight: editorLineHeight,
      minimap: { enabled: editorMinimap, scale: 1 },
      scrollBeyondLastLine: editorScrollBeyondLastLine,
      smoothScrolling: editorSmoothScrolling,
      cursorStyle: editorCursorStyle,
      bracketPairColorization: { enabled: editorBracketPairColorization },
      guides: { bracketPairs: editorBracketPairColorization, indentation: true },
      wordWrap: editorWordWrap,
      lineNumbers: editorLineNumbers,
      tabSize: editorTabSize,
      insertSpaces: editorInsertSpaces,
      renderWhitespace: editorRenderWhitespace,
      autoClosingBrackets: editorAutoClosingBrackets,
      autoClosingQuotes: editorAutoClosingQuotes,
      formatOnPaste: editorFormatOnPaste,
      formatOnType: editorFormatOnType,
    });
  }, [
    editorVersion,
    editorFontSize, editorFontFamily, editorLineHeight,
    editorTabSize, editorInsertSpaces,
    editorWordWrap, editorMinimap, editorLineNumbers, editorCursorStyle,
    editorRenderWhitespace, editorBracketPairColorization,
    editorScrollBeyondLastLine, editorSmoothScrolling,
    editorAutoClosingBrackets, editorAutoClosingQuotes,
    editorFormatOnPaste, editorFormatOnType,
  ]);

  // Apply git diff decorations to gutter + minimap
  useGitDecorations(
    editorInstanceRef,
    monacoInstanceRef,
    activeTab?.type === 'file' ? (activeTab?.filePath ?? null) : null,
    editorVersion,
  );

  // Apply git blame inline annotations to each line
  useGitBlameDecorations(
    editorInstanceRef,
    monacoInstanceRef,
    activeTab?.type === 'file' ? (activeTab?.filePath ?? null) : null,
    editorVersion,
  );

  // Apply agent edit decorations (glow, gutter markers, minimap)
  useAgentDecorations(
    editorInstanceRef,
    monacoInstanceRef,
    activeTab?.type === 'file' ? (activeTab?.filePath ?? null) : null,
    editorVersion,
  );

  // Sync Monaco diagnostics to the file tree
  useDiagnosticsSync(monacoInstanceRef);

  // Push agent edit content to the Monaco model without remounting
  useEffect(() => {
    if (!editSession || !editorInstanceRef.current) return;
    const editor = editorInstanceRef.current;
    const model = editor.getModel();
    if (!model) return;

    const currentValue = model.getValue();
    if (currentValue !== editSession.newContent) {
      // Preserve cursor and scroll position
      const position = editor.getPosition();
      const scrollTop = editor.getScrollTop();
      const scrollLeft = editor.getScrollLeft();

      // Push an undo stop before agent content so user can Ctrl+Z
      model.pushStackElement();
      model.pushEditOperations(
        [],
        [
          {
            range: model.getFullModelRange(),
            text: editSession.newContent,
          },
        ],
        () => null,
      );
      model.pushStackElement();

      // Restore cursor/scroll
      if (position) editor.setPosition(position);
      editor.setScrollTop(scrollTop);
      editor.setScrollLeft(scrollLeft);

      // Sync cache
      contentRef.current = editSession.newContent;
      setContent(editSession.newContent);
      if (activeTab) {
        setFileContent(activeTab.filePath, editSession.newContent);
      }
    }
  }, [editSession?.newContent, editSession?.id]);

  // Viewer types that are handled as text (Monaco / markdown)
  const isTextViewer =
    !activeTab || activeTab.viewerType === 'code' || activeTab.viewerType === 'markdown';

  // Load file content when active tab changes (only for text-based viewers)
  useEffect(() => {
    if (!activeTab || !isTextViewer) {
      setContent(null);
      contentRef.current = null;
      setLoading(false);
      return;
    }

    // Untitled files start with empty content — no disk read
    if (activeTab.filePath.startsWith('untitled:')) {
      const cached = fileCache.get(activeTab.filePath) ?? '';
      setContent(cached);
      contentRef.current = cached;
      setLoading(false);
      return;
    }

    const cached = fileCache.get(activeTab.filePath);
    if (cached !== undefined) {
      setContent(cached);
      contentRef.current = cached;
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    tauriFs
      .readFile(activeTab.filePath)
      .then((text) => {
        if (!cancelled) {
          setFileContent(activeTab.filePath, text);
          setContent(text);
          contentRef.current = text;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent('// Error reading file');
          contentRef.current = '// Error reading file';
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab?.filePath]);

  // Track previous active tab for LSP close notifications
  const prevTabRef = useRef<{ filePath: string; language: string } | null>(null);

  // Track closed tabs to notify LSP even when they aren't the active tab
  const prevTabsRef = useRef<typeof tabs>([]);
  useEffect(() => {
    const prevTabs = prevTabsRef.current;
    const closedTabs = prevTabs.filter((pt) => !tabs.some((t) => t.id === pt.id));
    for (const tab of closedTabs) {
      if (tab.type === 'file' || tab.type === 'diff') {
        const lang = detectLspLanguage(tab.filePath) ?? tab.language ?? 'plaintext';
        LspBridge.onFileClosed(tab.filePath, lang).catch(() => {});
      }
    }
    prevTabsRef.current = tabs;
  }, [tabs]);

  // Notify LSP when a text file is opened / closed
  useEffect(() => {
    // Close previous document
    if (prevTabRef.current) {
      const { filePath, language } = prevTabRef.current;
      LspBridge.onFileClosed(filePath, language).catch(() => {});
    }

    // Open new document
    if (activeTab && isTextViewer && content !== null) {
      const lang = detectLspLanguage(activeTab.filePath) ?? activeTab.language ?? 'plaintext';
      LspBridge.onFileOpened(activeTab.filePath, lang, content).catch(() => {});
      prevTabRef.current = { filePath: activeTab.filePath, language: lang };
    } else {
      prevTabRef.current = null;
    }
  }, [activeTab?.filePath, isTextViewer, content !== null]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeTab || value === undefined) return;
      contentRef.current = value;
      setFileContent(activeTab.filePath, value);
      markDirty(activeTab.id, true);

      // Notify LSP of content change (debounced inside bridge)
      const lang = detectLspLanguage(activeTab.filePath) ?? activeTab.language ?? 'plaintext';
      LspBridge.onFileChanged(activeTab.filePath, lang, value);

      // Auto-save after delay
      if (autoSave === 'afterDelay' && !activeTab.filePath.startsWith('untitled:')) {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(saveCurrentFile, autoSaveDelay);
      }
    },
    [activeTab?.id, activeTab?.filePath, activeTab?.language, markDirty, setFileContent, autoSave, autoSaveDelay, saveCurrentFile],
  );

  // Save with Ctrl+S (only for text-editable viewers)
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!activeTab || !isTextViewer) return;
        const currentContent = contentRef.current;
        if (currentContent === null) return;

        // Untitled files → prompt Save As dialog
        if (activeTab.filePath.startsWith('untitled:')) {
          const path = await saveFileDialog(activeTab.fileName);
          if (!path) return;
          try {
            await tauriFs.writeFile(path, currentContent);
            markDirty(activeTab.id, false);
          } catch (err) {
            console.error('Failed to save file:', err);
          }
          return;
        }

        saveCurrentFile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab?.id, activeTab?.filePath, activeTab?.fileName, markDirty, saveCurrentFile]);

  const hasOpenTabs = tabs.length > 0;

  return (
    <div className="flex h-full flex-col">
      {hasOpenTabs && <EditorTabs />}
      <div className="relative flex-1 overflow-hidden">
        {/* ── Layer 1: Normal editor content (hidden when a terminal tab is active) ── */}
        <div className="absolute inset-0 flex flex-col" style={{ display: activeTab?.type === 'terminal' ? 'none' : 'flex' }}>
          {!activeTab ? (
            <EditorWelcome />
          ) : activeTab.type === 'diff' && activeTab.diffProps ? (
            <DiffViewer
              filePath={activeTab.diffProps.filePath}
              staged={activeTab.diffProps.staged}
            />
          ) : editSession ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              <InlineReviewBar session={editSession} />
              <div className="flex-1 overflow-hidden">
                <AgentDiffViewer
                  key={editSession.id}
                  change={{
                    id: editSession.id,
                    filePath: editSession.filePath,
                    toolName: editSession.toolName,
                    toolCallId: editSession.toolCallId,
                    originalContent: editSession.originalContent,
                    newContent: editSession.newContent,
                    status: 'pending',
                  }}
                />
              </div>
            </div>
          ) : activeTab.viewerType === 'markdown' ? (
            loading ? (
              <EditorLoading />
            ) : (
              <MarkdownViewer
                content={content ?? ''}
                mode={activeTab.markdownMode ?? 'preview'}
                onModeChange={(mode) => setMarkdownMode(activeTab.id, mode)}
                onChange={handleEditorChange}
                language={activeTab.language}
                filePath={activeTab.filePath}
              />
            )
          ) : activeTab.viewerType === 'image' ? (
            <ImageViewer filePath={activeTab.filePath} />
          ) : activeTab.viewerType === 'pdf' ? (
            <PdfViewer filePath={activeTab.filePath} />
          ) : activeTab.viewerType === 'spreadsheet' ? (
            <SpreadsheetViewer filePath={activeTab.filePath} />
          ) : activeTab.viewerType === 'docx' ? (
            <DocxViewer filePath={activeTab.filePath} />
          ) : activeTab.viewerType === 'pptx' ? (
            <PptxViewer filePath={activeTab.filePath} />
          ) : loading ? (
            <EditorLoading />
          ) : (
            <>
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<EditorLoading />}>
                  <MonacoEditor
                    path={activeTab.filePath}
                    language={detectLanguage(activeTab.filePath)}
                    value={content ?? ''}
                    onChange={handleEditorChange}
                    theme={monacoTheme}
                    onMount={(editor, monaco) => {
                      editorInstanceRef.current = editor;
                      monacoInstanceRef.current = monaco;
                      setEditorVersion((v) => v + 1);

                      // Disable Monaco's built-in context menu so we show our own
                      editor.updateOptions({ contextmenu: false });

                      // Intercept right-click on the editor's DOM
                      const domNode = editor.getDomNode();
                      if (domNode) {
                        domNode.addEventListener('contextmenu', (e: MouseEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditorCtxMenu({ x: e.clientX, y: e.clientY });
                        });
                      }
                    }}
                    beforeMount={(monaco) => {
                      defineAllMonacoThemes(monaco);
                      registerAllLanguages(monaco);
                      disableNativeTypeScriptValidation(monaco);
                      LspBridge.setMonaco(monaco);
                    }}
                    options={{
                      fontFamily: `'${editorFontFamily}', 'JetBrains Mono', 'Fira Code', monospace`,
                      fontSize: editorFontSize,
                      lineHeight: editorLineHeight,
                      minimap: { enabled: editorMinimap, scale: 1 },
                      scrollBeyondLastLine: editorScrollBeyondLastLine,
                      smoothScrolling: editorSmoothScrolling,
                      cursorBlinking: 'smooth',
                      cursorSmoothCaretAnimation: 'on',
                      cursorStyle: editorCursorStyle,
                      bracketPairColorization: { enabled: editorBracketPairColorization },
                      guides: { bracketPairs: editorBracketPairColorization, indentation: true },
                      wordWrap: editorWordWrap,
                      lineNumbers: editorLineNumbers,
                      tabSize: editorTabSize,
                      insertSpaces: editorInsertSpaces,
                      renderWhitespace: editorRenderWhitespace,
                      autoClosingBrackets: editorAutoClosingBrackets,
                      autoClosingQuotes: editorAutoClosingQuotes,
                      formatOnPaste: editorFormatOnPaste,
                      formatOnType: editorFormatOnType,
                      padding: { top: 8 },
                      overviewRulerLanes: 3,
                      overviewRulerBorder: false,
                      lineDecorationsWidth: 12,
                      glyphMargin: true,
                    }}
                  />
                </Suspense>
              </div>
            </>
          )}
        </div>

        {/* ── Layer 2: Terminal tabs (always mounted; visibility toggled) ── */}
        {tabs
          .filter((t): t is typeof t & { terminalSessionId: string } => t.type === 'terminal' && !!t.terminalSessionId)
          .map((t) => (
            <div key={t.terminalSessionId} className="absolute inset-0" style={{ display: t.id === activeTabId ? 'block' : 'none' }}>
              <TerminalInstance sessionId={t.terminalSessionId} isActive={t.id === activeTabId} />
            </div>
          ))}
      </div>
      <PendingChangesBar />

      {editorCtxMenu && (
        <EditorContextMenu
          x={editorCtxMenu.x}
          y={editorCtxMenu.y}
          editorInstance={editorInstanceRef.current as unknown as Parameters<typeof EditorContextMenu>[0]['editorInstance']}
          onClose={() => setEditorCtxMenu(null)}
        />
      )}
    </div>
  );
}
