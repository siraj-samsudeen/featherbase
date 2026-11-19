import type { PersonLabel } from 'shared'
import { sql } from './db'
import { scopedWhere } from './query'
import { readableTitles, recordKey as key, type RecordRef as Ref } from './record-titles'
import { readsRestricted } from './person-identifiers'
import { displayValue, SENSITIVITY, type Sensitivity } from './identifiers'
import { describePeople } from './person-standing'

// #1345: the Person Label. Every place a person is named reads who they are:
// `employee code · role · place`. Values are worked out here, once per request
// and in one batch, so no surface asks per row.
//
// Two layers. The platform's own: the person's current employee codes
// (employee-record identifiers) and email, read through Person as the viewer.
// Then the app that says who people are (`people.describe`, #1267: Dash, from
// StyleHR's Employee rows) adds their standing, job, business role and store,
// as the Person page shows them: the store and the business role only where
// the viewer may read that record, and read as its own title, so nothing the
// viewer cannot read reaches them through a label (item 10).

export type { PersonLabel } from 'shared'

/** How long search waits for the app that describes people (item 2). */
export const DESCRIBE_WAIT_MS = 300

/** The labels of `persons` as `viewer` may see them. A person the viewer may not read gets none. */
export async function personLabels(persons: readonly string[], viewer: string, wait = DESCRIBE_WAIT_MS): Promise<Map<string, PersonLabel>> {
  const wanted = [...new Set(persons.filter(Boolean))]
  const labels = new Map<string, PersonLabel>()
  if (!wanted.length) return labels
  const readable = await readablePeople(wanted, viewer)
  if (!readable.size) return labels
  const ids = [...readable.keys()]
  const codes = await visibleCodes(ids, viewer)
  for (const id of ids) {
    const mine = codes.get(id)?.current ?? []
    labels.set(id, {
      ...(mine[0] ? { code: mine[0] } : {}),
      ...(mine.length > 1 ? { more_codes: mine.slice(1).map((code) => ({ code })) } : {}),
      ...(readable.get(id) ? { email: readable.get(id)! } : {}),
    })
  }
  // The app layer: never longer than `wait`, never an error (items 1 and 2).
  const described = await within(wait, appLayer(ids, viewer, codes)).catch(() => null)
  if (described) for (const [id, extra] of described) labels.set(id, { ...labels.get(id), ...extra })
  return labels
}

/** The people of `ids` the viewer may read, each with their email where they may read it. */
async function readablePeople(ids: string[], viewer: string): Promise<Map<string, string | null>> {
  const scoped = await scopedWhere('Person', viewer, []).catch(() => null)
  if (!scoped) return new Map()
  const { table, where, cols, readExpression } = scoped
  const email = cols.has('email') ? readExpression('email') : sql`null::text`
  const rows = await sql`select row_id, ${email} as email from ${sql(table)} where ${where} and row_id = any(${ids})`
  return new Map(rows.map((r) => [String(r.row_id), (r.email as string | null) || null]))
}

/** Each person's employee codes the viewer may see in plain, current ones the latest-joined first, then
 *  ended ones (#1345, Codex adversarial round 1): the identifier systems' own sensitivity, as the person's
 *  identifiers panel applies it. A masked or hidden value tells no one apart, so it is no label code. */
async function visibleCodes(ids: string[], viewer: string): Promise<Map<string, { current: string[]; ended: string[] }>> {
  const rows = await sql`
    select i.person_id, i.value, i.value_hint, s.sensitivity, upper_inf(i.valid) as current from person_identifier i
    join identifier_system s on s.row_id = i.system and s.kind = 'employee-record'
    where i.person_id = any(${ids})
    order by i.person_id, upper_inf(i.valid) desc, lower(i.valid) desc nulls last, i.value`
  const restricted = new Map<string, boolean>()
  for (const id of new Set(rows.map((r) => String(r.person_id))))
    restricted.set(id, viewer === id || (await readsRestricted(viewer, id)))
  const codes = new Map<string, { current: string[]; ended: string[] }>()
  for (const r of rows) {
    const id = String(r.person_id)
    const sensitivity = r.sensitivity as Sensitivity
    const shown = displayValue({ value: r.value as string | null, value_hint: r.value_hint as string | null }, sensitivity,
      restricted.get(id)! && (viewer !== id || sensitivity !== 'Restricted, hidden'))
    if (!shown.shown || SENSITIVITY[sensitivity].display !== 'full' || !shown.value) continue
    const mine = codes.get(id) ?? { current: [], ended: [] }
    ;(r.current ? mine.current : mine.ended).push(shown.value)
    codes.set(id, mine)
  }
  return codes
}

/** Resolves to the promise's value, or null after `ms`; the promise is left to finish on its own. */
function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  work.catch(() => undefined)
  return Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/** What the app that describes people adds, as the viewer may see it: their standing, the job they hold
 *  (the first the app names), its business role and its store, each record only where the viewer may read it. */
async function appLayer(ids: string[], viewer: string, codes: Map<string, { current: string[]; ended: string[] }>): Promise<Map<string, PersonLabel>> {
  const standing = await describePeople(ids)
  const refs: Ref[] = []
  for (const s of standing.values()) {
    const job = s.jobs[0]
    if (job?.site) refs.push({ table: job.site.table, row_id: job.site.id })
    if (job?.business_role) refs.push({ table: job.business_role.table, row_id: job.business_role.id })
  }
  const titles = await readableTitles(refs, viewer)
  const shown = new Map<string, PersonLabel>()
  for (const id of ids) {
    const s = standing.get(id)
    // 'none' (not on the staff list) and 'unknown' (the app is off, failed or late) add nothing.
    if (!s || (s.status !== 'current' && s.status !== 'left')) continue
    const label: PersonLabel = { standing: s.status }
    if (s.status === 'left' && s.left_on) label.left_on = s.left_on
    // A leaver's code has ended, so the platform holds no current one: the app's says who they were, but
    // only as a value this viewer may already see among their codes, so it never restores a withheld one.
    // The code never drops (item 3): with no app code the viewer may see, their latest ended one.
    const mine = codes.get(id)
    if (!mine?.current.length) {
      const code = s.code && mine?.ended.includes(s.code) ? s.code : mine?.ended[0]
      if (code) label.code = code
    }
    const job = s.jobs[0]
    if (job) {
      const role = job.business_role ? titles.get(key({ table: job.business_role.table, row_id: job.business_role.id })) : undefined
      // The job's words are what the Person page shows anyone who may read the person (#1267).
      label.role = role ?? job.job
      const place = job.site ? titles.get(key({ table: job.site.table, row_id: job.site.id })) : undefined
      if (place) label.place = place
    }
    shown.set(id, label)
  }
  return shown
}

