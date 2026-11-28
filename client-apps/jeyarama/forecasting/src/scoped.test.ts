// Who reads which forecast rows (#1454): each person's places come from Dash's own scope provider (reachOf) over a
// made-up org chart, as the platform asks it on every read; the platform keeps a copy's rows to those places
// (fakePlatform applies its rule), exactly as Dash's reports are kept. Made-up stores, codes and people throughout.
import { describe, expect, it } from 'vitest'
type Row = Record<string, unknown>
// Dash's own provider, the one the instance runs. Loaded by its path: its files are Dash's, typechecked there.
type Documents = { available(table: string): Promise<boolean>; list(table: string, args: { fields?: string[]; filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }): Promise<Row[]> }
const DASH_PROVIDER = new URL('../../dash/src/provider.ts', import.meta.url).href
const { reachOf } = (await import(/* @vite-ignore */ DASH_PROVIDER)) as { reachOf(documents: Documents, person: string, on: string): Promise<{ places: unknown[] }> }
import { COPIES, NO_PLACES, REVIEW_TABLES, STOCK_ELSEWHERE, copyRowId, inPlaces, readCopy, readReview, type Place, type ScopedReadContext } from './scoped'

const ON = '2026-12-05'
// Two stores in the North cluster (East region), one in the South (West).
const SITES: Row[] = [
  { row_id: 'AAA', name: 'Alpha', is_store: true, cluster: 'North', operating_region: 'East' },
  { row_id: 'BBB', name: 'Beta', is_store: true, cluster: 'North', operating_region: 'East' },
  { row_id: 'CCC', name: 'Gamma', is_store: true, cluster: 'South', operating_region: 'West' },
]
const PLANTS: Row[] = [{ row_id: '9901', site: 'AAA', plant_type: 'Store' }, { row_id: '9902', site: 'BBB', plant_type: 'Store' }, { row_id: '9903', site: 'CCC', plant_type: 'Store' }]
const SECTIONS: Row[] = [
  { row_id: 'AAA-GF-Tops', name: 'Tops', site: 'AAA', floor: 'AAA-GF' },
  { row_id: 'AAA-GF-Sarees', name: 'Sarees', site: 'AAA', floor: 'AAA-GF' },
  { row_id: 'AAA-FF-Toys', name: 'Toys', site: 'AAA', floor: 'AAA-FF' },
]
const TOPS = '000000001', SAREES = '000000003', TOYS = '000000004', SHIRTS = '000000005'
const PLACEMENTS: Row[] = [
  { row_id: 'p1', store: 'AAA', section: 'AAA-GF-Tops', subcategory: TOPS, starts_on: '2026-01-01', ends_on: null },
  { row_id: 'p3', store: 'AAA', section: 'AAA-GF-Sarees', subcategory: SAREES, starts_on: '2026-01-01', ends_on: null },
  { row_id: 'p4', store: 'AAA', section: 'AAA-FF-Toys', subcategory: TOYS, starts_on: '2026-01-01', ends_on: null },
]
const SUBCATEGORIES: Row[] = [
  { row_id: TOPS, category: 'Tops', subdivision: 'Womenswear', division: 'Fashion', subcategory_type: 'Merchandise' },
  { row_id: SAREES, category: 'Sarees', subdivision: 'Womenswear', division: 'Fashion', subcategory_type: 'Merchandise' },
  { row_id: TOYS, category: 'Toys', subdivision: 'Kids', division: 'Home', subcategory_type: 'Merchandise' },
  { row_id: SHIRTS, category: 'Shirts', subdivision: 'Menswear', division: 'Fashion', subcategory_type: 'Merchandise' },
]

/** The org chart with one person (E1) holding `jobs` and `assignments` (Merchandise Assignment rows). */
function orgChart(jobs: Row[], assignments: Row[] = []): Documents {
  const tables: Record<string, Row[]> = {
    Employee: [{ row_id: 'E1', person: 'me', status: 'Current' }],
    'Job Assignment': jobs.map((job, i) => ({ row_id: `J${i}`, employee: 'E1', starts_on: '2026-01-01', ends_on: null, ...job })),
    'Merchandise Assignment': assignments.map((row, i) => ({ row_id: `M${i}`, employee: 'E1', division: null, subdivision: null, category: null, subcategory: null,
      operating_region: null, starts_on: '2026-01-01', ends_on: null, ...row })),
    Site: SITES, Plant: PLANTS, Section: SECTIONS, 'Section Subcategory': PLACEMENTS, Subcategory: SUBCATEGORIES,
    Department: [], 'Department Section': [], Cluster: [{ row_id: 'North', cluster_manager: null }, { row_id: 'South', cluster_manager: null }], 'dash.access_source': [],
  }
  return {
    async available(table: string) { return table in tables },
    async list(table, { filters = [], limit_start = 0, limit_page_length = 500 }) {
      const rows = tables[table].filter(row => filters.every(([column, op, value]) => (op === 'in' ? (value as unknown[]).includes(row[column]) : row[column] === value)))
      return rows.slice(limit_start, limit_start + limit_page_length)
    },
  }
}
const placesOf = async (jobs: Row[], assignments: Row[] = []) => (await reachOf(orgChart(jobs, assignments), 'me', ON)).places as Place[]

