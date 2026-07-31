// EDS (spec 0001) / M3 (execution plan): the storage-adapter seam. A Table
// whose table_def carries a data_source is "bound" — its rows live in an
// external store and every read/write goes through one of these drivers
// instead of the control database. Drivers receive source-column names only;
// the column_name<->source_column mapping is the dispatcher's job.

export type SourceEngine = 'postgres' | 'duckdb' | 'csv-folder'
export type SourceAccess = 'read_only' | 'read_write'

export interface SourceConfig {
  name: string
  engine: SourceEngine
  // Name of the environment variable holding the connection string/token —
  // the value itself is never stored (spec BV7!).
  url_env: string | null
  // csv-folder only: absolute path of the folder (not a secret).
  root_path: string | null
  default_schema: string | null
  access: SourceAccess
  pool_max: number
  statement_timeout_ms: number
  // Newline-separated "schema.table" entries; null = everything allowed.
  allowlist: string[] | null
}

// The per-Table binding the dispatcher hands a driver, resolved from
// table_def.data_source/external_* and column_def.source_column.
export interface Binding {
  source: SourceConfig
  schema: string
  table: string
  pk: string
  // Source column used for optimistic locking and the synthesized
  // updated_at ('_mtime' on csv-folder = the file's mtime).
  modified: string | null
  columns: { column_name: string; source_column: string; column_type: string }[]
}

export interface SourceFilter {
  column: string // source column name, already validated against the binding
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'like' | 'not like' | 'in' | 'not in'
  value: unknown
}

export interface ListSpec {
  filters: SourceFilter[]
  columns: string[] // source columns to select (pk always included)
  order: { column: string; dir: 'asc' | 'desc' }
  limit: number
  offset: number
}

export type SourceRow = Record<string, unknown>

export interface IntrospectedColumn {
  name: string
  data_type: string
  nullable: boolean
  has_default: boolean
  is_pk: boolean
  // Featherbase column type the reflector proposes for this column.
  column_type: string
  max_length?: number | null
}

export interface IntrospectedTable {
  schema: string
  table: string
  pk: string | null // single-column primary key; null = not bindable
  columns: IntrospectedColumn[]
}

export interface SourceDriver {
  engine: SourceEngine
  // Whether the driver implements insert/update/remove at all. A source's
  // access mode further restricts writes; this is the hard capability.
  writable: boolean
  test(source: SourceConfig): Promise<void>
  introspect(source: SourceConfig, schema?: string): Promise<IntrospectedTable[]>
  getList(bind: Binding, spec: ListSpec): Promise<{ rows: SourceRow[]; total: number }>
  getDoc(bind: Binding, pk: string): Promise<SourceRow | null>
  count(bind: Binding, filters: SourceFilter[]): Promise<number>
  groupCount(
    bind: Binding,
    column: string,
    filters: SourceFilter[],
  ): Promise<{ label: string; value: number }[]>
  insert(bind: Binding, values: SourceRow, pkValue: string | null): Promise<SourceRow>
  // expectModified: the modified value the client loaded; 'conflict' when the
  // row changed since, 'missing' when the pk no longer exists.
  update(
    bind: Binding,
    pk: string,
    values: SourceRow,
    expectModified: string | null,
  ): Promise<SourceRow | 'conflict' | 'missing'>
  remove(bind: Binding, pk: string): Promise<void>
  // Drop any cached pool/instance for this source (config changed).
  dispose(sourceName: string): void
}
