// Instance settings as code (#465, D5): the fields the last successful apply
// set are read-only everywhere but the settings file. The apply stores which
// fields its file named; every save path then refuses to change one, except
// the apply itself (actor `instance-settings`) and the break-glass CLI (actor
// `cli`), each recognised only while that operation runs (system-actor.ts),
// never by a name a caller can send.
import { INSTANCE_SETTINGS_FILE, INSTANCE_SETTINGS_TABLES } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import type { TableMeta } from './meta'
import { isActingSystemActor } from './system-actor'

/** Who an apply's saves are recorded as (D4). */
export const INSTANCE_SETTINGS_ACTOR = 'instance-settings'
/** Who a break-glass `cli settings:set` is recorded as (D5). */
export const BREAK_GLASS_ACTOR = 'cli'

/** One field the last apply set: `row_id` is the Table name for a Settings Table. */
export interface ManagedPath {
  table: string
  row_id: string
  field: string
}

/** A locked field and the value the apply left in it (#465 D8). */
export interface ManagedValue extends ManagedPath {
  value: unknown
}

export interface LastApply {
  applied_at: Date
  applied_by: string
  environment: string | null
  revision: string | null
  run: string | null
  managed_paths: ManagedPath[]
  /** Null on an apply recorded before the values were kept (0123). */
  managed_values: ManagedValue[] | null
}

const LOCKABLE: ReadonlySet<string> = new Set(INSTANCE_SETTINGS_TABLES)

/** The last successful apply, or null before the first one. */
let storeExists = false

export async function lastApply(db: typeof sql = sql): Promise<LastApply | null> {
  // Migrations before the store's own (0122) save these Tables too.
  if (!storeExists) {
    const [{ ok }] = await db`select to_regclass('featherbase.instance_settings_apply') is not null as ok`
    if (!ok) return null
    storeExists = true
  }
  const [row] = await db`
    select * from instance_settings_apply`
  if (!row) return null
  const apply = row as unknown as LastApply
  return { ...apply, managed_values: apply.managed_values ?? null }
}

/** Record a successful apply, inside its transaction: it replaces the last
 *  one, so a field the file stops naming is editable again. */
export async function recordApply(db: typeof sql, apply: Omit<LastApply, 'applied_at'>): Promise<void> {
  const json = (v: unknown) => db.json(v as Parameters<typeof db.json>[0])
  const row = { ...apply, managed_paths: json(apply.managed_paths), managed_values: apply.managed_values === null ? null : json(apply.managed_values) }
  await db`delete from instance_settings_apply`
  await db`insert into instance_settings_apply ${db(row as unknown as Record<string, never>)}`
}

// One advisory lock orders an apply against the saves it locks out: an apply
// holds it exclusively from before it reads any value until it commits; a save
// of a lockable Table holds it shared from before its write until it commits.
// So a save is judged either wholly before an apply or wholly after it, never
// against a locked set the apply is about to replace (Codex review).
const LOCK_KEY = 'featherbase.instance_settings_lock'

/** In an apply's transaction, before anything is read. */
export async function holdManagedSetExclusive(db: typeof sql): Promise<void> {
  await db`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`
}

/** In a save's transaction, before the write. `table` null: any Table (a
 *  rename, whose cascade may reach a locked Reference). */
export async function holdManagedSet(db: typeof sql, table: string | null): Promise<void> {
  if (table !== null && !LOCKABLE.has(table)) return
  await db`select pg_advisory_xact_lock_shared(hashtext(${LOCK_KEY}))`
}

async function pathsOf(db: typeof sql, table: string): Promise<ManagedPath[]> {
  if (!LOCKABLE.has(table)) return []
  const apply = await lastApply(db)
  return (apply?.managed_paths ?? []).filter((p) => p.table === table)
}

/** The locked fields of one row, in the file's order. */
export async function managedFieldsOf(table: string, rowId: string, db: typeof sql = sql): Promise<string[]> {
  return (await pathsOf(db, table)).filter((p) => p.row_id === rowId).map((p) => p.field)
}

/** May this save change a locked field? Only the apply and the break-glass
 *  CLI, and only while running as themselves: the save's user AND the
 *  operation's actor must both be one of the two. */
function mayChangeManaged(user: string): boolean {
  return (user === INSTANCE_SETTINGS_ACTOR || user === BREAK_GLASS_ACTOR) && isActingSystemActor(user)
}

