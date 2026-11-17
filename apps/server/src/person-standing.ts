// #1267 step 3: who a person is to the organisation. The platform keeps no
// employee records; an app that does says it, through the read its manifest
// names as `people.describe` (Dash's answers from StyleHR's Employee rows, the
// same function its own screens use). The answer is never stored.
//
// The read runs as the app's own actor, so a person's standing is the truth,
// not whatever the viewer happens to be able to read. What it names (a job's
// store) is then kept only where the viewer may open it. A describer that is
// missing reads as 'none'; one that fails or is slow reads as 'unknown', which
// shows no badge and refuses nothing: a failed lookup must never lock a real
// employee out.
import { z } from 'zod'
import { sql } from './db'
import { getDoc } from './document'
import { activeApps } from './app-lifecycle'
import { runAsSystemActor } from './system-actor'
// Loaded when first needed, as view-as.ts does: a static import closes a start-up cycle.
const packages = () => import('./runtime-packages')

export type StandingStatus = 'current' | 'left' | 'none' | 'unknown'

export interface Standing {
  status: StandingStatus
  /** The person's employee code, when the app knows one. */
  code: string | null
  /** Each job held today, with its store where the viewer may open it. */
  jobs: { job: string; site?: { table: string; id: string; name: string } }[]
  /** #1271: for someone who has left, the day they left, when the app knows it. */
  left_on?: string | null
}

/** How long the app has to answer before the person reads as 'unknown'. */
export const DESCRIBE_MS = 3000

const UNKNOWN: Standing = { status: 'unknown', code: null, jobs: [] }
const NONE: Standing = { status: 'none', code: null, jobs: [] }

const answerSchema = z.array(z.object({
  person: z.string(),
  status: z.enum(['current', 'left', 'none']),
  code: z.string().nullable().optional(),
  left_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  jobs: z.array(z.object({
    job: z.string(),
    site: z.object({ table: z.string(), id: z.string(), name: z.string() }).optional(),
  })).optional(),
}))

/** The actor an app's describe read runs as: named, and System Manager only inside that read. */
export const describeActor = (app: string) => `people-describe:${app}`

/** The app that says who people are. 'none' when no installed app describes
 *  people; 'unavailable' when one does but cannot answer now (turned off, not
 *  loaded, waiting for activation): its people are then unknown, never External. */
async function describer(): Promise<{ app: string; describe: string } | 'none' | 'unavailable'> {
  // The installed manifests, not only the loaded ones: an app that failed to load still describes people.
  const installed = await sql`select name, enabled, activation_pending from installed_app
    where manifest -> 'people' ->> 'describe' is not null order by name`
  if (!installed.length) return 'none'
  const loaded = (await packages()).peopleDescribers()
  for (const row of installed) {
    const ready = row.enabled === true && row.activation_pending !== true && activeApps.has(String(row.name))
    const found = ready ? loaded.find((d) => d.app === String(row.name)) : undefined
    if (found) return found
  }
  return 'unavailable'
}

/** Each person's standing as the app says it, unfiltered. Internal: callers that
 *  show it to someone go through `standingFor`, which filters by the viewer. */
export async function describePeople(persons: string[]): Promise<Map<string, Standing>> {
  const wanted = [...new Set(persons.filter(Boolean))]
  const out = new Map<string, Standing>()
  if (!wanted.length) return out
  const app = await describer()
  if (app === 'none' || app === 'unavailable') {
    for (const person of wanted) out.set(person, app === 'none' ? NONE : UNKNOWN)
    return out
  }
  const actor = describeActor(app.app)
  let timer: ReturnType<typeof setTimeout> | undefined
  const answer = await Promise.race([
    runAsSystemActor(actor, async () => (await packages()).runGrant(app.app, 'read', app.describe, { payload: { persons: wanted } }, actor)),
    new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), DESCRIBE_MS) }),
  ]).catch(() => 'failed' as const).finally(() => clearTimeout(timer))
  const parsed = answer === 'late' || answer === 'failed' ? null : answerSchema.safeParse(answer)
  const said = new Map((parsed?.success ? parsed.data : []).map((entry) => [entry.person, entry]))
  for (const person of wanted) {
    const entry = said.get(person)
    // A person the app answered for; a person it left out, while it answered at all, is unknown too.
    out.set(person, entry ? { status: entry.status, code: entry.code ?? null, jobs: entry.jobs ?? [], ...(entry.left_on ? { left_on: entry.left_on } : {}) } : UNKNOWN)
  }
  return out
}

async function mayRead(table: string, row: string, viewer: string): Promise<boolean> {
  return getDoc(table, row, viewer).then(() => true, () => false)
}

/** A person's standing as `viewer` may see it. Refuses a viewer who may not
 *  read the Person; drops each store the viewer may not open. */
export async function standingFor(person: string, viewer: string): Promise<Standing & { external_label: string | null }> {
  const row = await getDoc('Person', person, viewer)
  const standing = (await describePeople([person])).get(person)!
  const jobs = await Promise.all(standing.jobs.map(async (job) =>
    job.site && !(await mayRead(job.site.table, job.site.id, viewer)) ? { job: job.job } : job))
  const label = typeof row.external_label === 'string' ? row.external_label : null
  // The label describes an External person only.
  return { ...standing, jobs, external_label: standing.status === 'none' ? label : null }
}
