import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { COLUMN_TYPE_VALUES, type TableMeta, getMeta, invalidateMeta } from './meta'

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
      const row = {
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
      if (!old) {
        await tx`insert into column_def ${tx({
          parent: name,
          column_name: f.column_name,
          column_type: f.column_type,
          ...row,
        })}`
        const type = pgType(f.column_type)
        if (type && existing.kind !== 'settings')
          await tx.unsafe(`alter table "${table}" add column if not exists "${f.column_name}" ${type}`)
        if (f.unique && type)
          await tx.unsafe(
            `alter table "${table}" add constraint "${table}_${f.column_name}_uq" unique ("${f.column_name}")`,
          )
      } else {
        await tx`update column_def set ${tx(row)}
          where parent = ${name} and column_name = ${f.column_name}`
        const type = pgType(f.column_type)
        if (type && existing.kind !== 'settings' && Boolean(old.unique) !== Boolean(f.unique)) {
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
      if (type && existing.kind !== 'settings' && opts.drop_columns)
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
    await tx`insert into table_def ${tx({
      name: def.name,
      module: def.module ?? 'Core',
      kind: def.kind ?? 'table',
      is_submittable: def.is_submittable ?? false,
      id_pattern: def.id_pattern ?? 'hash',
      title_column: def.title_column ?? null,
      description: def.description ?? null,
      system: def.system ?? false,
    })}`
    for (const [i, f] of def.columns.entries()) {
      await tx`insert into column_def ${tx({
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
      })}`
    }
    const ddl = createTableDDL(def)
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
