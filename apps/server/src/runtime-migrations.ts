import { createHash } from 'node:crypto'
import { quoteIdent } from './sql-identifier'
import { z } from 'zod'
import { AppError } from './errors'
import { sql, withTransaction } from './db'
import { provisionApp } from './app-lifecycle'
import { tableSchemaToZod } from 'shared'
import { changeColumnType, columnSchema, createTable, deleteTable, isSafeTypeChange, pgType, quoteRelation, renameColumn, renameTable, STANDARD_COLUMNS, storedRelation, tableDefSchema, updateTable, type TableDef } from './table-engine'
import { ensureHomePageForTable } from './home-pages'
import { COLUMN_TYPE_VALUES, defaultValueFor, invalidateMeta, physicalRowKey } from './meta'

export const packageVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
export function compareVersions(a: string, b: string): number {
  const left = packageVersion.parse(a).split('.').map(BigInt)
  const right = packageVersion.parse(b).split('.').map(BigInt)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export const checksum = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
export function refuse(message: string): never { throw new AppError('ValidationError', message) }

const columnName = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
const ownedTableName = z.string().regex(/^[a-z][a-z0-9_]{0,30}\.[a-z][a-z0-9_]{0,30}$/, 'An app Table is named <app>.<table>')
const column = columnSchema.extend({ column_name: columnName }).strict()
const fill = z.union([z.string(), z.number(), z.boolean()])
// The properties alterColumn may change. `null` in `from` means "not set
// before"; `null` in `to` removes the property.
const alterable = z.object({
  label: z.string().min(1).nullable(),
  choices: z.string().nullable(),
  reqd: z.boolean().nullable(),
  unique: z.boolean().nullable(),
  default_value: z.string().nullable(),
  hidden: z.boolean().nullable(),
  column_type: z.enum(COLUMN_TYPE_VALUES),
}).partial().strict()

// #651: every operation carries what it removes or replaces (a dropped Table
// or column as it stood, an altered column's `from`), so a history replays
// backward from the final declaration as well as forward from the installed
// one.
export const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('addTable'), table: tableDefSchema }).strict(),
  z.object({ kind: z.literal('dropTable'), table: tableDefSchema, destructive: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('addColumn'), table: z.string(), column, position: z.number().int().min(1).optional(), backfill: fill.optional() }).strict(),
  z.object({ kind: z.literal('alterColumn'), table: z.string(), column: columnName, from: alterable, to: alterable,
    destructive: z.boolean().optional(), backfill: fill.optional() }).strict(),
  z.object({ kind: z.literal('renameColumn'), table: z.string(), from: columnName, to: columnName }).strict(),
  z.object({ kind: z.literal('dropColumn'), table: z.string(), column, position: z.number().int().min(1).optional(), destructive: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('renameTable'), from: z.string(), to: ownedTableName }).strict(),
])
export type Operation = z.infer<typeof operationSchema>
export const migrationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,80}$/),
  fromVersion: packageVersion,
  toVersion: packageVersion,
  operations: z.array(operationSchema),
}).strict().superRefine((migration, ctx) => {
  migration.operations.forEach((op, index) => {
    if (op.kind !== 'alterColumn') return
    const from = Object.keys(op.from).sort().join(',')
    if (!from || from !== Object.keys(op.to).sort().join(','))
      ctx.addIssue({ code: 'custom', path: ['operations', index], message: 'alterColumn names the same properties in from and to' })
  })
})
export type PackageMigration = z.infer<typeof migrationSchema>
type MigrationEntry = { id: string; checksum: string }
export const migrationLedger = (migrations: PackageMigration[]): MigrationEntry[] =>
  migrations.map(m => ({ id: m.id, checksum: checksum(m) }))

type Column = TableDef['columns'][number]
type Alterable = z.infer<typeof alterable>

// Unset, null and false mean the same thing in a declaration (the engine
// stores `reqd ?? false`), so they compare equal.
function norm(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(norm)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => [k, norm(v)]))
  return value === null || value === false ? undefined : value
}
const same = (a: unknown, b: unknown) => canonical(norm(a)) === canonical(norm(b))
const byName = (tables: TableDef[]) => [...tables].sort((a, b) => a.name.localeCompare(b.name))

