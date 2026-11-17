// #1267: who people are to the organisation, for the platform's Person page.
// The platform runs this read as its own describe actor (never as a person),
// so it may read every Employee; it filters what a viewer sees afterwards. The
// answer is whoIs(), the one function Dash's own screens use.
import { istToday } from './report.ts'
import { whoIs, type AccessContext } from './report-access-server.ts'

/** The actor the platform runs this read as (person-standing.ts `describeActor`). */
export const DESCRIBE_ACTOR = 'people-describe:dash'
const MAX_PERSONS = 200

export type Described = {
  person: string
  status: 'current' | 'left' | 'none'
  code: string | null
  jobs: { job: string; site?: { table: 'Site'; id: string; name: string } }[]
}

/** `{ persons }` described in the order asked. Only the platform's describe actor may ask. */
export async function describePeople(ctx: AccessContext, on: string = istToday()): Promise<Described[]> {
  if (ctx.user !== DESCRIBE_ACTOR || !(ctx.roles ?? []).includes('System Manager'))
    ctx.reject!('Only the platform describes people this way')
  const asked = (ctx.payload as { persons?: unknown } | undefined)?.persons
  const persons = [...new Set(Array.isArray(asked) ? asked.filter((p): p is string => typeof p === 'string' && !!p) : [])].slice(0, MAX_PERSONS)
  const who = await whoIs(ctx.baseTables!, persons, on, { sites: true })
  return persons.map(person => {
    const w = who.get(person)!
    return {
      person,
      status: w.staff,
      code: w.code,
      jobs: (w.held ?? []).map(h => (h.site ? { job: h.job, site: { table: 'Site' as const, id: h.site.id, name: h.site.name } } : { job: h.job })),
    }
  })
}