function fieldLabel(meta: Pick<TableMeta, 'columns'>, field: string): string {
  const column = meta.columns.find((c) => c.column_name === field)
  const label = column?.label && column.label !== field ? column.label : field.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function lockedError(meta: Pick<TableMeta, 'name' | 'columns'>, rowId: string, fields: string[]): AppError {
  const where = rowId === meta.name ? meta.name : `${meta.name} ${rowId}`
  const names = fields.map((f) => fieldLabel(meta, f))
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const [verb, pronoun] = names.length === 1 ? ['is', 'it'] : ['are', 'they']
  return new AppError(
    'PermissionError',
    `${list} on ${where} ${verb} set in the instance settings file (${INSTANCE_SETTINGS_FILE}), so ${pronoun} cannot be changed here. Change ${pronoun} in the file, then apply the file.`,
    Object.fromEntries(fields.map((f) => [f, 'set in the instance settings file'])),
  )
}

/** A value as stored, in one comparable form: a Date as its instant, blank
 *  text as null, JSON (or JSON text) key-order-free, numbers as numbers. */
function comparable(columnType: string, v: unknown, jsonAsText: boolean): string {
  if (v === undefined || v === null || v === '') return 'null'
  if (columnType === 'Check') return String(v === true || v === 1 || v === '1' || v === 'true')
  if (['Int', 'Float', 'Currency', 'Percent'].includes(columnType)) {
    const n = Number(v)
    return Number.isFinite(n) ? String(n) : JSON.stringify(String(v))
  }
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  if (columnType === 'JSON') {
    let parsed = v
    // A jsonb column arrives decoded, so a string there is a JSON string;
    // only the Settings store keeps JSON as text (Codex review).
    if (typeof v === 'string' && jsonAsText) {
      try {
        parsed = JSON.parse(v)
      } catch {
        parsed = v
      }
    }
    return canonical(parsed)
  }
  return JSON.stringify(String(v))
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

/** Refuse a save that changed a locked field of this row. `before` is the
 *  stored row (null for a new row), `after` the row as written; both are
 *  judged as stored, so a form echoing a locked value back is no change. A
 *  new row under a locked row's id is a change. Call inside the save's
 *  transaction, after the write, so a refusal rolls it back. */
export async function assertManagedUnchanged(
  db: typeof sql,
  meta: Pick<TableMeta, 'name' | 'columns' | 'kind'>,
  rowId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  user: string,
): Promise<void> {
  if (mayChangeManaged(user)) return
  const fields = await managedFieldsOf(meta.name, rowId, db)
  if (!fields.length) return
  const jsonAsText = meta.kind === 'settings'
  const type = (f: string) => meta.columns.find((c) => c.column_name === f)?.column_type ?? 'Data'
  const changed = before === null
    ? fields
    : fields.filter((f) => comparable(type(f), before[f], jsonAsText) !== comparable(type(f), after[f], jsonAsText))
  if (changed.length) throw lockedError(meta, rowId, changed)
}

/** Refuse removing or renaming a row with a locked field: it would take the
 *  field's value with it. */
export async function assertRowNotManaged(
  db: typeof sql,
  meta: Pick<TableMeta, 'name' | 'columns'>,
  rowId: string,
  user: string,
): Promise<void> {
  if (mayChangeManaged(user)) return
  const fields = await managedFieldsOf(meta.name, rowId, db)
  if (fields.length) throw lockedError(meta, rowId, fields)
}

/** Refuse a rename of `table` row `oldName` when a locked Reference field
 *  holds that name: the rename's cascade would change the locked value. */
export async function assertNoManagedReference(
  db: typeof sql,
  table: string,
  oldName: string,
  user: string,
): Promise<void> {
  if (mayChangeManaged(user)) return
  const apply = await lastApply(db)
  if (!apply?.managed_paths.length) return
  const { getMeta } = await import('./meta')
  const { tableRelation } = await import('./table-engine')
  for (const path of apply.managed_paths) {
    const meta = await getMeta(path.table)
    const column = meta.columns.find((c) => c.column_name === path.field)
    if (column?.column_type !== 'Reference' || column.reference_table !== table) continue
    let value: unknown
    if (meta.kind === 'settings') {
      const [row] = await db`select value from single_value where table_name = ${meta.name} and field = ${path.field}`
      value = row?.value
    } else {
      const [row] = await db`select ${db(path.field)} as value from ${db(await tableRelation(meta.name))} where ${db(meta.row_key)} = ${path.row_id}`
      value = row?.value
    }
    if (value === oldName) throw lockedError(meta, path.row_id, [path.field])
  }
}

/** For a writer outside the save path (a workflow action, an assignment
 *  rule's stamp): refuse writing `field` of a locked row. */
export async function assertFieldNotManaged(table: string, rowId: string, field: string, user: string): Promise<void> {
  if (mayChangeManaged(user)) return
  if (!(await managedFieldsOf(table, rowId)).includes(field)) return
  const { getMeta } = await import('./meta')
  throw lockedError(await getMeta(table), rowId, [field])
}