/** Do two declarations describe the same Tables (in any order)? */
export const sameDeclaration = (a: TableDef[], b: TableDef[]) => same(byName(a), byName(b))

function mustOwn(app: string, ...names: string[]) {
  for (const name of names)
    if (!name.startsWith(`${app}.`)) refuse(`An app's migrations change only its own Tables (${app}.*); ${name} is not one`)
}
function tableIn(state: TableDef[], name: string, what: string): TableDef {
  const table = state.find(t => t.name === name)
  if (!table) refuse(`${what}: ${name} is not one of the app's Tables at this point in its history`)
  return table
}
function columnIn(table: TableDef, name: string, what: string): Column {
  const found = table.columns.find(c => c.column_name === name)
  if (!found) refuse(`${what}: ${table.name} has no column ${name} at this point in its history`)
  return found
}
function linksTo(state: TableDef[], name: string): string[] {
  return state.flatMap(t => t.name === name ? [] : t.columns
    .filter(c => c.reference_table === name || c.row_table === name)
    .map(c => `${t.name}.${c.column_name}`))
}
function renameLinks(state: TableDef[], from: string, to: string) {
  for (const t of state) for (const c of t.columns) {
    if (c.reference_table === from) c.reference_table = to
    if (c.row_table === from) c.row_table = to
  }
}
function renameColumnIn(table: TableDef, from: string, to: string) {
  columnIn(table, from, `renameColumn ${table.name}.${from}`).column_name = to
  if (table.title_column === from) table.title_column = to
  if (table.id_pattern === `field:${from}`) table.id_pattern = `field:${to}`
}
function setProperties(target: Column, values: Alterable) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete (target as Record<string, unknown>)[key]
    else (target as Record<string, unknown>)[key] = value
  }
}

// What a new or changed column may name: a Sub-table the app holds at that
// point, and a link to one of the app's own Tables that exists by then.
// Links to platform Tables are checked by the engine when the step runs.
function checkColumns(app: string, state: TableDef[], table: TableDef, columns: Column[], what: string) {
  for (const c of columns) {
    if ((STANDARD_COLUMNS as readonly string[]).includes(c.column_name)) refuse(`${what}: ${c.column_name} is a standard column name`)
    if (c.column_type === 'Choice' && !c.choices) refuse(`${what}: Choice column ${c.column_name} needs choices`)
    if (c.column_type === 'Reference' && !c.reference_table) refuse(`${what}: link column ${c.column_name} needs reference_table`)
    if (c.column_type === 'Reference' && c.reference_table!.startsWith(`${app}.`) && c.reference_table !== table.name &&
        !state.some(t => t.name === c.reference_table))
      refuse(`${what}: link column ${c.column_name} names ${c.reference_table}, which the app does not hold at this point`)
    if (c.column_type === 'Sub-table' && !state.some(t => t.name === c.row_table && t.kind === 'sub_table'))
      refuse(`${what}: Sub-table column ${c.column_name} names ${String(c.row_table)}, which is not a Sub-table of the app at this point`)
  }
}

