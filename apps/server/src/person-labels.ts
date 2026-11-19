import { z } from 'zod'
import type { PersonLabel } from 'shared'
import { sql } from './db'
import { scopedWhere } from './query'
import { describingApps, describePeopleWith } from './runtime-packages'

// #1345: the Person Label. Every place a person is named reads who they are:
// `employee code · role · place`. Values are worked out here, once per request
// and in one batch, so no surface asks per row.
//
// Two layers. The platform's own: the person's current employee codes
// (employee-record identifiers) and email, read through Person as the viewer.
// Then an app that knows the staff list (`person.describe` in its manifest)
// adds role, place, standing and company. The app answers with records, never
// words: each part is shown only where the viewer may read the record it
// names, and reads as that record's own title, read as the viewer. So nothing
// the viewer cannot read reaches them through a label (item 10).

export type { PersonLabel } from 'shared'

/** How long search waits for the apps that describe people (item 2). */
export const DESCRIBE_WAIT_MS = 300

const ref = z.object({ table: z.string().min(1).max(140), row_id: z.string().min(1).max(200) }).strict()
const described = z.object({
  standing: z.enum(['current', 'left', 'consultant', 'supplier']).optional(),
  left_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** The person's employment records, the main one first, each by the code it holds. */
  records: z.array(ref.extend({ code: z.string().min(1).max(60) }).strict()).max(20).optional(),
  role: ref.optional(),
  place: ref.optional(),
  company: ref.optional(),
}).strict()
const answerSchema = z.object({ version: z.literal(1), people: z.record(z.string(), described) }).strict()
type Described = z.infer<typeof described>
type Ref = z.infer<typeof ref>

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

/** What the apps that describe people add, as the viewer may see it. The first app with an
 *  appointment for a person speaks for them; another that also answers is logged, never merged. */
async function appLayer(ids: string[], viewer: string, codes: Map<string, string[]>): Promise<Map<string, PersonLabel>> {
  const apps = await describingApps(viewer)
  const answers = await Promise.all(apps.map(async (app) => {
    try {
      // A read's answer comes as `{ result }`.
      const answer = await describePeopleWith(app, ids, viewer) as { result?: unknown } | null
      const parsed = answerSchema.safeParse(answer?.result)
      return { app: app.app, people: parsed.success ? parsed.data.people : {} }
    } catch {
      return { app: app.app, people: {} }
    }
  }))
  const chosen = new Map<string, Described>()
  for (const { app, people } of answers)
    for (const id of ids) {
      const said = Object.hasOwn(people, id) ? people[id]! : undefined
      if (!said || !hasAppointment(said)) continue
      if (chosen.has(id)) console.warn(`[person-label] ${app} also describes ${id}; the first app's answer is shown`)
      else chosen.set(id, said)
    }
  const titles = await readableTitles([...chosen.values()].flatMap((d) => [d.role, d.place, d.company, ...(d.records ?? [])].filter((r): r is Ref => !!r)), viewer)
  const shown = new Map<string, PersonLabel>()
  for (const [id, d] of chosen) {
    const title = (r?: Ref) => (r ? titles.get(key(r)) : undefined)
    const mine = codes.get(id) ?? []
    // Records count only for codes the platform holds for this person, and only where the viewer may open them.
    const records = (d.records ?? []).filter((r) => mine.includes(r.code))
    const main = records.find((r) => r.code === mine[0])
    const label: PersonLabel = {}
    const role = title(d.role), place = title(d.place), company = title(d.company)
    if (role) label.role = role
    if (place) label.place = place
    if (company) label.company = company
    // Standing says something about their employment: shown only with a record of it the viewer may read
    // (their main employment record; for a consultant or supplier, their company).
    const anchored = d.standing === 'consultant' || d.standing === 'supplier' ? !!company : !!(main && titles.has(key(main)))
    if (d.standing && anchored) {
      label.standing = d.standing
      if (d.standing === 'left' && d.left_on) label.left_on = d.left_on
    }
    const more = mine.slice(1).map((code) => {
      const r = records.find((x) => x.code === code)
      return r && titles.has(key(r)) ? { code, table: r.table, row_id: r.row_id } : { code }
    })
    if (more.length) label.more_codes = more
    if (Object.keys(label).length) shown.set(id, label)
  }
  return shown
}

const hasAppointment = (d: Described) => !!(d.role || d.place || d.company || d.standing || d.records?.length)
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
