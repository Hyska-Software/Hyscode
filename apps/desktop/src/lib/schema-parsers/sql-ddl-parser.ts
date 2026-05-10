import type { SchemaGraph, SchemaTable, SchemaColumn, SchemaRelation } from './types';

/**
 * Parse SQL DDL content into a SchemaGraph.
 * Handles CREATE TABLE, column definitions, PRIMARY KEY, FOREIGN KEY.
 */
export function parseSqlDdl(content: string): SchemaGraph {
  const tables: SchemaTable[] = [];
  const relations: SchemaRelation[] = [];

  // Strip comments
  const cleaned = content
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Match CREATE TABLE blocks
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([^;]*)\)/gims;

  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(cleaned)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const tableId = tableName.toLowerCase();

    const columns: SchemaColumn[] = [];
    const pkCols = new Set<string>();
    const fkDefs: { fromCol: string; toTable: string; toCol: string }[] = [];

    // Detect inline / table-level PRIMARY KEY
    const pkTableMatch = body.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (pkTableMatch) {
      pkTableMatch[1].split(',').map((c) => c.trim().replace(/["'`]/g, '')).forEach((c) => pkCols.add(c));
    }

    // Detect FOREIGN KEY constraints
    const fkRegex = /FOREIGN\s+KEY\s*\(\s*["'`]?(\w+)["'`]?\s*\)\s+REFERENCES\s+["'`]?(\w+)["'`]?\s*\(\s*["'`]?(\w+)["'`]?\s*\)/gi;
    let fkMatch: RegExpExecArray | null;
    while ((fkMatch = fkRegex.exec(body)) !== null) {
      fkDefs.push({ fromCol: fkMatch[1], toTable: fkMatch[2], toCol: fkMatch[3] });
    }

    // Parse column lines (skip constraint lines)
    const lines = body.split(',').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Skip table-level constraints
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)\s/i.test(line)) continue;

      const colMatch = line.match(/^["'`]?(\w+)["'`]?\s+([A-Z][A-Z0-9_()[\], ]*?)(?:\s+(NOT\s+NULL|NULL|DEFAULT\s+\S+|UNIQUE|PRIMARY\s+KEY|AUTO_INCREMENT|AUTOINCREMENT|SERIAL|GENERATED\s+ALWAYS))*\s*$/i);
      if (!colMatch) continue;

      const colName = colMatch[1];
      const colType = colMatch[2].trim().toUpperCase();
      const rest = line.slice(colMatch[1].length + colMatch[2].length + 1).toUpperCase();

      const isPrimaryInline = /PRIMARY\s+KEY/i.test(rest) || pkCols.has(colName);
      if (isPrimaryInline) pkCols.add(colName);

      columns.push({
        name: colName,
        type: colType.split(/\s/)[0],
        nullable: !/NOT\s+NULL/i.test(rest) && !isPrimaryInline,
        isPrimary: isPrimaryInline,
        isForeign: fkDefs.some((f) => f.fromCol === colName),
        isUnique: /UNIQUE/i.test(rest),
        defaultValue: (() => {
          const d = rest.match(/DEFAULT\s+(\S+)/i);
          return d ? d[1] : undefined;
        })(),
      });
    }

    tables.push({ id: tableId, name: tableName, columns });

    // Add relations from FK defs
    for (const fk of fkDefs) {
      relations.push({
        id: `${tableId}_${fk.fromCol}_${fk.toTable.toLowerCase()}_${fk.toCol}`,
        fromTable: tableId,
        fromColumn: fk.fromCol,
        toTable: fk.toTable.toLowerCase(),
        toColumn: fk.toCol,
        cardinality: 'N-1',
      });
    }
  }

  return { tables, relations };
}
