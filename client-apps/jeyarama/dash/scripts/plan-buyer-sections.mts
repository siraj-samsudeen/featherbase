// #1246: plan the first Buyer Sections from an instance's Merchandise Assignment Buyer rows. READ ONLY:
// every request is a GET (checked below); it writes only the CSV and summary to --out, never to the instance.
//
//   FEATHERBASE_URL=https://dash.jeyarama.com FEATHERBASE_HEADERS="$(<header helper>)" \
//     node --experimental-strip-types scripts/plan-buyer-sections.mts --out <dir> [--today YYYY-MM-DD]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planBuyerSections, toCsv } from '../src/buyer-sections-plan.ts'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const base = process.env.FEATHERBASE_URL
const headers = JSON.parse(process.env.FEATHERBASE_HEADERS ?? '{}') as Record<string, string>
const out = arg('out')
const today = arg('today') ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
if (!base || !out) { console.error('Set FEATHERBASE_URL and FEATHERBASE_HEADERS, and pass --out <dir>'); process.exit(2) }

async function get(path: string): Promise<any> {
  const request = new Request(new URL(path, base), { method: 'GET', headers })
  if (request.method !== 'GET') throw new Error('read only')
  const response = await fetch(request)
  if (!response.ok) throw new Error(`${response.status} on ${path}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
}
async function every(table: string, fields: string[], filters: unknown[] = []): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let start = 0; ; start += 500) {
    const q = new URLSearchParams({ fields: JSON.stringify(['row_id', ...fields]), filters: JSON.stringify(filters), limit_start: String(start), limit_page_length: '500', order_by: 'row_id asc' })
    const page = (await get(`/api/table/${encodeURIComponent(table)}?${q}`)).data as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

const assignments = await every('Merchandise Assignment', ['employee', 'responsibility', 'division', 'subdivision', 'category', 'subcategory', 'operating_region', 'starts_on', 'ends_on'])
const subcategories = await every('Subcategory', ['subcategory', 'category', 'subdivision', 'division', 'subcategory_type'])
const people = [...new Set(assignments.map(a => String(a.employee ?? '')).filter(Boolean))]
const employees: Record<string, unknown>[] = []
for (let i = 0; i < people.length; i += 200) employees.push(...await every('Employee', ['name', 'status'], [['row_id', 'in', people.slice(i, i + 200)]]))
const regions = (await every('Operating Region', [])).map(r => String(r.row_id))
const { lines, summary } = planBuyerSections({ assignments, subcategories, employees, regions }, today)
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'buyer_sections_plan.csv'), toCsv(lines))
writeFileSync(join(out, 'buyer_sections_plan_summary.json'), JSON.stringify({ today, read: { merchandise_assignments: assignments.length, subcategories: subcategories.length, employees: employees.length }, ...summary }, null, 2) + '\n')
console.log(JSON.stringify({ today, sections: summary.sections, vacant_sections: summary.vacant_sections, subcategories_placed: summary.subcategories_placed, no_buyer: summary.no_buyer,
  wider_buyer_rows: summary.wider_buyer_rows.length, two_buyers: summary.two_buyers.length, two_heads: summary.two_heads.length }))
