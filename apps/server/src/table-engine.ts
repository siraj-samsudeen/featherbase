import { z } from 'zod'
import { DEFAULT_ID_PATTERN, namingColumn, prettifyLabel, tableSlug } from 'shared'
import { inAppTransaction, sql, type TxSql } from './db'
import { AppError } from './errors'
import { assertNotSystemWritten } from './system-written'
import { DELETED_AT_SOURCE } from './sources/table-copy'
import { COLUMN_TYPE_VALUES, ROW_KEY, type TableMeta, getMeta, invalidateMeta } from './meta'
import { accessPolicySchema, policyColumns } from './access-policy'
import { logAccess } from './audit'
import { deleteStored } from './storage'
import { asNameList } from './installed-app-ledger'
import { COLUMN_NAME_RE, quoteIdent } from './sql-identifier'
import { PLATFORM_SCHEMA, platformRelation, resolvedRelation, tableName } from './platform-schema'
import { canRetire, readingPresentationSchema } from 'shared'
import { allowedTables, anyTableLinkColumns, linkableTable } from './any-table-link'
import { filterColumns, normaliseViewFilters, rowsInView, viewsOf } from './views'

export { tableName }

// Columns every generated table has (META-005); user columns cannot shadow them.
// #132: `name` left this list when the primary key became `row_id`, so a user
// Table may now carry the most natural column name there is.
export const STANDARD_COLUMNS = [
  ROW_KEY,
  'created_by',
  'created_at',
  'updated_at',
  'updated_by',
  'submission_status',
  'position',
  'parent',
  'parenttype',
  'parentfield',
] as const

// #859: retiring a row (ADR 0019). Every stored Table of kind 'table' carries
// these beside the standard columns; the names are reserved on every Table.
export const RETIREMENT_COLUMNS = ['retired_at', 'retired_by', 'retired_reason'] as const

// Names no builder's column may take: the standard columns and the retirement ones.
export const RESERVED_COLUMNS: readonly string[] = [...STANDARD_COLUMNS, ...RETIREMENT_COLUMNS]

/** Whether a Table's rows can be retired (ADR 0019); one rule, in shared. */
export { canRetire }

// META-002: how each column type maps to a Postgres column type.
// Layout columns and Sub-table columns produce no column at all.
const PG_TYPES: Record<string, string | null> = {
  Data: 'varchar(140)',
  Int: 'bigint',
  Float: 'double precision',
  Currency: 'numeric(21,9)',
  Check: 'boolean',
  Choice: 'text',
  Date: 'date',
  Datetime: 'timestamptz',
  Text: 'text',
  'Long Text': 'text',
  Reference: 'varchar(140)',
  'Sub-table': null,
  Attach: 'text',
  'Attach Image': 'text',
  JSON: 'jsonb',
  'Section Break': null,
  'Column Break': null,
}

// #651: the column type changes that keep every value. Each maps the target
// type to the cast that converts stored values (null when the stored type does
// not change). Anything else is refused: add a new column, copy the data,
// then drop the old one.
const SAFE_TYPE_CHANGES: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  Int: { Float: 'double precision' },
  Data: { Text: 'text', 'Long Text': 'text', Choice: 'text' },
  Text: { 'Long Text': null },
  'Long Text': { Text: null },
  Choice: { Text: null, 'Long Text': null },
  Date: { Datetime: 'timestamptz' },
  Check: { Int: 'bigint' },
}

/** #911: a text column becomes a link, and back, in place. Both store the same
 *  text, so nothing converts; text becomes a link only once every value names a
 *  row of the target (`assertValuesNameRows`). */
export function isLinkTypeChange(from: string, to: string): boolean {
  return (from === 'Data' && to === 'Reference') || (from === 'Reference' && to === 'Data')
}

export function isSafeTypeChange(from: string, to: string): boolean {
  return isLinkTypeChange(from, to) || (Object.hasOwn(SAFE_TYPE_CHANGES, from) && Object.hasOwn(SAFE_TYPE_CHANGES[from], to))
}

/** #911: before a text column becomes a link to `target`, every non-empty value
 *  must be the id of a row there. Refuses naming the values that are not, and
 *  turns empty text into no value, which is how a link says empty. */
async function assertValuesNameRows(
  tx: { unsafe: (q: string) => Promise<unknown> },
  relation: string,
  table: string,
  column: string,
  target: string,
): Promise<void> {
  const targetMeta = await getMeta(target)
  if (targetMeta.data_source || targetMeta.kind === 'settings')
    throw new AppError('ValidationError', `${table}.${column} can only become a link to a Table whose rows are stored here`, {
      [column]: `${target} rows are not stored here`,
    })
  const col = quoteIdent(column)
  const missing = (await tx.unsafe(
    `select distinct t.${col} as value from ${relation} t
     where t.${col} is not null and t.${col} <> ''
       and not exists (select 1 from ${quoteRelation(await tableRelation(targetMeta.kind === 'view' ? targetMeta.view_of! : target))} r where r.row_id = t.${col})
     order by 1 limit 20`,
  )) as unknown as { value: string }[]
  if (missing.length) {
    // The first 20 are enough to see the pattern and start fixing.
    const why = `${missing.map((m) => m.value).join(', ')} ${missing.length === 1 ? 'names' : 'name'} no ${target} row`
    throw new AppError('ValidationError', `${table}.${column} cannot become a link: ${why}`, { [column]: why })
  }
  // #1021: a link to a view also needs every value to be one of its rows.
  await assertValuesInView(table, relation, column, target)
  await tx.unsafe(`update ${relation} set ${col} = null where ${col} = ''`)
}

export function pgType(columnType: string): string | null {
  if (!(columnType in PG_TYPES))
    throw new AppError('ValidationError', `Unknown column type ${columnType}`)
  return PG_TYPES[columnType]
}

// #209 (issue #197): the meta this server RETURNS carries `null` for every
// unset optional. A client that reads a Table, changes one column and sends
// it back — the natural shape of a column editor — was rejected on every one
// of them ("Expected string, received null"), which made read-modify-write
// impossible without the client scrubbing nulls it did not put there. Null
// and absent mean the same thing here, so say so once.
const optionalString = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined)
  .optional()

export const columnSchema = z.object({
  column_name: z
    .string()
    .regex(COLUMN_NAME_RE, 'column_name must be snake_case'),
  label: optionalString,
  column_type: z.enum(COLUMN_TYPE_VALUES),
  // Type-specific target, replacing the old overloaded "options" key:
  // Reference -> target table name, Choice -> newline/comma list of choices,
  // Sub-table -> the sub-table's Table name.
  reference_table: optionalString,
  // #881: a link whose Table is chosen per row names the column holding it.
  table_column: optionalString,
  choices: optionalString,
  choice_labels: z.record(z.string(), z.string()).nullish(),
  row_table: optionalString,
  reqd: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  unique: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  default_value: optionalString,
  read_only: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  hidden: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  in_list_view: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  tier: z.enum(['basic', 'restricted']).nullish().transform((v) => v ?? undefined).optional(),
  // #473: one plain line every form shows under the control.
  description: optionalString,
  // EDS-3: true column name on a bound Table's source when the legal
  // column_name had to differ (reserved word, illegal characters).
  source_column: optionalString,
})

