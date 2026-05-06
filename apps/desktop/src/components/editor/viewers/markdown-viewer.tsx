import { Suspense, lazy, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Code, Eye, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import { MARKDOWN_COMPONENTS } from '../../agent/markdown-renderer';
import { defineAllMonacoThemes, getMonacoThemeName } from '../../../lib/monaco-themes';
import { registerAllLanguages, disableNativeTypeScriptValidation } from '@hyscode/lsp-client';
import { LspBridge } from '../../../lib/lsp-bridge';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface MarkdownViewerProps {
  content: string;
  mode: 'preview' | 'code';
  onModeChange: (mode: 'preview' | 'code') => void;
  onChange?: (value: string) => void;
  language?: string;
  filePath?: string;
}

export function MarkdownViewer({
  content,
  mode,
  onModeChange,
  onChange,
  language,
  filePath,
}: MarkdownViewerProps) {
  const themeId = useSettingsStore((s) => s.themeId);
  const monacoTheme = getMonacoThemeName(themeId);

  // Editor settings — same as main editor
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

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) onChange?.(value);
    },
    [onChange],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Mode selector bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 bg-surface-raised px-3">
        <span className="mr-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Markdown
        </span>
        <button
          onClick={() => onModeChange('preview')}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === 'preview'
              ? 'bg-accent/20 text-accent'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Eye className="h-3 w-3" />
          Preview
        </button>
        <button
          onClick={() => onModeChange('code')}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === 'code'
              ? 'bg-accent/20 text-accent'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Code className="h-3 w-3" />
          Code
        </button>
      </div>

      {/* Content area */}
      {mode === 'preview' ? (
        <div className="flex-1 overflow-auto p-6">
          <article className="markdown-preview select-text cursor-text">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[[rehypeKatex], [rehypeHighlight, { ignoreMissing: true }]] as any}
              components={MARKDOWN_COMPONENTS as any}
            >
              {content}
            </ReactMarkdown>
          </article>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <MonacoEditor
              path={filePath}
              language={language ?? 'markdown'}
              value={content}
              onChange={handleEditorChange}
              theme={monacoTheme}
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
      )}
    </div>
  );
}
