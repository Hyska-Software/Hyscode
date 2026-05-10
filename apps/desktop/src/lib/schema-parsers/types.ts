export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  isUnique: boolean;
  defaultValue?: string;
}

export interface SchemaTable {
  id: string;
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaRelation {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /** e.g. "1-N", "N-1", "1-1" */
  cardinality: '1-1' | '1-N' | 'N-1' | 'N-M';
  label?: string;
}

export interface SchemaGraph {
  tables: SchemaTable[];
  relations: SchemaRelation[];
}
