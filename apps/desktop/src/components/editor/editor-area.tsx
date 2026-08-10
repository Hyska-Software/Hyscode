import { Suspense, lazy, useEffect, useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { EditorTabs } from './editor-tabs';
import { EditorWelcome } from './editor-welcome';
import { DiffViewer } from './diff-viewer';
import { AgentDiffViewer } from './agent-diff-viewer';
import { CommitTab } from './commit-tab';
import { GitGraphView } from '../git/git-graph-view';
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

  DatabaseViewer,
} from './viewers';
import { DbSchemaViewer } from './viewers/db-schema';
import { MemoryViewer } from './viewers/memory-viewer';
import { ExtensionReadmeViewer } from './extension-readme-viewer';
import { SubAgentTabView } from './sub-agent-tab';
import { useEditorStore, useFileStore, useLayoutStore, useSettingsStore } from '../../stores';
import { useAgentStore } from '../../stores/agent-store';
import { useExtensionStore } from '../../stores/extension-store';
import { tauriFs } from '../../lib/tauri-fs';
import { saveFileDialog } from '../../lib/tauri-dialog';
import { GIT_GUTTER_WIDTH, useGitDecorations } from '../../hooks/use-git-decorations';
import { useGitBlameDecorations } from '../../hooks/use-git-blame-decorations';
import { useAgentDecorations } from '../../hooks/use-agent-decorations';
import { useDiagnosticsSync } from '../../hooks/use-diagnostics-sync';
import { useInlineCompletion } from '../../hooks/use-inline-completion';
import { defineAllMonacoThemes, getMonacoThemeName } from '../../lib/monaco-themes';
import { LspBridge, detectLanguage, detectLspLanguage } from '../../lib/lsp-bridge';
import { LspMissingBanner } from './lsp-missing-banner';
import { registerAllLanguages, disableNativeTypeScriptValidation } from '@hyscode/lsp-client';
import { getViewerType } from '../../lib/utils';
import type * as monacoEditor from 'monaco-editor';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

function EditorLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function EditorLoadError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <p className="text-sm font-medium text-foreground">Unable to read this file</p>
      <p className="max-w-xl text-xs">{message}</p>
    </div>
  );
}

type FileLoadState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string }
  | { status: 'error'; path: string; message: string };

