// Who reads which forecast rows (#1454): each person's places come from Dash's own scope provider (reachOf) over a
// made-up org chart, as the platform asks it on every read; the platform's own rule (rowWithinPlaces, in shared) keeps
// each Table to them by the mapping Forecasting's manifest declares. Made-up stores, codes and people throughout.
import { describe, expect, it } from 'vitest'
type Row = Record<string, unknown>
// Dash's own provider, the one the instance runs. Loaded by its path: its files are Dash's, typechecked there.
type Documents = { available(table: string): Promise<boolean>; list(table: string, args: { fields?: string[]; filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }): Promise<Row[]> }
const DASH_PROVIDER = new URL('../../dash/src/provider.ts', import.meta.url).href
const { reachOf } = (await import(/* @vite-ignore */ DASH_PROVIDER)) as { reachOf(documents: Documents, person: string, on: string): Promise<{ places: unknown[] }> }
// The platform's rule, from shared (the same function place-scope.ts runs on every read).
type Place = { label: string; filters: Record<string, string[]>; basis?: string }
const SHARED = new URL('../../../../packages/shared/src/person-scope.ts', import.meta.url).href
const { rowWithinPlaces } = (await import(/* @vite-ignore */ SHARED)) as { rowWithinPlaces(mapping: Record<string, string>, places: Place[], row: Row): boolean }
import manifest from '../featherbase.json'
import { NO_PLACES, myPlaces } from './scoped'

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

/** How each Table is narrowed, as the manifest declares it: a copy by its dataset's filters, a review Table by its row rule `places` (rowRules, #1459). */
type Dataset = { name: string; filters?: Record<string, string>; unscoped?: boolean; store?: string }
const MAPPING: Record<string, Record<string, string> | null> = {
  ...Object.fromEntries((manifest.datasets as Dataset[]).map(d => [`forecasting.${d.name}`, d.unscoped ? null : d.filters ?? null])),
  ...Object.fromEntries(Object.entries((manifest as { rowRules?: Record<string, { kind: string; columns?: Record<string, string> }> }).rowRules ?? {})
    .flatMap(([table, rule]) => (rule.kind === 'places' ? [[table, rule.columns!]] : []))),
}

/** The month's lines: store × subcategory. A line merged from several subcategories carries no code. */
const line = (store: string, code: string | null, name: string) => ({ store_code: store, subcategory_code: code, subcategory_name: name })
const LINES = [line('9901', TOPS, 'Tops'), line('9901', SAREES, 'Sarees'), line('9901', TOYS, 'Toys'), line('9901', null, 'Mixed lot'),
  line('9902', SAREES, 'Sarees'), line('9902', SHIRTS, 'Shirts'), line('9903', TOPS, 'Tops')]
/** What a person reads of a Table: the rows within their places, or written by them. */
const read = (table: string, places: Place[], rows: Row[], me?: string) => rows.filter(r => !MAPPING[table] || (me !== undefined && r.created_by === me) || rowWithinPlaces(MAPPING[table]!, places, r))
const linesFor = async (places: Place[]) => read('forecasting.forecast_line_month', places, LINES).map(r => `${r.store_code} ${r.subcategory_name}`)

