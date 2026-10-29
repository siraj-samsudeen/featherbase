import { z } from 'zod'
import { inAppTransaction, sql, type TxSql } from './db'
import { AppError } from './errors'
import { assertNotSystemWritten } from './system-written'
import { COLUMN_TYPE_VALUES, ROW_KEY, type TableMeta, getMeta, invalidateMeta } from './meta'
import { logAccess } from './audit'
import { deleteStored } from './storage'
import { asNameList } from './installed-app-ledger'
import { COLUMN_NAME_RE, quoteIdent } from './sql-identifier'
import { PLATFORM_SCHEMA, SITE_REGISTRY_RELATION, platformRelation, resolvedRelation, tableName } from './platform-schema'

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
  'status',
  'position',
  'parent',
  'parenttype',
  'parentfield',
] as const

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
export const SAFE_TYPE_CHANGES: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  Int: { Float: 'double precision' },
  Data: { Text: 'text', 'Long Text': 'text', Choice: 'text' },
  Text: { 'Long Text': null },
  'Long Text': { Text: null },
  Choice: { Text: null, 'Long Text': null },
  Date: { Datetime: 'timestamptz' },
  Check: { Int: 'bigint' },
}

export function isSafeTypeChange(from: string, to: string): boolean {
  return Object.hasOwn(SAFE_TYPE_CHANGES, from) && Object.hasOwn(SAFE_TYPE_CHANGES[from], to)
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
  choices: optionalString,
  row_table: optionalString,
  reqd: z.boolean().nullish().transform((v) => v ?? undefined),
  unique: z.boolean().nullish().transform((v) => v ?? undefined),
  default_value: optionalString,
  read_only: z.boolean().nullish().transform((v) => v ?? undefined),
  hidden: z.boolean().nullish().transform((v) => v ?? undefined),
  in_list_view: z.boolean().nullish().transform((v) => v ?? undefined),
  tier: z.enum(['basic', 'restricted']).nullish().transform((v) => v ?? undefined),
  // #473: one plain line every form shows under the control.
  description: optionalString,
  // EDS-3: true column name on a bound Table's source when the legal
  // column_name had to differ (reserved word, illegal characters).
  source_column: optionalString,
})

