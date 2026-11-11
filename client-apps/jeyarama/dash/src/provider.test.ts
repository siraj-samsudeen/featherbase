// Who sees what (#967's table), from the core Tables. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { PROVIDER_TABLES, orgChartProvider, reachOf, type Documents } from './provider'

type Row = Record<string, unknown>
const ON = '2026-11-07'
const SITES: Row[] = [
  { row_id: 'AAA', name: 'Alpha', is_store: true, cluster: 'North', operating_region: 'East' },
  { row_id: 'BBB', name: 'Beta', is_store: true, cluster: 'North', operating_region: 'East' },
  { row_id: 'CCC', name: 'Gamma', is_store: true, cluster: 'South', operating_region: 'West' },
  { row_id: 'DDD', name: 'Delta', is_store: true, cluster: null, operating_region: 'West' },
  { row_id: 'HOF', name: 'Head office', is_store: false, cluster: null, operating_region: 'East' },
]
const PLANTS: Row[] = [
  { row_id: '9901', site: 'AAA', plant_type: 'Store' }, { row_id: '9151', site: 'AAA', plant_type: 'Warehouse' },
  { row_id: '9902', site: 'BBB', plant_type: 'Store' }, { row_id: '9903', site: 'CCC', plant_type: 'Store' }, { row_id: '9904', site: 'DDD', plant_type: 'Store' },
]
const SECTIONS: Row[] = [
  { row_id: 'AAA-GF-Tops', name: 'Tops', site: 'AAA', floor: 'AAA-GF' },
  { row_id: 'AAA-GF-Sarees', name: 'Sarees', site: 'AAA', floor: 'AAA-GF' },
  { row_id: 'AAA-FF-Toys', name: 'Toys', site: 'AAA', floor: 'AAA-FF' },
  { row_id: 'AAA-FF-Empty', name: 'Empty', site: 'AAA', floor: 'AAA-FF' },
  { row_id: 'BBB-GF-Tops', name: 'Tops', site: 'BBB', floor: 'BBB-GF' },
]
const PLACEMENTS: Row[] = [
  { row_id: 'p1', store: 'AAA', section: 'AAA-GF-Tops', subcategory: '000000001', starts_on: '2026-01-01', ends_on: null },
  { row_id: 'p2', store: 'AAA', section: 'AAA-GF-Tops', subcategory: '000000002', starts_on: '2026-01-01', ends_on: '2026-02-01' },
  { row_id: 'p3', store: 'AAA', section: 'AAA-GF-Sarees', subcategory: '000000003', starts_on: '2026-01-01', ends_on: null },
  { row_id: 'p4', store: 'AAA', section: 'AAA-FF-Toys', subcategory: '000000004', starts_on: '2026-01-01', ends_on: null },
  { row_id: 'p5', store: 'BBB', section: 'BBB-GF-Tops', subcategory: '000000005', starts_on: '2026-01-01', ends_on: null },
]
/** The merchandise tree, as Subcategory carries it: each code names its category, subdivision and division. */
const SUBCATEGORIES: Row[] = [
  { row_id: '000000001', category: 'Tops', subdivision: 'Womenswear', division: 'Fashion', subcategory_type: 'Merchandise' },
  { row_id: '000000002', category: 'Tops', subdivision: 'Womenswear', division: 'Fashion', subcategory_type: 'Merchandise' },
  { row_id: '000000003', category: 'Sarees', subdivision: 'Womenswear', division: 'Fashion', subcategory_type: 'Merchandise' },
  { row_id: '000000004', category: 'Toys', subdivision: 'Kids', division: 'Home', subcategory_type: 'Merchandise' },
  { row_id: '000000009', category: 'Tops', subdivision: 'Womenswear', division: 'Fashion', subcategory_type: 'Consumable' },
]

