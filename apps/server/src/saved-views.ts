import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { assertPermission, hasPermission } from './permissions'

// #101 Phase 6: saved views — a filter habit with a name. Owned by
// created_by; `shared` opens a view to every user (read-only for them).
// Direct table access, owner-scoped here — the table carries no role
// permissions on purpose (same discipline as user_event).

const createSchema = z.object({
  table: z.string().min(1).max(140),
  label: z.string().min(1).max(100),
  filters: z.array(z.tuple([z.string(), z.string(), z.unknown()])).min(1).max(10),
  shared: z.boolean().optional(),
})

interface SavedView {
  row_id: string
  table: string
  label: string
  filters: unknown
  shared: boolean
  owner: string
  mine: boolean
}

function toView(row: Record<string, unknown>, user: string): SavedView {
  return {
    row_id: row.row_id as string,
    table: row.ref_table as string,
    label: row.label as string,
    filters: row.filters,
    shared: Boolean(row.shared),
    owner: row.created_by as string,
    mine: row.created_by === user,
  }
}

export async function listSavedViews(user: string, table: string): Promise<SavedView[]> {
  // Views describe a Table's rows (filter columns and values) — without read
  // permission on that Table the caller must not see them, own or shared.
  await assertPermission(user, table, 'read')
  const rows = await sql`
    select row_id, ref_table, label, filters, shared, created_by
    from saved_view
    where ref_table = ${table} and (created_by = ${user} or shared = true)
    order by created_by = ${user} desc, label`
  return rows.map((r) => toView(r, user))
}

/** The settings record (user_settings) that holds a person's navigation
 *  choices, the stars on shared views among them (web lib/nav-settings). */
const NAVIGATION_SETTINGS = '__navigation'
/** More than a sidebar group can usefully show. */
const SIDEBAR_LIMIT = 50

/** #1229: the Admin sidebar's "Saved views": the person's own views on every
 *  Table, and others' shared views they starred. Only views on Tables they can
 *  read now; a starred view since deleted or made private simply drops out. */
export async function listSidebarViews(user: string): Promise<SavedView[]> {
  const [settings] = await sql`
    select settings from user_settings where "user" = ${user} and table_name = ${NAVIGATION_SETTINGS}`
  const raw = (settings?.settings as { starredViews?: unknown } | undefined)?.starredViews
  const starred = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(0, SIDEBAR_LIMIT) : []
  const rows = await sql`
    select row_id, ref_table, label, filters, shared, created_by
    from saved_view
    where created_by = ${user} or (shared = true and row_id in ${sql(starred.length ? starred : [''])})
    order by lower(label), ref_table
    limit ${SIDEBAR_LIMIT * 2}`
  // One permission check per Table, not per view.
  const readable = new Map<string, boolean>()
  for (const table of new Set(rows.map((r) => r.ref_table as string)))
    readable.set(table, await hasPermission(user, table, 'read'))
  return rows.filter((r) => readable.get(r.ref_table as string)).slice(0, SIDEBAR_LIMIT).map((r) => toView(r, user))
}

export async function createSavedView(user: string, body: unknown): Promise<SavedView> {
  const parsed = createSchema.safeParse(body)
  if (!parsed.success)
    throw new AppError('ValidationError', 'Expected { table, label, filters: [[col, op, value], …] }')
  // No publishing view chips for Tables the author cannot read — a shared
  // chip lands in other users' list screens.
  await assertPermission(user, parsed.data.table, 'read')
  const now = new Date()
  const row = {
    row_id: randomBytes(8).toString('hex'),
    created_by: user,
    updated_by: user,
    created_at: now,
    updated_at: now,
    submission_status: 'draft',
    ref_table: parsed.data.table,
    label: parsed.data.label,
    // sql.json keeps the array a jsonb array — a pre-stringified value would
    // land as a double-encoded jsonb string.
    filters: sql.json(parsed.data.filters as never),
    shared: parsed.data.shared ?? false,
  }
  await sql`insert into saved_view ${sql(row as never)}`
  return toView({ ...row, filters: parsed.data.filters }, user)
}

async function ownRow(user: string, name: string): Promise<{ ref_table: string }> {
  const [row] = await sql`select created_by, ref_table from saved_view where row_id = ${name}`
  if (!row) throw new AppError('NotFoundError', `Saved view ${name} does not exist`)
  if (row.created_by !== user)
    throw new AppError('PermissionError', 'Only the owner can change a saved view')
  return { ref_table: row.ref_table as string }
}

export async function setSavedViewShared(user: string, name: string, shared: boolean): Promise<void> {
  const { ref_table } = await ownRow(user, name)
  // Re-check on share: the owner may have lost access to the Table since
  // creating the view.
  if (shared) await assertPermission(user, ref_table, 'read')
  await sql`update saved_view set shared = ${shared}, updated_at = now(), updated_by = ${user}
    where row_id = ${name}`
}

export async function deleteSavedView(user: string, name: string): Promise<void> {
  await ownRow(user, name)
  await sql`delete from saved_view where row_id = ${name}`
}