function forward(app: string, state: TableDef[], op: Operation) {
  switch (op.kind) {
    case 'addTable': {
      const what = `addTable ${op.table.name}`
      mustOwn(app, op.table.name)
      if (state.some(t => t.name === op.table.name)) refuse(`${what}: the Table already exists`)
      if ((op.table.kind ?? 'table') === 'settings' || op.table.data_source || op.table.system || !op.table.label)
        refuse(`${what}: an app Table needs a label and its own storage (no settings, data_source or system)`)
      if (new Set(op.table.columns.map(c => c.column_name)).size !== op.table.columns.length) refuse(`${what}: duplicate column names`)
      checkColumns(app, state, op.table, op.table.columns, what)
      state.push(structuredClone(op.table))
      return
    }
    case 'dropTable': {
      const what = `dropTable ${op.table.name}`
      mustOwn(app, op.table.name)
      if (!op.destructive) refuse(`${what} removes the Table and its rows; mark the operation destructive: true`)
      const table = tableIn(state, op.table.name, what)
      if (!same(table, op.table)) refuse(`${what} must declare the Table as it stood before the drop`)
      const links = linksTo(state, table.name)
      if (links.length) refuse(`${what}: ${links.join(', ')} still link to it; drop or change those columns first`)
      state.splice(state.indexOf(table), 1)
      return
    }
    case 'addColumn': {
      const what = `addColumn ${op.table}.${op.column.column_name}`
      mustOwn(app, op.table)
      const table = tableIn(state, op.table, what)
      if (table.columns.some(c => c.column_name === op.column.column_name)) refuse(`${what}: ${op.table} already has that column`)
      checkColumns(app, state, table, [op.column], what)
      const filled = op.backfill !== undefined || Boolean(op.column.reqd && op.column.default_value != null)
      if (op.column.reqd && !filled) refuse(`${what}: a required column needs a default_value or a backfill for the rows already there`)
      if (op.column.column_type === 'Sub-table' && op.backfill !== undefined) refuse(`${what}: a Sub-table column holds no value to backfill`)
      if (op.column.unique && filled) refuse(`${what}: a unique column cannot be backfilled with one value`)
      const at = op.position ?? table.columns.length + 1
      if (at > table.columns.length + 1) refuse(`${what}: position ${at} is past the end of ${op.table}`)
      table.columns.splice(at - 1, 0, structuredClone(op.column))
      return
    }
    case 'alterColumn': {
      const what = `alterColumn ${op.table}.${op.column}`
      mustOwn(app, op.table)
      const table = tableIn(state, op.table, what)
      const target = columnIn(table, op.column, what)
      for (const [key, value] of Object.entries(op.from))
        if (!same((target as Record<string, unknown>)[key], value)) refuse(`${what} does not hold ${key} ${JSON.stringify(value)}`)
      const fromType = op.from.column_type
      const toType = op.to.column_type
      if (fromType && toType && fromType !== toType && !isSafeTypeChange(fromType, toType))
        refuse(`${what}: ${fromType} to ${toType} is not a safe conversion; add a new column, copy the data, then drop the old one`)
      setProperties(target, op.to)
      checkColumns(app, state, table, [target], what)
      if (target.unique && op.backfill !== undefined) refuse(`${what}: a unique column cannot be backfilled with one value`)
      return
    }
    case 'renameColumn': {
      const what = `renameColumn ${op.table}.${op.from}`
      mustOwn(app, op.table)
      const table = tableIn(state, op.table, what)
      columnIn(table, op.from, what)
      if ((STANDARD_COLUMNS as readonly string[]).includes(op.to)) refuse(`${what}: ${op.to} is a standard column name`)
      if (table.columns.some(c => c.column_name === op.to)) refuse(`${what}: ${op.table} already has a column ${op.to}`)
      renameColumnIn(table, op.from, op.to)
      return
    }
    case 'dropColumn': {
      const name = op.column.column_name
      const what = `dropColumn ${op.table}.${name}`
      mustOwn(app, op.table)
      if (!op.destructive) refuse(`${what} removes the column and its values; mark the operation destructive: true`)
      const table = tableIn(state, op.table, what)
      const index = table.columns.indexOf(columnIn(table, name, what))
      if (!same(table.columns[index], op.column)) refuse(`${what} must declare the column as it stood before the drop`)
      if (op.position !== undefined && op.position !== index + 1) refuse(`${what}: the column stood at position ${index + 1}, not ${op.position}`)
      if (table.title_column === name || table.id_pattern === `field:${name}`) refuse(`${what}: it is the Table's title column or names its rows`)
      if (name === 'amended_from' && table.is_submittable) refuse(`${what}: a submittable Table keeps amended_from`)
      if (table.columns.length === 1) refuse(`${what}: a Table keeps at least one column`)
      table.columns.splice(index, 1)
      return
    }
    case 'renameTable': {
      const what = `renameTable ${op.from}`
      mustOwn(app, op.from, op.to)
      const table = tableIn(state, op.from, what)
      if (state.some(t => t.name === op.to)) refuse(`${what}: ${op.to} already exists`)
      table.name = op.to
      renameLinks(state, op.from, op.to)
    }
  }
}

