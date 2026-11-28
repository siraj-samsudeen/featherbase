// #1453: an app's roles from the organisation's own records. An app declares, under `orgChartRoles`, which of its
// roles everyone the org chart gives a place holds; the instance turns it on by enabling the Scheduled Job
// sync_org_chart_roles (off when installed). The job keeps App Roles From The Org Chart in step: everyone the
// instance's one scope provider gives at least one place (the same places every scoped read keeps them to, so the
// app and its reads cannot disagree about who is in) holds each declared role of each active app, and someone with no
// place (left, no job, disabled) loses it on the next run. getRoles reads the rows only while the job is on.
import { createHash } from 'node:crypto'
import type { PersonScope } from 'shared'
import { sql, withTransaction } from './db'
import { NoPersonScope, resolvePersonScope } from './person-scope'
import { PLATFORM_ROLES } from './permissions'

export const ORG_CHART_ROLES_JOB = 'sync_org_chart_roles'
const packages = () => import('./runtime-packages')

/** Why a person holds the roles: their places, as the provider labels them, briefly. */
export function whyOf(places: PersonScope): string {
  const labels = places.map((place) => place.label)
  const shown = labels.slice(0, 3).join('; ')
  return `${labels.length} place${labels.length === 1 ? '' : 's'} on the org chart: ${shown}${labels.length > 3 ? `; and ${labels.length - 3} more` : ''}`.slice(0, 140)
}

export interface OrgChartRolesReport { people: number; holders: number; rows: number; roles: string[] }

/** Rebuild the rows in one go: readers see the old holders or the new, never half; two runs take turns. An app's
 *  declared roles are given only while it is active. */
export async function syncOrgChartRoles(): Promise<OrgChartRolesReport> {
  const loaded = await packages()
  const declared = loaded.orgChartRoleDeclarations().map(({ app, roles }) => ({ app, roles: roles.filter((role) => !PLATFORM_ROLES.includes(role)) }))
    .filter(({ roles }) => roles.length)
  const provider = await loaded.findScopeProvider()
  const rows: { person: string; app: string; app_role: string; why: string }[] = []
  let holders = 0
  const people = declared.length && provider
    ? (await sql`select row_id from person where enabled and replaced_by is null and coalesce(built_in, false) = false order by row_id`).map((r) => String(r.row_id))
    : []
  for (const person of people) {
    let places: PersonScope = []
    try {
      places = await withTransaction(() => resolvePersonScope(person, provider))
    } catch (error) {
      // no places, or a provider that cannot answer for this person: no role from the org chart
      if (!(error instanceof NoPersonScope) && (error as { type?: string }).type !== 'NotSetUpError') throw error
    }
    if (!places.length) continue
    holders++
    const why = whyOf(places)
    for (const { app, roles } of declared) for (const app_role of roles) rows.push({ person, app, app_role, why })
  }
  await withTransaction(async () => {
    await sql`select pg_advisory_xact_lock(hashtext(${ORG_CHART_ROLES_JOB}))`
    await sql`delete from app_role_from_org_chart`
    for (const [position, row] of rows.entries())
      await sql`insert into app_role_from_org_chart ${sql({
        row_id: createHash('sha256').update(`${row.person}\u0000${row.app}\u0000${row.app_role}`).digest('hex').slice(0, 20), position, ...row })}`
  })
  return { people: people.length, holders, rows: rows.length, roles: declared.flatMap(({ app, roles }) => roles.map((role) => `${app}: ${role}`)) }
}

export function syncSummary(report: OrgChartRolesReport): string {
  if (!report.roles.length) return 'No app declares a role from the org chart; nobody holds one'
  return `${report.holders} of ${report.people} people have a place on the org chart and hold ${report.roles.join(', ')}`
}
