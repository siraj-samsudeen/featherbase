import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { COLUMN_TYPE_VALUES, type TableMeta, getMeta, invalidateMeta } from './meta'
import { logAccess } from './audit'
import { deleteStored } from './storage'

// Columns every generated table has (META-005); user columns cannot shadow them.
export const STANDARD_COLUMNS = [
  'name',
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

export function pgType(columnType: string): string | null {
  if (!(columnType in PG_TYPES))
    throw new AppError('ValidationError', `Unknown column type ${columnType}`)
  return PG_TYPES[columnType]
}

const columnSchema = z.object({
  column_name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, 'column_name must be snake_case'),
  label: z.string().optional(),
  column_type: z.enum(COLUMN_TYPE_VALUES),
  // Type-specific target, replacing the old overloaded "options" key:
  // Reference -> target table name, Choice -> newline/comma list of choices,
  // Sub-table -> the sub-table's Table name.
  reference_table: z.string().optional(),
  choices: z.string().optional(),
  row_table: z.string().optional(),
  reqd: z.boolean().optional(),
  unique: z.boolean().optional(),
  default_value: z.string().optional(),
  read_only: z.boolean().optional(),
  hidden: z.boolean().optional(),
  in_list_view: z.boolean().optional(),
  tier: z.enum(['basic', 'restricted']).optional(),
  // EDS-3: true column name on a bound Table's source when the legal
  // column_name had to differ (reserved word, illegal characters).
  source_column: z.string().optional(),
})

export const tableDefSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9 ]{0,60}$/, 'invalid Table name'),
  module: z.string().optional(),
  // Replaces the old istable/issingle booleans: 'table' = normal collection,
  // 'sub_table' = rows only ever nested inside a parent row, 'settings' = a
  // single-row Settings Table (no list, no collection table).
  kind: z.enum(['table', 'sub_table', 'settings']).optional(),
  is_submittable: z.boolean().optional(),
  id_pattern: z.string().optional(),
  title_column: z.string().optional(),
  description: z.string().optional(),
  // #74: platform-table flag. Accepted here so migrations and seeds can set
  // it through createTable; the public /api/doctype routes REJECT it — a
  // user-created table can never claim system: true.
  system: z.boolean().optional(),
  // EDS-3: binding to an external Data Source. Set only at creation (BV3) —
  // updateTable never touches these. A bound Table gets no DDL and no RLS
  // (BV1): its rows live on the source.
  data_source: z.string().optional(),
  external_schema: z.string().optional(),
  external_table: z.string().optional(),
  external_pk: z.string().optional(),
  external_modified: z.string().optional(),
  columns: z.array(columnSchema).min(1),
})

export type TableDef = z.infer<typeof tableDefSchema>

