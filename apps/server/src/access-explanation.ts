import { sql } from './db'
import { AppError } from './errors'
import { activeApps } from './app-lifecycle'
import { OPEN_ROLES, PLATFORM_ROLES, assertPermission, getRoles } from './permissions'
import { canUseAdmin } from './landing'
import { NoPersonScope, coversPersonScope, resolvePersonScope } from './person-scope'
import { appCatalog, findScopeProvider } from './runtime-packages'
import { principalReach, type TableReach } from './token-reach'
import { rowTitles } from './row-titles'
import { everyoneRoles } from './everyone-roles'
import { actorNames } from './actor-names'

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
  /** #923: held because System Settings gives it to everyone who signs in. */
  everyone: boolean
  given_by: string | null
  /** #1224: who gave it, by name, even when the viewer may not read Person. */
  given_by_name: string | null
  given_at: string | null
}

/** #1224: a Table as a reader says it, so the page can group by module and
 *  say "Reports (Dash)" instead of dash.report_access. */
export interface ExplainedTable extends TableReach {
  label: string
  module: string
  app: string | null
}

export interface AccessExplanation {
  person: string
  /** #1224: the person's display name, for the page title; the viewer may
   *  open this page, so who it is about is not hidden from them. */
  person_name: string | null
  /** #1224: the apps the person can open, by title, for the summary. */
  apps: { name: string; title: string; href: string }[]
  every_table: boolean
  roles: ExplainedRole[]
  read: ExplainedTable[]
  change: ExplainedTable[]
  /** #1224: which of the Tables this page names (Role, Person, Service
   *  Account, each Table reached) the VIEWER may open in the Admin, so the
   *  page links only what will open. Empty when they cannot use the Admin. */
  viewer_opens: string[]
  limits: { table: string; value: string; title: string | null; set_by: string; set_by_name: string | null; set_at: string }[]
  shares: { table: string; row_id: string; title: string | null; write: boolean; reshare: boolean; shared_by: string; shared_by_name: string | null; shared_at: string }[]
  /** The places the instance's scope-providing app gives the person today,
   *  each with the reasons the app gives (Q1 C). Null when no app provides a
   *  scope. Labels and reasons only, never a filter value. */
  scope: {
    app: string
    title: string
    /** Why the person has no usable scope, as NoPersonScope names it. */
    problem: NoPersonScope['reason'] | null
    places: { label: string; reasons: { text: string; since: string | null; until: string | null }[] }[]
  } | null
}

/** A Table's label, else its name in words: "dash.report_access" reads
 *  "Report access". */
