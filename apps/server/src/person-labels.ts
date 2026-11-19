import type { PersonLabel } from 'shared'
import { sql } from './db'
import { scopedWhere } from './query'
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
  const codes = await currentCodes(ids)
  for (const id of ids) {
    const mine = codes.get(id) ?? []
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

/** Each person's current employee codes, the latest-joined first. */
async function currentCodes(ids: string[]): Promise<Map<string, string[]>> {
  const rows = await sql`
    select i.person_id, i.value from person_identifier i
    join identifier_system s on s.row_id = i.system and s.kind = 'employee-record'
    where i.person_id = any(${ids}) and upper_inf(i.valid)
    order by i.person_id, lower(i.valid) desc nulls last, i.value`
  const codes = new Map<string, string[]>()
  for (const r of rows) codes.set(String(r.person_id), [...(codes.get(String(r.person_id)) ?? []), String(r.value)])
  return codes
}

/** Resolves to the promise's value, or null after `ms`; the promise is left to finish on its own. */
function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  work.catch(() => undefined)
  return Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/** What the app that describes people adds, as the viewer may see it: their standing, the job they hold
 *  (the first the app names), its business role and its store, each record only where the viewer may read it. */
async function appLayer(ids: string[], viewer: string, codes: Map<string, string[]>): Promise<Map<string, PersonLabel>> {
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
    // A leaver's code has ended, so the platform holds no current one: the app's says who they were.
    if (!codes.get(id)?.length && s.code) label.code = s.code
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

type Ref = { table: string; row_id: string }
const key = (r: Ref) => `${r.table}\u0000${r.row_id}`

/** Each record's title (else its key), for the records the viewer may read; the rest are left out. */
async function readableTitles(refs: Ref[], viewer: string): Promise<Map<string, string>> {
  const byTable = new Map<string, Set<string>>()
  for (const r of refs) byTable.set(r.table, (byTable.get(r.table) ?? new Set()).add(r.row_id))
  const titles = new Map<string, string>()
  await Promise.all([...byTable].map(async ([table, rowIds]) => {
    const scoped = await scopedWhere(table, viewer, []).catch(() => null)
    if (!scoped) return
    const { meta, table: physical, where, cols, readExpression } = scoped
    const rowKey = sql(meta.row_key)
    const shown = meta.title_column && cols.has(meta.title_column) ? readExpression(meta.title_column) : rowKey
    const rows = await sql`select ${rowKey}::text as id, ${shown}::text as title from ${sql(physical)}
      where ${where} and ${rowKey}::text = any(${[...rowIds]})`
    for (const r of rows) {
      const words = String(r.title ?? r.id ?? '').trim()
      if (words) titles.set(key({ table, row_id: String(r.id) }), words)
    }
  }))
  return titles
}
