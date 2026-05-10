export type { SchemaGraph, SchemaTable, SchemaColumn, SchemaRelation } from './types';
export { parseSqlDdl } from './sql-ddl-parser';
export { parsePrismaSchema } from './prisma-parser';
export { parseDrizzleSchema } from './drizzle-parser';

import type { SchemaGraph } from './types';
import { parseSqlDdl } from './sql-ddl-parser';
import { parsePrismaSchema } from './prisma-parser';
import { parseDrizzleSchema } from './drizzle-parser';

export type SchemaSourceType = 'sql' | 'prisma' | 'drizzle' | 'unknown';

export function detectSourceType(filePath: string, content?: string): SchemaSourceType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'sql') return 'sql';
  if (ext === 'prisma') return 'prisma';
  if (ext === 'ts' || ext === 'js') {
    if (content?.includes('drizzle-orm')) return 'drizzle';
  }
  return 'unknown';
}

export function parseSchema(content: string, type: SchemaSourceType): SchemaGraph {
  switch (type) {
    case 'sql': return parseSqlDdl(content);
    case 'prisma': return parsePrismaSchema(content);
    case 'drizzle': return parseDrizzleSchema(content);
    default: return { tables: [], relations: [] };
  }
}
