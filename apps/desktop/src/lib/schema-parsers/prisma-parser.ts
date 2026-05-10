import type { SchemaGraph, SchemaTable, SchemaColumn, SchemaRelation } from './types';

/**
 * Parse a Prisma schema file into a SchemaGraph.
 */
export function parsePrismaSchema(content: string): SchemaGraph {
  const tables: SchemaTable[] = [];
  const relations: SchemaRelation[] = [];

  // Match model blocks
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/gs;

  let modelMatch: RegExpExecArray | null;
  while ((modelMatch = modelRegex.exec(content)) !== null) {
    const modelName = modelMatch[1];
    const body = modelMatch[2];
    const tableId = modelName.toLowerCase();

    const columns: SchemaColumn[] = [];
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // Skip block-level attributes (@@...)
      if (line.startsWith('@@') || line.startsWith('//')) continue;

      // Match field: fieldName  FieldType  attributes...
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?\??\s*(.*)?$/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      const rawType = fieldMatch[2];
      const isArray = !!fieldMatch[3];
      const attrs = fieldMatch[4] ?? '';

      // Skip relation fields (relation types are capitalized model names, not scalar types)
      const scalarTypes = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported']);
      const enumLike = /^[A-Z]/.test(rawType) && !scalarTypes.has(rawType);

      if (enumLike && !isArray) {
        // This is a relation field — extract FK info
        // The actual FK column will be in @relation(fields: [...])
        const relMatch = attrs.match(/@relation\s*\(\s*fields:\s*\[([^\]]+)\]\s*,\s*references:\s*\[([^\]]+)\]/);
        if (relMatch) {
          const fromCols = relMatch[1].split(',').map((c) => c.trim());
          const toCols = relMatch[2].split(',').map((c) => c.trim());
          fromCols.forEach((fc, i) => {
            relations.push({
              id: `${tableId}_${fc}_${rawType.toLowerCase()}_${toCols[i] ?? 'id'}`,
              fromTable: tableId,
              fromColumn: fc,
              toTable: rawType.toLowerCase(),
              toColumn: toCols[i] ?? 'id',
              cardinality: 'N-1',
            });
          });
        }
        continue;
      }

      const isPrimary = /@id\b/.test(attrs);
      const isUnique = /@unique\b/.test(attrs);
      const isOptional = line.includes('?');
      const defaultMatch = attrs.match(/@default\(([^)]+)\)/);

      columns.push({
        name: fieldName,
        type: isArray ? `${rawType}[]` : rawType,
        nullable: isOptional,
        isPrimary,
        isForeign: false, // will be set by relation resolution below
        isUnique,
        defaultValue: defaultMatch ? defaultMatch[1] : undefined,
      });
    }

    // Mark columns that appear in relations as foreign keys
    const fromCols = new Set(relations.filter((r) => r.fromTable === tableId).map((r) => r.fromColumn));
    for (const col of columns) {
      if (fromCols.has(col.name)) col.isForeign = true;
    }

    tables.push({ id: tableId, name: modelName, columns });
  }

  return { tables, relations };
}