function fake(jobs: Row[], { employee = { row_id: 'E1', person: 'me', status: 'Current' } as Row, plants = PLANTS, assignments = [] as Row[] } = {}): Documents {
  const tables: Record<string, Row[]> = {
    Employee: [employee], 'Job Assignment': jobs.map((job, i) => ({ row_id: `J${i}`, employee: 'E1', starts_on: '2026-01-01', ends_on: null, ...job })),
    'Merchandise Assignment': assignments.map((row, i) => ({ row_id: `M${i}`, employee: 'E1', division: null, subdivision: null, category: null, subcategory: null,
      operating_region: null, starts_on: '2026-01-01', ends_on: null, ...row })),
    Site: SITES, Plant: plants, Section: SECTIONS, 'Section Subcategory': PLACEMENTS, Subcategory: SUBCATEGORIES,
  }
  return {
    async list(table, { filters = [], limit_start = 0, limit_page_length = 500 }) {
      const rows = tables[table].filter(row => filters.every(([column, op, value]) =>
        op === 'in' ? (value as unknown[]).includes(row[column]) : row[column] === value))
      return rows.slice(limit_start, limit_start + limit_page_length)
    },
  }
}
const reach = (...jobs: Row[]) => reachOf(fake(jobs), 'me', ON)
const stores = async (...jobs: Row[]) => (await reach(...jobs)).places.map(place => place.filters)

