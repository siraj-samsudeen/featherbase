// EDS (spec 0001) / M3 (execution plan): the storage-adapter seam. A Table
// whose table_def carries a data_source is "bound" — its rows live in an
// external store and every read/write goes through one of these drivers
// instead of the control database. Drivers receive source-column names only;
// the column_name<->source_column mapping is the dispatcher's job.

export type SourceEngine = 'postgres' | 'mysql' | 'duckdb' | 'csv-folder'
export type SourceAccess = 'read_only' | 'read_write'

// Hard per-engine write capability (mirrors each driver's `writable` flag,
// kept here dependency-free so meta enrichment can consult it without
// loading driver modules). A source is effectively writable only when the
// engine can write AND access is read_write.
export const ENGINE_WRITABLE: Record<SourceEngine, boolean> = {
  postgres: true,
  mysql: true,
  duckdb: false,
  'csv-folder': true,
}

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

// EDS-6: the shape of a write the data source refused for a constraint
// reason. The codes are Postgres SQLSTATEs: the postgres driver passes its
// own errors through as they are, and every other driver translates its
// dialect into them (mysql: errno -> code). `column_name` is the SOURCE
// column when the source names one; the dispatcher translates it to the
// field (explainRefusal in dispatch.ts). `message` is the driver's raw text,
// for the server log only.
export const REFUSAL_CODE = {
  unique: '23505',
  notNull: '23502',
  foreignKey: '23503',
  check: '23514',
  tooLong: '22001',
  outOfRange: '22003',
  invalidText: '22P02',
} as const

export interface SourceRefusal extends Error {
  code: (typeof REFUSAL_CODE)[keyof typeof REFUSAL_CODE]
  column_name?: string
  constraint_name?: string
  // Postgres's detail line, "Key (col, ...)=(value, ...) ..."; the mysql
  // driver writes one for a unique refusal.
  detail?: string
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
  // 'in_or_null' is internal-only (never accepted from callers): Data Scope
  // narrowing on Reference columns, matching the native scopedWhere's
  // "(col is null or col in ...)" semantics.
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'like' | 'not like' | 'in' | 'not in' | 'in_or_null'
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
  // Single-column foreign key edge this column carries, engine-neutrally:
  // the referenced relation and column on the SAME source. Composite FKs are
  // not reported (they cannot become a Reference). Drivers that cannot read
  // FK metadata simply omit it.
  references?: { schema: string; table: string; column: string } | null
}

export interface IntrospectedTable {
  schema: string
  table: string
  pk: string | null // single-column primary key; null = not bindable
  columns: IntrospectedColumn[]
}

// #625 (design E3): which rows of an app's declared dataset query a read may
// see. A row passes when it matches every condition in `all` and every
// condition of at least one group in `any`. No group means no row: the
// reader's scope fails closed. Values are compared as text.
export interface DatasetCondition {
  column: string // a declared column, validated against the declaration
  values: string[]
}
export interface DatasetWhere {
  any: DatasetCondition[][]
  all: DatasetCondition[]
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
  // expectModified: the revision the caller loaded (same semantics as
  // update); 'conflict' when the store changed since, 'missing' when the pk
  // no longer resolves. Drivers without a revision notion may ignore it.
  remove(bind: Binding, pk: string, expectModified: string | null): Promise<void | 'conflict' | 'missing'>
  // Drop any cached pool/instance for this source (config changed).
  dispose(sourceName: string): void
  // #625: run an app's declared dataset query, read-only, limited to `where`
  // (the whole result when omitted: a snapshot build). Engines without it
  // cannot back a dataset.
  query?(source: SourceConfig, text: string, where?: DatasetWhere): Promise<SourceRow[]>
}
