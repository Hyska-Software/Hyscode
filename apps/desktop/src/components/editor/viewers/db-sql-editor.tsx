import { useState, useCallback, useRef, useEffect } from 'react';
import { Play, Clock, ChevronUp, ChevronDown, Trash2, Loader2 } from 'lucide-react';
import { useDbViewerStore } from '../../../stores/db-viewer-store';
import { executeQuery, executeUpdate } from '../../../lib/db-engine';
import { DbQueryResult } from './db-query-result';

export function DbSqlEditor() {
  const {
    queryText,
    queryResult,
    queryExecuteResult,
    queryHistory,
    isLoading,
    setQueryText,
    setQueryResult,
    setQueryExecuteResult,
    addToQueryHistory,
    setLoading,
    setError,
  } = useDbViewerStore();

  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [queryText]);

  const handleRun = useCallback(async () => {
    const conn = useDbViewerStore.getState().connection;
    if (!conn || !queryText.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const trimmed = queryText.trim();
      const upper = trimmed.toUpperCase();

      if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA') || upper.startsWith('WITH')) {
        const result = await executeQuery(conn, trimmed);
        setQueryResult(result);
      } else {
        const result = await executeUpdate(conn, trimmed);
        setQueryExecuteResult(result);
      }

      addToQueryHistory(trimmed);
    } catch (err: any) {
      setError(err.message ?? 'Query failed');
      setQueryResult(null);
      setQueryExecuteResult(null);
    } finally {
      setLoading(false);
    }
  }, [queryText, setLoading, setError, setQueryResult, setQueryExecuteResult, addToQueryHistory]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  };

  const selectFromHistory = (query: string) => {
    setQueryText(query);
    setShowHistory(false);
    textareaRef.current?.focus();
  };

  const clearHistory = () => {
    useDbViewerStore.setState((state) => {
      state.queryHistory = [];
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* SQL Input Area */}
      <div className="flex flex-col border-b border-border/40">
        <div className="flex items-center justify-between border-b border-border/40 bg-surface-raised px-3 py-1">
          <span className="text-[11px] font-medium text-muted-foreground">SQL Query</span>
          <div className="flex items-center gap-1">
            {queryHistory.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Clock className="h-3 w-3" />
                History ({queryHistory.length})
                {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={isLoading || !queryText.trim()}
              className="flex items-center gap-1 rounded bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:hover:bg-primary transition-colors"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run
            </button>
          </div>
        </div>

        {/* Query History Dropdown */}
        {showHistory && queryHistory.length > 0 && (
          <div className="max-h-40 overflow-y-auto border-b border-border/40 bg-muted/20">
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-[10px] text-muted-foreground">Recent queries</span>
              <button
                onClick={clearHistory}
                className="flex items-center gap-1 rounded p-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            </div>
            {queryHistory.map((q, i) => (
              <button
                key={i}
                onClick={() => selectFromHistory(q)}
                className="block w-full truncate px-3 py-1 text-left text-[10px] text-foreground/70 hover:bg-muted/40 transition-colors"
                title={q}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="SELECT * FROM ..."
            className="w-full resize-none bg-background p-3 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground/40 outline-none"
            rows={4}
            spellCheck={false}
          />
          <div className="absolute bottom-1 right-2 text-[10px] text-muted-foreground/40">
            Ctrl+Enter to run
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-hidden">
        <DbQueryResult result={queryResult} executeResult={queryExecuteResult} />
      </div>
    </div>
  );
}
