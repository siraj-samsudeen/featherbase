// The live org chart, as Forecasting needs it (#1419; Siraj, 28-Nov-2026: read live and read-only from the
// instance's own Tables, Dash's org chart). The server reads only the columns the manifest's baseTables.read names,
// with the app's own access, and hands the pages the derived map; the client never reads those Tables.
// Dates: a Section Subcategory or Job Assignment row's Ends On is its last day; a Merchandise Assignment's Ends On is
// the first day it no longer applies (each Table's own description says so).

type Row = Record<string, unknown>
interface BaseTables { list(table: string, args: { fields: string[]; filters?: [string, string, unknown][]; limit_page_length?: number; order_by?: string }): Promise<Row[]> }

export interface OrgSection { id: string; name: string; floor: string; floorOrder: number; teamLeaders: string[] }
export interface OrgSubcategory { section: string | null; buyer: string | null; categoryHead: string | null }
/** One store's org chart today: its sections (floor, floor order, Team Leaders), its Store Managers, and each
 *  subcategory's section, buyer and category head, by subcategory code. */
export interface OrgChart { store: string; region: string | null; sections: OrgSection[]; storeManagers: string[]; subcategories: Record<string, OrgSubcategory> }

const day = (v: unknown) => (v == null || v === '' ? null : String(v).slice(0, 10))
/** Applies on `today`, its Ends On being its last day. */
const throughEnd = (r: Row, today: string) => (!day(r.starts_on) || day(r.starts_on)! <= today) && (!day(r.ends_on) || day(r.ends_on)! >= today)
/** Applies on `today`, its Ends On being the first day it no longer applies. */
const beforeEnd = (r: Row, today: string) => (!day(r.starts_on) || day(r.starts_on)! <= today) && (!day(r.ends_on) || day(r.ends_on)! > today)
/** Of rows that apply, the one that started last. */
const latest = (rows: Row[]) => rows.sort((a, b) => String(day(b.starts_on) ?? '').localeCompare(String(day(a.starts_on) ?? '')))[0]
const ALL = 20000

export async function orgChart(base: BaseTables, store: string, today: string): Promise<OrgChart> {
  const [site] = await base.list('Site', { fields: ['row_id', 'operating_region'], filters: [['row_id', '=', store]], limit_page_length: 1 })
  const region = site ? String(site.operating_region ?? '') || null : null
  const [sections, floors, placed, jobs] = await Promise.all([
    base.list('Section', { fields: ['row_id', 'name', 'floor', 'status'], filters: [['site', '=', store]], limit_page_length: ALL }),
    base.list('Store Floor', { fields: ['row_id', 'name', 'floor_order'], filters: [['site', '=', store]], limit_page_length: ALL }),
    base.list('Section Subcategory', { fields: ['subcategory', 'section', 'starts_on', 'ends_on'], filters: [['store', '=', store]], limit_page_length: ALL }),
    base.list('Job Assignment', { fields: ['employee', 'job', 'section', 'starts_on', 'ends_on'], filters: [['site', '=', store], ['job', 'in', ['Team Leader', 'Store Manager']]], limit_page_length: ALL }),
  ])
  const todays = jobs.filter(j => throughEnd(j, today))
  const merch = region ? (await base.list('Merchandise Assignment', { fields: ['employee', 'responsibility', 'category', 'subcategory', 'starts_on', 'ends_on'],
    filters: [['operating_region', '=', region], ['responsibility', 'in', ['Buyer', 'Category head']]], limit_page_length: ALL })).filter(m => beforeEnd(m, today)) : []
  const people = [...new Set([...todays, ...merch].map(r => String(r.employee ?? '')).filter(Boolean))]
  const names = new Map((people.length ? await base.list('Employee', { fields: ['row_id', 'name'], filters: [['row_id', 'in', people]], limit_page_length: ALL }) : [])
    .map(e => [String(e.row_id), String(e.name ?? e.row_id)]))
  const nameOf = (id: unknown) => (id ? names.get(String(id)) ?? String(id) : null)

  const floorOf = new Map(floors.map(f => [String(f.row_id), f]))
  const orgSections: OrgSection[] = sections.filter(s => String(s.status ?? 'Active') !== 'Closed').map(s => {
    const f = floorOf.get(String(s.floor ?? ''))
    return { id: String(s.row_id), name: String(s.name), floor: f ? String(f.name) : 'No floor', floorOrder: f?.floor_order == null ? 99 : Number(f.floor_order),
      teamLeaders: todays.filter(j => j.job === 'Team Leader' && String(j.section ?? '') === String(s.row_id)).map(j => nameOf(j.employee)!).filter(Boolean) }
  })

  // each subcategory's section today: of its rows that apply, the one that started last
  const bySub = new Map<string, Row[]>()
  for (const r of placed.filter(r => throughEnd(r, today))) bySub.set(String(r.subcategory), [...(bySub.get(String(r.subcategory)) ?? []), r])
  const codes = [...new Set([...bySub.keys(), ...merch.map(m => String(m.subcategory ?? '')).filter(Boolean)])]
  const categoryOf = new Map((codes.length ? await base.list('Subcategory', { fields: ['row_id', 'category'], filters: [['row_id', 'in', codes]], limit_page_length: ALL }) : [])
    .map(s => [String(s.row_id), String(s.category ?? '')]))
  // the most specific row wins: a head named for one subcategory over its category's head
  const who = (code: string, responsibility: string) => {
    const mine = merch.filter(m => m.responsibility === responsibility)
    const exact = latest(mine.filter(m => String(m.subcategory ?? '') === code))
    const byCategory = latest(mine.filter(m => !m.subcategory && String(m.category ?? '') === categoryOf.get(code)))
    return nameOf((exact ?? byCategory)?.employee)
  }
  const subcategories: Record<string, OrgSubcategory> = {}
  for (const code of codes) subcategories[code] = { section: latest(bySub.get(code) ?? []) ? String(latest(bySub.get(code)!).section ?? '') || null : null,
    buyer: who(code, 'Buyer'), categoryHead: who(code, 'Category head') }
  return { store, region, sections: orgSections, storeManagers: todays.filter(j => j.job === 'Store Manager').map(j => nameOf(j.employee)!).filter(Boolean), subcategories }
}