export const tableDefSchema = z.object({
  name: z
    .string()
    .regex(/^(?:[A-Za-z][A-Za-z0-9 ]{0,60}|[a-z][a-z0-9_]{0,30}\.[a-z][a-z0-9_]{0,30})$/, 'invalid Table name'),
  label: optionalString,
  module: optionalString,
  // Replaces the old istable/issingle booleans: 'table' = normal collection,
  // 'sub_table' = rows only ever nested inside a parent row, 'settings' = a
  // single-row Settings Table (no list, no collection table).
  kind: z.enum(['table', 'sub_table', 'settings']).nullish().transform((v) => v ?? undefined),
  is_submittable: z.boolean().nullish().transform((v) => v ?? undefined),
  id_pattern: optionalString,
  title_column: optionalString,
  description: optionalString,
  // #74: platform-table flag. Accepted here so migrations and seeds can set
  // it through createTable; the public /api/table_def routes REJECT it — a
  // user-created table can never claim system: true.
  system: z.boolean().nullish().transform((v) => v ?? undefined),
  // #559: the Table's rows decide which places people cover. Writing them is
  // System Manager work (security-tables.ts), and only a marked Table can be
  // read by an app's scope provider. Kept when an update leaves it out.
  decides_scope: z.boolean().nullish().transform((v) => v ?? undefined),
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
  if (pattern === 'hash' || pattern === 'prompt') return
  if (pattern.startsWith('opaque:')) {
    if (!/^[a-z]{2,8}_$/.test(pattern.slice('opaque:'.length)))
      throw bad('An opaque id pattern names a short lowercase prefix ending in _, e.g. opaque:psn_')
    return
  }
  if (pattern.startsWith('field:')) {
    const column = pattern.slice('field:'.length)
    if (!columnNames.includes(column))
      throw bad(`Naming column ${column} is not a column of this Table`)
    return
  }
  if (!pattern.includes('.')) throw bad(`Unsupported id pattern ${pattern}`)
  const [prefix, mask] = [
    pattern.slice(0, pattern.indexOf('.')),
    pattern.slice(pattern.indexOf('.') + 1),
  ]
  if (!prefix) throw bad('A series needs a prefix before the digits')
  if (!/^#+$/.test(mask)) throw bad('A series ends in # digit placeholders, e.g. ZONE-.###')
}

// NAM-001: change only how new rows are named. Deliberately narrow — the full
// PUT /api/table_def round-trip would have the client resend every column, and
// an omission there silently rewrites the schema.
export async function setIdPattern(name: string, pattern: string): Promise<TableMeta> {
  const meta = await getMeta(name)
  assertNotSystemWritten(meta, 'renamed or changed')
  validateIdPattern(pattern, meta.columns.map((c) => c.column_name))
  await sql`update table_def set id_pattern = ${pattern}, updated_at = ${new Date()}
            where name = ${name}`
  invalidateMeta(name)
  return getMeta(name)
}

function targetOf(f: TableDef['columns'][number]): string | undefined {
  if (f.column_type === 'Reference') return f.reference_table
  if (f.column_type === 'Sub-table') return f.row_table
  return undefined
}

function validateDef(def: TableDef) {
  const errs: Record<string, string> = {}
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
    if ((STANDARD_COLUMNS as readonly string[]).includes(f.column_name))
      errs[f.column_name] = `'${f.column_name}' is a reserved column name`
    if (seen.has(f.column_name)) errs[f.column_name] = 'duplicate column_name'
    seen.add(f.column_name)
    if (['Reference', 'Sub-table', 'Choice'].includes(f.column_type) && !targetOf(f) && f.column_type !== 'Choice')
      errs[f.column_name] = `${f.column_type} column requires ${f.column_type === 'Reference' ? 'reference_table' : 'row_table'}`
    if (f.column_type === 'Choice' && !f.choices)
      errs[f.column_name] = 'Choice column requires choices'
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
    `"status" text not null default 'draft'`,
    `"position" integer not null default 0`,
  ]
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
  assertNotSystemWritten(existing, 'changed')
  const parsed = tableDefSchema.safeParse({ ...(input as object), name })
  if (!parsed.success) {
    const errs: Record<string, string> = {}
    for (const issue of parsed.error.issues) errs[issue.path.join('.')] = issue.message
    throw new AppError('ValidationError', 'Invalid Table definition', errs)
  }
  const def = parsed.data
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
  validateDef(def)
  if (def.id_pattern)
    validateIdPattern(def.id_pattern, def.columns.map((f) => f.column_name))
  if ((def.kind ?? 'table') !== existing.kind)
    throw new AppError('ValidationError', 'kind cannot be changed after creation')

  const before = new Map(existing.columns.map((f) => [f.column_name, f]))
  const after = new Map(def.columns.map((f) => [f.column_name, f]))
  const errors: Record<string, string> = {}
  for (const [column_name, f] of after) {
    const old = before.get(column_name)
    if (old && old.column_type !== f.column_type)
      errors[column_name] = `column_type cannot change (${old.column_type} -> ${f.column_type})`
  }
  if (Object.keys(errors).length)
    throw new AppError('ValidationError', 'Unsupported schema change', errors)
  await assertLinkTargetsExist(
    def,
    def.columns.filter((f) => before.get(f.column_name)?.reference_table !== f.reference_table),
  )

  // A bound Table's column changes are metadata-only (BV1: no DDL against
  // anyone's storage, ours included).
  const isBound = Boolean(existing.data_source)
  const table = tableName(name)
  const relation = quoteRelation(await tableRelation(name))

  const removing = new Set(opts.remove_columns ?? [])
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
    await tx`update table_def set ${tx({
      module: def.module ?? existing.module,
      is_submittable: def.is_submittable ?? existing.is_submittable,
      id_pattern: def.id_pattern ?? existing.id_pattern,
      title_column: def.title_column ?? null,
      description: def.description ?? null,
      // Only when given: an update that leaves it out keeps the Table's choice.
      ...(def.decides_scope !== undefined ? { decides_scope: def.decides_scope } : {}),
      updated_at: new Date(),
    })} where name = ${name}`

    for (const [i, f] of def.columns.entries()) {
      const old = before.get(f.column_name)
      const row: Record<string, unknown> = {
        position: i + 1,
        label: f.label ?? f.column_name,
        reference_table: f.reference_table ?? null,
        choices: f.choices ?? null,
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

export async function createTable(
  input: unknown,
  ownerApp?: string,
  opts: { alongside?: readonly string[] } = {},
): Promise<TableMeta> {
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
  const physical = tableName(def.name)
  const relation = qualified ? `${ownerApp}.${def.name.split('.')[1]}` : platformRelation(physical)
  const [clash] = await sql`
    select 1 from information_schema.tables
    where (table_schema = ${qualified ? ownerApp! : PLATFORM_SCHEMA}
           and table_name = ${qualified ? def.name.split('.')[1] : physical})
       or (${!qualified && physical === SITE_REGISTRY_RELATION.split('.')[1]}
           and table_schema = 'public' and table_name = 'site')`
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
      id_pattern: def.id_pattern ?? 'hash',
      title_column: def.title_column ?? null,
      description: def.description ?? null,
      system: def.system ?? false,
    }
    if (def.decides_scope) tableRow.decides_scope = true
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
        label: f.label ?? f.column_name,
        column_type: f.column_type,
        reference_table: f.reference_table ?? null,
        choices: f.choices ?? null,
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
  if (meta.system)
    throw new AppError('ValidationError', `${meta.name} is a system table and cannot be deleted`)

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
  const blockers = await sql<{ parent: string; column_name: string }[]>`
    select parent, column_name from column_def
    where (reference_table = ${meta.name} or row_table = ${meta.name})
      and parent <> ${meta.name}
    order by parent, column_name`
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
    for (const p of pointers)
      await tx`
        delete from ${tx(await storedRelation(p.parent))}
        where ${tx(p.column_name)} = ${meta.name}`
    await tx`delete from column_def where parent = ${meta.name}`
    await tx`delete from table_def where name = ${meta.name}`
    // DEL-R6/BV1: a bound Table sheds its binding, never its source's
    // storage; a settings Table never had a physical table. RLS policies
    // drop with the table. Series counters are deliberately untouched
    // (DEL-R5 / IMP-R6: the pattern is the promise, not the number).
    if (!meta.data_source && meta.kind !== 'settings')
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

// #209 (issue #197): rename a column in place, keeping its data.
//
// "In one of the things floor was spelled with a G, Glor." The mistake is in
// the NAME, and the rows underneath it are fine — so the fix has to be a
// rename, not a new column beside the old one.
//
// updateTable cannot do this: it matches columns by `column_name`, so a
// changed name reads as "delete that one, add this one" — the old physical
// column is orphaned with its data and the new one arrives empty. That is a
// silent data loss, which is why this is its own operation with its own DDL.
export async function renameColumn(
  table: string,
  from: string,
  to: string,
  user = 'Administrator',
): Promise<TableMeta> {
  const meta = await getMeta(table)
  assertNotSystemWritten(meta, 'renamed or changed')
  if (meta.system)
    throw new AppError('ValidationError', `${meta.name} is a system table and cannot be changed`)
  // BV1: a bound Table's storage belongs to the source. Renaming its column
  // here would rename nothing real and desynchronise the binding.
  if (meta.data_source)
    throw new AppError(
      'ValidationError',
      `${meta.name} is bound to a data source; rename the column at the source`,
    )

  // Checked BEFORE "no such column": a standard column is not absent, it is
  // off limits, and saying so is the useful answer.
  if ((STANDARD_COLUMNS as readonly string[]).includes(from))
    throw new AppError('ValidationError', `${from} is a standard column and cannot be renamed`)
  const column = meta.columns.find((c) => c.column_name === from)
  if (!column) throw new AppError('NotFoundError', `${meta.name} has no column ${from}`)

  const target = to.trim()
  if (target === from) return meta
  if (!COLUMN_NAME_RE.test(target))
    throw new AppError('ValidationError', 'column_name must be snake_case', { to: 'snake_case' })
  if ((STANDARD_COLUMNS as readonly string[]).includes(target))
    throw new AppError('ValidationError', `${target} is a standard column name`)
  if (meta.columns.some((c) => c.column_name === target))
    throw new AppError('ValidationError', `${meta.name} already has a column ${target}`)

  const physical = tableName(meta.name)
  const relation = quoteRelation(await tableRelation(meta.name))
  const hasStorage = pgType(column.column_type) !== null && meta.kind !== 'settings'

  await sql.begin(async (tx) => {
    if (hasStorage)
      await tx.unsafe(`alter table ${relation} rename column ${quoteIdent(from)} to ${quoteIdent(target)}`)
    await tx`update column_def set column_name = ${target}
      where parent = ${meta.name} and column_name = ${from}`
    // A Sub-table's children name their column on every row, in
    // `parentfield`, and every child read filters on it (document.ts
    // loadChildren). Renaming only the column_def would leave them addressed
    // under a name nothing asks for: the parent loads an empty list, and the
    // next save of that row deletes the children it could not see.
    if (column.column_type === 'Sub-table' && column.row_table)
      await tx.unsafe(
        `update ${quoteRelation(await tableRelation(column.row_table))} set parentfield = $1
          where parenttype = $2 and parentfield = $3`,
        [target, meta.name, from],
      )
    // A unique constraint carries the old name in its own name. Postgres
    // renames the column inside it but not the constraint, so the next
    // updateTable — which builds that name from the column — would fail to
    // find it. Rename it to match.
    if (column.unique && hasStorage)
      await tx.unsafe(
        `alter table ${relation} rename constraint ${quoteIdent(`${physical}_${from}_uq`)} to ${quoteIdent(`${physical}_${target}_uq`)}`,
      )
    // The two places this Table names its own column. Left stale, the id
    // pattern would stop resolving and the list would lose its title.
    if (meta.title_column === from)
      await tx`update table_def set title_column = ${target} where name = ${meta.name}`
    // `field:<column>` is the one id pattern that names a column (see
    // document.ts). Left stale it stops resolving, and every new row fails
    // with "Naming field glor is required" for a column that is gone.
    if (meta.id_pattern === `field:${from}`)
      await tx`update table_def set id_pattern = ${`field:${target}`} where name = ${meta.name}`
    // #651: an Admin override (a relabel, a hidden flag) belongs to the
    // column, not to its old name.
    await tx`update metadata_override set column_name = ${target} where table_name = ${meta.name} and column_name = ${from}`
    await renameInGlossary(tx, meta.name, { table: meta.name, column: from }, { table: meta.name, column: target })
    await tx`update table_def set updated_at = ${new Date()} where name = ${meta.name}`
  })

  invalidateMeta(meta.name)
  await logAccess(user, `rename_column ${from} -> ${target}`, {
    table: 'Table',
    row_id: meta.name,
  }).catch(() => {})
  return getMeta(meta.name)
}

// #629: a glossary term describes Tables and columns by name, in its links
// and in the app's wording it keeps to tell a reworded term from one that is
// not. A rename carries both, or every term naming the old name would lose
// its "?" and refuse its next save.
async function renameInGlossary(tx: TxSql, table: string, from: { table: string; column?: string }, to: { table: string; column?: string }) {
  const key = from.column === undefined ? 'table' : 'column'
  const before = from.column ?? from.table
  const after = to.column ?? to.table
  if (from.column === undefined) await tx`update glossary_link set link_table = ${after} where link_table = ${before}`
  else await tx`update glossary_link set link_column = ${after} where link_table = ${table} and link_column = ${before}`
  await tx`update glossary_term set app_wording = jsonb_set(app_wording, '{describes}', (
      select jsonb_agg(case when d->>'table' = ${table} and d->>${key} = ${before}
        then jsonb_set(d, array[${key}::text], to_jsonb(${after}::text)) else d end order by n)
      from jsonb_array_elements(app_wording->'describes') with ordinality as e(d, n)))
    where jsonb_typeof(app_wording->'describes') = 'array'
      and app_wording->'describes' @> jsonb_build_array(jsonb_build_object('table', ${table}::text, ${key}::text, ${before}::text))`
}

// #651: where the platform keeps a Table's name outside its own definition,
// beyond the link columns declared Reference -> Table (swept by metadata).
const TABLE_NAME_COLUMNS: readonly [string, string][] = [
  ['custom_field', 'reference_table'], ['custom_field', 'row_table'], ['access_log', 'ref_table'],
  ['saved_view', 'ref_table'], ['user_settings', 'table_name'], ['tag_link', 'ref_table'], ['import_log', 'table_created'],
]

// #651: rename one of an app's Tables, keeping its rows, its history, the
// links to it and its grants. Only the owning app's upgrade renames a Table:
// Admin customization never changes what an app's Table is.
export async function renameTable(from: string, to: string, ownerApp: string, user = 'Administrator'): Promise<TableMeta> {
  const meta = await getMeta(from)
  if (meta.owner_app !== ownerApp || !meta.physical_schema || !meta.physical_relation)
    throw new AppError('ValidationError', `${from} belongs to ${meta.owner_app ?? 'the platform'}; only its own app renames it`)
  if (!to.startsWith(`${ownerApp}.`) || !tableDefSchema.shape.name.safeParse(to).success)
    throw new AppError('ValidationError', `${to} is not a name for one of ${ownerApp}'s Tables`)
  const relationName = to.split('.')[1]
  const [taken] = await sql`select 1 from table_def where name = ${to}`
  const [clash] = await sql`select 1 from information_schema.tables where table_schema = ${ownerApp} and table_name = ${relationName}`
  if (taken || clash) throw new AppError('ConflictError', `Table ${to} already exists`)
  const foreign = await sql<{ parent: string; column_name: string }[]>`
    select cd.parent, cd.column_name from column_def cd join table_def td on td.name = cd.parent
    where (cd.reference_table = ${from} or cd.row_table = ${from}) and td.owner_app is not null and td.owner_app <> ${ownerApp}
    order by 1, 2`
  if (foreign.length)
    throw new AppError('ValidationError', `${from} is linked from another app's ${foreign.map((f) => `${f.parent}.${f.column_name}`).join(', ')}`)
  // Every live pointer at a Table, history included: unlike a deletion, a
  // rename keeps what history says, under the name the Table now has.
  const pointers = await sql<{ parent: string; column_name: string }[]>`
    select cd.parent, cd.column_name from column_def cd join table_def td on td.name = cd.parent
    where cd.column_type = 'Reference' and cd.reference_table = 'Table'
      and td.kind <> 'settings' and td.data_source is null
    order by 1, 2`
  const relations = new Map<string, string>()
  // The Table being renamed may hold such a link itself: by the time the
  // sweep runs, its rows live under the new name.
  for (const p of pointers)
    relations.set(p.parent, p.parent === from ? quoteRelation(`${meta.physical_schema}.${to.split('.')[1]}`) : quoteRelation(await storedRelation(p.parent)))
  const children: string[] = []
  for (const c of meta.columns)
    if (c.column_type === 'Sub-table' && c.row_table) children.push(quoteRelation(await storedRelation(c.row_table)))

  const schema = quoteIdent(meta.physical_schema)
  const relation = `${schema}.${quoteIdent(relationName)}`
  await sql.begin(async (tx) => {
    await tx.unsafe(`alter table ${quoteRelation(`${meta.physical_schema}.${meta.physical_relation}`)} rename to ${quoteIdent(relationName)}`)
    // Names Postgres built from the relation (its primary key, and on 18 its
    // NOT NULL constraints): a fresh Table under the new name has them so.
    const built = await tx<{ conname: string }[]>`
      select conname from pg_constraint where conrelid = (
        select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = ${meta.physical_schema!} and c.relname = ${relationName})
      and starts_with(conname, ${`${meta.physical_relation}_`})`
    for (const { conname } of built)
      await tx.unsafe(`alter table ${relation} rename constraint ${quoteIdent(conname)} to ${quoteIdent(`${relationName}_${conname.slice(meta.physical_relation!.length + 1)}`)}`)
    // Names built from the Table's own name, so the next schema change finds them.
    for (const c of meta.columns)
      if (c.unique && pgType(c.column_type))
        await tx.unsafe(`alter table ${relation} rename constraint ${quoteIdent(`${tableName(from)}_${c.column_name}_uq`)} to ${quoteIdent(`${tableName(to)}_${c.column_name}_uq`)}`)
    if (meta.kind === 'sub_table')
      await tx.unsafe(`alter index ${schema}.${quoteIdent(`${tableName(from)}_parent_idx`)} rename to ${quoteIdent(`${tableName(to)}_parent_idx`)}`)
    else {
      const [policy] = await tx`select 1 from pg_policies where schemaname = ${meta.physical_schema!} and tablename = ${relationName} and policyname = 'fc_select'`
      if (policy) await tx.unsafe(`alter policy fc_select on ${relation} using (featherbase.fc_has_read('${to.replace(/'/g, "''")}'))`)
    }
    // column_def's key on table_def has no ON UPDATE: the definition moves.
    const [row] = await tx`select * from table_def where name = ${from}`
    await tx`insert into table_def ${tx({ ...row, name: to, physical_relation: relationName, updated_at: new Date() } as unknown as Record<string, never>)}`
    await tx`update column_def set parent = ${to} where parent = ${from}`
    await tx`delete from table_def where name = ${from}`
    await tx`update column_def set reference_table = ${to} where reference_table = ${from}`
    await tx`update column_def set row_table = ${to} where row_table = ${from}`
    for (const child of children)
      await tx.unsafe(`update ${child} set parenttype = $1 where parenttype = $2`, [to, from])
    for (const p of pointers)
      await tx.unsafe(`update ${relations.get(p.parent)} set ${quoteIdent(p.column_name)} = $1 where ${quoteIdent(p.column_name)} = $2`, [to, from])
    for (const [table, column] of TABLE_NAME_COLUMNS)
      await tx.unsafe(`update ${table} set ${quoteIdent(column)} = $1 where ${quoteIdent(column)} = $2`, [to, from])
    await renameInGlossary(tx, from, { table: from }, { table: to })
    await tx`update home_page_link set label = ${to} where link_to = ${to} and label = ${from}`
    await tx`update installed_app set tables = (
        select jsonb_agg(case when value = to_jsonb(${from}::text) then to_jsonb(${to}::text) else value end order by ordinality)
        from jsonb_array_elements(tables) with ordinality)
      where name = ${ownerApp} and jsonb_typeof(tables) = 'array' and tables ? ${from}`
  })
  invalidateMeta()
  await logAccess(user, `rename_table ${from} -> ${to}`, { table: 'Table', row_id: to }).catch(() => {})
  return getMeta(to)
}

// #651: change a column's type where every stored value converts as it is
// (SAFE_TYPE_CHANGES); anything else is refused.
export async function changeColumnType(table: string, column: string, to: string): Promise<TableMeta> {
  const meta = await getMeta(table)
  assertNotSystemWritten(meta, 'changed')
  if (meta.system || meta.data_source)
    throw new AppError('ValidationError', `${meta.name}'s column types are not changed here`)
  const current = meta.columns.find((c) => c.column_name === column)
  if (!current) throw new AppError('NotFoundError', `${meta.name} has no column ${column}`)
  const from = current.column_type
  if (from === to) return meta
  if (!isSafeTypeChange(from, to))
    throw new AppError('ValidationError', `${meta.name}.${column}: ${from} to ${to} is not a safe conversion; add a new column, copy the data, then drop the old one`)
  const cast = SAFE_TYPE_CHANGES[from][to]
  const relation = quoteRelation(await tableRelation(meta.name))
  await sql.begin(async (tx) => {
    const col = quoteIdent(column)
    if (cast && meta.kind !== 'settings')
      await tx.unsafe(`alter table ${relation} alter column ${col} type ${cast} using ${col}${from === 'Check' ? '::int' : ''}::${cast}`)
    await tx`update column_def set column_type = ${to} where parent = ${meta.name} and column_name = ${column}`
  })
  invalidateMeta(meta.name)
  return getMeta(meta.name)
}