export function EditorArea() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const markDirty = useEditorStore((s) => s.markDirty);
  const setMarkdownMode = useEditorStore((s) => s.setMarkdownMode);
  const setMarkdownSplitRatio = useEditorStore((s) => s.setMarkdownSplitRatio);
  const setMarkdownAnchor = useEditorStore((s) => s.setMarkdownAnchor);
  const setFileContent = useFileStore((s) => s.setFileContent);
  const clearExternalConflict = useFileStore((s) => s.clearExternalConflict);
  const rootPath = useFileStore((s) => s.rootPath);
  const content = useFileStore((s) =>
    activeTab ? s.fileCache.get(activeTab.filePath) : undefined,
  );
  const hasExternalConflict = useFileStore((s) =>
    activeTab ? s.externalConflicts.has(activeTab.filePath) : false,
  );

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
  const inlineCompletionEnabled = useSettingsStore((s) => s.inlineCompletionEnabled);
  const inlineCompletionDelay = useSettingsStore((s) => s.inlineCompletionDelay);
  const inlineCompletionMaxTokens = useSettingsStore((s) => s.inlineCompletionMaxTokens);
  const inlineCompletionTemperature = useSettingsStore((s) => s.inlineCompletionTemperature);
  const inlineCompletionProviderId = useSettingsStore((s) => s.inlineCompletionProviderId);
  const inlineCompletionModelId = useSettingsStore((s) => s.inlineCompletionModelId);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const openSettingsOnTab = useSettingsStore((s) => s.openSettingsOnTab);

  const monacoTheme = getMonacoThemeName(themeId);
  const extensionThemesVersion = useExtensionStore((s) => s.extensionThemesVersion);

  // Re-define custom themes + re-apply when extension themes finish loading asynchronously
  useEffect(() => {
    const monaco = monacoInstanceRef.current;
    if (!monaco) return;
    defineAllMonacoThemes(monaco);
    monaco.editor.setTheme(getMonacoThemeName(themeId));
  }, [extensionThemesVersion]);

  const [loadState, setLoadState] = useState<FileLoadState>({ status: 'idle' });
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

  // Keep the imperative save path aligned with the canonical buffer.
  useEffect(() => {
    if (!activeTab || content === undefined) {
      contentRef.current = null;
      return;
    }
    contentRef.current = content;
  }, [activeTab?.filePath, content]);

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
      clearExternalConflict(activeTab.filePath);
      const lang = detectLspLanguage(activeTab.filePath) ?? activeTab.language ?? 'plaintext';
      LspBridge.onFileSaved(activeTab.filePath, lang, currentContent);

      // Native SpectraLang format-on-save (via the LSP formatting provider).
      if (lang === 'spectra' && useSettingsStore.getState().spectraFormatOnSave) {
        editorInstanceRef.current?.trigger('spectra', 'editor.action.formatDocument', undefined);
      }
      // Record history snapshot (skip large files >1 MB, fire-and-forget)
      if (currentContent.length <= 1_048_576) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('file_history_save', { filePath: activeTab.filePath, content: currentContent }).catch(() => {});
        });
      }
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, [activeTab?.id, activeTab?.filePath, activeTab?.language, markDirty, clearExternalConflict]);

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
  useDiagnosticsSync(monacoInstanceRef, editorVersion);

  // AI-powered inline completion (ghost text)
  const inlineCompletionState = useInlineCompletion({
    editorRef: editorInstanceRef,
    monacoRef: monacoInstanceRef,
    filePath: activeTab?.type === 'file' ? (activeTab?.filePath ?? null) : null,
    language: activeTab?.type === 'file' ? (activeTab?.language ?? null) : null,
    enabled: inlineCompletionEnabled && activeTab?.type === 'file' && activeTab?.viewerType === 'code',
    editorVersion,
    delay: inlineCompletionDelay,
    maxTokens: inlineCompletionMaxTokens,
    temperature: inlineCompletionTemperature,
    providerId: inlineCompletionProviderId,
    modelId: inlineCompletionModelId,
    activeProviderId,
    activeModelId,
  });

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
      if (activeTab) {
        setFileContent(activeTab.filePath, editSession.newContent);
      }
    }
  }, [editSession?.newContent, editSession?.id]);

  // Viewer types that are handled as text (Monaco / markdown)
  const isTextViewer =
    !activeTab ||
    (activeTab.type === 'file' &&
      (activeTab.viewerType === 'code' || activeTab.viewerType === 'markdown'));

  // Load file content when active tab changes (only for text-based viewers)
  useEffect(() => {
    if (!activeTab || !isTextViewer) {
      contentRef.current = null;
      setLoadState({ status: 'idle' });
      return;
    }

    // Untitled files start with empty content — no disk read
    if (activeTab.filePath.startsWith('untitled:')) {
      if (content === undefined) setFileContent(activeTab.filePath, '');
      setLoadState({ status: 'ready', path: activeTab.filePath });
      return;
    }

    if (content !== undefined) {
      setLoadState({ status: 'ready', path: activeTab.filePath });
      return;
    }

    let cancelled = false;
    const requestedPath = activeTab.filePath;
    setLoadState({ status: 'loading', path: requestedPath });

    tauriFs
      .readFile(requestedPath)
      .then((text) => {
        if (!cancelled) {
          setFileContent(requestedPath, text);
          contentRef.current = text;
          setLoadState({ status: 'ready', path: requestedPath });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          contentRef.current = null;
          setLoadState({
            status: 'error',
            path: requestedPath,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab?.filePath, isTextViewer, content === undefined, setFileContent]);

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
    if (activeTab && isTextViewer && content !== undefined) {
      const lang = detectLspLanguage(activeTab.filePath) ?? activeTab.language ?? 'plaintext';
      LspBridge.onFileOpened(activeTab.filePath, lang, content).catch(() => {});
      prevTabRef.current = { filePath: activeTab.filePath, language: lang };
    } else {
      prevTabRef.current = null;
    }
  }, [activeTab?.filePath, isTextViewer, content !== undefined]);

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

  const handleOpenWorkspaceFile = useCallback(
    (path: string, anchor: string | null) => {
      const fileName = path.split(/[\\/]/).pop() ?? path;
      useEditorStore.getState().openTab({
        id: path,
        filePath: path,
        fileName,
        language: detectLanguage(path),
        viewerType: getViewerType(fileName),
        markdownAnchor: anchor ?? undefined,
      });
      useLayoutStore.getState().setWorkspaceMode('editor');
    },
    [],
  );

  const handleTextEditorMount = useCallback(
    (
      editor: monacoEditor.editor.IStandaloneCodeEditor | null,
      monaco: typeof monacoEditor | null,
    ) => {
      editorInstanceRef.current = editor;
      monacoInstanceRef.current = monaco;
      setEditorVersion((version) => version + 1);
      if (!editor || !monaco) return;

      editor.updateOptions({ contextmenu: false });
      const domNode = editor.getDomNode();
      if (domNode) {
        domNode.addEventListener('contextmenu', (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          setEditorCtxMenu({ x: event.clientX, y: event.clientY });
        });
      }
    },
    [],
  );

  const hasOpenTabs = tabs.length > 0;
  const loading =
    loadState.status === 'loading' && loadState.path === activeTab?.filePath;
  const loadError =
    loadState.status === 'error' && loadState.path === activeTab?.filePath
      ? loadState.message
      : null;

  return (
    <div className="flex h-full flex-col">
      {hasOpenTabs && <EditorTabs />}
      <LspMissingBanner />
      {activeTab?.type === 'file' &&
        activeTab.viewerType === 'code' &&
        (inlineCompletionState.status.kind === 'unavailable' ||
          inlineCompletionState.status.kind === 'error') && (
          <div className="flex items-center justify-between gap-3 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-100">
            <span>{inlineCompletionState.status.message}</span>
            <button
              type="button"
              className="shrink-0 font-medium text-sky-200 underline underline-offset-2 hover:text-white"
              onClick={() => openSettingsOnTab('ai')}
            >
              Open AI settings
            </button>
          </div>
        )}
      {hasExternalConflict && (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
          This file changed on disk while the editor buffer has unsaved changes. Save or revert the buffer before reloading.
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        {/* ── Layer 1: Normal editor content (hidden when a terminal tab is active) ── */}
        <div className="absolute inset-0 flex flex-col" style={{ display: activeTab?.type === 'terminal' ? 'none' : 'flex' }}>
          {!activeTab ? (
            <EditorWelcome />
          ) : activeTab.type === 'commit' && activeTab.commitProps ? (
            <CommitTab hash={activeTab.commitProps.hash} />
          ) : activeTab.type === 'git-graph' ? (
            <GitGraphView />
          ) : activeTab.type === 'db-schema' ? (
            <DbSchemaViewer sourceFile={activeTab.dbSchemaProps?.sourceFile ?? null} />
          ) : activeTab.type === 'memory' && activeTab.memoryProps ? (
            <MemoryViewer memoryId={activeTab.memoryProps.memoryId} />
          ) : activeTab.type === 'sub-agent' && activeTab.subAgentProps ? (
            <SubAgentTabView
              subAgentId={activeTab.subAgentProps.subAgentId}
              conversationId={activeTab.subAgentProps.conversationId}
              snapshot={activeTab.subAgentProps.snapshot}
            />
          ) : activeTab.type === 'release-notes' && activeTab.releaseNotesProps ? (
            <MarkdownViewer
              content={activeTab.releaseNotesProps.body}
              mode={activeTab.markdownMode ?? 'preview'}
              onModeChange={(mode) => setMarkdownMode(activeTab.id, mode)}
              language="markdown"
              filePath={activeTab.id}
              rootPath={rootPath}
              readOnly
            />
          ) : activeTab.type === 'extension-readme' && activeTab.extensionReadmeProps ? (
            <ExtensionReadmeViewer {...activeTab.extensionReadmeProps} />
          ) : activeTab.type === 'history' && activeTab.historyProps ? (
            loading ? (
              <EditorLoading />
            ) : (
              <Suspense fallback={<EditorLoading />}>
                <MonacoEditor
                  path={`history:${activeTab.historyProps.snapshotId}`}
                  language={detectLanguage(activeTab.historyProps.originalPath)}
                  value={activeTab.historyProps.content}
                  theme={monacoTheme}
                  onMount={(editor, monaco) => {
                    monacoInstanceRef.current = monaco;
                    editor.updateOptions({ contextmenu: false, readOnly: true });
                  }}
                  beforeMount={(monaco) => {
                    defineAllMonacoThemes(monaco);
                    registerAllLanguages(monaco);
                  }}
                  options={{
                    readOnly: true,
                    fontFamily: `'${editorFontFamily}', 'JetBrains Mono', 'Fira Code', monospace`,
                    fontSize: editorFontSize,
                    lineHeight: editorLineHeight,
                    minimap: { enabled: editorMinimap, scale: 1 },
                    wordWrap: editorWordWrap,
                    lineNumbers: editorLineNumbers,
                    scrollBeyondLastLine: editorScrollBeyondLastLine,
                    padding: { top: 8 },
                  }}
                />
              </Suspense>
            )
          ) : activeTab.type === 'diff' && activeTab.diffProps ? (
            <DiffViewer
              filePath={activeTab.diffProps.filePath}
              staged={activeTab.diffProps.staged}
              mode={activeTab.diffProps.mode}
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
            ) : loadError ? (
              <EditorLoadError message={loadError} />
            ) : (
              <MarkdownViewer
                content={content ?? ''}
                mode={activeTab.markdownMode ?? 'preview'}
                onModeChange={(mode) => setMarkdownMode(activeTab.id, mode)}
                onSplitRatioChange={(ratio) => setMarkdownSplitRatio(activeTab.id, ratio)}
                onChange={handleEditorChange}
                onEditorMount={handleTextEditorMount}
                onOpenWorkspaceFile={handleOpenWorkspaceFile}
                language={activeTab.language}
                filePath={activeTab.filePath}
                rootPath={rootPath}
                splitRatio={activeTab.markdownSplitRatio ?? 50}
                requestedAnchor={activeTab.markdownAnchor}
                onAnchorHandled={() => setMarkdownAnchor(activeTab.id, undefined)}
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
          ) : activeTab.viewerType === 'db-schema' ? (
            <DbSchemaViewer sourceFile={activeTab.filePath} />
          ) : activeTab.viewerType === 'db' ? (
            <DatabaseViewer filePath={activeTab.filePath} />
          ) : loading ? (
            <EditorLoading />
          ) : loadError ? (
            <EditorLoadError message={loadError} />
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
                      handleTextEditorMount(editor, monaco);
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
                      inlineSuggest: {
                        enabled: inlineCompletionEnabled,
                        mode: 'subwordSmart',
                        showToolbar: 'onHover',
                        suppressSuggestions: false,
                      },
                      padding: { top: 8 },
                      overviewRulerLanes: 3,
                      overviewRulerBorder: false,
                      lineDecorationsWidth: GIT_GUTTER_WIDTH,
                      glyphMargin: false,
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
