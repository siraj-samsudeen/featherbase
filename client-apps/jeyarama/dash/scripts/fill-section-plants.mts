// Links each section to its site's one plant (#1351). Safe to rerun: only a section with no plant is
// filled, and only at a site holding exactly one plant; a site with several plants, or none, is left
// for a person and listed, as is a section whose plant is at another site. Every write carries the row's updated_at, so a section someone changed
// since it was read is refused by the server and skipped, never overwritten.
//
//   FEATHERBASE_TOKEN=<the loader's token> tsx scripts/fill-section-plants.mts --url <instance> [--apply] [--out <folder>]
//
// Without --apply it is a dry run: it reads, says what it would fill and what is left, and writes
// nothing to the instance. With --apply it writes the record of every section it filled to --out
// (default: here), named with its keep-until date (#4365). Undo is by hand from that record: each
// section's Activity shows the change. The instance's Section Table needs a `plant` column linking
// to Plant first. The token is read from the environment only and never printed. Never run it
// with --apply on production without the owner's yes.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planSectionPlants, type PlantRow, type SectionRow } from '../src/section-plants.ts'

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const url = flag('--url')?.replace(/\/$/, '')
const token = process.env.FEATHERBASE_TOKEN
const apply = args.includes('--apply')
if (!url || !token) throw new Error('Give --url, and the loader\'s token in FEATHERBASE_TOKEN')

const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${url}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } })
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } }
  if (!response.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${response.status}`), { status: response.status })
  return body
}
const all = async <T>(table: string, fields: string[]): Promise<T[]> => {
  const rows: T[] = []
  for (let start = 0; ; start += 500) {
    const query = new URLSearchParams({ fields: JSON.stringify(fields), limit_start: String(start), limit_page_length: '500', order_by: 'row_id asc' })
    const { data } = await call<{ data: T[] }>(`/api/table/${encodeURIComponent(table)}?${query}`)
    rows.push(...data)
    if (data.length < 500) return rows
  }
}

const meta = await call<{ columns: { column_name: string; reference_table: string | null }[] }>('/api/table/Section:meta')
const column = meta.columns.find(c => c.column_name === 'plant')
if (column?.reference_table !== 'Plant') throw new Error('Section has no plant column linking to Plant: add it on the instance first')

const sections = await all<SectionRow & { updated_at: string }>('Section', ['row_id', 'site', 'plant', 'updated_at'])
const plants = await all<PlantRow>('Plant', ['row_id', 'site'])
const plan = planSectionPlants(sections, plants)
const stamp = new Map(sections.map(s => [s.row_id, s.updated_at]))
const leftBySite = Object.fromEntries([...new Set(plan.left.map(l => l.site))].map(site => {
  const left = plan.left.filter(l => l.site === site)
  return [site, { sections: left.length, plants: left[0].plants }]
}))
const summary = { sections: sections.length, already_set: plan.kept, to_fill: plan.fill.length, left_for_a_person: plan.left.length, left_by_site: leftBySite,
  // Set by hand to a plant of another site: a person checks these; the script never changes them.
  plant_at_another_site: plan.elsewhere }
if (!apply) {
  console.log(JSON.stringify({ dry_run: true, ...summary }, null, 1))
  process.exit(0)
}

const filled: typeof plan.fill = []
const skipped: { section: string; why: string }[] = []
for (const fill of plan.fill) {
  try {
    await call(`/api/table/Section/${encodeURIComponent(fill.section)}`, { method: 'PATCH',
      body: JSON.stringify({ plant: fill.plant, updated_at: stamp.get(fill.section) }) })
    filled.push(fill)
  } catch (error) {
    skipped.push({ section: fill.section, why: (error as Error).message })
  }
}
const keepUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
const at = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
const record = join(flag('--out') ?? '.', `section-plants-filled-${at}__keep-until-${keepUntil}.json`)
writeFileSync(record, JSON.stringify({ filled, skipped }, null, 2))
console.log(JSON.stringify({ ...summary, filled: filled.length, skipped, record }, null, 1))
