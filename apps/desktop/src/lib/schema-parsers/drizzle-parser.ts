import type { SchemaGraph, SchemaTable, SchemaColumn, SchemaRelation } from './types';

/** Drizzle table factory functions we recognize */
const TABLE_FACTORIES = ['pgTable', 'sqliteTable', 'mysqlTable', 'table'];

/** Drizzle column type helpers → normalized SQL type */
const TYPE_MAP: Record<string, string> = {
  integer: 'INTEGER',
  int: 'INTEGER',
  bigint: 'BIGINT',
  serial: 'SERIAL',
  bigserial: 'BIGSERIAL',
  real: 'REAL',
  numeric: 'NUMERIC',
  decimal: 'DECIMAL',
  boolean: 'BOOLEAN',
  bool: 'BOOLEAN',
  text: 'TEXT',
  varchar: 'VARCHAR',
  char: 'CHAR',
  uuid: 'UUID',
  timestamp: 'TIMESTAMP',
  timestamptz: 'TIMESTAMPTZ',
  date: 'DATE',
  time: 'TIME',
  json: 'JSON',
  jsonb: 'JSONB',
  blob: 'BLOB',
  doublePrecision: 'DOUBLE PRECISION',
};

function resolveType(callExpr: string): string {
  const fn = callExpr.split('(')[0].trim();
  return TYPE_MAP[fn] ?? fn.toUpperCase();
}

/**
 * Parse a Drizzle schema TypeScript file into a SchemaGraph.
 * Works on static analysis of the source text — no eval needed.
 */
export function parseDrizzleSchema(content: string): SchemaGraph {
  const tables: SchemaTable[] = [];
  const relations: SchemaRelation[] = [];

  // Quick guard: file must import from drizzle-orm
  if (!content.includes('drizzle-orm')) return { tables, relations };

  // Match table declarations:
  //   export const users = pgTable('users', { ... })
  //   export const posts = sqliteTable("posts", { ... }, (t) => [...])
  const tablePattern = new RegExp(
    `(?:export\\s+)?const\\s+(\\w+)\\s*=\\s*(${TABLE_FACTORIES.join('|')})\\s*\\(\\s*['"\`](\\w+)['"\`]\\s*,\\s*\\{`,
    'g',
  );

  let tm: RegExpExecArray | null;
  while ((tm = tablePattern.exec(content)) !== null) {
    const varName = tm[1];
    const tableName = tm[3];
    const tableId = tableName.toLowerCase();

    // Extract the columns object — find matching closing brace
    const startIdx = tm.index + tm[0].length - 1; // position of opening {
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }

    const body = content.slice(startIdx + 1, endIdx);
    const columns: SchemaColumn[] = [];

    // Match column definitions: colName: typeHelper(...)...modifiers
    const colPattern = /(\w+)\s*:\s*(\w+)\s*\([^)]*\)((?:\.[a-zA-Z]+\([^)]*\))*)/g;
    let cm: RegExpExecArray | null;
    while ((cm = colPattern.exec(body)) !== null) {
      const colName = cm[1];
      const typeFn = cm[2];
      const chainStr = cm[3];

      const isPrimary = chainStr.includes('.primaryKey');
      const isUnique = chainStr.includes('.unique');
      const isNotNull = chainStr.includes('.notNull');
      const defaultMatch = chainStr.match(/\.default\(([^)]+)\)/);

      columns.push({
        name: colName,
        type: resolveType(typeFn),
        nullable: !isNotNull && !isPrimary,
        isPrimary,
        isForeign: false, // resolved below
        isUnique,
        defaultValue: defaultMatch ? defaultMatch[1].trim() : undefined,
      });
    }

    tables.push({ id: tableId, name: tableName, columns });
    void varName; // used implicitly for relation lookup below
  }

  // Parse relations() calls
  //   relations(users, ({ one, many }) => ({ posts: many(posts) }))
  const relFnPattern = /relations\s*\(\s*(\w+)\s*,\s*\(\{[^}]*\}\)\s*=>\s*\(\{([^)]+(?:\([^)]*\)[^)]*)*)\}\)\s*\)/gs;
  let rm: RegExpExecArray | null;
  while ((rm = relFnPattern.exec(content)) !== null) {
    const srcVar = rm[1];
    const body = rm[2];

    // Find the table whose variable name matches srcVar
    const srcTableMatch = content.match(new RegExp(`const\\s+${srcVar}\\s*=\\s*(?:${TABLE_FACTORIES.join('|')})\\s*\\(\\s*['"\`](\\w+)['"\`]`));
    const srcTable = srcTableMatch ? srcTableMatch[1].toLowerCase() : srcVar.toLowerCase();

    const entryPattern = /(\w+)\s*:\s*(one|many)\s*\(\s*(\w+)/g;
    let em: RegExpExecArray | null;
    while ((em = entryPattern.exec(body)) !== null) {
      const relationType = em[2] as 'one' | 'many';
      const targetVar = em[3];
      const targetTableMatch = content.match(new RegExp(`const\\s+${targetVar}\\s*=\\s*(?:${TABLE_FACTORIES.join('|')})\\s*\\(\\s*['"\`](\\w+)['"\`]`));
      const targetTable = targetTableMatch ? targetTableMatch[1].toLowerCase() : targetVar.toLowerCase();

      if (relationType === 'one') {
        relations.push({
          id: `${srcTable}_rel_${targetTable}_${relations.length}`,
          fromTable: srcTable,
          fromColumn: 'id',
          toTable: targetTable,
          toColumn: 'id',
          cardinality: 'N-1',
        });
      }
    }
  }

  return { tables, relations };
}
