// #1453: an app's roles from the organisation's own records. An app declares, under `orgChartRoles`, which of its
// roles everyone the org chart gives a place may hold; a System Manager turns each on with an Org Chart Role Rule row.
// The job sync_org_chart_roles keeps App Roles From The Org Chart in step: everyone the instance's one scope provider
// gives at least one place (the same places every scoped read keeps them to, so the app and its reads agree about who
// is in) holds each role turned on, and someone with no place (left, no job, disabled) loses it on the next run.
// getRoles reads a row only while its rule stands and the app still declares and created the role.
import { createHash } from 'node:crypto'
import type { PersonScope } from 'shared'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { NoPersonScope, resolvePersonScope } from './person-scope'
import { PLATFORM_ROLES } from './permissions'
import { activeApps } from './app-lifecycle'
import { logActivity } from './audit'

export const ORG_CHART_ROLES_JOB = 'sync_org_chart_roles'
const packages = () => import('./runtime-packages')

/** Why a person holds the roles: their places, as the provider labels them, briefly. */
export function whyOf(places: PersonScope): string {
  const labels = places.map((place) => place.label)
  const shown = labels.slice(0, 3).join('; ')
  return `${labels.length} place${labels.length === 1 ? '' : 's'} on the org chart: ${shown}${labels.length > 3 ? `; and ${labels.length - 3} more` : ''}`.slice(0, 140)
}

/** The roles turned on: a rule a System Manager added, for an active app that still declares the role may be given
 *  so and created it when it was installed. */
async function rolesTurnedOn(): Promise<{ app: string; app_role: string }[]> {
  const rows = await sql`select r.app, r.app_role from org_chart_role_rule r
    join installed_app a on a.name = r.app and a.enabled and not a.activation_pending
    where jsonb_typeof(a.manifest->'orgChartRoles') = 'array' and a.manifest->'orgChartRoles' ? r.app_role
      and jsonb_typeof(a.roles) = 'array' and a.roles ? r.app_role
      and r.app_role not in ${sql(PLATFORM_ROLES)}
    order by r.app, r.app_role`
  return rows.map((r) => ({ app: String(r.app), app_role: String(r.app_role) })).filter((r) => activeApps.has(r.app))
}

/** Ships on (owner, 28-Nov-2026): the roles an app declares the org chart gives are turned on when it is installed,
 *  or when an upgrade first declares them (its preview lists them), and each one is logged. A System Manager turns
 *  one off by removing its rule; a later upgrade does not turn it on again unless the app declares it anew. */
export async function seedOrgChartRules(app: string, roles: readonly string[], actor: string, version?: string): Promise<string[]> {
  const added: string[] = []
  for (const role of roles) {
    if (PLATFORM_ROLES.includes(role)) continue
    const [written] = await sql`insert into org_chart_role_rule (row_id, app, app_role, created_by, updated_by)
      values (${createHash('sha256').update(`${app}\u0000${role}`).digest('hex').slice(0, 20)}, ${app}, ${role}, ${actor}, ${actor})
      on conflict (app, app_role) do nothing returning 1`
    if (!written) continue
    added.push(role)
    await logActivity(actor, `app_org_chart_role_added ${app}${version ? `@${version}` : ''}: ${role}`.slice(0, 140))
  }
  return added
}

export interface OrgChartRolesReport { people: number; holders: number; roles: string[]; gained: number; lost: number; published: boolean }

/**
 * Rebuild the holders in one go: readers see the old rows or the new, never half, and a rebuild that started before
 * the one on show writes nothing. A run the scope provider cannot answer (none, not set up, or failing for anyone)
 * writes nothing and fails, so an outage never takes the role from everyone; the last holders stand until a run can.
 */
export async function syncOrgChartRoles(): Promise<OrgChartRolesReport> {
  const [{ started }] = await sql`select clock_timestamp() as started`
  const turnedOn = await rolesTurnedOn()
  const rows: { person: string; app: string; app_role: string; why: string }[] = []
  let people: string[] = []
  let holders = 0
  if (turnedOn.length) {
    const provider = await (await packages()).findScopeProvider()
    if (!provider) throw new AppError('ConflictError', 'No app provides people\'s scope now, so nobody can be found on the org chart; the last holders stand')
    people = (await sql`select row_id from person where enabled and replaced_by is null and coalesce(built_in, false) = false order by row_id`).map((r) => String(r.row_id))
    let unanswered = 0
    for (const person of people) {
      let places: PersonScope = []
      try {
        places = await withTransaction(() => resolvePersonScope(person, provider))
      } catch (error) {
        if (error instanceof NoPersonScope && error.reason === 'scope') continue // no place: no role
        if ((error as { type?: string }).type === 'NotSetUpError')
          throw new AppError('ConflictError', `${provider.title} is not set up yet, so nobody can be found on the org chart; the last holders stand`)
        unanswered++
        continue
      }
      holders++
      const why = whyOf(places)
      for (const { app, app_role } of turnedOn) rows.push({ person, app, app_role, why })
    }
    if (unanswered) throw new AppError('ConflictError', `${provider.title} could not say where ${unanswered} of ${people.length} people work; the last holders stand`)
  }
  const key = (r: { person: string; app: string; app_role: string }) => `${r.person}\u0000${r.app}\u0000${r.app_role}`
  let gained = 0, lost = 0
  const published = await withTransaction(async () => {
    await sql`select pg_advisory_xact_lock(hashtext(${ORG_CHART_ROLES_JOB}))`
    const [shown] = await sql`select started_at from app_role_from_org_chart_rebuild where id = 1`
    if (shown && new Date(shown.started_at as string) > new Date(started as string)) return false
    const before = new Set((await sql`select person, app, app_role from app_role_from_org_chart`).map((r) => key(r as never)))
    const after = new Set(rows.map(key))
    gained = [...after].filter((k) => !before.has(k)).length
    lost = [...before].filter((k) => !after.has(k)).length
    const summary = turnedOn.length ? `${holders} of ${people.length} people hold ${turnedOn.map((r) => `${r.app}: ${r.app_role}`).join(', ')}` : 'No app role is turned on'
    await sql`insert into app_role_from_org_chart_rebuild (id, started_at, summary) values (1, ${started}, ${summary})
      on conflict (id) do update set started_at = excluded.started_at, summary = excluded.summary`
    await sql`delete from app_role_from_org_chart`
    for (const [position, row] of rows.entries())
      await sql`insert into app_role_from_org_chart ${sql({ row_id: createHash('sha256').update(key(row)).digest('hex').slice(0, 20), position, ...row })}`
    return true
  })
  return { people: people.length, holders, roles: turnedOn.map((r) => `${r.app}: ${r.app_role}`), gained, lost, published }
}

export function syncSummary(report: OrgChartRolesReport): string {
  if (!report.published) return 'A newer run was already on show; this one changed nothing'
  if (!report.roles.length) return 'No app role is turned on (Org Chart Role Rules); nobody holds one from the org chart'
  return `${report.holders} of ${report.people} people have a place on the org chart and hold ${report.roles.join(', ')}: ${report.gained} gained, ${report.lost} lost`
}