export function tableLabel(name: string, label: unknown): string {
  const given = String(label ?? '').trim()
  if (given) return given
  const bare = name.includes('.') ? name.slice(name.indexOf('.') + 1) : name
  const words = bare.replace(/[_-]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : name
}

const iso = (value: unknown) => (value as Date).toISOString()

/** The built-in role whose holders may open anyone's page (#628). */
export const ACCESS_AUDITOR = 'Access Auditor'

/** Who may open someone else's page: a System Manager, an Access Auditor, or
 *  (C1, owner 4 Nov) a viewer whose places cover every place of the person.
 *  A person with no places is never covered: resolvePersonScope refuses an
 *  empty scope, for either side. */
async function assertMayExplain(person: string, viewer: string) {
  if (person === viewer || viewer === 'Administrator') return
  const roles = await getRoles(viewer)
  if (roles.includes('System Manager') || roles.includes(ACCESS_AUDITOR)) return
  if (await coversPlaces(viewer, person)) return
  throw new AppError('PermissionError', 'Only the person, a System Manager, an Access Auditor or someone whose places cover theirs may open this page')
}

async function scopeOf(person: string): Promise<AccessExplanation['scope']> {
  const binding = await findScopeProvider()
  if (!binding) return null
  const answer = await resolvePersonScope(person, binding).then(
    (places) => ({ problem: null, places }),
    // Besides NoPersonScope's reasons, resolving fails only when the app is
    // not set up yet (a declared identifier system is missing): its
    // configuration. The page still shows everything else.
    (error: unknown) => ({ problem: error instanceof NoPersonScope ? error.reason : 'configuration' as const, places: [] }))
  return {
    app: binding.app, title: binding.title, problem: answer.problem,
    places: answer.places.map((place) => ({
      label: place.label,
      reasons: (place.reasons ?? []).map((r) => ({ text: r.text, since: r.since ?? null, until: r.until ?? null })),
    })),
  }
}

async function coversPlaces(viewer: string, person: string): Promise<boolean> {
  const binding = await findScopeProvider()
  // No usable scope on either side (NoPersonScope), or anything else that
  // stops the answer, refuses: this only ever widens who may look.
  // One after the other: each answer runs in the request's transaction.
  return resolvePersonScope(person, binding)
    .then(async (theirs) => coversPersonScope(theirs, await resolvePersonScope(viewer, binding)))
    .catch(() => false)
}

/** Who gave each role the person holds, and when, from the Person's history:
 *  #830 records a Person's roles as one field, the names joined by ", ". The
 *  latest entry that added a role wins, so a role removed and given again
 *  reads as the second time. */
async function roleGrants(person: string): Promise<Map<string, { by: string; at: string }>> {
  const versions = await sql`
    select data->'changed' as changed, created_by, created_at from version
    where ref_table = 'Person' and ref_name = ${person} and jsonb_typeof(data->'changed') = 'array'
    order by created_at, row_id`
  const names = (value: unknown) => new Set(typeof value === 'string' && value ? value.split(', ') : [])
  const given = new Map<string, { by: string; at: string }>()
  for (const v of versions) {
    // Only entries that record changed fields count (an import's
    // annotations and older shapes carry none).
    const changed = v.changed as [string, unknown, unknown][]
    for (const [, was, now] of changed.filter(([column]) => column === 'roles')) {
      const before = names(was)
      for (const role of names(now)) if (!before.has(role)) given.set(role, { by: String(v.created_by), at: iso(v.created_at) })
    }
  }
  return given
}

export async function explainAccess(person: string, viewer: string): Promise<AccessExplanation> {
  // Refuse before saying whether the person exists.
  await assertMayExplain(person, viewer)
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
    return { role, app: null, through: null, everyone: false, given_by: from.by, given_by_name: null, given_at: from.at }
  })
  // #923: a person also holds the roles given to everyone who signs in.
  const [isPerson] = await sql`select 1 from person where row_id = ${person} and row_id <> 'Guest'`
  for (const role of isPerson ? await everyoneRoles(sql) : [])
    if (!roles.some((r) => r.role === role)) roles.push({ role, app: null, through: null, everyone: true, given_by: null, given_by_name: null, given_at: null })
  // App roles bound to the person's own roles (#620), from available apps only,
  // the same rule getRoles applies.
  const own = roles.map((r) => r.role)
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
      roles.push({ role: String(b.app_role), app: String(b.app), through: String(b.bound_role), everyone: false, given_by: null, given_by_name: null, given_at: null })
  }

  const reach = await principalReach(person)
  const tableNames = [...new Set([...reach.read, ...reach.change].map((t) => t.table))]
  const defs = new Map((tableNames.length
    ? await sql`select name, label, module, owner_app from table_def where name in ${sql(tableNames)}` : [])
    .map((d) => [String(d.name), d]))
  const described = (t: TableReach): ExplainedTable => {
    const d = defs.get(t.table)
    return { ...t, label: tableLabel(t.table, d?.label), module: String(d?.module ?? 'Core'), app: (d?.owner_app as string | null) ?? null }
  }
  const scope = await scopeOf(person)

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

  // #1224: the people (or accounts, or system steps) who gave, set or shared
  // each of these are named. The viewer may already open this page, so who
  // acted on it is not hidden from them; only the display name travels.
  const named = await actorNames([
    ...roles.map((r) => r.given_by), ...scopeRows.map((r) => r.created_by), ...shareRows.map((r) => r.created_by)])
  const nameOf = (id: unknown) => (id == null ? null : named.get(String(id)) ?? null)
  for (const r of roles) r.given_by_name = nameOf(r.given_by)

  const candidates = [...new Set(['Role', 'Person', 'Service Account', ...tableNames, ...refs.map((r) => r.table)])]
  const viewer_opens: string[] = []
  // One after the other: inside a request they share its transaction.
  if (await canUseAdmin(viewer))
    for (const table of candidates)
      if (await assertPermission(viewer, table, 'read').then(() => true, () => false)) viewer_opens.push(table)

  const apps = (await appCatalog(person)).map((a) => ({ name: String(a.name), title: String(a.title ?? a.name), href: String(a.href) }))

  return {
    person,
    person_name: (await actorNames([person])).get(person) ?? null,
    apps,
    every_table: reach.every_table,
    viewer_opens,
    roles,
    read: reach.read.map(described),
    change: reach.change.map(described),
    limits: scopeRows.map((r) => ({
      table: String(r.allow_table), value: String(r.for_value), title: title(String(r.allow_table), String(r.for_value)),
      set_by: String(r.created_by), set_by_name: nameOf(r.created_by), set_at: iso(r.created_at),
    })),
    shares: shareRows.map((r) => ({
      table: String(r.share_table), row_id: String(r.share_name), title: title(String(r.share_table), String(r.share_name)),
      write: Boolean(r.write), reshare: Boolean(r.share), shared_by: String(r.created_by), shared_by_name: nameOf(r.created_by), shared_at: iso(r.created_at),
    })),
    scope,
  }
}