function backward(state: TableDef[], op: Operation) {
  switch (op.kind) {
    case 'addTable': {
      const table = tableIn(state, op.table.name, `addTable ${op.table.name}`)
      if (!same(table, op.table)) refuse(`addTable ${op.table.name} does not match the Table as declared after it`)
      state.splice(state.indexOf(table), 1)
      return
    }
    case 'dropTable':
      if (state.some(t => t.name === op.table.name)) refuse(`dropTable ${op.table.name}: the Table is declared after it was dropped`)
      state.push(structuredClone(op.table))
      return
    case 'addColumn': {
      const what = `addColumn ${op.table}.${op.column.column_name}`
      const table = tableIn(state, op.table, what)
      const index = (op.position ?? table.columns.length) - 1
      if (!same(table.columns[index], op.column)) refuse(`${what} does not match column ${index + 1} as declared after it`)
      table.columns.splice(index, 1)
      return
    }
    case 'dropColumn': {
      const what = `dropColumn ${op.table}.${op.column.column_name}`
      const table = tableIn(state, op.table, what)
      if (table.columns.some(c => c.column_name === op.column.column_name)) refuse(`${what}: the column is declared after it was dropped`)
      table.columns.splice((op.position ?? table.columns.length + 1) - 1, 0, structuredClone(op.column))
      return
    }
    case 'alterColumn': {
      const what = `alterColumn ${op.table}.${op.column}`
      const target = columnIn(tableIn(state, op.table, what), op.column, what)
      for (const [key, value] of Object.entries(op.to))
        if (!same((target as Record<string, unknown>)[key], value)) refuse(`${what}: the column as declared after it does not hold ${key} ${JSON.stringify(value)}`)
      setProperties(target, op.from)
      return
    }
    case 'renameColumn':
      renameColumnIn(tableIn(state, op.table, `renameColumn ${op.table}.${op.to}`), op.to, op.from)
      return
    case 'renameTable':
      tableIn(state, op.to, `renameTable ${op.to}`).name = op.from
      renameLinks(state, op.to, op.from)
  }
}

/** #651: `tables` with `operations` applied in order, each checked against
 *  the declaration it meets. Refuses an operation outside the app's own
 *  Tables, a destructive one without `destructive: true`, and one whose
 *  declared starting point is not what the history holds. */
export function replayForward(app: string, tables: TableDef[], operations: Operation[]): TableDef[] {
  const state = structuredClone(tables)
  for (const op of operations) forward(app, state, op)
  return state
}

// Reverse/replay makes the final declaration and cumulative history one
// contract: the baseline is the final declaration with the history undone,
// and replaying the history forward from it must give the final declaration.
export function validateMigrations(name: string, version: string, tables: TableDef[], migrations: PackageMigration[]) {
  const ids = new Set<string>()
  let previous: string | undefined
  for (const migration of migrations) {
    if (ids.has(migration.id) || (previous && previous !== migration.fromVersion) ||
        compareVersions(migration.toVersion, migration.fromVersion) <= 0)
      refuse('Migration history has duplicate, reordered or skipped steps')
    ids.add(migration.id)
    previous = migration.toVersion
  }
  if (previous && previous !== version) refuse('Migration history does not reach the package version')
  const operations = migrations.flatMap(m => m.operations)
  const baseline = structuredClone(tables)
  for (const op of [...operations].reverse()) backward(baseline, op)
  if (!sameDeclaration(replayForward(name, baseline, operations), tables))
    refuse('Migration history does not replay to the final declaration')
  return baseline
}

/** What a destructive step removes, counted, never shown. */
export interface Loss {
  migration: string
  operation: number
  kind: Operation['kind']
  table: string
  column?: string
  destructive: boolean
  rows?: number
  childRows?: number
  values?: number
}