describe('who sees what', () => {
  // #1155 (owner, 10-Nov-2026): a site's readers reach every plant on it that sells: Store,
  // Shop-in-shop and E-commerce fulfilment, not only the last one read. A warehouse stays out; a
  // retired plant the platform leaves out. Plant.is_active waits for #1161.
  describe('a site with more than one plant', () => {
    const plants = [...PLANTS, { row_id: '9911', site: 'AAA', plant_type: 'Store' },
      { row_id: '9291', site: 'AAA', plant_type: 'Shop-in-shop' },
      { row_id: '8191', site: 'AAA', plant_type: 'E-commerce fulfilment' }]
    const reachOn = (job: Row) => reachOf(fake([job], { plants }), 'me', ON).then(answer => answer.places.map(place => place.filters))

    it('gives a Store Manager each Store, Shop-in-shop and E-commerce plant whole, and no warehouse', async () => {
      expect(await reachOn({ job: 'Store Manager', site: 'AAA' })).toEqual(['8191', '9291', '9901', '9911'].map(store => ({ store: [store] })))
    })

    // A store site whose plants are all gone (or only a warehouse) has nothing to reach.
    it('reaches nothing on a store site with no selling plant, whole or by section', async () => {
      const onlyWarehouse = PLANTS.filter(plant => plant.site !== 'AAA').concat({ row_id: '9151', site: 'AAA', plant_type: 'Warehouse' })
      const whole = await reachOf(fake([{ job: 'Store Manager', site: 'AAA' }], { plants: onlyWarehouse }), 'me', ON)
      const bySection = await reachOf(fake([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }], { plants: onlyWarehouse }), 'me', ON)
      expect([whole.places, bySection]).toEqual([[], { places: [], problems: ['nothing_placed'] }])
    })

    it("gives a section's reader that section in each of them", async () => {
      expect(await reachOn({ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' })).toEqual(['8191', '9291', '9901', '9911']
        .map(store => ({ store: [store], subcategory: ['000000001'] })))
    })
  })

  it('Staff and a Team Leader see their section\'s current subcategories', async () => {
    for (const job of ['Staff', 'Team Leader'])
      expect(await stores({ job, site: 'AAA', section: 'AAA-GF-Tops' })).toEqual([{ store: ['9901'], subcategory: ['000000001'] }])
  })

  it('Staff with no section get no place, and the reason', async () => {
    expect(await reach({ job: 'Staff', site: 'AAA', section: null })).toEqual({ places: [], problems: ['no_section'] })
  })

  it('a section with nothing placed reaches nothing, and says so', async () => {
    expect(await reach({ job: 'Team Leader', site: 'AAA', section: 'AAA-FF-Empty' })).toEqual({ places: [], problems: ['nothing_placed'] })
  })

  it('a Floor Manager sees their floor\'s sections, each its own place', async () => {
    const { places } = await reach({ job: 'Floor Manager', site: 'AAA', floor: 'AAA-GF' })
    expect(places.map(place => [place.label, place.filters.subcategory])).toEqual([
      ['9901 / Section: Sarees', ['000000003']], ['9901 / Section: Tops', ['000000001']]])
  })

  it('a Department Manager has a clear reason until departments are filled', async () => {
    expect(await reach({ job: 'Department Manager', site: 'AAA' })).toEqual({ places: [], problems: ['departments_not_filled'] })
  })

  it('a Store Manager sees the whole of their store, through its store plant only', async () => {
    expect(await stores({ job: 'Store Manager', site: 'AAA' })).toEqual([{ store: ['9901'] }])
  })

  it('a Cluster Manager sees every store in the cluster of the site on their job', async () => {
    expect(await stores({ job: 'Cluster Manager', site: 'BBB' })).toEqual([{ store: ['9901'] }, { store: ['9902'] }])
  })

  it('a Cluster Manager on a site with no cluster reaches nothing, and says so', async () => {
    expect(await reach({ job: 'Cluster Manager', site: 'DDD' })).toEqual({ places: [], problems: ['no_cluster'] })
  })

  it('a Director, Managing Director and Chief Operating Officer see every store, wherever their job row sits', async () => {
    for (const job of ['Director', 'Managing Director', 'Chief Operating Officer'])
      expect(await stores({ job, site: 'HOF' })).toEqual(['9901', '9902', '9903', '9904'].map(store => ({ store: [store] })))
  })

  it('head office staff see no report', async () => {
    expect(await reach({ job: 'Head office staff', site: 'HOF' })).toEqual({ places: [], problems: ['head_office'] })
  })

  it('a person with no employee record has no job', async () => {
    expect(await reachOf(fake([]), 'someone else', ON)).toEqual({ places: [], problems: ['no_job'] })
  })

  it('a leaver has no job, whatever rows remain', async () => {
    const left = fake([{ job: 'Store Manager', site: 'AAA' }], { employee: { row_id: 'E1', person: 'me', status: 'Left' } })
    expect(await reachOf(left, 'me', ON)).toEqual({ places: [], problems: ['no_job'] })
  })

  it('a job that has ended or not begun reaches nothing', async () => {
    expect((await reach({ job: 'Store Manager', site: 'AAA', ends_on: ON })).problems).toEqual(['no_job'])
    expect((await reach({ job: 'Store Manager', site: 'AAA', starts_on: '2026-12-01' })).problems).toEqual(['no_job'])
  })

  it('a section in another store than the job\'s reaches nothing', async () => {
    expect(await reach({ job: 'Team Leader', site: 'BBB', section: 'AAA-GF-Tops' })).toEqual({ places: [], problems: ['nothing_placed'] })
  })

  it('two jobs add up, and a whole store sits beside a section elsewhere', async () => {
    expect(await stores({ job: 'Store Manager', site: 'AAA' }, { job: 'Team Leader', site: 'BBB', section: 'BBB-GF-Tops' })).toEqual([
      { store: ['9901'] }, { store: ['9902'], subcategory: ['000000005'] }])
  })

  it('a Floor Manager with no floor gets no place, and the reason', async () => {
    expect(await reach({ job: 'Floor Manager', site: 'AAA', floor: null })).toEqual({ places: [], problems: ['no_section'] })
  })

  it('a store reached by two jobs names both, in order', async () => {
    const [place] = (await reach({ job: 'Store Manager', site: 'AAA' }, { job: 'Store Manager', site: 'AAA', acting: true })).places
    expect(place.reasons!.map(reason => reason.text)).toEqual(['Acting Store Manager job assignment', 'Store Manager job assignment'])
  })

  it('a place says which job gives it, and an acting one says so', async () => {
    const [place] = (await reach({ job: 'Store Manager', site: 'AAA', acting: true })).places
    expect(place.basis).toBe('acting_store_manager')
    expect(place.reasons).toEqual([{ text: 'Acting Store Manager job assignment', since: '2026-01-01' }])
  })
})

// Buyers, category heads and the heads above them (rama_dw #4588): a Merchandise Assignment gives
// its subcategories in every selling plant of every store in its region, a blank region every store.
describe('merchandise assignments', () => {
  const assigned = (...assignments: Row[]) => reachOf(fake([], { assignments }), 'me', ON)
  const scopes = async (...assignments: Row[]) => (await assigned(...assignments)).places.map(place => place.filters)
  const east = (subcategory: string[]) => ['9901', '9902'].map(store => ({ store: [store], subcategory }))

  it('gives a buyer their subcategories in every store of their region', async () => {
    expect(await scopes({ responsibility: 'Buyer', division: 'Fashion', subdivision: 'Womenswear', category: 'Tops', subcategory: '000000001', operating_region: 'East' },
      { responsibility: 'Buyer', division: 'Fashion', subdivision: 'Womenswear', category: 'Sarees', subcategory: '000000003', operating_region: 'East' }))
      .toEqual(east(['000000001', '000000003']))
  })

  it("gives a category head every merchandise subcategory in the category, and no consumable", async () => {
    expect(await scopes({ responsibility: 'Category head', division: 'Fashion', subdivision: 'Womenswear', category: 'Tops', operating_region: 'East' }))
      .toEqual(east(['000000001', '000000002']))
  })

  it('gives a subdivision or division head everything under it', async () => {
    expect(await scopes({ responsibility: 'Subdivision head', division: 'Fashion', subdivision: 'Womenswear', operating_region: 'East' }))
      .toEqual(east(['000000001', '000000002', '000000003']))
    expect(await scopes({ responsibility: 'Division head', division: 'Home', operating_region: 'East' })).toEqual(east(['000000004']))
  })

  it('reaches every store when the assignment names no region', async () => {
    expect((await scopes({ responsibility: 'Buyer', category: 'Toys', subcategory: '000000004' })).map(scope => scope.store[0])).toEqual(['9901', '9902', '9903', '9904'])
  })

  it('reaches through each selling plant of the store, and no warehouse', async () => {
    const plants = [...PLANTS, { row_id: '9291', site: 'AAA', plant_type: 'Shop-in-shop' }]
    const { places } = await reachOf(fake([], { plants, assignments: [{ responsibility: 'Buyer', subcategory: '000000004', operating_region: 'East' }] }), 'me', ON)
    expect(places.map(place => place.filters.store[0])).toEqual(['9291', '9901', '9902'])
  })

  it('says the subcategories are assigned, and by which responsibility', async () => {
    const [place] = (await assigned({ responsibility: 'Buyer', subcategory: '000000004', operating_region: 'East' })).places
    expect(place).toMatchObject({ basis: 'assignment', reasons: [{ text: 'Buyer merchandise assignment', since: '2026-01-01' }] })
  })

  it('an assignment that has ended or not begun reaches nothing', async () => {
    expect(await assigned({ responsibility: 'Buyer', subcategory: '000000004', ends_on: ON })).toEqual({ places: [], problems: ['no_job'] })
    expect(await assigned({ responsibility: 'Buyer', subcategory: '000000004', starts_on: '2026-12-01' })).toEqual({ places: [], problems: ['no_job'] })
  })

  it('an assignment naming nothing that holds a subcategory reaches nothing, and says so', async () => {
    expect(await assigned({ responsibility: 'Buyer', category: 'Nowhere', operating_region: 'East' })).toEqual({ places: [], problems: ['nothing_assigned'] })
  })

  it('an assignment naming no level, or a region with no store, reaches nothing, and says so', async () => {
    expect(await assigned({ responsibility: 'Buyer', operating_region: 'East' })).toEqual({ places: [], problems: ['nothing_assigned'] })
    expect(await assigned({ responsibility: 'Buyer', subcategory: '000000004', operating_region: 'North-east' })).toEqual({ places: [], problems: ['nothing_assigned'] })
  })

  it('a store of the region that sells through no plant adds nothing', async () => {
    const plants = PLANTS.filter(plant => plant.row_id !== '9902')
    const { places } = await reachOf(fake([], { plants, assignments: [{ responsibility: 'Buyer', subcategory: '000000004', operating_region: 'East' }] }), 'me', ON)
    expect(places.map(place => place.filters.store[0])).toEqual(['9901'])
  })

  it('an assignment that ends says until when', async () => {
    const [place] = (await assigned({ responsibility: 'Buyer', subcategory: '000000004', operating_region: 'East', ends_on: '2026-12-31' })).places
    expect(place.reasons).toEqual([{ text: 'Buyer merchandise assignment', since: '2026-01-01', until: '2026-12-31' }])
  })

  it('adds up with a job: head office staff who buy see their subcategories, a store manager who buys keeps the whole store', async () => {
    const both = await reachOf(fake([{ job: 'Head office staff', site: 'HOF' }, { job: 'Store Manager', site: 'CCC' }],
      { assignments: [{ responsibility: 'Buyer', subcategory: '000000004', operating_region: 'West' }] }), 'me', ON)
    expect(both.places.map(place => place.filters)).toEqual([{ store: ['9903'] }, { store: ['9903'], subcategory: ['000000004'] }, { store: ['9904'], subcategory: ['000000004'] }])
  })
})

// #1192 (owner, 11-Nov-2026): a holder of Dash All-Stores Reader reaches every store, as a
// Director's job does, on top of whatever their jobs reach.
describe('the Dash All-Stores Reader role', () => {
  const ROLE = ['All', 'Dash All-Stores Reader']
  const EVERY = ['9901', '9902', '9903', '9904']
  const whole = (store: string, basis = 'all_stores_reader') => ({ label: store, filters: { store: [store] }, basis, reasons: [{ text: 'Dash All-Stores Reader role' }] })

  it('gives a head office person every store whole, with the role as the reason, and no head-office message', async () => {
    expect(await reachOf(fake([{ job: 'Head office staff', site: 'HOF' }]), 'me', ON, ROLE)).toEqual({ places: EVERY.map(store => whole(store)), problems: [] })
  })

  it('gives someone not on the staff list every store, and no no-job message', async () => {
    expect(await reachOf(fake([]), 'someone else', ON, ROLE)).toEqual({ places: EVERY.map(store => whole(store)), problems: [] })
  })

  it('adds to a job: a Team Leader keeps their section and gains every store', async () => {
    const both = await reachOf(fake([{ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' }]), 'me', ON, ROLE)
    expect(both.places.map(place => [place.label, place.basis])).toEqual([
      ['9901', 'all_stores_reader'], ['9901 / Section: Tops', 'team_leader'], ['9902', 'all_stores_reader'], ['9903', 'all_stores_reader'], ['9904', 'all_stores_reader']])
    expect(both.problems).toEqual([])
  })

  it("names both the role and a Store Manager's job on the store they manage", async () => {
    const [mine] = (await reachOf(fake([{ job: 'Store Manager', site: 'AAA' }]), 'me', ON, ROLE)).places
    expect([mine.basis, mine.reasons]).toEqual(['all_stores_reader, store_manager',
      [{ text: 'Dash All-Stores Reader role' }, { text: 'Store Manager job assignment', since: '2026-01-01' }]])
  })

  it('gives nothing to someone holding only other roles', async () => {
    expect(await reachOf(fake([{ job: 'Head office staff', site: 'HOF' }]), 'me', ON, ['All', 'Dash Reader', 'Report Access Manager']))
      .toEqual({ places: [], problems: ['head_office'] })
  })
})

describe('the provider', () => {
  it("reaches every store for a holder of Dash All-Stores Reader, from the roles the platform hands it", async () => {
    const provide = orgChartProvider({ today: () => ON })
    const places = await provide({ person: { id: 'me', email: null, roles: ['All', 'Dash All-Stores Reader'] }, documents: fake([]) })
    expect(places.map(place => place.filters)).toEqual(['9901', '9902', '9903', '9904'].map(store => ({ store: [store] })))
  })

  it('answers the person\'s places on today\'s date', async () => {
    const provide = orgChartProvider({ today: () => ON })
    const places = await provide({ person: { id: 'me', email: null }, documents: fake([{ job: 'Store Manager', site: 'AAA' }]) })
    expect(places.map(place => place.filters)).toEqual([{ store: ['9901'] }])
  })

  it('reads only the Tables it declares', () => {
    expect(PROVIDER_TABLES).toEqual(['Employee', 'Job Assignment', 'Site', 'Plant', 'Section', 'Section Subcategory', 'Merchandise Assignment', 'Subcategory'])
  })
})