// NAM-001: the id_pattern kinds resolveName() (document.ts) understands. A
// series prefix may not itself contain the '.' that separates it from the
// digit mask, or resolveName would cut the prefix short.
export function validateIdPattern(pattern: string, columnNames: string[]): void {
  const bad = (message: string) =>
    new AppError('ValidationError', message, { id_pattern: message })
  if (pattern === 'hash' || pattern === 'prompt') return
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
// PUT /api/doctype round-trip would have the client resend every column, and
// an omission there silently rewrites the schema.
export async function setIdPattern(name: string, pattern: string): Promise<TableMeta> {
  const meta = await getMeta(name)
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

// Table and Column describe themselves, but "table"/"column" are reserved
// SQL keywords — their physical storage is table_def/column_def (chosen at
// bootstrap specifically to dodge that collision) rather than the naive
// lowercased name every other Table gets.
const PHYSICAL_TABLE_OVERRIDES: Record<string, string> = {
  table: 'table_def',
  column: 'column_def',
}

export function tableName(table: string): string {
  const naive = table.toLowerCase().replace(/\s+/g, '_')
  return PHYSICAL_TABLE_OVERRIDES[naive] ?? naive
}

// META-003: generate the CREATE TABLE statement for a Table definition.
// Standard columns (META-005) are always present; sub-tables additionally
// carry parent linkage. Settings Tables (kind: 'settings') get no table.
function createTableDDL(def: TableDef): string | null {
  if (def.kind === 'settings') return null
  const cols: string[] = [
    `"name" varchar(140) primary key`,
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
    cols.push(`"${f.column_name}" ${type}`)
    if (f.unique)
      constraints.push(
        `constraint "${tableName(def.name)}_${f.column_name}_uq" unique ("${f.column_name}")`,
      )
  }
  return `create table "${tableName(def.name)}" (\n  ${[...cols, ...constraints].join(',\n  ')}\n)`
}

// PERM-004: new tables get RLS with a generated SELECT-only policy for the
// direct-client role (app_client). Skipped while bootstrap migrations run
// before 0010_rls.sql has created the role and fc_has_read(); that migration
// sweeps every table that already exists.
async function applyRls(
  tx: { unsafe: (q: string) => Promise<unknown> },
  def: TableDef,
): Promise<void> {
  const [ready] = (await tx.unsafe(
    `select 1 from pg_proc where proname = 'fc_has_read'`,
  )) as unknown as unknown[]
  if (!ready) return
  const table = tableName(def.name)
  await tx.unsafe(`alter table "${table}" enable row level security`)
  const predicate = def.kind === 'sub_table'
    ? 'fc_has_read(parenttype)'
    : `fc_has_read('${def.name.replace(/'/g, "''")}')`
  await tx.unsafe(
    `create policy fc_select on "${table}" for select to app_client using (${predicate})`,
  )
  await tx.unsafe(`grant select on "${table}" to app_client`)
}

// META-004: sync an existing Table's columns to a new definition. Additions
// create columns; property edits update column_def rows; removals delete the
// column_def row but KEEP the physical column (data is never dropped without
// the explicit drop_columns flag). Column-type changes are rejected.
export async function updateTable(
  name: string,
  input: unknown,
  opts: { drop_columns?: boolean } = {},
): Promise<TableMeta> {
  const existing = await getMeta(name)
  const parsed = tableDefSchema.safeParse({ ...(input as object), name })
  if (!parsed.success) {
    const errs: Record<string, string> = {}
    for (const issue of parsed.error.issues) errs[issue.path.join('.')] = issue.message
    throw new AppError('ValidationError', 'Invalid Table definition', errs)
  }
  const def = parsed.data
  // BV3: the binding is immutable — whatever the caller sent, the existing
  // binding is what validateDef judges against (and what stays stored).
  if (existing.data_source) {
    def.data_source = existing.data_source
    def.external_table = existing.external_table ?? undefined
    def.external_pk = existing.external_pk ?? undefined
  } else if (def.data_source) {
    throw new AppError('ValidationError', 'An existing Table cannot be bound to a data source')
  }
  if (def.is_submittable && !def.columns.some((f) => f.column_name === 'amended_from'))
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

  // A bound Table's column changes are metadata-only (BV1: no DDL against
  // anyone's storage, ours included).
  const isBound = Boolean(existing.data_source)
  const table = tableName(name)
  await sql.begin(async (tx) => {
    await tx`update table_def set ${tx({
      module: def.module ?? existing.module,
      is_submittable: def.is_submittable ?? existing.is_submittable,
      id_pattern: def.id_pattern ?? existing.id_pattern,
      title_column: def.title_column ?? null,
      description: def.description ?? null,
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
      // Only touch source_column when a value exists — pre-0064 migrations
      // that call updateTable run before the column does (fresh databases).
      const sourceColumn = f.source_column ?? (old ? old.source_column : null)
      if (sourceColumn != null) row.source_column = sourceColumn
      if (!old) {
        await tx`insert into column_def ${tx({
          parent: name,
          column_name: f.column_name,
          column_type: f.column_type,
          ...row,
        })}`
        const type = pgType(f.column_type)
        if (type && existing.kind !== 'settings' && !isBound)
          await tx.unsafe(`alter table "${table}" add column if not exists "${f.column_name}" ${type}`)
        if (f.unique && type && !isBound)
          await tx.unsafe(
            `alter table "${table}" add constraint "${table}_${f.column_name}_uq" unique ("${f.column_name}")`,
          )
      } else {
        await tx`update column_def set ${tx(row)}
          where parent = ${name} and column_name = ${f.column_name}`
        const type = pgType(f.column_type)
        if (type && existing.kind !== 'settings' && !isBound && Boolean(old.unique) !== Boolean(f.unique)) {
          if (f.unique)
            await tx.unsafe(
              `alter table "${table}" add constraint "${table}_${f.column_name}_uq" unique ("${f.column_name}")`,
            )
          else
            await tx.unsafe(
              `alter table "${table}" drop constraint if exists "${table}_${f.column_name}_uq"`,
            )
        }
      }
    }

    for (const [column_name, old] of before) {
      if (after.has(column_name)) continue
      await tx`delete from column_def where parent = ${name} and column_name = ${column_name}`
      const type = pgType(old.column_type)
      if (type && existing.kind !== 'settings' && !isBound && opts.drop_columns)
        await tx.unsafe(`alter table "${table}" drop column if exists "${column_name}"`)
      // without drop_columns the column (and its data) is retained
    }
  })
  invalidateMeta(name)
  return getMeta(name)
}

export async function createTable(input: unknown): Promise<TableMeta> {
  const parsed = tableDefSchema.safeParse(input)
  if (!parsed.success) {
    const errs: Record<string, string> = {}
    for (const issue of parsed.error.issues) errs[issue.path.join('.')] = issue.message
    throw new AppError('ValidationError', 'Invalid Table definition', errs)
  }
  const def = parsed.data
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
  // answer with a real error instead of a Postgres one. Settings Tables are
  // exempt because they generate no DDL; their values live in single_value.
  const physical = tableName(def.name)
  if (def.kind !== 'settings') {
    const [clash] = await sql`
      select 1 from information_schema.tables
      where table_schema = current_schema() and table_name = ${physical}`
    if (clash)
      throw new AppError('ConflictError', `Table ${def.name} collides with an internal table`, {
        name: `"${physical}" is reserved for platform storage`,
      })
  }

  // EDS-3 (review finding 10): a binding written by hand (POST /api/doctype)
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
    // The binding keys exist only from migration 0064 on. Include them only
    // when actually binding, so the pre-0064 migrations (0005…) that call
    // createTable still work on a FRESH database mid-chain — omitting the
    // keys entirely keeps the INSERT valid against the older shape.
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
      await tx`insert into column_def ${tx(columnRow as Record<string, never>)}`
    }
    // BV1!: a bound Table never causes DDL — no CREATE TABLE, no RLS, no
    // index. Its storage belongs to the source.
    const ddl = def.data_source ? null : createTableDDL(def)
    if (ddl) {
      await tx.unsafe(ddl)
      if (def.kind === 'sub_table')
        await tx.unsafe(
          `create index "${tableName(def.name)}_parent_idx" on "${tableName(def.name)}" ("parent", "position")`,
        )
      await applyRls(tx, def)
    }
  })
  invalidateMeta(def.name)
  return getMeta(def.name)
}

// DEL-R2..R8 (docs/specs/0003-table-deletion.md): delete a Table outright —
// definition, columns, physical table, and every live pointer at it.
export async function deleteTable(name: string, user = 'Administrator'): Promise<void> {
  const meta = await getMeta(name)
  if (meta.system)
    throw new AppError('ValidationError', `${meta.name} is a system table and cannot be deleted`)

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
      and td.kind <> 'settings' and td.data_source is null`

  // DEL-R7: capture attachment urls before their registry rows vanish.
  const files = await sql<{ file_url: string | null }[]>`
    select file_url from file where ref_table = ${meta.name}`

  const physical = tableName(meta.name)
  await sql.begin(async (tx) => {
    for (const p of pointers)
      await tx`
        delete from ${tx(tableName(p.parent))}
        where ${tx(p.column_name)} = ${meta.name}`
    // This Table's own child rows; the child Table definition is not
    // cascaded — it may serve other parents (DEL-R2).
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      await tx`
        delete from ${tx(tableName(f.row_table!))} where parenttype = ${meta.name}`
    }
    await tx`delete from column_def where parent = ${meta.name}`
    await tx`delete from table_def where name = ${meta.name}`
    // DEL-R6/BV1: a bound Table sheds its binding, never its source's
    // storage; a settings Table never had a physical table. RLS policies
    // drop with the table. Series counters are deliberately untouched
    // (DEL-R5 / IMP-R6: the pattern is the promise, not the number).
    if (!meta.data_source && meta.kind !== 'settings')
      await tx.unsafe(`drop table if exists "${physical}"`)
  })
  invalidateMeta(meta.name)
  // DEL-R8: the audit line is plain text, so it outlives its subject.
  await logAccess(user, 'delete_table', { table: meta.name })
  // DEL-R7: bytes are removed best-effort after commit — a survivor is disk
  // garbage, not a leak (files are only served through the registry).
  for (const f of files)
    if (f.file_url) await deleteStored(f.file_url).catch(() => {})
}