export function describeLoss(loss: Loss): string {
  const counts = [
    loss.rows !== undefined ? `${loss.rows} ${loss.rows === 1 ? 'row' : 'rows'}` : '',
    loss.childRows ? `${loss.childRows} Sub-table ${loss.childRows === 1 ? 'row' : 'rows'}` : '',
    loss.values !== undefined ? `${loss.values} ${loss.values === 1 ? 'value' : 'values'}` : '',
  ].filter(Boolean).join(' and ')
  return `${loss.migration} #${loss.operation} ${loss.kind} ${loss.table}${loss.column ? `.${loss.column}` : ''}: ${counts}`
}

const choiceList = (choices: string | null | undefined) =>
  (choices ?? '').split('\n').map(o => o.trim()).filter(Boolean)

interface Stored { relation: string; kind: string; columns: Map<string, { column_type: string; choices: string | null; row_table: string | null }> }

// Read straight from the stored definition: no metadata overrides, no app
// availability check (the release guard runs outside any app lifecycle).
async function stored(name: string, owner: string): Promise<Stored | null> {
  const [table] = await sql`select kind, owner_app, physical_schema, physical_relation from table_def where name = ${name}`
  if (!table || table.owner_app !== owner || !table.physical_schema || !table.physical_relation) return null
  const columns = await sql<{ column_name: string; column_type: string; choices: string | null; row_table: string | null }[]>`
    select column_name, column_type, choices, row_table from column_def where parent = ${name}`
  return { relation: quoteRelation(`${table.physical_schema}.${table.physical_relation}`), kind: String(table.kind),
    columns: new Map(columns.map(c => [c.column_name, c])) }
}

const count = async (query: string, parameters: unknown[] = []) =>
  Number(((await sql.unsafe(query, parameters as never[])) as unknown as { n: number }[])[0].n)

async function childRows(name: string, owner: string, table: Stored, column?: string): Promise<number> {
  let total = 0
  for (const [columnName, c] of table.columns) {
    if (c.column_type !== 'Sub-table' || !c.row_table || (column && column !== columnName)) continue
    const child = await stored(c.row_table, owner)
    if (child) total += await count(`select count(*)::int as n from ${child.relation} where parenttype = $1 and parentfield = $2`, [name, columnName])
  }
  return total
}

// The values a Choice column holds outside `choices`: what narrowing them,
// or turning a Data column into a Choice, would clear.
const outsideChoices = (table: Stored, column: string, choices: string[]) =>
  count(`select count(*)::int as n from ${table.relation} where ${quoteIdent(column)} is not null and not (${quoteIdent(column)}::text = any($1))`, [choices])

const narrowsChoices = (op: Extract<Operation, { kind: 'alterColumn' }>) =>
  op.to.choices !== undefined || (op.to.column_type === 'Choice' && op.from.column_type !== 'Choice')

const DRY_RUN = new Error('counting what an upgrade removes')

/** #651: what each destructive step of `migrations` would remove from this
 *  instance, before anything runs. The steps run for real inside a
 *  transaction that is always rolled back, so each one meets the rows the
 *  steps before it left, and a step the upgrade would refuse is refused here
 *  too. Counts only, never values. */
export async function countLosses(owner: string, migrations: PackageMigration[], opts: { ownsClient?: boolean } = {}): Promise<Loss[]> {
  let losses: Loss[] = []
  try {
    await withTransaction(() => provisionApp(owner, async () => {
      losses = await applyMigrations(migrations, owner, 'Administrator', opts)
      throw DRY_RUN
    }))
  } catch (error) {
    if (error !== DRY_RUN) {
      if (error instanceof AppError) throw error
      refuse(`The upgrade would fail here: ${error instanceof Error ? error.message : String(error)}`)
    }
  } finally {
    invalidateMeta()
  }
  return losses
}

// The stored definition of an app Table, as updateTable takes it. Built from
// table_def/column_def, never getMeta: that folds in Admin's metadata
// overrides, which must not be written into the app's definition.
async function definition(name: string): Promise<TableDef> {
  const [table] = await sql`select * from table_def where name = ${name}`
  const columns = await sql`select * from column_def where parent = ${name} order by position`
  return tableDefSchema.parse({ ...table, columns })
}