export const tableDefSchema = z.object({
  access_policy: accessPolicySchema.nullish().transform(value => value ?? undefined).optional(),
  name: z
    .string()
    .regex(/^(?:[A-Za-z][A-Za-z0-9 ]{0,60}|[a-z][a-z0-9_]{0,30}\.[a-z][a-z0-9_]{0,30})$/, 'invalid Table name'),
  label: optionalString,
  module: optionalString,
  // Replaces the old istable/issingle booleans: 'table' = normal collection,
  // 'sub_table' = rows only ever nested inside a parent row, 'settings' = a
  // single-row Settings Table (no list, no collection table).
  kind: z.enum(['table', 'sub_table', 'settings']).nullish().transform((v) => v ?? undefined).optional(),
  is_submittable: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  id_pattern: optionalString,
  title_column: optionalString,
  reading_presentation: readingPresentationSchema.nullish(),
  description: optionalString,
  // #74: platform-table flag. Accepted here so migrations and seeds can set
  // it through createTable; the public /api/table_def routes REJECT it — a
  // user-created table can never claim system: true.
  system: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  // #559: the Table's rows decide which places people cover. Writing them is
  // System Manager work (security-tables.ts), and only a marked Table can be
  // read by an app's scope provider. Kept when an update leaves it out.
  decides_scope: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  // #246: the Reference columns Data Scope narrows this Table by. Left out,
  // every Reference to a scoped Table narrows (Frappe's discovery). An empty
  // list clears it. scope_required refuses a person with no Data Scope on
  // those dimensions. Both are kept when an update leaves them out.
  scope_on: z.array(z.string()).nullish(),
  scope_required: z.boolean().nullish().transform((v) => v ?? undefined).optional(),
  // EDS-3: binding to an external Data Source. Set only at creation (BV3) —
  // updateTable never touches these. A bound Table gets no DDL and no RLS
  // (BV1): its rows live on the source.
  data_source: optionalString,
  external_schema: optionalString,
  external_table: optionalString,
  external_pk: optionalString,
  external_modified: optionalString,
  columns: z.array(columnSchema).min(1),
})

export type TableDef = z.infer<typeof tableDefSchema>

