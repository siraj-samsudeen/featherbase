import { randomBytes } from 'node:crypto'
import { VIEW_SETTING_KEYS, tableViewSettingsSchema, type TableViewDefault, type TableViewSettings } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta } from './meta'
import { assertPermission, assertSystemManager } from './permissions'

// #1282 A4 (UI owner): a System Manager makes their whole view of a list the Table's default from the View menu:
// its layout, columns, sort, compact rows and the Links tab's choices. Each save is a row of its own, never changed;
// the latest row is the default. Undo adds a row that puts the one before back, and only while the save it undoes
// is still the default. A person's own choices win over it; "Reset to the Table's Default" clears them.

/** Columns every Table has, which a sort may name besides its own. */
const BUILT_IN_COLUMNS = new Set(['row_id', 'created_at', 'updated_at', 'created_by', 'updated_by'])

function id(): string {
  return randomBytes(8).toString('hex')
}

function toDefault(row: Record<string, unknown>): TableViewDefault | null {
  const settings = row.settings as TableViewSettings
  // Empty settings are the platform's own built-in: no default.
  if (!Object.keys(settings).length) return null
  return { id: String(row.row_id), settings, by: String(row.created_by), at: new Date(row.created_at as string).toISOString(),
    ...(row.undoes ? { undoes: String(row.undoes) } : {}) }
}

async function latest(table: string) {
  const [row] = await sql`select * from table_view_default where ref_table = ${table} order by created_at desc, row_id desc limit 1`
  return row
}

/** GET /api/table_view_default/:table: the Table's default view, for anyone who reads the Table; none if not set. */
export async function tableViewDefault(table: string, user: string): Promise<TableViewDefault | null> {
  await assertPermission(user, table, 'read')
  const row = await latest(table)
  return row ? toDefault(row) : null
}

/** PUT /api/table_view_default/:table: a System Manager's view becomes the Table's default. It names only the
 *  view's own settings and the Table's real columns. */
export async function setTableViewDefault(table: string, body: unknown, user: string): Promise<TableViewDefault> {
  await assertSystemManager(user)
  const meta = await getMeta(table)
  const parsed = tableViewSettingsSchema.safeParse((body as { settings?: unknown } | null)?.settings)
  if (!parsed.success) throw new AppError('ValidationError', 'A Table default names only the list\'s view settings')
  const settings = parsed.data
  const columns = new Set(meta.columns.map((c) => c.column_name))
  const unknown = [...(settings.shownCols ?? []), ...(settings.hiddenCols ?? [])].filter((c) => !columns.has(c))
  if (settings.sort && !columns.has(settings.sort.field) && !BUILT_IN_COLUMNS.has(settings.sort.field)) unknown.push(settings.sort.field)
  if (unknown.length) throw new AppError('ValidationError', `${unknown.join(', ')} is not a column of ${table}`)
  return save(table, settings, user)
}

async function save(table: string, settings: TableViewSettings, user: string, undoes?: string): Promise<TableViewDefault> {
  const [row] = await sql`insert into table_view_default (row_id, ref_table, settings, undoes, created_by, created_at)
    values (${id()}, ${table}, ${settings as never}, ${undoes ?? null}, ${user}, clock_timestamp()) returning *`
  return (toDefault(row!) ?? { id: String(row!.row_id), settings, by: user, at: new Date(row!.created_at as string).toISOString() })
}

/** POST /api/table_view_default/:table/undo: puts back the default before `id`, only while `id` is the default. */
export async function undoTableViewDefault(table: string, body: unknown, user: string): Promise<TableViewDefault | null> {
  await assertSystemManager(user)
  const target = String((body as { id?: unknown } | null)?.id ?? '')
  return sql.begin(async (tx) => {
    // One undo at a time per Table, so two can't both pass the "still the default" check.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`table_view_default:${table}`}, 1282))`
    const rows = await tx`select * from table_view_default where ref_table = ${table} order by created_at desc, row_id desc limit 2`
    const [now, before] = rows
    // Only the default itself, and never an Undo (no redo): the one before it comes back, or none.
    if (!now || String(now.row_id) !== target || now.undoes || !Object.keys(now.settings as object).length)
      throw new AppError('ConflictError', 'That is no longer the Table\'s default, so there is nothing to undo')
    const previous = (before?.settings as TableViewSettings | undefined) ?? {}
    const [row] = await tx`insert into table_view_default (row_id, ref_table, settings, undoes, created_by, created_at)
      values (${id()}, ${table}, ${previous as never}, ${target}, ${user}, clock_timestamp()) returning *`
    return toDefault(row!)
  })
}

/** POST /api/user_settings/:table/reset: clears the person's own view choices for the Table; their form stays. */
export async function resetViewSettings(table: string, user: string): Promise<void> {
  await sql`update user_settings set settings = settings - ${[...VIEW_SETTING_KEYS]}::text[], updated_at = now()
    where "user" = ${user} and table_name = ${table}`
}

/** For the team feed: the saves still in force, by Table, so their line offers Undo. */
export async function currentDefaultIds(): Promise<Set<string>> {
  const rows = await sql`select distinct on (ref_table) row_id, settings, undoes from table_view_default order by ref_table, created_at desc, row_id desc`
  return new Set(rows.filter((r) => !r.undoes && Object.keys(r.settings as object).length).map((r) => String(r.row_id)))
}
