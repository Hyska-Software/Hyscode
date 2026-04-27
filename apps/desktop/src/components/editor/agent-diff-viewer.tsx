import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { defineAllMonacoThemes, getMonacoThemeName } from '@/lib/monaco-themes';
import type { PendingFileChange } from '@/stores/agent-store';

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor })),
);

function DiffLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  rs: 'rust',
  py: 'python',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sh: 'shell',
};

interface AgentDiffViewerProps {
  change: PendingFileChange;
}

export function AgentDiffViewer({ change }: AgentDiffViewerProps) {
  const ext = change.filePath.split('.').pop()?.toLowerCase() ?? '';
  const language = LANG_MAP[ext] || 'plaintext';
  const themeId = useSettingsStore((s) => s.themeId);
  const monacoTheme = getMonacoThemeName(themeId);
  const editorFontSize = useSettingsStore((s) => s.fontSize);
  const editorFontFamily = useSettingsStore((s) => s.fontFamily);
  const editorLineHeight = useSettingsStore((s) => s.lineHeight);
  const editorMinimap = useSettingsStore((s) => s.minimap);
  const editorWordWrap = useSettingsStore((s) => s.wordWrap);
  const editorLineNumbers = useSettingsStore((s) => s.lineNumbers);
  const editorScrollBeyondLastLine = useSettingsStore((s) => s.scrollBeyondLastLine);
  const editorSmoothScrolling = useSettingsStore((s) => s.smoothScrolling);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<DiffLoading />}>
          <MonacoDiffEditor
            original={change.originalContent ?? ''}
            modified={change.newContent}
            language={language}
            theme={monacoTheme}
            beforeMount={defineAllMonacoThemes}
            options={{
              fontFamily: `'${editorFontFamily}', 'JetBrains Mono', 'Fira Code', monospace`,
              fontSize: editorFontSize,
              lineHeight: editorLineHeight,
              readOnly: true,
              renderSideBySide: false,
              scrollBeyondLastLine: editorScrollBeyondLastLine,
              smoothScrolling: editorSmoothScrolling,
              wordWrap: editorWordWrap,
              lineNumbers: editorLineNumbers,
              minimap: { enabled: editorMinimap, scale: 1 },
              padding: { top: 8 },
              overviewRulerLanes: 0,
              overviewRulerBorder: false,
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
