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

/** One change to a Table's default at a time (Codex adversarial round 1): a save and an Undo take the same lock. */
const lockTable = (tx: typeof sql, table: string) => tx`select pg_advisory_xact_lock(hashtextextended(${`table_view_default:${table}`}, 1282))`

async function save(table: string, settings: TableViewSettings, user: string): Promise<TableViewDefault> {
  return sql.begin(async (tx) => {
    await lockTable(tx as unknown as typeof sql, table)
    const [row] = await tx`insert into table_view_default (row_id, ref_table, settings, created_by, created_at)
      values (${id()}, ${table}, ${settings as never}, ${user}, clock_timestamp()) returning *`
    return toDefault(row!) ?? { id: String(row!.row_id), settings, by: user, at: new Date(row!.created_at as string).toISOString() }
  })
}

/** POST /api/table_view_default/:table/undo: puts back the default before `id`, only while `id` is the default
 *  and is not itself an Undo (no redo). The check and the insert are one statement, so a save landing between
 *  them can never be replaced. */
export async function undoTableViewDefault(table: string, body: unknown, user: string): Promise<TableViewDefault | null> {
  await assertSystemManager(user)
  const target = String((body as { id?: unknown } | null)?.id ?? '')
  return sql.begin(async (tx) => {
    await lockTable(tx as unknown as typeof sql, table)
    const [row] = await tx`
      with ordered as (
        select row_id, settings, undoes, row_number() over (order by created_at desc, row_id desc) as n
        from table_view_default where ref_table = ${table}
      )
      insert into table_view_default (row_id, ref_table, settings, undoes, created_by, created_at)
      select ${id()}, ${table}, coalesce((select settings from ordered where n = 2), '{}'::jsonb), ${target}, ${user}, clock_timestamp()
      where exists (select 1 from ordered where n = 1 and row_id = ${target} and undoes is null and settings <> '{}'::jsonb)
      returning *`
    if (!row) throw new AppError('ConflictError', 'That is no longer the Table\'s default, so there is nothing to undo')
    return toDefault(row)
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