describe('the lines each person reads', () => {
  it('a Team Leader reads their own section’s subcategories at their store, and nothing merged or elsewhere', async () => {
    expect(await linesFor(await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }]))).toEqual(['9901 Tops'])
  })
  it('a Floor Manager reads every section of their floor', async () => {
    expect(await linesFor(await placesOf([{ job: 'Floor Manager', site: 'AAA', floor: 'AAA-GF' }]))).toEqual(['9901 Tops', '9901 Sarees'])
  })
  it('a Store Manager reads their whole store, a line merged from several subcategories too', async () => {
    expect(await linesFor(await placesOf([{ job: 'Store Manager', site: 'AAA' }]))).toEqual(['9901 Tops', '9901 Sarees', '9901 Toys', '9901 Mixed lot'])
  })
  it('a category head reads their category’s subcategories at every store of their region', async () => {
    expect(await linesFor(await placesOf([], [{ responsibility: 'Category head', category: 'Sarees', operating_region: 'East' }]))).toEqual(['9901 Sarees', '9902 Sarees'])
  })
  it('a Cluster Manager reads every store of their cluster, and a Director every store', async () => {
    expect(await linesFor(await placesOf([{ job: 'Cluster Manager', site: 'AAA' }]))).toEqual(['9901 Tops', '9901 Sarees', '9901 Toys', '9901 Mixed lot', '9902 Sarees', '9902 Shirts'])
    expect(await linesFor(await placesOf([{ job: 'Director', site: 'AAA' }]))).toHaveLength(LINES.length)
  })
  it('section staff read their own section, as in Dash', async () => {
    expect(await linesFor(await placesOf([{ job: 'Staff', site: 'AAA', section: 'AAA-GF-Tops' }]))).toEqual(['9901 Tops'])
  })
  it('someone who is staff in one section and Team Leader of another reads both', async () => {
    expect(await linesFor(await placesOf([{ job: 'Staff', site: 'AAA', section: 'AAA-GF-Tops' }, { job: 'Team Leader', site: 'AAA', section: 'AAA-FF-Toys' }]))).toEqual(['9901 Tops', '9901 Toys'])
  })
  it('someone the org chart gives no place reads nothing, and is told they have no access', async () => {
    expect(await placesOf([{ job: 'Head office staff', site: 'AAA' }])).toEqual([])
    expect(await linesFor([])).toEqual([])
    expect(() => myPlaces({ authorization: { places: [] }, reject: (m: string): never => { throw new Error(m) } })).toThrow(NO_PLACES)
    expect(myPlaces({ authorization: { places: [{}, {}] }, reject: (m: string): never => { throw new Error(m) } })).toEqual({ places: 2 })
  })
  it('a place the Table cannot apply adds nothing (fail closed)', async () => {
    expect(await linesFor([{ label: 'odd', filters: { store: ['9901'], line: ['L1'] } }])).toEqual([])
  })
})

describe('the review rows each person reads', () => {
  const REVIEWS = LINES.filter(l => l.subcategory_code).map((l, i) => ({ ...l, row_id: `R${i}`, created_by: `someone-${i}` }))
    .concat([{ ...line('9901', null, 'Mixed lot'), row_id: 'mine', created_by: 'me' }])
  const reviewsFor = async (places: Place[]) => read('forecasting.forecast_line_review', places, REVIEWS, 'me').map(r => r.row_id)
  it('a Team Leader reads every answer on their section’s lines, whoever gave it, and their own', async () => {
    expect(await reviewsFor(await placesOf([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }]))).toEqual(['R0', 'mine'])
  })
  it('a Store Manager reads their store’s', async () => {
    expect(await reviewsFor(await placesOf([{ job: 'Store Manager', site: 'AAA' }]))).toEqual(['R0', 'R1', 'R2', 'mine'])
  })
})

describe('the manifest', () => {
  it('maps every copy about places, and every review Table, by store and subcategory code', () => {
    for (const d of manifest.datasets as Dataset[]) {
      if (d.unscoped) continue
      expect(MAPPING[`forecasting.${d.name}`], d.name).toEqual({ store: 'store_code', subcategory: 'subcategory_code' })
    }
    for (const t of ['forecasting.day_explanation', 'forecasting.forecast_change', 'forecasting.forecast_line_review', 'forecasting.forecast_question'])
      expect(MAPPING[t], t).toEqual({ store: 'store_code', subcategory: 'subcategory_code' })
  })
  it('reads a Run and other stores’ stock whole (they name no place, or a transfer needs them)', () => {
    expect(MAPPING['forecasting.forecast_run']).toBeNull()
    expect(MAPPING['forecasting.item_stock']).toBeNull()
  })
})