// NAM-001: the id_pattern kinds resolveName() (document.ts) understands. A
// series prefix may not itself contain the '.' that separates it from the
// digit mask, or resolveName would cut the prefix short.
function validateIdPattern(pattern: string, columnNames: string[]): void {
  const bad = (message: string) =>
    new AppError('ValidationError', message, { id_pattern: message })
  if (pattern === 'hash' || pattern === 'prompt' || pattern === 'integer') return
  if (pattern.startsWith('opaque:')) {
    if (!/^[a-z]{2,8}_$/.test(pattern.slice('opaque:'.length)))
      throw bad('An opaque id pattern names a short lowercase prefix ending in _, e.g. opaque:psn_')
    return
  }
  // #858: field:<column>, or a prefix then {<column>}.
  const naming = namingColumn(pattern)
  if (naming) {
    if (!columnNames.includes(naming.column))
      throw bad(`Naming column ${naming.column} is not a column of this Table`)
    if (/^\s|\s$/.test(naming.prefix)) throw bad('An id prefix cannot start or end with a space')
    return
  }
  if (pattern.includes('{') || pattern.includes('}'))
    throw bad('A prefixed id names one column after its prefix, e.g. PLANT-{plant_code}')
  if (!pattern.includes('.')) throw bad(`Unsupported id pattern ${pattern}`)
  const [prefix, mask] = [
    pattern.slice(0, pattern.indexOf('.')),
    pattern.slice(pattern.indexOf('.') + 1),
  ]
  if (!prefix) throw bad('A series needs a prefix before the digits')
  if (!/^#+$/.test(mask)) throw bad('A series ends in # digit placeholders, e.g. ZONE-.###')
}

// #855: the key of a Table's row counter in `series`: one count per Table and
// prefix ('' for plain numbers), never per prefix text alone, so two Tables
// numbered alike keep separate counts. Table names hold no ':', and the
// 'table:' marker keeps these keys apart from the old per-prefix ones.
export function seriesKey(table: string, prefix: string): string {
  return `table:${table}:${prefix}`
}

// NAM-001: change only how new rows are named. Deliberately narrow — the full
// PUT /api/table_def round-trip would have the client resend every column, and
// an omission there silently rewrites the schema.
export async function setIdPattern(name: string, pattern: string): Promise<TableMeta> {
  const meta = await getMeta(name)
  if (meta.kind === 'view') throw baseOnlyChange(meta)
  assertNotSystemWritten(meta, 'renamed or changed')
  validateIdPattern(pattern, meta.columns.map((c) => c.column_name))
  await sql`update table_def set id_pattern = ${pattern}, updated_at = ${new Date()}
            where name = ${name}`
  invalidateMeta(name)
  return getMeta(name)
}

function targetOf(f: TableDef['columns'][number]): string | undefined {
  if (f.column_type === 'Reference') return f.reference_table ?? f.table_column
  if (f.column_type === 'Sub-table') return f.row_table
  return undefined
}

function validateDef(def: TableDef) {
  const errs: Record<string, string> = {}
  if (def.access_policy) {
    if (def.data_source || (def.kind && def.kind !== 'table')) errs.access_policy = 'Mandatory access requires a local collection'
    if (def.access_policy.shared_column && !def.columns.some(c => c.column_name === def.access_policy!.shared_column && c.column_type === 'Check'))
      errs.access_policy = 'The shared column must be a Check column'
    if (def.access_policy.inherit_column && !def.columns.some(c => c.column_name === def.access_policy!.inherit_column && c.column_type === 'Reference'))
      errs.access_policy = 'The inherited access column must be a Reference column'
  }
  if (def.scope_on?.length) {
    const bad = def.scope_on.find((name) => !def.columns.some((c) => c.column_name === name && c.column_type === 'Reference'))
    if (bad) errs.scope_on = `${bad} is not a Reference column of this Table`
  }
  if (def.scope_required && !def.scope_on?.length) errs.scope_required = 'Name the columns it is scoped on first'
  const reading = def.reading_presentation
  if (reading) {
    const columns = new Set(def.columns.filter(f => !['Section Break', 'Column Break', 'Sub-table'].includes(f.column_type)).map(f => f.column_name))
    columns.add('created_at')
    columns.add('updated_at')
    for (const name of [reading.title, ...reading.headers, reading.body, reading.attachment_names].filter((name): name is string => Boolean(name)))
      if (!columns.has(name)) errs.reading_presentation = `Reading column ${name} is not a value column of this Table`
  }
  // EDS-3/BV4/VDT-4: a source binding is only coherent for plain collection
  // Tables — no sub_tables, no settings, no submit lifecycle (the source has
  // no docstatus), no Sub-table columns (child rows can't live on a source).
  if (def.data_source) {
    if ((def.kind ?? 'table') !== 'table')
      errs.data_source = 'Only kind "table" can be bound to a data source'
    if (def.is_submittable)
      errs.is_submittable = 'A source-bound Table cannot be submittable (no docstatus on the source)'
    if (!def.external_table) errs.external_table = 'external_table is required for a bound Table'
    if (!def.external_pk) errs.external_pk = 'external_pk is required for a bound Table'
    for (const f of def.columns)
      if (f.column_type === 'Sub-table')
        errs[f.column_name] = 'Sub-table columns are not supported on source-bound Tables'
  }
  const seen = new Set<string>()
  for (const f of def.columns) {
    if (RESERVED_COLUMNS.includes(f.column_name))
      errs[f.column_name] = `'${f.column_name}' is a reserved column name`
    if (seen.has(f.column_name)) errs[f.column_name] = 'duplicate column_name'
    seen.add(f.column_name)
    if (['Reference', 'Sub-table', 'Choice'].includes(f.column_type) && !targetOf(f) && f.column_type !== 'Choice')
      errs[f.column_name] = `${f.column_type} column requires ${f.column_type === 'Reference' ? 'reference_table' : 'row_table'}`
    if (f.column_type === 'Choice' && !f.choices)
      errs[f.column_name] = 'Choice column needs at least one choice'
    if (f.table_column) {
      // #881: a link to a row of any Table names the column of this Table
      // that holds the Table, a link to Table, and no fixed target of its own.
      const holder = def.columns.find((c) => c.column_name === f.table_column)
      if (f.column_type !== 'Reference' || f.reference_table)
        errs[f.column_name] = 'Only a link column without a target Table can take its Table from another column'
      else if (!holder || holder.column_type !== 'Reference' || holder.reference_table !== 'Table' || holder.table_column)
        errs[f.column_name] = `${f.table_column} must be a link to Table in this Table`
    }
  }
  if (Object.keys(errs).length)
    throw new AppError('ValidationError', 'Invalid Table definition', errs)
}

// #511: a link column must name a Table that exists — or its own Table, or
// one being created alongside it (an app's install) — otherwise every later
// save with a value in that column is refused. Only the columns given are
// checked, so an update judges just the links it adds or retargets.
async function assertLinkTargetsExist(
  def: TableDef,
  columns: TableDef['columns'],
  alongside: readonly string[] = [],
): Promise<void> {
  const errs: Record<string, string> = {}
  for (const f of columns) {
    // #881: each allowed Table must exist and be one a link can point at.
    if (f.column_type === 'Reference' && f.table_column) {
      for (const allowed of allowedTables(f.choices)) {
        const [target] = await sql`select kind, data_source from table_def where name = ${allowed}`
        if (!target) errs[f.column_name] = `Link target ${allowed} does not exist`
        else if (!linkableTable(target)) errs[f.column_name] = `${allowed} cannot be a link target: only a stored Table's rows can be`
      }
      continue
    }
    if (f.column_type !== 'Reference' || !f.reference_table) continue
    if (f.reference_table === def.name || alongside.includes(f.reference_table)) continue
    const [target] = await sql`select 1 from table_def where name = ${f.reference_table}`
    if (!target) errs[f.column_name] = `Link target ${f.reference_table} does not exist`
  }
  if (Object.keys(errs).length)
    throw new AppError('ValidationError', 'Invalid link column target', errs)
}

// Existing core Tables keep their bootstrap mapping. Qualified identities must
// have persisted storage metadata; never infer their location from spelling.
export async function tableRelation(name: string): Promise<string> {
  if (!name.includes('.')) return platformRelation(tableName(name))
  const meta = await getMeta(name)
  if (!meta.owner_app || !meta.physical_schema || !meta.physical_relation)
    throw new AppError('ValidationError', `Table ${name} has no app storage mapping`)
  return `${meta.physical_schema}.${meta.physical_relation}`
}

// Describe the same storage the row readers use, never a label-derived name.
// Source bindings are not local relations; Settings share a composite-key store.
export async function tableStorageIdentity(meta: TableMeta) {
  // #1021: a view stores nothing; its rows are its base's.
  if (meta.kind === 'view') return null
  if (meta.data_source) {
    if (!meta.external_table) return null
    return { schema: meta.external_schema ?? '', relation: meta.external_table,
      row_key: [meta.external_pk || ROW_KEY], data_source: meta.data_source, discriminator: null }
  }
  if (meta.kind === 'settings') {
    return { schema: PLATFORM_SCHEMA, relation: 'single_value', row_key: ['table_name', 'field'],
      data_source: null, discriminator: { table_name: meta.name } }
  }
  const [schema, relation] = (await tableRelation(meta.name)).split('.')
  return { schema, relation, row_key: [meta.row_key], data_source: null, discriminator: null }
}

// #651: where a Table's rows are stored, read straight from its definition.
// A maintenance sweep (a rename's, a drop's) must reach every Table, even
// one whose app is turned off, so it never passes the availability check
// that getMeta (and tableRelation) applies to app Tables.
export async function storedRelation(name: string): Promise<string> {
  const [row] = await sql<{ name: string; physical_schema: string | null; physical_relation: string | null }[]>`
    select name, physical_schema, physical_relation from table_def where name = ${name}`
  if (!row) throw new AppError('NotFoundError', `Table ${name} not found`)
  return resolvedRelation(row)
}

export function quoteRelation(relation: string): string {
  return relation.split('.').map(quoteIdent).join('.')
}

// META-003: generate the CREATE TABLE statement for a Table definition.
// Standard columns (META-005) are always present; sub-tables additionally
// carry parent linkage. Settings Tables (kind: 'settings') get no table.
function createTableDDL(def: TableDef, relation = tableName(def.name)): string | null {
  if (def.kind === 'settings') return null
  const cols: string[] = [
    `"${ROW_KEY}" varchar(140) primary key`,
    `"created_by" varchar(140) not null default 'Administrator'`,
    `"created_at" timestamptz not null default now()`,
    `"updated_at" timestamptz not null default now()`,
    `"updated_by" varchar(140) not null default 'Administrator'`,
    `"submission_status" text not null default 'draft'`,
    `"position" integer not null default 0`,
  ]
  if ((def.kind ?? 'table') === 'table')
    cols.push(`"retired_at" timestamptz`, `"retired_by" varchar(140)`, `"retired_reason" text`)
  if (def.kind === 'sub_table') {
    cols.push(
      `"parent" varchar(140)`,
      `"parenttype" varchar(140)`,
      `"parentfield" varchar(140)`,
    )
  }
  const constraints: string[] = []
  for (const f of def.columns) {
    const type = pgType(f.column_type)
    if (!type) continue
    cols.push(`${quoteIdent(f.column_name)} ${type}`)
    if (f.unique)
      constraints.push(
        `constraint ${quoteIdent(`${tableName(def.name)}_${f.column_name}_uq`)} unique (${quoteIdent(f.column_name)})`,
      )
  }
  return `create table ${quoteRelation(relation)} (\n  ${[...cols, ...constraints].join(',\n  ')}\n)`
}

// PERM-004: new tables get RLS with a generated SELECT-only policy that holds
// every role but the owner to the session user's read Permission. No role is
// granted access, so the server (the owner) stays the only reader. Skipped
// while bootstrap migrations run before 0010_rls.sql has created
// fc_has_read(); that migration sweeps every table that already exists.
async function applyRls(
  tx: { unsafe: (q: string) => Promise<unknown> },
  def: TableDef,
  relation = tableName(def.name),
): Promise<void> {
  const [ready] = (await tx.unsafe(
    `select to_regprocedure('featherbase.fc_has_read(text)') as function`,
  )) as unknown as unknown[]
  if (!ready || !(ready as { function?: unknown }).function) return
  const table = quoteRelation(relation)
  await tx.unsafe(`alter table ${table} enable row level security`)
  const predicate = def.kind === 'sub_table'
    ? 'featherbase.fc_has_read(parenttype)'
    : `featherbase.fc_has_read('${def.name.replace(/'/g, "''")}')`
  await tx.unsafe(`create policy fc_select on ${table} for select using (${predicate})`)
}

// #510: rows that already repeat a value would fail a unique constraint with
// a bare database error; name the value instead (shortened, since it is
// echoed back). Thrown inside the write's transaction, so the Table is left
// as it was.
async function assertNoRepeats(
  tx: { unsafe: (q: string) => Promise<unknown> },
  relation: string,
  column: string,
): Promise<void> {
  const col = quoteIdent(column)
  const [repeat] = (await tx.unsafe(
    `select ${col}::text as value, count(*)::int as n from ${relation}
     where ${col} is not null group by ${col} having count(*) > 1
     order by count(*) desc, ${col}::text limit 1`,
  )) as unknown as { value: string; n: number }[]
  if (!repeat) return
  const shown = repeat.value.length > 60 ? `${repeat.value.slice(0, 60)}…` : repeat.value
  throw new AppError('ValidationError', 'A unique column cannot repeat a value', {
    [column]: `${JSON.stringify(shown)} is held by ${repeat.n} rows; make each value distinct before marking the column unique`,
  })
}

// META-004: sync an existing Table's columns to a new definition. Additions
// create columns; property edits update column_def rows; removals delete the
// column_def row but KEEP the physical column (data is never dropped without
// the explicit drop_columns flag). Column-type changes are rejected.
//
// #251: a removal is never inferred from a column simply being absent — a
// partial payload would otherwise erase every column it left out. Each one
// must be named in remove_columns; an unnamed omission refuses the whole
// write, naming the column and how many rows hold a value in it.
export async function updateTable(
  name: string,
  input: unknown,
  opts: { drop_columns?: boolean; remove_columns?: string[]; clear_descriptions?: string[] } = {},
): Promise<TableMeta> {
  if (input && typeof input === 'object' && 'name' in input && input.name !== name)
    throw new AppError('ValidationError', 'Body Table name must match the path', { name: 'Table renaming is not supported by this endpoint' })
  const existing = await getMeta(name)
  // #1021: a view's columns are its base's; only its own definition changes.
  if (existing.kind === 'view') {
    if (opts.remove_columns?.length) throw baseOnlyChange(existing)
    return updateView(name, input)
  }
  assertNotSystemWritten(existing, 'changed')
  // #1025: an update changes what it names. Columns left out are the stored ones,
  // not the effective meta, so a Metadata Override is not written into the Table.
  const named = input as Record<string, unknown>
  const columns = named.columns ?? await sql`select * from column_def where parent = ${name} order by position`
  const parsed = tableDefSchema.safeParse({ ...named, name, columns })
  if (!parsed.success) {
    const errs: Record<string, string> = {}
    for (const issue of parsed.error.issues) errs[issue.path.join('.')] = issue.message
    throw new AppError('ValidationError', 'Invalid Table definition', errs)
  }
  const def = parsed.data
  def.kind ??= existing.kind
  if (def.title_column && def.title_column !== existing.title_column && def.title_column !== ROW_KEY &&
      !def.columns.some((c) => c.column_name === def.title_column && !['Sub-table', 'Section Break', 'Column Break'].includes(c.column_type)))
    throw new AppError('ValidationError', `${name} has no column ${def.title_column} to name its rows`, { title_column: 'No such column' })
  if (existing.access_policy && def.access_policy && JSON.stringify(def.access_policy) !== JSON.stringify(accessPolicySchema.parse(existing.access_policy)))
    throw new AppError('PermissionError', 'An existing mandatory access policy cannot be changed through the schema editor')
  if (existing.access_policy) {
    def.access_policy = existing.access_policy
    for (const name of policyColumns(existing.access_policy)) {
      const before = existing.columns.find(column => column.column_name === name)
      const after = def.columns.find(column => column.column_name === name)
      if (!before || !after || before.column_type !== after.column_type ||
          (before.reference_table ?? null) !== (after.reference_table ?? null) ||
          (before.default_value ?? null) !== (after.default_value ?? null) ||
          Boolean(before.reqd) !== Boolean(after.reqd))
        throw new AppError('PermissionError', 'Columns that define mandatory access cannot be removed or redefined')
    }
  }
  // person-identities (D9): a Person email is unique ignoring case through the
  // index user_email_lower_uq. A column-level `unique` would re-add the
  // case-sensitive user_email_uq beside it, so it is refused here.
  if (name === 'Person' && def.columns.some((f) => f.column_name === 'email' && f.unique))
    throw new AppError('ValidationError', 'User email is already unique ignoring case; it cannot be made unique again', {
      'columns.email.unique': 'managed by the platform',
    })
  // BV3: the binding is immutable — whatever the caller sent, the existing
  // binding is what validateDef judges against (and what stays stored).
  if (existing.data_source) {
    def.data_source = existing.data_source
    def.external_table = existing.external_table ?? undefined
    def.external_pk = existing.external_pk ?? undefined
  } else if (def.data_source) {
    throw new AppError('ValidationError', 'An existing Table cannot be bound to a data source')
  }
  // An update that leaves is_submittable out keeps the stored value (below),
  // so it keeps that value's Amended From column too.
  const keptAmendedFrom = Boolean(def.is_submittable ?? existing.is_submittable) &&
    !def.columns.some((f) => f.column_name === 'amended_from')
  if (keptAmendedFrom)
    def.columns.push({
      column_name: 'amended_from',
      label: 'Amended From',
      column_type: 'Reference',
      reference_table: name,
      hidden: true,
    })
  if (def.reading_presentation === undefined) def.reading_presentation = existing.reading_presentation
  if (def.scope_on === undefined) def.scope_on = existing.scope_on
  if (def.scope_required === undefined) def.scope_required = existing.scope_required
  validateDef(def)
  if (def.id_pattern)
    validateIdPattern(def.id_pattern, def.columns.map((f) => f.column_name))
  if (def.kind !== existing.kind)
    throw new AppError('ValidationError', 'kind cannot be changed after creation')

  const before = new Map(existing.columns.map((f) => [f.column_name, f]))
  const after = new Map(def.columns.map((f) => [f.column_name, f]))
  const errors: Record<string, string> = {}
  for (const [column_name, f] of after) {
    const old = before.get(column_name)
    if (old && old.column_type !== f.column_type && !(
      isLinkTypeChange(old.column_type, f.column_type) && existing.kind !== 'settings' && !existing.data_source &&
      (f.column_type !== 'Reference' || (f.reference_table && !f.table_column))))
      errors[column_name] = `column_type cannot change (${old.column_type} -> ${f.column_type})`
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', 'Unsupported schema change', errors)
  await assertLinkTargetsExist(
    def,
    def.columns.filter((f) => before.get(f.column_name)?.reference_table !== f.reference_table),
  )
  // #1021: a link moved onto a view keeps every value only if each is a row
  // of it. A link moved back to the base always does.
  if (existing.kind !== 'settings' && !existing.data_source)
    for (const f of def.columns)
      if (f.column_type === 'Reference' && f.reference_table && before.has(f.column_name)
        && before.get(f.column_name)!.column_type === 'Reference'
        && before.get(f.column_name)!.reference_table !== f.reference_table)
        await assertValuesInView(name, quoteRelation(await tableRelation(name)), f.column_name, f.reference_table)

  // A bound Table's column changes are metadata-only (BV1: no DDL against
  // anyone's storage, ours included).
  const isBound = Boolean(existing.data_source)
  const table = tableName(name)
  const relation = quoteRelation(await tableRelation(name))

  const removing = new Set(opts.remove_columns ?? [])
  if (removing.has(DELETED_AT_SOURCE)) await assertNotCopyMarker(existing.name, DELETED_AT_SOURCE, 'removed')
  for (const column of removing) await assertNotViewFilterColumn(existing.name, column, 'removed')
  for (const column_name of removing) {
    if (!before.has(column_name)) errors[column_name] = 'not a column of this Table'
    else if (column_name === 'amended_from' && keptAmendedFrom)
      errors[column_name] = 'kept while the Table is submittable; turn is_submittable off to remove it'
    else if (after.has(column_name)) errors[column_name] = 'still in the definition; leave it out to remove it'
  }
  for (const [column_name, old] of before) {
    if (after.has(column_name) || removing.has(column_name)) continue
    const stored = pgType(old.column_type) && existing.kind !== 'settings' && !isBound
    const [{ n }] = stored
      ? ((await sql.unsafe(
          `select count(*)::int as n from ${relation} where ${quoteIdent(column_name)} is not null`,
        )) as unknown as { n: number }[])
      : [{ n: 0 }]
    // #250: drop-one/add-one of the same type reads like a rename, but it is
    // ambiguous, so it is never inferred — the refusal names the way to say it.
    const renamedTo = def.columns
      .filter((f) => !before.has(f.column_name) && f.column_type === old.column_type)
      .map((f) => f.column_name)
    errors[column_name] =
      `left out of the definition${n ? ` while ${n} ${n === 1 ? 'row holds' : 'rows hold'} a value in it` : ''}; ` +
      'name it in remove_columns to remove it' +
      (renamedTo.length ? `, or use rename_column to rename it to ${renamedTo.join(' or ')}` : '')
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', 'Columns left out must be removed by name', errors)
  await sql.begin(async (tx) => {
    await clearChangedListOverrides(tx, name, def.columns, before)
    await tx`update table_def set ${tx({
      module: def.module ?? existing.module,
      is_submittable: def.is_submittable ?? existing.is_submittable,
      id_pattern: def.id_pattern ?? existing.id_pattern,
      // Only when named: null or an empty value clears them, leaving them out keeps them.
      ...(named.title_column !== undefined ? { title_column: def.title_column || null } : {}),
      // A title column removed with this update names nothing any more.
      ...(existing.title_column && opts.remove_columns?.includes(existing.title_column) ? { title_column: null } : {}),
      ...(def.reading_presentation !== undefined ? { reading_presentation: def.reading_presentation } : {}),
      ...(named.description !== undefined ? { description: def.description || null } : {}),
      // Only when given: an update that leaves it out keeps the Table's choice.
      ...(def.decides_scope !== undefined ? { decides_scope: def.decides_scope } : {}),
      // Only once the definition has them: migrations before 0154 update Tables too.
      ...(def.scope_on !== undefined ? { scope_on: def.scope_on?.length ? def.scope_on : null } : {}),
      ...(def.scope_required !== undefined ? { scope_required: def.scope_required } : {}),
      ...(def.access_policy !== undefined ? { access_policy: def.access_policy } : {}),
      updated_at: new Date(),
    })} where name = ${name}`

    for (const [i, f] of def.columns.entries()) {
      const old = before.get(f.column_name)
      const row: Record<string, unknown> = {
        position: i + 1,
        label: f.label ?? prettifyLabel(f.column_name),
        reference_table: f.reference_table ?? null,
        table_column: f.table_column ?? null,
        choices: f.table_column ? allowedTables(f.choices).join('\n') || null : f.choices ?? null,
        choice_labels: f.choice_labels == null ? null : tx.json(f.choice_labels),
        row_table: f.row_table ?? null,
        reqd: f.reqd ?? false,
        unique: f.unique ?? false,
        default_value: f.default_value ?? null,
        read_only: f.read_only ?? false,
        hidden: f.hidden ?? false,
        in_list_view: f.in_list_view ?? false,
        tier: f.tier ?? 'basic',
      }
      // source_column is kept when the update leaves it out.
      const sourceColumn = f.source_column ?? (old ? old.source_column : null)
      if (sourceColumn != null) row.source_column = sourceColumn
      // Likewise a description (0121): kept when the update leaves it out,
      // unless the caller names the column to clear it (#663).
      if (f.description !== undefined) row.description = f.description
      else if (opts.clear_descriptions?.includes(f.column_name)) row.description = null
      if (!old) {
        await tx`insert into column_def ${tx({
          parent: name,
          column_name: f.column_name,
          column_type: f.column_type,
          ...row,
        })}`
        const type = pgType(f.column_type)
        if (type && existing.kind !== 'settings' && !isBound)
          await tx.unsafe(`alter table ${relation} add column if not exists ${quoteIdent(f.column_name)} ${type}`)
        if (f.unique && type && existing.kind !== 'settings' && !isBound) {
          // A column put back keeps its old values, which may repeat (#510).
          await assertNoRepeats(tx, relation, f.column_name)
          await tx.unsafe(
            `alter table ${relation} add constraint ${quoteIdent(`${table}_${f.column_name}_uq`)} unique (${quoteIdent(f.column_name)})`,
          )
        }
      } else {
        if (old.column_type !== f.column_type) {
          // #911: the only type changes that reach here are text ⇄ link.
          if (f.column_type === 'Reference')
            await assertValuesNameRows(tx, relation, name, f.column_name, f.reference_table!)
          else row.reference_table = null
          row.column_type = f.column_type
        }
        await tx`update column_def set ${tx(row)}
          where parent = ${name} and column_name = ${f.column_name}`
        const type = pgType(f.column_type)
        if (type && existing.kind !== 'settings' && !isBound && Boolean(old.unique) !== Boolean(f.unique)) {
          if (f.unique) await assertNoRepeats(tx, relation, f.column_name)
          if (f.unique)
            await tx.unsafe(
              `alter table ${relation} add constraint ${quoteIdent(`${table}_${f.column_name}_uq`)} unique (${quoteIdent(f.column_name)})`,
            )
          else
            await tx.unsafe(
              `alter table ${relation} drop constraint if exists ${quoteIdent(`${table}_${f.column_name}_uq`)}`,
            )
        }
      }
    }

    for (const [column_name, old] of before) {
      if (after.has(column_name)) continue
      await tx`delete from column_def where parent = ${name} and column_name = ${column_name}`
      const type = pgType(old.column_type)
      if (type && existing.kind !== 'settings' && !isBound && opts.drop_columns)
        await tx.unsafe(`alter table ${relation} drop column if exists ${quoteIdent(column_name)}`)
      // without drop_columns the column (and its data) is retained, but not
      // its unique rule: a hidden constraint would keep refusing saves, and
      // putting the column back unique re-checks its values (#510).
      else if (type && existing.kind !== 'settings' && !isBound && old.unique)
        await tx.unsafe(`alter table ${relation} drop constraint if exists ${quoteIdent(`${table}_${column_name}_uq`)}`)
    }
  })
  invalidateMeta(name)
  return getMeta(name)
}

// #738 (Decision 3): the list a Table shows for everyone is its columns'
// in_list_view flags, so a save that changes a column's flag deletes that
// column's in_list_view Metadata Override — otherwise the override would make
// the "In list" tick do nothing. A flag "changes" when the one sent differs
// from the stored definition's, or from what the column showed (definition
// plus override, `shown`): the Edit columns page sends back the merged meta,
// so an untouched column arrives with its override's value, and unticking a
// column only an override put in the list arrives equal to the stored value.
// Other properties' overrides, and the overrides of columns whose flag
// matches both, stay.
async function clearChangedListOverrides(
  tx: TxSql,
  name: string,
  columns: { column_name: string; in_list_view?: boolean }[],
  shown: Map<string, { in_list_view?: boolean | null }>,
): Promise<void> {
  const stored = new Map(
    (
      await tx<{ column_name: string; in_list_view: boolean }[]>`
        select column_name, in_list_view from column_def where parent = ${name}`
    ).map((r) => [r.column_name, Boolean(r.in_list_view)]),
  )
  const changed = columns
    .filter((f) => stored.has(f.column_name))
    .filter((f) => {
      const sent = Boolean(f.in_list_view)
      return sent !== stored.get(f.column_name) || sent !== Boolean(shown.get(f.column_name)?.in_list_view)
    })
    .map((f) => f.column_name)
  if (!changed.length) return
  await tx`delete from metadata_override
    where table_name = ${name} and property = 'in_list_view' and column_name in ${tx(changed)}`
}

// Serialize the ownership check with its metadata write, including nested
// app-install/upgrade transactions. A single lock avoids acquiring several
// slug locks in opposite orders when an app materializes multiple Tables.
export async function assertTableAddressAvailable(tx: TxSql, name: string, from?: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended('featherbase.table-url-ownership', 821))`
  const tables = await tx<{ name: string }[]>`select name from table_def`
  const owner = tables.find((table) => table.name !== from && tableSlug(table.name) === tableSlug(name))
  if (owner)
    throw new AppError('ConflictError', `Table ${name} would share its address with ${owner.name}`, {
      name: `The address "${tableSlug(name)}" already belongs to ${owner.name}`,
    })
}

// #1021: a view is metadata only: a name, a base Table and filters. It makes
// no storage, no RLS policy and no columns of its own (its columns are its
// base's), and holds no grants: every read resolves it to its base first.
const viewDefSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9 ]{0,60}$/, 'A view name starts with a letter and has only letters, digits and spaces'),
  kind: z.literal('view'),
  label: optionalString,
  module: optionalString,
  description: optionalString,
  view_of: z.string().min(1),
  view_filters: z.unknown(),
})

async function viewBase(name: string): Promise<TableMeta> {
  const base = await getMeta(name)
  if (base.kind !== 'table' || base.data_source || base.system_written || base.archived_at || base.name === 'Table' || base.name === 'Column')
    throw new AppError('ValidationError', `${base.name} cannot have a view: a view is of a Table whose rows are stored here`, {
      view_of: `${base.name} rows are not stored here`,
    })
  return base
}

export async function createView(input: unknown, user = 'Administrator'): Promise<TableMeta> {
  const parsed = viewDefSchema.safeParse(input)
  if (!parsed.success) {
    const errs: Record<string, string> = {}
    for (const issue of parsed.error.issues) errs[issue.path.join('.')] = issue.message
    throw new AppError('ValidationError', 'Invalid view definition', errs)
  }
  const def = parsed.data
  const base = await viewBase(def.view_of)
  const filters = normaliseViewFilters(base, def.view_filters)
  const [existing] = await sql`select 1 from table_def where name = ${def.name}`
  if (existing) throw new AppError('ConflictError', `Table ${def.name} already exists`)
  // A view has no storage, but its name must not spell a relation that does
  // (#432): a read that reached tableRelation(view) would find those rows.
  const [clash] = await sql`select 1 from information_schema.tables
    where table_schema = ${PLATFORM_SCHEMA} and table_name = ${tableName(def.name)}`
  if (clash) throw new AppError('ConflictError', `Table ${def.name} already exists`)
  await sql.begin(async (tx) => {
    await assertTableAddressAvailable(tx, def.name)
    await tx`insert into table_def ${tx({
      name: def.name,
      label: def.label ?? null,
      module: def.module ?? base.module,
      kind: 'view',
      view_of: base.name,
      view_filters: tx.json(filters as never),
      description: def.description ?? null,
      custom: true,
      created_by: user,
      updated_by: user,
    } as unknown as Record<string, never>)}`
  })
  invalidateMeta(def.name)
  return getMeta(def.name)
}

function baseOnlyChange(view: TableMeta): AppError {
  return new AppError('ValidationError', `${view.name} is a view of ${view.view_of}: its columns and settings are ${view.view_of}'s, so change it on ${view.view_of}`)
}

/** A view's label, description and filters change; its base never does.
 *  Its one caller (updateTable) has already found `name` to be a view. */
export async function updateView(name: string, input: unknown, user = 'Administrator'): Promise<TableMeta> {
  const meta = await getMeta(name)
  const body = (input ?? {}) as Record<string, unknown>
  if (body.view_of !== undefined && body.view_of !== meta.view_of)
    throw new AppError('ValidationError', `A view keeps its base; make a new view of ${String(body.view_of)} instead`, { view_of: 'cannot change' })
  if (body.kind !== undefined && body.kind !== 'view') throw new AppError('ValidationError', 'kind cannot be changed after creation')
  // Anything else is its base's: dropping it silently would report a change
  // that never happened.
  if (Object.keys(body).some((key) => !['name', 'kind', 'view_of', 'label', 'description', 'view_filters'].includes(key)))
    throw baseOnlyChange(meta)
  const base = await viewBase(meta.view_of!)
  const filters = body.view_filters === undefined ? meta.view_filters ?? [] : normaliseViewFilters(base, body.view_filters)
  const text = (key: string) => body[key] === undefined ? (meta as unknown as Record<string, unknown>)[key] ?? null
    : typeof body[key] === 'string' && (body[key] as string).trim() ? (body[key] as string).trim() : null
  await sql`update table_def set ${sql({
    label: text('label'), description: text('description'),
    view_filters: sql.json(filters as never), updated_by: user, updated_at: new Date(),
  } as unknown as Record<string, never>)} where name = ${name}`
  invalidateMeta(name)
  return getMeta(name)
}

/** #1021: a base keeps the columns its views filter on. */
export async function assertNotViewFilterColumn(table: string, column: string, verb: string): Promise<void> {
  const using = (await viewsOf(table)).filter((v) => filterColumns(v.filters).includes(column))
  if (using.length)
    throw new AppError('ValidationError',
      `${table}.${column} cannot be ${verb}: the view${using.length === 1 ? '' : 's'} ${using.map((v) => v.name).join(', ')} filter${using.length === 1 ? 's' : ''} on it`,
      { [column]: `used by ${using.map((v) => v.name).join(', ')}` })
}

/** #1021: a link column moving to a view keeps its values only if every one
 *  is a row of the view; otherwise the move is refused, naming them, rather
 *  than leaving rows that fail their next save. */
async function assertValuesInView(table: string, relation: string, column: string, target: string): Promise<void> {
  const view = await getMeta(target)
  if (view.kind !== 'view') return
  const baseRelation = await tableRelation(view.view_of!)
  const col = quoteIdent(column)
  const rows = await sql.unsafe(`select distinct t.${col} as value from ${relation} t
    where t.${col} is not null and t.${col} <> '' order by 1`) as unknown as { value: string }[]
  const values = rows.map((r) => String(r.value))
  const inside = await rowsInView(sql, view, values, baseRelation)
  const outside = values.filter((v) => !inside.has(v))
  if (outside.length) {
    const shown = outside.slice(0, 20).join(', ')
    const why = `${shown}${outside.length > 20 ? ` and ${outside.length - 20} more` : ''} ${outside.length === 1 ? 'is' : 'are'} not ${target} rows`
    throw new AppError('ValidationError', `${table}.${column} cannot link to ${target}: ${why}`, { [column]: why })
  }
}

export async function createTable(
  input: unknown,
  ownerApp?: string,
  opts: { alongside?: readonly string[] } = {},
): Promise<TableMeta> {
  // #1021: a view is defined by its base and filters, not by columns.
  if (input && typeof input === 'object' && (input as { kind?: unknown }).kind === 'view') {
    if (ownerApp) throw new AppError('ValidationError', 'An app cannot define a view yet')
    return createView(input)
  }
  const parsed = tableDefSchema.safeParse(input)
  if (!parsed.success) {
    const errs: Record<string, string> = {}
    for (const issue of parsed.error.issues) errs[issue.path.join('.')] = issue.message
    throw new AppError('ValidationError', 'Invalid Table definition', errs)
  }
  const def = parsed.data
  const qualified = def.name.includes('.')
  if (qualified && def.name.split('.')[0] !== ownerApp)
    throw new AppError('ValidationError', 'App-qualified Tables must be created by their owning app')
  if (qualified && (def.data_source || def.kind === 'settings'))
    throw new AppError('ValidationError', 'Runtime app Tables require local collection storage')
  // DOC-008: submittable rows track their cancelled predecessor.
  if (def.is_submittable && !def.columns.some((f) => f.column_name === 'amended_from'))
    def.columns.push({
      column_name: 'amended_from',
      label: 'Amended From',
      column_type: 'Reference',
      reference_table: def.name,
      hidden: true,
    })
  validateDef(def)
  if (def.id_pattern)
    validateIdPattern(def.id_pattern, def.columns.map((f) => f.column_name))

  const [existing] = await sql`select 1 from table_def where name = ${def.name}`
  if (existing)
    throw new AppError('ConflictError', `Table ${def.name} already exists`)

  // #137: engine-owned RAW tables (series, single_value, migration,
  // access_token, tag_link, …) carry no `table_def` row, so the check above
  // cannot see them — a Table named "Access Token" sailed past it and then
  // collided with the credential store at DDL time, surfacing as a raw
  // `relation "access_token" already exists`.
  //
  // The reserved set is DERIVED, not enumerated: whatever already occupies
  // the physical name we are about to create is a collision, no matter what
  // created it. A hand-written literal rots silently every time a raw table
  // is added (the first draft of this guard covered 3 of ~10), and this asks
  // the database the same question the DDL would — just early enough to
  // answer with a real error instead of a Postgres one.
  //
  // #432: every kind is checked, Settings Tables included. A Settings Table
  // creates no storage of its own, but tableRelation() still resolves its
  // name, so a Settings Table spelled like a platform relation would reach
  // that relation's rows.
  //
  // #906: only the schema the Table will live in is checked. The host
  // registry public.site is outside it, so "Site" is a free name.
  const physical = tableName(def.name)
  const relation = qualified ? `${ownerApp}.${def.name.split('.')[1]}` : platformRelation(physical)
  const [clash] = await sql`
    select 1 from information_schema.tables
    where table_schema = ${qualified ? ownerApp! : PLATFORM_SCHEMA}
      and table_name = ${qualified ? def.name.split('.')[1] : physical}`
  if (clash)
    throw new AppError('ConflictError', `Table ${def.name} collides with an internal table`, {
      name: `"${physical}" is reserved for platform storage`,
    })
  // #432: names match case-sensitively but storage does not ("Activity Log"
  // and "activity log" are one relation), and a Settings Table or a bound
  // Table owns no physical table for the check above to find. No two Tables
  // may resolve to the same relation.
  const owners = await sql<{ name: string; physical_schema?: string | null; physical_relation?: string | null }[]>`
    select * from table_def`
  const owner = owners.find((o) => resolvedRelation(o) === relation)
  if (owner)
    throw new AppError('ConflictError', `Table ${def.name} would share storage with ${owner.name}`, {
      name: `"${physical}" already belongs to ${owner.name}`,
    })

  // EDS-3 (review finding 10): a binding written by hand (POST /api/table_def)
  // is checked against the live source — it must exist, be allowlisted, and
  // carry every mapped column — instead of persisting a Table that only
  // fails later at query time. Imported lazily: reflect.ts imports this
  // module for createTable.
  if (def.data_source) {
    const { assertBindingIsValid } = await import('./sources/reflect')
    await assertBindingIsValid({
      name: def.name,
      data_source: def.data_source,
      external_schema: def.external_schema,
      external_table: def.external_table!,
      external_pk: def.external_pk!,
      external_modified: def.external_modified,
      columns: def.columns.map((c) => ({
        column_name: c.column_name,
        source_column: c.source_column,
      })),
    })
  }

  await assertLinkTargetsExist(def, def.columns, opts.alongside)

  // Sub-table columns must point at an existing sub_table-kind Table.
  for (const f of def.columns) {
    if (f.column_type !== 'Sub-table') continue
    const [child] = await sql`select kind from table_def where name = ${f.row_table!}`
    if (!child)
      throw new AppError('ValidationError', 'Invalid Sub-table column target', {
        [f.column_name]: `Sub-table target ${f.row_table} does not exist`,
      })
    if (child.kind !== 'sub_table')
      throw new AppError('ValidationError', 'Invalid Sub-table column target', {
        [f.column_name]: `${f.row_table} is not a sub_table Table`,
      })
  }

  await sql.begin(async (tx) => {
    const tableRow: Record<string, unknown> = {
      name: def.name,
      module: def.module ?? 'Core',
      kind: def.kind ?? 'table',
      is_submittable: def.is_submittable ?? false,
      // #855: a new Table numbers its rows 1, 2, 3 unless told otherwise. Child
      // rows and a Settings Table's single row keep random ids, and a bound
      // Table's ids come from its source.
      id_pattern: def.id_pattern ?? ((def.kind ?? 'table') === 'table' && !def.data_source ? DEFAULT_ID_PATTERN : 'hash'),
      title_column: def.title_column ?? null,
      reading_presentation: def.reading_presentation ?? null,
      description: def.description ?? null,
      system: def.system ?? false,
    }
    await assertTableAddressAvailable(tx, def.name)
    if (def.decides_scope) tableRow.decides_scope = true
    if (def.scope_on?.length) tableRow.scope_on = def.scope_on
    if (def.scope_required) tableRow.scope_required = true
    if (def.access_policy) tableRow.access_policy = def.access_policy
    if (qualified) {
      tableRow.label = def.label ?? def.name.split('.')[1]
      tableRow.owner_app = ownerApp
      tableRow.physical_schema = ownerApp
      tableRow.physical_relation = def.name.split('.')[1]
      await tx.unsafe(`create schema if not exists ${quoteRelation(ownerApp!)}`)
    }
    if (def.data_source) {
      tableRow.data_source = def.data_source
      tableRow.external_schema = def.external_schema ?? null
      tableRow.external_table = def.external_table ?? null
      tableRow.external_pk = def.external_pk ?? null
      tableRow.external_modified = def.external_modified ?? null
    }
    await tx`insert into table_def ${tx(tableRow as Record<string, never>)}`
    for (const [i, f] of def.columns.entries()) {
      const columnRow: Record<string, unknown> = {
        parent: def.name,
        position: i + 1,
        column_name: f.column_name,
        label: f.label ?? prettifyLabel(f.column_name),
        column_type: f.column_type,
        reference_table: f.reference_table ?? null,
        ...(f.table_column ? { table_column: f.table_column } : {}),
        choices: f.table_column ? allowedTables(f.choices).join('\n') || null : f.choices ?? null,
        choice_labels: f.choice_labels == null ? null : tx.json(f.choice_labels),
        row_table: f.row_table ?? null,
        reqd: f.reqd ?? false,
        unique: f.unique ?? false,
        default_value: f.default_value ?? null,
        read_only: f.read_only ?? false,
        hidden: f.hidden ?? false,
        in_list_view: f.in_list_view ?? false,
        tier: f.tier ?? 'basic',
      }
      if (f.source_column != null) columnRow.source_column = f.source_column
      if (f.description != null) columnRow.description = f.description
      await tx`insert into column_def ${tx(columnRow as Record<string, never>)}`
    }
    // BV1!: a bound Table never causes DDL — no CREATE TABLE, no RLS, no
    // index. Its storage belongs to the source.
    const relation = qualified
      ? `${tableRow.physical_schema}.${tableRow.physical_relation}`
      : platformRelation(physical)
    const ddl = def.data_source ? null : createTableDDL(def, relation)
    if (ddl) {
      await tx.unsafe(ddl)
      if (def.kind === 'sub_table')
        await tx.unsafe(
          `create index ${quoteIdent(`${tableName(def.name)}_parent_idx`)} on ${quoteRelation(relation)} ("parent", "position")`,
        )
      await applyRls(tx, def, relation)
    }
  })
  invalidateMeta(def.name)
  return getMeta(def.name)
}

// DEL-R2..R8 (docs/specs/0003-table-deletion.md): delete a Table outright —
// definition, columns, physical table, and every live pointer at it.
export async function deleteTable(name: string, user = 'Administrator', opts: { ownerApp?: string } = {}): Promise<void> {
  const meta = await getMeta(name)
  assertNotSystemWritten(meta, 'deleted')
  if (meta.access_policy) throw new AppError('PermissionError', 'A protected Table must retain its access policy for private history')
  if (meta.system)
    throw new AppError('ValidationError', `${meta.name} is a system table and cannot be deleted`)
  // #1021: a Table goes only once no view is based on it.
  const views = await viewsOf(meta.name)
  if (views.length)
    throw new AppError('ValidationError',
      `Cannot delete ${meta.name}: the view${views.length === 1 ? '' : 's'} ${views.map((v) => v.name).join(', ')} ${views.length === 1 ? 'is' : 'are'} based on it. Delete ${views.length === 1 ? 'that view' : 'those views'} first.`)

  // #122: an installed app owns its tables as a set — the registry records
  // them, and uninstalling removes them and the record together. Deleting
  // one alone would leave the app recorded as installed without it.
  // The ledger is read as uninstall reads it, so a row stored as a JSON
  // string counts too. #651: the owning app's own upgrade may drop one; the
  // upgrade updates the registry in the same transaction.
  const owner = (await sql<{ name: string; tables: unknown }[]>`select name, tables from installed_app order by name`)
    .find((app) => asNameList(app.tables).includes(meta.name))
  if (opts.ownerApp !== undefined && meta.owner_app !== opts.ownerApp)
    throw new AppError('ValidationError', `${meta.name} belongs to ${meta.owner_app ?? 'the platform'}; only its own app drops it`)
  if (owner && owner.name !== opts.ownerApp)
    throw new AppError(
      'ValidationError',
      `Cannot delete ${meta.name}: it belongs to the installed app ${owner.name}. Uninstall the app to remove its tables.`,
    )

  // DEL-R3: DOC-006's reverse lookup, one level up. Any OTHER Table whose
  // schema targets this one — a Reference column or a Sub-table's row
  // storage — blocks, even with zero data rows: the column is the dependency.
  const blockers = [...await sql<{ parent: string; column_name: string }[]>`
    select parent, column_name from column_def
    where (reference_table = ${meta.name} or row_table = ${meta.name})
      and parent <> ${meta.name}
    order by parent, column_name`]
  // #881: a link to a row of any Table that allows this one depends on it the
  // same way, and so does one that holds a link to a row of it.
  const anyLinks = await anyTableLinkColumns(sql)
  for (const link of anyLinks) {
    if (link.parent === meta.name) continue
    const [def] = await sql<{ choices: string | null }[]>`
      select choices from column_def where parent = ${link.parent} and column_name = ${link.column_name}`
    const [held] = allowedTables(def?.choices).includes(meta.name) ? [true] : await sql`
      select 1 from ${sql(await storedRelation(link.parent))}
      where ${sql(link.table_column)} = ${meta.name} and ${sql(link.column_name)} is not null limit 1`
    if (held) blockers.push({ parent: link.parent, column_name: link.column_name })
  }
  if (blockers.length)
    throw new AppError(
      'ValidationError',
      `Cannot delete ${meta.name}: referenced by ${blockers
        .map((b) => `${b.parent}.${b.column_name}`)
        .join(', ')}`,
    )

  // DEL-R4: "live pointer" is defined by metadata — every column anywhere
  // declared Reference → Table. Plain-text mentions (Data columns like the
  // Access Log's) are testimony, not pointers, and survive. Settings-kind
  // and bound owners hold no local rows to sweep.
  const pointers = await sql<{ parent: string; column_name: string }[]>`
    select cd.parent, cd.column_name from column_def cd
    join table_def td on td.name = cd.parent
    where cd.column_type = 'Reference' and cd.reference_table = 'Table'
      and cd.parent <> ${meta.name}
      and td.kind <> 'settings' and td.data_source is null
      -- #432: history survives its Table. Version, Import Log, Email Queue
      -- and Notification Log rows keep naming a Table that is gone.
      and not td.system_written`

  const physical = quoteRelation(await tableRelation(meta.name))
  const files = await sql.begin(async (tx) => {
    const removedFiles: { file_url: string | null }[] = []
    // This Table's own child rows; the child Table definition is not
    // cascaded — it may serve other parents (DEL-R2). Collect actual deleted
    // IDs before the generic pointer sweep can remove those rows (#123).
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      const children = await tx<{ row_id: string }[]>`
        delete from ${tx(await storedRelation(f.row_table!))} where parenttype = ${meta.name} returning row_id`
      if (children.length) removedFiles.push(...await tx<{ file_url: string | null }[]>`
        delete from file where ref_table = ${f.row_table!} and ref_name in ${tx(children.map((r) => r.row_id))}
        returning file_url`)
    }
    removedFiles.push(...await tx<{ file_url: string | null }[]>`
      delete from file where ref_table = ${meta.name} returning file_url`)
    for (const p of pointers) {
      // #881: the Table half of a link to any Table only names which Table;
      // with no row linked (checked above) the rest of its row is kept.
      if (anyLinks.some((l) => l.parent === p.parent && l.table_column === p.column_name)) {
        await tx`
          update ${tx(await storedRelation(p.parent))} set ${tx(p.column_name)} = null
          where ${tx(p.column_name)} = ${meta.name}`
        continue
      }
      await tx`
        delete from ${tx(await storedRelation(p.parent))}
        where ${tx(p.column_name)} = ${meta.name}`
    }
    await tx`delete from column_def where parent = ${meta.name}`
    await tx`delete from table_def where name = ${meta.name}`
    // DEL-R6/BV1: a bound Table sheds its binding, never its source's
    // storage; a settings Table never had a physical table. RLS policies
    // drop with the table. Series counters are deliberately untouched
    // (DEL-R5 / IMP-R6: the pattern is the promise, not the number).
    // #1021: nor did a view.
    if (!meta.data_source && meta.kind !== 'settings' && meta.kind !== 'view')
      await tx.unsafe(`drop table if exists ${physical}`)
    return removedFiles
  })
  invalidateMeta(meta.name)
  // DEL-R7: bytes are removed best-effort after commit — a survivor is disk
  // garbage, not a leak. Only managed URLs qualify; another File row may
  // still own these bytes. Failure here cannot undo the committed deletion.
  // #651: inside an app upgrade's transaction nothing is committed yet, and
  // a later step may still roll it all back, so the bytes stay (garbage at
  // worst, never a File row pointing at nothing).
  for (const url of inAppTransaction() ? [] : new Set(files.map((f) => f.file_url))) {
    if (!url || !/^\/(?:private\/)?files\/[a-f0-9]{16}_[\w.-]+$/.test(url)) continue
    try {
      const survivors = await sql.begin((tx) => tx`select 1 from file where file_url = ${url} limit 1`)
      if (!survivors.length) await deleteStored(url)
    } catch {
      console.warn('Table deleted; attachment cleanup could not complete')
    }
  }
  // DEL-R8: audit is independent of cleanup, and an audit outage must not
  // claim that an already committed deletion was refused.
  await sql.begin((tx) => logAccess(user, 'delete_table', { table: meta.name }, tx))
    .catch(() => console.warn('Table deleted; deletion audit could not be recorded'))
}

/** #932: every Copy again finds the deleted-at-source marker by its name, so
 *  while the Table is copied from a data source it keeps that name. */
export async function assertNotCopyMarker(table: string, column: string, verb: 'renamed' | 'removed' | 'changed'): Promise<void> {
  if (column !== DELETED_AT_SOURCE) return
  const [copied] = await sql`select 1 from featherbase.table_copy where target_table = ${table}`
  if (copied)
    throw new AppError('ValidationError',
      `${column} marks rows deleted at the source while ${table} is copied from a data source, so it cannot be ${verb}`)
}

// #651: change a column's type where every stored value converts as it is
// (SAFE_TYPE_CHANGES); anything else is refused.
export async function changeColumnType(table: string, column: string, to: string,
  opts: { reference_table?: string | null } = {}): Promise<TableMeta> {
  const meta = await getMeta(table)
  if (policyColumns(meta.access_policy).includes(column))
    throw new AppError('PermissionError', 'A column that defines mandatory access cannot change type')
  assertNotSystemWritten(meta, 'changed')
  if (meta.system || meta.data_source || meta.kind === 'view')
    throw new AppError('ValidationError', `${meta.name}'s column types are not changed here`)
  const current = meta.columns.find((c) => c.column_name === column)
  if (!current) throw new AppError('NotFoundError', `${meta.name} has no column ${column}`)
  if (current.column_type !== to) await assertNotViewFilterColumn(meta.name, column, 'changed')
  if (current.column_type !== to) await assertNotCopyMarker(meta.name, column, 'changed')
  const from = current.column_type
  if (from === to) return meta
  if (!isSafeTypeChange(from, to))
    throw new AppError('ValidationError', `${meta.name}.${column}: ${from} to ${to} is not a safe conversion; add a new column, copy the data, then drop the old one`)
  const relation = quoteRelation(await tableRelation(meta.name))
  if (isLinkTypeChange(from, to)) {
    if (current.table_column)
      throw new AppError('ValidationError', `${meta.name}.${column} is a link to a row of any Table, so it does not turn into text`)
    const target = to === 'Reference' ? opts.reference_table ?? null : null
    if (to === 'Reference') {
      if (!target) throw new AppError('ValidationError', `${meta.name}.${column}: a link needs the Table it links to`)
      await assertLinkTargetsExist({ name: meta.name } as TableDef, [{ column_name: column, column_type: 'Reference', reference_table: target }])
    }
    await sql.begin(async (tx) => {
      if (target) await assertValuesNameRows(tx, relation, meta.name, column, target)
      await tx`update column_def set column_type = ${to}, reference_table = ${target}
        where parent = ${meta.name} and column_name = ${column}`
    })
    invalidateMeta(meta.name)
    return getMeta(meta.name)
  }
  const cast = SAFE_TYPE_CHANGES[from][to]
  await sql.begin(async (tx) => {
    const col = quoteIdent(column)
    if (cast && meta.kind !== 'settings')
      await tx.unsafe(`alter table ${relation} alter column ${col} type ${cast} using ${col}${from === 'Check' ? '::int' : ''}::${cast}`)
    await tx`update column_def set column_type = ${to} where parent = ${meta.name} and column_name = ${column}`
  })
  invalidateMeta(meta.name)
  return getMeta(meta.name)
}