async function owned(name: string, owner: string, what: string): Promise<Stored> {
  const found = await stored(name, owner)
  if (!found || found.kind === 'settings')
    refuse(`${what}: ${name} is not one of ${owner}'s Tables here; restore the app's metadata before retrying`)
  return found
}

// No value: NULL, or empty text (a save stores "" as no value too).
const isEmpty = (column: string) => `(${quoteIdent(column)} is null or ${quoteIdent(column)}::text = '')`

// A backfill, or a required column's default, lands in rows no save ever
// checked, so it meets the column's own rules first: its kind, its choices,
// and for a link, a row the target holds.
// What a column fills its empty rows with when the step names no backfill:
// a required column's default, converted as a save converts it.
const automaticFill = (column: Column) =>
  column.reqd && column.default_value != null ? defaultValueFor(column.column_type, column.default_value) : undefined

async function writeFill(found: Stored, table: string, column: Column, value: unknown, what: string) {
  if (value === undefined || value === null) return
  const name = column.column_name
  const parsed = tableSchemaToZod([{ ...column, reqd: true }]).safeParse({ [name]: value })
  if (!parsed.success) refuse(`${what}: the backfill ${JSON.stringify(value)} is not a value ${table}.${name} accepts`)
  if (column.column_type === 'Reference') {
    const target = column.reference_table!
    const rows = await sql.unsafe(`select 1 from ${quoteRelation(await storedRelation(target))} where ${quoteIdent(physicalRowKey(target))} = $1`, [String(value)])
    if (!rows.length) refuse(`${what}: the backfill ${JSON.stringify(value)} names no row of ${target}`)
  }
  await sql.unsafe(`update ${found.relation} set ${quoteIdent(name)} = $1 where ${isEmpty(name)}`, [(parsed.data as Record<string, never>)[name]])
}

