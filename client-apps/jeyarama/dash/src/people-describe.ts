// #1267: who people are to the organisation, for the platform's Person page.
// The platform runs this read as its own describe actor (never as a person),
// so it may read every Employee; it filters what a viewer sees afterwards. The
// answer is whoIs(), the one function Dash's own screens use.
import { istToday } from './report.ts'
import { all, whoIs, type AccessContext } from './report-access-server.ts'
import { DESIGNATION, ROLE, ROLE_ASSIGNMENT, TITLE_MAP, readsDesignations, type Base } from './business-access.ts'
import { inForce, key, mapping, type HandChange } from './business-roles.ts'
import { EMPLOYEE_STATUS, day, exact, holdsOn, text } from './values.ts'

/** The actor the platform runs this read as (person-standing.ts `describeActor`). */
export const DESCRIBE_ACTOR = 'people-describe:dash'
const MAX_PERSONS = 200

export type Described = {
  person: string
  status: 'current' | 'left' | 'none'
  code: string | null
  jobs: { job: string; site?: { table: 'Site'; id: string; name: string }; business_role?: { table: typeof ROLE; id: string; name: string } }[]
}

/** `{ persons }` described in the order asked. Only the platform's describe actor may ask. */
export async function describePeople(ctx: AccessContext, on: string = istToday()): Promise<Described[]> {
  if (ctx.user !== DESCRIBE_ACTOR || !(ctx.roles ?? []).includes('System Manager'))
    ctx.reject!('Only the platform describes people this way')
  const asked = (ctx.payload as { persons?: unknown } | undefined)?.persons
  const persons = [...new Set(Array.isArray(asked) ? asked.filter((p): p is string => typeof p === 'string' && !!p) : [])].slice(0, MAX_PERSONS)
  const who = await whoIs(ctx.baseTables!, persons, on, { sites: true })
  const roleOf = await businessRolesOf(ctx, persons, on)
  return persons.map(person => {
    const w = who.get(person)!
    return {
      person,
      status: w.staff,
      code: w.code,
      jobs: (w.held ?? []).map(h => {
        const role = roleOf(person, h.job, h.site?.id)
        return {
          job: h.job,
          ...(h.site ? { site: { table: 'Site' as const, id: h.site.id, name: h.site.name } } : {}),
          ...(role ? { business_role: { table: ROLE, ...role } } : {}),
        }
      }),
    }
  })
}

/**
 * featherbase #1345: the business role (#1218) each job gives, for the platform's Person Label, as Explain
 * finds it: a Correct given by hand that is in force, else the job's HR title (Job Assignment.designation),
 * else its job title, through the Title Map. One read of each Table for every person asked about.
 */
async function businessRolesOf(ctx: AccessContext, persons: string[], on: string) {
  const base = ctx.baseTables!
  const employees = (await all(base, 'Employee', ['person', EMPLOYEE_STATUS], [['person', 'in', persons]])).filter(row => text(row[EMPLOYEE_STATUS]) === 'Current')
  const jobs = employees.length
    ? (await all(base, 'Job Assignment', ['employee', 'job', 'site', 'designation', 'starts_on', 'ends_on'], [['employee', 'in', employees.map(row => exact(row.row_id))]])).filter(row => holdsOn(row, on))
    : []
  const roles = (await all(base, ROLE, ['role_name', 'by_hand_only'])).map(r => ({ id: exact(r.row_id), name: text(r.role_name), by_hand_only: r.by_hand_only === 1 || r.by_hand_only === true || r.by_hand_only === '1' }))
  const rules = (await all(base, TITLE_MAP, ['title', 'business_role'])).map(r => ({ title: text(r.title), role: exact(r.business_role) || null }))
  const byTitle = mapping({ rules, roles } as Parameters<typeof mapping>[0])
  const corrections = (await all(base, ROLE_ASSIGNMENT, ['person', 'change', 'business_role', 'ends_on', 'removed'], [['person', 'in', persons]]))
    .map(r => ({ id: exact(r.row_id), person: exact(r.person), change: text(r.change) as HandChange['change'], role: exact(r.business_role), ends_on: day(r.ends_on) || null, removed: r.removed === 1 || r.removed === true || r.removed === '1' }))
    .filter(h => h.change === 'Correct' && inForce(h, on) && roles.some(r => r.id === h.role))
  // HR's titles, where Job Assignment names a Designation record (as businessAccess reads them).
  const designated = [...new Set(jobs.map(row => exact(row.designation)).filter(Boolean))]
  const designationNames = new Map(designated.length && await readsDesignations(base as Base)
    ? (await all(base, DESIGNATION, ['designation'], [['row_id', 'in', designated]])).map(row => [exact(row.row_id), text(row.designation)])
    : [])
  const named = (id: string | undefined) => { const r = roles.find(x => x.id === id); return r ? { id: r.id, name: r.name } : undefined }
  return (person: string, job: string, site: string | undefined) => {
    const corrected = corrections.find(c => c.person === person)
    if (corrected) return named(corrected.role)
    const mine = new Set(employees.filter(e => exact(e.person) === person).map(e => exact(e.row_id)))
    const row = jobs.find(r => mine.has(exact(r.employee)) && exact(r.job) === job && (exact(r.site) || undefined) === site)
    if (!row) return undefined
    const title = designationNames.get(exact(row.designation))
    return named((title && byTitle.get(key(title))) || byTitle.get(key(job)))
  }
}