/** The month's lines: store × subcategory. A line merged from several subcategories carries no code. */
const line = (store: string, code: string | null, name: string) => ({ run_id: 'dec', region: 'X', store_code: store, store_short_code: store === '9901' ? 'AAA' : store === '9902' ? 'BBB' : 'CCC',
  division_name: 'D', subdivision_name: 'S', category_name: 'C', subcategory_name: name, subcategory_code: code, forecast_value_before_tax: 100 })
const LINES = [line('9901', TOPS, 'Tops'), line('9901', SAREES, 'Sarees'), line('9901', TOYS, 'Toys'), line('9901', null, 'Mixed lot'),
  line('9902', SAREES, 'Sarees'), line('9902', SHIRTS, 'Shirts'), line('9903', TOPS, 'Tops')]
/** One item's stock at each store (the narrow, unscoped copy a transfer reads). */
const STOCK = ['9901', '9902', '9903'].map(store => ({ store_code: store, item_code: 'IT-1', subcategory_code: SAREES, stock_qty: 5 }))
const REVIEWS = LINES.filter(l => l.subcategory_code).map((l, i) => ({ row_id: `R${i}`, updated_at: '2026-12-05', run_id: 'dec', store_code: l.store_code,
  subcategory_name: l.subcategory_name, subcategory_code: l.subcategory_code, reviewer: `Someone ${i}`, answer: 'accepted' }))

/** The platform's part: a copy's rows (or a review Table's) kept to all of the reader's places, as datasetWhere and
 *  the scoped Tables read them, and narrowed by the read's own key filters. */
function fakePlatform(places: Place[], payload: unknown): ScopedReadContext & { views: string[] } {
  const views: string[] = []
  const keepAll = (rows: Row[], filters: unknown) => rows.filter(r => Object.entries((filters ?? {}) as Record<string, string[]>).every(([k, v]) => [v].flat().includes(String(r[k]))))
  // an unscoped copy answers every row; a scoped one only its places'
  const keep = (rows: Row[], mapping: Record<string, string>, filters: unknown) => keepAll(rows, filters).filter(r => inPlaces(r, places, mapping))
  return {
    payload, authorization: { places }, views,
    datasets: { async active(name, filters) { return { at: '2026-12-05T00:00:00Z', rows: name === STOCK_ELSEWHERE ? keepAll(STOCK, filters) : keep(name === 'forecast_line_month' ? LINES : [], COPIES.get(name)!.filters!, filters) } } },
    scopedTables: { async list(table, filters) { return keep(REVIEWS, REVIEW_TABLES.get(table)!, filters) } },
    async recordView(d) { views.push(String(d?.dataset)) },
    reject(message: string): never { throw new Error(message) },
  }
}
const linesFor = async (places: Place[], filters?: Record<string, string[]>) =>
  (await readCopy(fakePlatform(places, { dataset: 'forecast_line_month', filters, fields: ['store_code', 'subcategory_name'] }))).rows
    .map(r => `${r.store_code} ${r.subcategory_name}`)

describe('the lines each person reads', () => {
  it('a Team Leader reads their own section’s subcategories at their store, and nothing merged or elsewhere', async () => {
    const places = await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }])
    expect(await linesFor(places)).toEqual(['9901 Tops'])
  })
  it('a Floor Manager reads every section of their floor', async () => {
    expect(await linesFor(await placesOf([{ job: 'Floor Manager', site: 'AAA', floor: 'AAA-GF' }]))).toEqual(['9901 Tops', '9901 Sarees'])
  })
  it('a Store Manager reads their whole store, a line merged from several subcategories too', async () => {
    expect(await linesFor(await placesOf([{ job: 'Store Manager', site: 'AAA' }]))).toEqual(['9901 Tops', '9901 Sarees', '9901 Toys', '9901 Mixed lot'])
  })
  it('a category head reads their category’s subcategories at every store of their region', async () => {
    const places = await placesOf([], [{ responsibility: 'Category head', category: 'Sarees', operating_region: 'East' }])
    expect(await linesFor(places)).toEqual(['9901 Sarees', '9902 Sarees'])
  })
  it('a Cluster Manager (the region’s head, as RB) reads every store of their cluster, and a Director every store', async () => {
    expect(await linesFor(await placesOf([{ job: 'Cluster Manager', site: 'AAA' }]))).toEqual(['9901 Tops', '9901 Sarees', '9901 Toys', '9901 Mixed lot', '9902 Sarees', '9902 Shirts'])
    expect(await linesFor(await placesOf([{ job: 'Director', site: 'AAA' }]))).toHaveLength(LINES.length)
  })
  it('section staff read their own section, as in Dash', async () => {
    const places = await placesOf([{ job: 'Staff', site: 'AAA', section: 'AAA-GF-Tops' }])
    expect(places.map(p => p.basis)).toEqual(['section_staff'])
    expect(await linesFor(places)).toEqual(['9901 Tops'])
  })
  it('someone who is staff in one section and Team Leader of another reads both', async () => {
    const places = await placesOf([{ job: 'Staff', site: 'AAA', section: 'AAA-GF-Tops' }, { job: 'Team Leader', site: 'AAA', section: 'AAA-FF-Toys' }])
    expect(await linesFor(places)).toEqual(['9901 Tops', '9901 Toys'])
  })
  it('someone the org chart gives no place is refused', async () => {
    expect((await placesOf([{ job: 'Head office staff', site: 'AAA' }]))).toEqual([])
    await expect(linesFor([])).rejects.toThrow(NO_PLACES)
  })
  it('an acting Team Leader counts as one', async () => {
    expect(await linesFor(await placesOf([{ job: 'Team Leader', acting: true, site: 'AAA', section: 'AAA-GF-Sarees' }]))).toEqual(['9901 Sarees'])
  })
  it('nobody reaches past their places by naming a store or a subcategory', async () => {
    const tl = await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }])
    expect(await linesFor(tl, { store_code: ['9902'] })).toEqual([])
    expect(await linesFor(tl, { subcategory_code: [SAREES] })).toEqual([])
  })
  it('a place the copy cannot apply adds nothing (fail closed)', async () => {
    expect(await linesFor([{ label: 'odd', filters: { store: ['9901'], line: ['L1'] }, basis: 'store_manager' }])).toEqual([])
  })
})