async function applyOperation(owner: string, op: Operation, actor: string, base: Omit<Loss, 'table'>, ownsClient: boolean): Promise<Loss | null> {
  switch (op.kind) {
    case 'addTable': {
      const meta = await createTable(op.table, owner)
      await sql`update installed_app set tables = tables || ${sql.json([meta.name])} where name = ${owner}`
      // As an install does: an app without its own client keeps the
      // generated Table home page as its usable UI.
      if (!ownsClient && meta.kind !== 'sub_table') await ensureHomePageForTable(meta.name, meta.module)
      return null
    }
    case 'dropTable': {
      const what = `dropTable ${op.table.name}`
      const found = await owned(op.table.name, owner, what)
      const loss = { ...base, table: op.table.name, rows: await count(`select count(*)::int as n from ${found.relation}`),
        childRows: await childRows(op.table.name, owner, found) }
      await deleteTable(op.table.name, actor, { ownerApp: owner })
      // The grants and links that went with it leave the registry too.
      await sql`update installed_app set tables = coalesce((select jsonb_agg(value order by ordinality)
          from jsonb_array_elements(tables) with ordinality where value <> to_jsonb(${op.table.name}::text)), '[]'::jsonb),
        perms = coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(perms) with ordinality
          where exists (select 1 from permission where row_id = value #>> '{}')), '[]'::jsonb)
        where name = ${owner}`
      return loss
    }
    case 'addColumn': {
      const what = `addColumn ${op.table}.${op.column.column_name}`
      const found = await owned(op.table, owner, what)
      // No adoption: a stored column the definition does not know is drift.
      const [stray] = await sql`select 1 from information_schema.columns
        where table_schema = ${owner} and table_name = ${op.table.split('.')[1]} and column_name = ${op.column.column_name}`
      if (stray) refuse(`${what}: ${op.table} already stores a ${op.column.column_name} column outside its definition, so the prior version and data are unchanged. Remove that column before retrying`)
      const def = await definition(op.table)
      def.columns.splice((op.position ?? def.columns.length + 1) - 1, 0, op.column)
      await updateTable(op.table, def)
      // An explicit backfill is checked as written; the default as a save converts it.
      await writeFill(found, op.table, op.column, op.backfill ?? automaticFill(op.column), what)
      return null
    }
    case 'alterColumn': {
      const what = `alterColumn ${op.table}.${op.column}`
      let found = await owned(op.table, owner, what)
      if (op.to.column_type) await changeColumnType(op.table, op.column, op.to.column_type)
      found = await owned(op.table, owner, what)
      let loss: Loss | null = null
      if (narrowsChoices(op)) {
        const choices = choiceList(op.to.choices ?? found.columns.get(op.column)?.choices)
        const values = await outsideChoices(found, op.column, choices)
        if (values && !op.destructive)
          refuse(`${what} would clear ${values} ${values === 1 ? 'value' : 'values'} outside its new choices; mark the operation destructive: true`)
        await sql.unsafe(`update ${found.relation} set ${quoteIdent(op.column)} = null where ${quoteIdent(op.column)} is not null and not (${quoteIdent(op.column)}::text = any($1))`, [choices])
        loss = { ...base, table: op.table, column: op.column, values }
      }
      const def = await definition(op.table)
      const target = def.columns.find(c => c.column_name === op.column)!
      const wasUnique = Boolean(target.unique)
      const { column_type: _type, ...properties } = op.to
      setProperties(target, properties)
      // Rules the step withdraws go first and rules it adds go after the
      // fill, so the fill meets the rules the column ends with: one value
      // may fill many rows once unique is off, never while it turns on.
      const addsUnique = Boolean(target.unique) && !wasUnique
      if (addsUnique) target.unique = false
      await updateTable(op.table, def)
      // The column as it ends up decides: a narrowing can empty a column
      // that was already required.
      await writeFill(found, op.table, target, op.backfill ?? automaticFill(target), what)
      if (target.reqd) {
        const empty = await count(`select count(*)::int as n from ${found.relation} where ${isEmpty(op.column)}`)
        if (empty) refuse(`${what}: ${empty} ${empty === 1 ? 'row holds' : 'rows hold'} no value; give the operation a backfill`)
      }
      if (addsUnique) {
        target.unique = true
        await updateTable(op.table, def)
      }
      return loss
    }
    case 'renameColumn':
      await owned(op.table, owner, `renameColumn ${op.table}.${op.from}`)
      await renameColumn(op.table, op.from, op.to, actor)
      return null
    case 'dropColumn': {
      const name = op.column.column_name
      const what = `dropColumn ${op.table}.${name}`
      const found = await owned(op.table, owner, what)
      const type = found.columns.get(name)?.column_type
      let values = 0
      if (type === 'Sub-table') {
        values = await childRows(op.table, owner, found, name)
        const child = await stored(found.columns.get(name)!.row_table!, owner)
        if (child) await sql.unsafe(`delete from ${child.relation} where parenttype = $1 and parentfield = $2`, [op.table, name])
      } else if (type && pgType(type)) {
        values = await count(`select count(*)::int as n from ${found.relation} where ${quoteIdent(name)} is not null`)
      }
      const def = await definition(op.table)
      def.columns = def.columns.filter(c => c.column_name !== name)
      await updateTable(op.table, def, { remove_columns: [name], drop_columns: true })
      return { ...base, table: op.table, column: name, values }
    }
    case 'renameTable':
      await owned(op.from, owner, `renameTable ${op.from}`)
      await renameTable(op.from, op.to, owner, actor)
      return null
  }
}

/** #651: run `migrations` for `owner` through the table engine, in order,
 *  inside the caller's transaction (a failing step rolls back the whole
 *  upgrade). Answers what the destructive steps removed. */
export async function applyMigrations(migrations: PackageMigration[], owner: string, actor = 'Administrator',
  opts: { ownsClient?: boolean } = {}): Promise<Loss[]> {
  const losses: Loss[] = []
  try {
    for (const migration of migrations) for (const [index, op] of migration.operations.entries()) {
      const base = { migration: migration.id, operation: index + 1, kind: op.kind, destructive: 'destructive' in op && op.destructive === true }
      const loss = await applyOperation(owner, op, actor, base, opts.ownsClient ?? false)
      if (loss) losses.push(loss)
    }
  } finally {
    invalidateMeta()
  }
  return losses
}
