import Database from '@tauri-apps/plugin-sql';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DbColumn {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  isPk: boolean;
}

export interface DbForeignKey {
  id: number;
  seq: number;
  toTable: string;
  fromCol: string;
  toCol: string;
}

export interface DbIndex {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
}

export interface DbTableInfo {
  name: string;
  columns: DbColumn[];
  foreignKeys: DbForeignKey[];
  indexes: DbIndex[];
  rowCount: number;
}

export interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
}

export interface ExecuteResult {
  rowsAffected: number;
  durationMs: number;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export type DbType = 'sqlite' | 'mysql' | 'postgresql';

export interface DbConnection {
  id: string;
  db: Database;
  type: DbType;
  name: string;
  path?: string;
}

const connections = new Map<string, DbConnection>();
const pathConnections = new Map<string, DbConnection>();

function generateConnectionId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Connect to a SQLite database file. Reuses existing connection for the same path. */
export async function connectSQLite(filePath: string): Promise<DbConnection> {
  // Reuse existing connection for this path to avoid "closed pool" issues
  const existing = pathConnections.get(filePath);
  if (existing) {
    console.log('[db-engine] Reusing existing connection for:', filePath);
    return existing;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  console.log('[db-engine] Connecting to SQLite:', normalizedPath);
  const db = await Database.load(`sqlite:${normalizedPath}`);
  console.log('[db-engine] Database.load succeeded');

  // Validate connection with a simple query
  try {
    const test = await db.select<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
    console.log('[db-engine] Connection validated, sample table:', test[0]?.name ?? 'none');
  } catch (e: any) {
    console.error('[db-engine] Connection validation failed:', e);
    throw new Error(`Connected but validation query failed: ${e.message}`);
  }

  const id = generateConnectionId();
  const name = normalizedPath.split('/').pop() ?? 'database.db';
  const conn: DbConnection = { id, db, type: 'sqlite', name, path: filePath };
  connections.set(id, conn);
  pathConnections.set(filePath, conn);
  return conn;
}

/** Close a connection — NOTE: we do NOT call db.close() because tauri-plugin-sql
 *  reuses connections per path internally. Closing it would kill the shared pool
 *  and cause "attempted to acquire a connection on a closed pool" on remounts.
 *  We just remove from our tracking maps and let the plugin manage lifecycle.
 */
export async function closeConnection(id: string): Promise<void> {
  const conn = connections.get(id);
  if (!conn) return;
  connections.delete(id);
  if (conn.path) {
    pathConnections.delete(conn.path);
  }
  // Do NOT call conn.db.close() — tauri-plugin-sql manages the pool
}

/** Get an existing connection */
export function getConnection(id: string): DbConnection | undefined {
  return connections.get(id);
}

/** List all tables in a SQLite database */
export async function getTables(conn: DbConnection): Promise<string[]> {
  console.log('[db-engine] getTables called');
  const rows = await conn.db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  console.log('[db-engine] getTables returned', rows.length, 'tables');
  return rows.map((r) => r.name);
}

/** List all views in a SQLite database */
export async function getViews(conn: DbConnection): Promise<string[]> {
  console.log('[db-engine] getViews called');
  const rows = await conn.db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='view' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  console.log('[db-engine] getViews returned', rows.length, 'views');
  return rows.map((r) => r.name);
}

/** Get full schema for a specific table using only the plugin connection */
export async function getTableSchema(conn: DbConnection, tableName: string): Promise<DbTableInfo> {
  console.log('[db-engine] getTableSchema for:', tableName);
  // Columns via PRAGMA table_info
  const colRows = await conn.db.select<
    Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>
  >(`PRAGMA table_info("${tableName}")`);
  console.log('[db-engine] table_info returned', colRows.length, 'columns');

  const columns: DbColumn[] = colRows.map((c) => ({
    cid: c.cid,
    name: c.name,
    type: c.type,
    notNull: c.notnull === 1,
    defaultValue: c.dflt_value,
    isPk: c.pk === 1,
  }));

  // Foreign keys via PRAGMA foreign_key_list
  const fkRows = await conn.db.select<
    Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
    }>
  >(`PRAGMA foreign_key_list("${tableName}")`);

  const foreignKeys: DbForeignKey[] = fkRows.map((fk) => ({
    id: fk.id,
    seq: fk.seq,
    toTable: fk.table,
    fromCol: fk.from,
    toCol: fk.to,
  }));

  // Indexes via PRAGMA index_list + index_info
  const indexList = await conn.db.select<
    Array<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>
  >(`PRAGMA index_list("${tableName}")`);

  const indexes: DbIndex[] = [];
  for (const idx of indexList) {
    const info = await conn.db.select<Array<{ name: string }>>(
      `PRAGMA index_info("${idx.name}")`
    );
    indexes.push({
      name: idx.name,
      unique: idx.unique === 1,
      origin: idx.origin,
      partial: idx.partial === 1,
      columns: info.map((c) => c.name),
    });
  }

  // Row count
  const countResult = await conn.db.select<Array<{ count: number }>>(
    `SELECT COUNT(*) as count FROM "${tableName}"`
  );
  const rowCount = countResult[0]?.count ?? 0;

  console.log('[db-engine] getTableSchema complete:', { columns: columns.length, fks: foreignKeys.length, indexes: indexes.length, rowCount });
  return {
    name: tableName,
    columns,
    foreignKeys,
    indexes,
    rowCount,
  };
}

/** Get paginated data from a table */
export async function getTableData(
  conn: DbConnection,
  tableName: string,
  page: number,
  pageSize: number,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  console.log('[db-engine] getTableData for:', tableName, 'page:', page, 'size:', pageSize);
  const offset = page * pageSize;
  const [data, countResult] = await Promise.all([
    conn.db.select<Array<Record<string, unknown>>>(`SELECT * FROM "${tableName}" LIMIT ${pageSize} OFFSET ${offset}`),
    conn.db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM "${tableName}"`),
  ]);
  console.log('[db-engine] getTableData returned', data.length, 'rows, total:', countResult[0]?.count ?? 0);
  return { rows: data, total: countResult[0]?.count ?? 0 };
}

/** Execute a SELECT query */
export async function executeQuery(conn: DbConnection, sql: string): Promise<QueryResult> {
  const start = performance.now();
  const rows = await conn.db.select<Array<Record<string, unknown>>>(sql);
  const duration = performance.now() - start;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return {
    columns,
    rows,
    rowCount: rows.length,
    durationMs: Math.round(duration * 100) / 100,
  };
}

/** Execute an INSERT/UPDATE/DELETE query */
export async function executeUpdate(conn: DbConnection, sql: string): Promise<ExecuteResult> {
  const start = performance.now();
  const result = await conn.db.execute(sql);
  const duration = performance.now() - start;

  return {
    rowsAffected: result.rowsAffected,
    durationMs: Math.round(duration * 100) / 100,
  };
}

/** Update a single cell value */
export async function updateCell(
  conn: DbConnection,
  tableName: string,
  column: string,
  value: unknown,
  whereClause: string,
): Promise<number> {
  const sql = `UPDATE "${tableName}" SET "${column}" = ? WHERE ${whereClause}`;
  const result = await conn.db.execute(sql, [value]);
  return result.rowsAffected;
}

/** Delete rows */
export async function deleteRows(conn: DbConnection, tableName: string, whereClause: string): Promise<number> {
  const sql = `DELETE FROM "${tableName}" WHERE ${whereClause}`;
  const result = await conn.db.execute(sql);
  return result.rowsAffected;
}

/** Get CREATE TABLE DDL */
export async function getTableDdl(conn: DbConnection, tableName: string): Promise<string | null> {
  const rows = await conn.db.select<{ sql: string | null }[]>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
    [tableName],
  );
  return rows[0]?.sql ?? null;
}

/** Get table row count */
export async function getRowCount(conn: DbConnection, tableName: string): Promise<number> {
  const rows = await conn.db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM "${tableName}"`);
  return rows[0]?.count ?? 0;
}

/** Build a WHERE clause for a row based on PK columns */
export function buildWhereClause(
  columns: DbColumn[],
  row: Record<string, unknown>,
): { clause: string; values: unknown[] } {
  const pkCols = columns.filter((c) => c.isPk);
  const colsToUse = pkCols.length > 0 ? pkCols : columns.slice(0, 3); // fallback to first 3 cols

  const conditions: string[] = [];
  const values: unknown[] = [];

  for (const col of colsToUse) {
    conditions.push(`"${col.name}" = ?`);
    values.push(row[col.name] ?? null);
  }

  return { clause: conditions.join(' AND '), values };
}

/** Format cell value for display */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return `<BLOB: ${value.length} bytes>`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.length > 200) return value.slice(0, 200) + '…';
    return value;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Get column type for input rendering */
export function getInputType(sqlType: string): 'text' | 'number' | 'checkbox' {
  const t = sqlType.toUpperCase();
  if (t.includes('INT') || t.includes('REAL') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('NUMERIC') || t.includes('DECIMAL')) {
    return 'number';
  }
  if (t.includes('BOOL')) {
    return 'checkbox';
  }
  return 'text';
}
