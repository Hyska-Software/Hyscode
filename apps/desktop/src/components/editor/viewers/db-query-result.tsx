import { CheckCircle2, Rows3 } from 'lucide-react';
import { formatCellValue } from '../../../lib/db-engine';
import type { QueryResult, ExecuteResult } from '../../../lib/db-engine';

interface DbQueryResultProps {
  result: QueryResult | null;
  executeResult: ExecuteResult | null;
}

export function DbQueryResult({ result, executeResult }: DbQueryResultProps) {
  if (!result && !executeResult) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-xs">Run a query to see results</p>
      </div>
    );
  }

  // Show execute result (INSERT/UPDATE/DELETE)
  if (executeResult) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
          <CheckCircle2 className="h-3 w-3 text-green-500" />
          <span className="text-[11px] text-foreground">Query executed successfully</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {executeResult.rowsAffected} rows affected · {executeResult.durationMs}ms
          </span>
        </div>
      </div>
    );
  }

  // Show select result
  if (result) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
          <Rows3 className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] text-foreground">
            {result.rowCount.toLocaleString()} rows
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {result.durationMs}ms
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          {result.rowCount > 0 ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border/40 bg-muted/50">
                  {result.columns.map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/10 hover:bg-muted/20">
                    {result.columns.map((col) => {
                      const val = row[col];
                      const isNull = val === null || val === undefined;
                      return (
                        <td
                          key={col}
                          className={`whitespace-nowrap px-3 py-1 ${isNull ? 'text-muted-foreground/40 italic' : ''}`}
                        >
                          <span className="block truncate max-w-[300px]" title={formatCellValue(val)}>
                            {isNull ? 'NULL' : formatCellValue(val)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <p className="text-xs">No rows returned</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
