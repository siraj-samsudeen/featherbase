import { sql } from './db'
import { AppError } from './errors'
import { activeApps } from './app-lifecycle'
import { OPEN_ROLES, PLATFORM_ROLES, assertSystemManager } from './permissions'
import { principalReach, type TableReach } from './token-reach'
import { rowTitles } from './row-titles'

// #628: "What can this person see, and why". The platform's own reasons for a
// person's access, as one answer: their roles (who gave each, and when), the
// Tables those roles reach (principalReach, #852), the Data Scope rows that
// limit them and the rows shared with them. It says that access exists and
// why, never the data: a row is named by its title only when the viewer can
// read it (rowTitles answers for those alone).

export interface ExplainedRole {
  role: string
  /** The app whose role this is, when it comes through an app's role binding. */
  app: string | null
  /** The person's own role it comes through, for an app role. */
  through: string | null
  given_by: string | null
  given_at: string | null
}

export interface AccessExplanation {
  person: string
  every_table: boolean
  roles: ExplainedRole[]
  read: TableReach[]
  change: TableReach[]
  limits: { table: string; value: string; title: string | null; set_by: string; set_at: string }[]
  shares: { table: string; row_id: string; title: string | null; write: boolean; reshare: boolean; shared_by: string; shared_at: string }[]
}

const iso = (value: unknown) => (value as Date).toISOString()

/** Who gave each role the person holds, and when, from the Person's history:
 *  #830 records a Person's roles as one field, the names joined by ", ". The
 *  latest entry that added a role wins, so a role removed and given again
 *  reads as the second time. */
async function roleGrants(person: string): Promise<Map<string, { by: string; at: string }>> {
  const versions = await sql`
    select data, created_by, created_at from version
    where ref_table = 'Person' and ref_name = ${person} order by created_at, row_id`
  const names = (value: unknown) => new Set(typeof value === 'string' && value ? value.split(', ') : [])
  const given = new Map<string, { by: string; at: string }>()
  for (const v of versions) {
    const changed = (v.data as { changed: [string, unknown, unknown][] }).changed
    for (const [, was, now] of changed.filter(([column]) => column === 'roles')) {
      const before = names(was)
      for (const role of names(now)) if (!before.has(role)) given.set(role, { by: String(v.created_by), at: iso(v.created_at) })
    }
  }
  return given
}

export async function explainAccess(person: string, viewer: string): Promise<AccessExplanation> {
  // Refuse before saying whether the person exists.
  if (person !== viewer) await assertSystemManager(viewer)
  const [found] = await sql`
    select 1 from person where row_id = ${person}
    union all select 1 from service_account where row_id = ${person}`
  if (!found && person !== 'Administrator') throw new AppError('NotFoundError', `No person ${person}`)

  const held = await sql`
    select role, created_by, created_at from has_role
    where parent = ${person} and parenttype in ('Person', 'Service Account') and role is not null
    order by position`
  const given = await roleGrants(person)
  const roles: ExplainedRole[] = held.map((r) => {
    const role = String(r.role)
    // A role given before history recorded roles falls back to its row.
    const from = given.get(role) ?? { by: String(r.created_by), at: iso(r.created_at) }
    return { role, app: null, through: null, given_by: from.by, given_at: from.at }
  })
  // App roles bound to the person's own roles (#620), from available apps only,
  // the same rule getRoles applies.
  const own = held.map((r) => String(r.role))
  if (own.length) {
    const bound = await sql`
      select distinct b.app_role, b.app, b.bound_role from app_role_binding b
      join installed_app a on a.name = b.app and a.enabled and not a.activation_pending
      where b.bound_role in ${sql(own)} and b.bound_role not in ${sql(OPEN_ROLES)}
        and b.app_role not in ${sql(PLATFORM_ROLES)}
        and jsonb_typeof(a.manifest->'roles') = 'array' and a.manifest->'roles' ? b.app_role
        and b.app = any(${[...activeApps]}::text[])
      order by b.app, b.app_role, b.bound_role`
    for (const b of bound)
      roles.push({ role: String(b.app_role), app: String(b.app), through: String(b.bound_role), given_by: null, given_at: null })
  }

  const reach = await principalReach(person)

  const scopeRows = await sql`
    select allow_table, for_value, created_by, created_at from data_scope
    where (person = ${person} or service_account = ${person}) and allow_table is not null and for_value is not null
    order by allow_table, for_value`
  const shareRows = await sql`
    select share_table, share_name, write, share, created_by, created_at from share
    where (person = ${person} or service_account = ${person}) and share_table is not null and share_name is not null
    order by share_table, share_name`
  const refs = [
    ...scopeRows.map((r) => ({ table: String(r.allow_table), row_id: String(r.for_value) })),
    ...shareRows.map((r) => ({ table: String(r.share_table), row_id: String(r.share_name) })),
  ]
  const titles = new Map((await rowTitles(viewer, refs)).map((t) => [`${t.table}\u0000${t.row_id}`, t.title]))
  const title = (table: string, rowId: string) => titles.get(`${table}\u0000${rowId}`) ?? null

  return {
    person,
    every_table: reach.every_table,
    roles,
    read: reach.read,
    change: reach.change,
    limits: scopeRows.map((r) => ({
      table: String(r.allow_table), value: String(r.for_value), title: title(String(r.allow_table), String(r.for_value)),
      set_by: String(r.created_by), set_at: iso(r.created_at),
    })),
    shares: shareRows.map((r) => ({
      table: String(r.share_table), row_id: String(r.share_name), title: title(String(r.share_table), String(r.share_name)),
      write: Boolean(r.write), reshare: Boolean(r.share), shared_by: String(r.created_by), shared_at: iso(r.created_at),
    })),
  }
}