describe('the review rows each person reads', () => {
  const reviewsFor = async (places: Place[]) => (await readReview(fakePlatform(places, { table: 'forecasting.forecast_line_review', fields: ['reviewer'] })))
    .map(r => `${r.row_id} ${r.reviewer}`)
  it('a Team Leader reads every answer on their section’s lines, whoever gave it, and no other', async () => {
    expect(await reviewsFor(await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }]))).toEqual(['R0 Someone 0'])
  })
  it('a Store Manager reads their store’s; section staff their section’s', async () => {
    expect(await reviewsFor(await placesOf([{ job: 'Store Manager', site: 'AAA' }]))).toEqual(['R0 Someone 0', 'R1 Someone 1', 'R2 Someone 2'])
    expect(await reviewsFor(await placesOf([{ job: 'Staff', site: 'AAA', section: 'AAA-GF-Tops' }]))).toEqual(['R0 Someone 0'])
  })
  it('answers only the fields asked for, with row_id and updated_at', async () => {
    const [row] = await readReview(fakePlatform(await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }]), { table: 'forecasting.forecast_line_review', fields: ['reviewer'] }))
    expect(Object.keys(row).sort()).toEqual(['reviewer', 'row_id', 'updated_at'])
  })
  it('refuses a Table it does not scope', async () => {
    await expect(readReview(fakePlatform([], { table: 'forecasting.number' }))).rejects.toThrow(/no review Table/)
  })
})

describe('the reads themselves', () => {
  it('name every scoped copy by store and subcategory code, and each review Table too', () => {
    for (const copy of COPIES.values()) if (!copy.unscoped) expect(copy.filters, copy.name).toEqual({ store: 'store_code', subcategory: 'subcategory_code' })
    expect([...REVIEW_TABLES.keys()].sort()).toEqual(['forecasting.day_explanation', 'forecasting.forecast_change', 'forecasting.forecast_line_review', 'forecasting.forecast_question'])
    for (const mapping of REVIEW_TABLES.values()) expect(mapping).toEqual({ store: 'store_code', subcategory: 'subcategory_code' })
  })
  it('give each copy row the id the platform keys it by, and log the view', async () => {
    const ctx = fakePlatform(await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }]), { dataset: 'forecast_line_month' })
    const [row] = (await readCopy(ctx)).rows
    expect(row.row_id).toBe(copyRowId(COPIES.get('forecast_line_month')!, row))
    expect(row.row_id).toBe(['dec', '9901', 'Tops'].join('·'))
    expect(ctx.views).toEqual(['forecast_line_month'])
  })
  it('answer other stores’ stock of named items or subcategories, for a transfer, and never a whole store’s list', async () => {
    const tl = await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }])
    const stock = (filters?: Record<string, string[]>) => readCopy(fakePlatform(tl, { dataset: STOCK_ELSEWHERE, filters, fields: ['store_code', 'stock_qty'] }))
    expect((await stock({ item_code: ['IT-1'] })).rows.map(r => r.store_code)).toEqual(['9901', '9902', '9903'])
    expect((await stock({ subcategory_code: [SAREES], store_code: ['9902'] })).rows.map(r => r.store_code)).toEqual(['9902'])
    await expect(stock({ store_code: ['9902'] })).rejects.toThrow(/Name the items or subcategories/)
    await expect(stock()).rejects.toThrow(/Name the items or subcategories/)
  })
})
