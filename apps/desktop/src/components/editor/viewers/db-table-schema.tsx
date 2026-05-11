import { KeyRound, Hash, ArrowRightLeft, ListTree } from 'lucide-react';
import type { DbTableInfo } from '../../../lib/db-engine';

interface DbTableSchemaProps {
  tableInfo: DbTableInfo;
}

export function DbTableSchema({ tableInfo }: DbTableSchemaProps) {
  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      {/* Columns */}
      <section className="mb-6">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          Columns ({tableInfo.columns.length})
        </h3>
        <div className="overflow-hidden rounded border border-border/40">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/40 bg-muted/30">
                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-1.5 text-center font-medium text-muted-foreground w-16">PK</th>
                <th className="px-3 py-1.5 text-center font-medium text-muted-foreground w-16">NN</th>
                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Default</th>
              </tr>
            </thead>
            <tbody>
              {tableInfo.columns.map((col) => (
                <tr key={col.name} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-medium text-foreground">
                    <div className="flex items-center gap-1">
                      {col.isPk && <KeyRound className="h-3 w-3 text-amber-500" />}
                      {col.name}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground font-mono">{col.type}</td>
                  <td className="px-3 py-1.5 text-center">
                    {col.isPk ? (
                      <span className="inline-flex h-4 items-center rounded bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-600">
                        PK
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">-</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {col.notNull ? (
                      <span className="inline-flex h-4 items-center rounded bg-red-500/10 px-1.5 text-[10px] font-medium text-red-600">
                        NN
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">-</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {col.defaultValue ?? <span className="text-muted-foreground/30">NULL</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Foreign Keys */}
      {tableInfo.foreignKeys.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
            Foreign Keys ({tableInfo.foreignKeys.length})
          </h3>
          <div className="overflow-hidden rounded border border-border/40">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Column</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">References</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Target Column</th>
                </tr>
              </thead>
              <tbody>
                {tableInfo.foreignKeys.map((fk) => (
                  <tr key={`${fk.fromCol}-${fk.toTable}`} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium text-foreground">{fk.fromCol}</td>
                    <td className="px-3 py-1.5 text-primary font-medium">{fk.toTable}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{fk.toCol}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Indexes */}
      {tableInfo.indexes.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
            Indexes ({tableInfo.indexes.length})
          </h3>
          <div className="overflow-hidden rounded border border-border/40">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Columns</th>
                  <th className="px-3 py-1.5 text-center font-medium text-muted-foreground w-16">Unique</th>
                  <th className="px-3 py-1.5 text-center font-medium text-muted-foreground w-16">Partial</th>
                </tr>
              </thead>
              <tbody>
                {tableInfo.indexes.map((idx) => (
                  <tr key={idx.name} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium text-foreground">{idx.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{idx.columns.join(', ')}</td>
                    <td className="px-3 py-1.5 text-center">
                      {idx.unique ? (
                        <span className="inline-flex h-4 items-center rounded bg-green-500/10 px-1.5 text-[10px] font-medium text-green-600">
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">No</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {idx.partial ? (
                        <span className="inline-flex h-4 items-center rounded bg-blue-500/10 px-1.5 text-[10px] font-medium text-blue-600">
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Row count */}
      <section>
        <div className="text-[11px] text-muted-foreground">
          Total rows: <span className="font-medium text-foreground">{tableInfo.rowCount.toLocaleString()}</span>
        </div>
      </section>
    </div>
  );
}
