import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, FileText, Loader2 } from 'lucide-react';
import { tauriFs, type SearchResult } from '../../../lib/tauri-fs';
import { useFileStore, useEditorStore } from '../../../stores';
import { getViewerType } from '../../../lib/utils';

export function SearchView() {
  const rootPath = useFileStore((s) => s.rootPath);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Invalidate any in-flight search so a late resolve cannot clobber new state.
      generationRef.current += 1;
    };
  }, []);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      const gen = ++generationRef.current;
      if (!rootPath || !searchQuery.trim()) {
        setResults([]);
        setHasSearched(false);
        setError(null);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setHasSearched(true);
      setError(null);

      try {
        const res = await tauriFs.searchFiles(rootPath, searchQuery.trim(), 100);
        if (gen !== generationRef.current) return;
        setResults(res);
      } catch {
        if (gen !== generationRef.current) return;
        setResults([]);
        setError('Busca falhou');
      } finally {
        if (gen === generationRef.current) setIsSearching(false);
      }
    },
    [rootPath],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => performSearch(value), 300);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setError(null);
    generationRef.current += 1;
  };

  const handleResultClick = (result: SearchResult) => {
    const fileName = result.path.split(/[\\/]/).pop() ?? result.path;
    const tabs = useEditorStore.getState().tabs;
    const existing = tabs.find((t) => t.filePath === result.path);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      useEditorStore.getState().openTab({
        id: result.path,
        filePath: result.path,
        fileName,
        language: 'plaintext',
        viewerType: getViewerType(fileName),
      });
    }
  };

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.path]) acc[r.path] = [];
    acc[r.path].push(r);
    return acc;
  }, {});

  if (!rootPath) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <Search className="mb-3 h-8 w-8 opacity-30" />
        <p className="text-xs">Open a folder to search</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search input */}
      <div className="flex items-center gap-1 bg-surface-raised px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search files..."
          className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          autoFocus
        />
        {query && (
          <button
            onClick={handleClear}
            aria-label="Limpar busca"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        <div aria-live="polite" className="sr-only">
          {isSearching ? 'Searching...' : error ?? (hasSearched ? `${results.length} results` : '')}
        </div>
        {isSearching && (
          <div className="flex items-center gap-2 px-3 py-4 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[11px]">Searching...</span>
          </div>
        )}

        {error && !isSearching && (
          <div role="alert" className="px-3 py-4 text-center text-[11px] text-destructive">
            {error}
          </div>
        )}

        {!isSearching && !error && hasSearched && results.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            No results found
          </div>
        )}

        {!isSearching &&
          !error &&
          Object.entries(grouped).map(([filePath, fileResults]) => {
            const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
            const relativePath = rootPath
              ? filePath.replace(rootPath, '').replace(/^[\\/]/, '')
              : filePath;

            return (
              <div key={filePath} className="">
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-[11px] font-medium text-foreground">{fileName}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{relativePath}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {fileResults.length}
                  </span>
                </div>
                {fileResults.map((r, i) => (
                  <button
                    key={`${r.line_number}-${i}`}
                    onClick={() => handleResultClick(r)}
                    className="flex w-full items-start gap-2 px-4 py-0.5 text-left text-[11px] hover:bg-muted transition-colors"
                  >
                    <span className="shrink-0 text-muted-foreground w-6 text-right">
                      {r.line_number}
                    </span>
                    <span className="truncate text-foreground">{r.line_content}</span>
                  </button>
                ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
