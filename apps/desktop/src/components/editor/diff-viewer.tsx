import { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useGitStore, useSettingsStore } from '../../stores';
import { defineAllMonacoThemes, getMonacoThemeName } from '../../lib/monaco-themes';

const MonacoDiffEditor = lazy(
  () => import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor })),
);

function DiffLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

interface DiffViewerProps {
  filePath: string;
  staged: boolean;
}

export function DiffViewer({ filePath, staged }: DiffViewerProps) {
  const getFileContent = useGitStore((s) => s.getFileContent);
  const themeId = useSettingsStore((s) => s.themeId);
  const monacoTheme = getMonacoThemeName(themeId);
  const [original, setOriginal] = useState<string>('');
  const [modified, setModified] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getFileContent(filePath)
      .then((content) => {
        if (cancelled) return;
        setOriginal(content.original);
        setModified(content.modified);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filePath, staged, getFileContent]);

  if (loading) return <DiffLoading />;
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-[11px] text-destructive">
        {error}
      </div>
    );
  }

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact',
    js: 'javascript', jsx: 'javascriptreact',
    json: 'json', md: 'markdown', css: 'css', html: 'html',
    rs: 'rust', py: 'python', toml: 'toml', yaml: 'yaml',
    yml: 'yaml', sql: 'sql', sh: 'shell',
  };
  const language = langMap[ext] || 'plaintext';

  return (
    <div className="flex-1 overflow-hidden">
      <Suspense fallback={<DiffLoading />}>
        <MonacoDiffEditor
          original={original}
          modified={modified}
          language={language}
          theme={monacoTheme}
          beforeMount={defineAllMonacoThemes}
          options={{
            fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 14,
            lineHeight: 1.6,
            readOnly: true,
            renderSideBySide: true,
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            minimap: { enabled: false },
            padding: { top: 8 },
            overviewRulerLanes: 0,
            overviewRulerBorder: false,
          }}
        />
      </Suspense>
    </div>
  );
}
