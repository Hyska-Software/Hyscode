import { Suspense, lazy, useCallback, useEffect } from 'react';
import { Code, Columns2, Eye, Loader2 } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useSettingsStore } from '../../../stores';
import type { MarkdownViewMode } from '../../../stores/editor-store';
import { defineAllMonacoThemes, getMonacoThemeName } from '../../../lib/monaco-themes';
import { registerAllLanguages, disableNativeTypeScriptValidation } from '@hyscode/lsp-client';
import { LspBridge } from '../../../lib/lsp-bridge';
import { MarkdownDocumentPreview } from './markdown-document-preview';
import type * as monacoEditor from 'monaco-editor';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

export interface MarkdownViewerProps {
  content: string;
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
  onChange?: (value: string) => void;
  onSplitRatioChange?: (ratio: number) => void;
  onEditorMount?: (
    editor: monacoEditor.editor.IStandaloneCodeEditor | null,
    monaco: typeof monacoEditor | null,
  ) => void;
  onOpenWorkspaceFile?: (path: string, anchor: string | null) => void;
  requestedAnchor?: string;
  onAnchorHandled?: () => void;
  language?: string;
  filePath: string;
  rootPath: string | null;
  readOnly?: boolean;
  splitRatio?: number;
}

interface MarkdownCodeEditorProps {
  content: string;
  filePath: string;
  language: string;
  readOnly: boolean;
  onChange?: (value: string) => void;
  onEditorMount?: MarkdownViewerProps['onEditorMount'];
}

function MarkdownCodeEditor({
  content,
  filePath,
  language,
  readOnly,
  onChange,
  onEditorMount,
}: MarkdownCodeEditorProps) {
  const themeId = useSettingsStore((state) => state.themeId);
  const editorFontSize = useSettingsStore((state) => state.fontSize);
  const editorFontFamily = useSettingsStore((state) => state.fontFamily);
  const editorLineHeight = useSettingsStore((state) => state.lineHeight);
  const editorTabSize = useSettingsStore((state) => state.tabSize);
  const editorInsertSpaces = useSettingsStore((state) => state.insertSpaces);
  const editorWordWrap = useSettingsStore((state) => state.wordWrap);
  const editorMinimap = useSettingsStore((state) => state.minimap);
  const editorLineNumbers = useSettingsStore((state) => state.lineNumbers);
  const editorCursorStyle = useSettingsStore((state) => state.cursorStyle);
  const editorRenderWhitespace = useSettingsStore((state) => state.renderWhitespace);
  const editorBracketPairColorization = useSettingsStore(
    (state) => state.bracketPairColorization,
  );
  const editorScrollBeyondLastLine = useSettingsStore(
    (state) => state.scrollBeyondLastLine,
  );
  const editorSmoothScrolling = useSettingsStore((state) => state.smoothScrolling);
  const editorAutoClosingBrackets = useSettingsStore(
    (state) => state.autoClosingBrackets,
  );
  const editorAutoClosingQuotes = useSettingsStore((state) => state.autoClosingQuotes);
  const editorFormatOnPaste = useSettingsStore((state) => state.formatOnPaste);
  const editorFormatOnType = useSettingsStore((state) => state.formatOnType);
  const monacoTheme = getMonacoThemeName(themeId);

  useEffect(
    () => () => {
      onEditorMount?.(null, null);
    },
    [onEditorMount],
  );

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <MonacoEditor
        path={filePath}
        language={language}
        value={content}
        onChange={(value) => {
          if (!readOnly && value !== undefined) onChange?.(value);
        }}
        theme={monacoTheme}
        beforeMount={(monaco) => {
          defineAllMonacoThemes(monaco);
          registerAllLanguages(monaco);
          disableNativeTypeScriptValidation(monaco);
          LspBridge.setMonaco(monaco);
        }}
        onMount={(editor, monaco) => {
          onEditorMount?.(editor, monaco);
        }}
        options={{
          readOnly,
          domReadOnly: readOnly,
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
  );
}

export function MarkdownViewer({
  content,
  mode,
  onModeChange,
  onChange,
  onSplitRatioChange,
  onEditorMount,
  onOpenWorkspaceFile,
  requestedAnchor,
  onAnchorHandled,
  language = 'markdown',
  filePath,
  rootPath,
  readOnly = false,
  splitRatio = 50,
}: MarkdownViewerProps) {
  const handleLayout = useCallback(
    (sizes: number[]) => {
      const editorRatio = sizes[0];
      if (editorRatio !== undefined) onSplitRatioChange?.(editorRatio);
    },
    [onSplitRatioChange],
  );

  const codeEditor = (
    <MarkdownCodeEditor
      content={content}
      filePath={filePath}
      language={language}
      readOnly={readOnly}
      onChange={onChange}
      onEditorMount={onEditorMount}
    />
  );
  const preview = (
    <MarkdownDocumentPreview
      content={content}
      filePath={filePath}
      rootPath={rootPath}
      requestedAnchor={requestedAnchor}
      onAnchorHandled={onAnchorHandled}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 bg-surface-raised px-3">
        <span className="mr-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Markdown
        </span>
        <button
          type="button"
          onClick={() => onModeChange('preview')}
          aria-pressed={mode === 'preview'}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === 'preview'
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Eye className="h-3 w-3" />
          Preview
        </button>
        <button
          type="button"
          onClick={() => onModeChange('code')}
          aria-pressed={mode === 'code'}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === 'code'
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Code className="h-3 w-3" />
          Code
        </button>
        <button
          type="button"
          onClick={() => onModeChange('split')}
          aria-pressed={mode === 'split'}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === 'split'
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Columns2 className="h-3 w-3" />
          Split
        </button>
        {readOnly && (
          <span className="ml-auto text-[10px] text-muted-foreground">Read only</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'preview' ? (
          preview
        ) : mode === 'code' ? (
          codeEditor
        ) : (
          <PanelGroup direction="horizontal" onLayout={handleLayout}>
            <Panel defaultSize={splitRatio} minSize={20}>
              <div className="h-full overflow-hidden">{codeEditor}</div>
            </Panel>
            <PanelResizeHandle className="group relative w-1.5 bg-border/40 transition-colors hover:bg-primary/40">
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-primary" />
            </PanelResizeHandle>
            <Panel defaultSize={100 - splitRatio} minSize={20}>
              <div className="h-full overflow-hidden">{preview}</div>
            </Panel>
          </PanelGroup>
        )}
      </div>
    </div>
  );
}
