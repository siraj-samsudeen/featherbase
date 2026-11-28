// The live org chart, as Forecasting needs it (#1419; Siraj, 28-Nov-2026: read live and read-only from the
// instance's own Tables, Dash's org chart). The server reads only the columns the manifest's baseTables.read names,
// with the app's own access, and hands the pages the derived map; the client never reads those Tables.
// Dates: a Section Subcategory or Job Assignment row's Ends On is its last day; a Merchandise Assignment's Ends On is
// the first day it no longer applies (each Table's own description says so).

type Row = Record<string, unknown>
interface BaseTables { list(table: string, args: { fields: string[]; filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number; order_by?: string }): Promise<Row[]> }

export interface OrgSection { id: string; name: string; floor: string; floorOrder: number; teamLeaders: string[] }
export interface OrgSubcategory { section: string | null; buyer: string | null; categoryHead: string | null
  /** The category head's Employee row: people are told apart by it, never by name (two can share one). */
  categoryHeadId: string | null }
/** One store's org chart today: its sections (floor, floor order, Team Leaders), its Store Managers, and each
 *  subcategory's section, buyer and category head, by subcategory code. */
export interface OrgChart { store: string; region: string | null; sections: OrgSection[]; storeManagers: string[]
  /** The Store Managers' Employee rows, in the order of storeManagers. */
  storeManagerIds: string[]; subcategories: Record<string, OrgSubcategory>
  /** The region's stores, short code → name, for the stores a transfer names. */
  stores: Record<string, string>
  /** Each person the chart names → their Employee row, so a page can link them (#1227). */
  people: Record<string, string> }

/** A Date column's calendar day: the database client returns a Date at UTC midnight, a page or a test the text. */
const day = (v: unknown) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v == null ? '' : String(v))
  return m ? m[1] : null
}
/** Applies on `today`, its Ends On being its last day. */
const throughEnd = (r: Row, today: string) => (!day(r.starts_on) || day(r.starts_on)! <= today) && (!day(r.ends_on) || day(r.ends_on)! >= today)
/** Applies on `today`, its Ends On being the first day it no longer applies. */
const beforeEnd = (r: Row, today: string) => (!day(r.starts_on) || day(r.starts_on)! <= today) && (!day(r.ends_on) || day(r.ends_on)! > today)
/** Of rows that apply, the one that started last. */
const latest = (rows: Row[]) => rows.sort((a, b) => String(day(b.starts_on) ?? '').localeCompare(String(day(a.starts_on) ?? '')))[0]
/** Every row a read matches: the platform serves a list 500 rows a page, one read at a time. */
const PAGE = 500
async function all(base: BaseTables, table: string, args: { fields: string[]; filters?: [string, string, unknown][] }): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await base.list(table, { ...args, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

export async function orgChart(base: BaseTables, store: string, today: string): Promise<OrgChart> {
  const [site] = await base.list('Site', { fields: ['row_id', 'operating_region'], filters: [['row_id', '=', store]], limit_page_length: 1 })
  const region = site ? String(site.operating_region ?? '') || null : null
  const stores = Object.fromEntries((region ? await all(base, 'Site', { fields: ['row_id', 'name'], filters: [['operating_region', '=', region]] }) : [])
    .map(x => [String(x.row_id), String(x.name ?? x.row_id)]))
  // one read at a time: the platform refuses a handler's base Table reads awaited together
  const sections = await all(base, 'Section', { fields: ['row_id', 'name', 'floor', 'status'], filters: [['site', '=', store]] })
  const floors = await all(base, 'Store Floor', { fields: ['row_id', 'name', 'floor_order'], filters: [['site', '=', store]] })
  const placed = await all(base, 'Section Subcategory', { fields: ['subcategory', 'section', 'starts_on', 'ends_on'], filters: [['store', '=', store]] })
  const jobs = await all(base, 'Job Assignment', { fields: ['employee', 'job', 'section', 'starts_on', 'ends_on'], filters: [['site', '=', store], ['job', 'in', ['Team Leader', 'Store Manager']]] })
  const todays = jobs.filter(j => throughEnd(j, today))
  const merch = region ? (await all(base, 'Merchandise Assignment', { fields: ['employee', 'responsibility', 'category', 'subcategory', 'starts_on', 'ends_on'],
    filters: [['operating_region', '=', region], ['responsibility', 'in', ['Buyer', 'Category head']]] })).filter(m => beforeEnd(m, today)) : []
  const people = [...new Set([...todays, ...merch].map(r => String(r.employee ?? '')).filter(Boolean))]
  const names = new Map((people.length ? await all(base, 'Employee', { fields: ['row_id', 'name'], filters: [['row_id', 'in', people]] }) : [])
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
  const categoryOf = new Map((codes.length ? await all(base, 'Subcategory', { fields: ['row_id', 'category'], filters: [['row_id', 'in', codes]] }) : [])
    .map(s => [String(s.row_id), String(s.category ?? '')]))
  // the most specific row wins: a head named for one subcategory over its category's head
  const who = (code: string, responsibility: string) => {
    const mine = merch.filter(m => m.responsibility === responsibility)
    const exact = latest(mine.filter(m => String(m.subcategory ?? '') === code))
    const byCategory = latest(mine.filter(m => !m.subcategory && String(m.category ?? '') === categoryOf.get(code)))
    const id = (exact ?? byCategory)?.employee
    return { name: nameOf(id), id: id ? String(id) : null }
  }
  const managers = todays.filter(j => j.job === 'Store Manager' && j.employee)
  const subcategories: Record<string, OrgSubcategory> = {}
  for (const code of codes) subcategories[code] = { section: latest(bySub.get(code) ?? []) ? String(latest(bySub.get(code)!).section ?? '') || null : null,
    buyer: who(code, 'Buyer').name, categoryHead: who(code, 'Category head').name, categoryHeadId: who(code, 'Category head').id }
  return { store, region, stores, people: Object.fromEntries([...names].map(([id, name]) => [name, id])), sections: orgSections, storeManagers: managers.map(j => nameOf(j.employee)!),
    storeManagerIds: managers.map(j => String(j.employee)), subcategories }
}
