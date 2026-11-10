// Who sees what (#967's table), from the core Tables. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { PROVIDER_TABLES, orgChartProvider, reachOf, type Documents } from './provider'

type Row = Record<string, unknown>
const ON = '2026-11-07'
const SITES: Row[] = [
  { row_id: 'AAA', name: 'Alpha', is_store: true, cluster: 'North' },
  { row_id: 'BBB', name: 'Beta', is_store: true, cluster: 'North' },
  { row_id: 'CCC', name: 'Gamma', is_store: true, cluster: 'South' },
  { row_id: 'DDD', name: 'Delta', is_store: true, cluster: null },
  { row_id: 'HOF', name: 'Head office', is_store: false, cluster: null },
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

function fake(jobs: Row[], { employee = { row_id: 'E1', person: 'me', status: 'Current' } as Row, plants = PLANTS } = {}): Documents {
  const tables: Record<string, Row[]> = {
    Employee: [employee], 'Job Assignment': jobs.map((job, i) => ({ row_id: `J${i}`, employee: 'E1', starts_on: '2026-01-01', ends_on: null, ...job })),
    Site: SITES, Plant: plants, Section: SECTIONS, 'Section Subcategory': PLACEMENTS,
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
  // #1155: a site's readers reach every one of its Store plants, not the last one read, and (owner,
  // 10-Nov-2026) its Shop-in-shop plants too. A warehouse or an e-commerce fulfilment plant stays out.
  describe('a site with more than one plant', () => {
    const plants = [...PLANTS, { row_id: '9911', site: 'AAA', plant_type: 'Store' }, { row_id: '9291', site: 'AAA', plant_type: 'Shop-in-shop' },
      { row_id: '8191', site: 'AAA', plant_type: 'E-commerce fulfilment' }]
    const reachOn = (job: Row) => reachOf(fake([job], { plants }), 'me', ON).then(answer => answer.places.map(place => place.filters))

    it('gives a Store Manager each Store and Shop-in-shop plant whole, and no warehouse or e-commerce plant', async () => {
      expect(await reachOn({ job: 'Store Manager', site: 'AAA' })).toEqual([{ store: ['9291'] }, { store: ['9901'] }, { store: ['9911'] }])
    })

    it("gives a section's reader that section in each of them", async () => {
      expect(await reachOn({ job: 'Team Leader', site: 'AAA', section: 'AAA-GF-Tops' })).toEqual(['9291', '9901', '9911']
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

describe('the provider', () => {
  it('answers the person\'s places on today\'s date', async () => {
    const provide = orgChartProvider({ today: () => ON })
    const places = await provide({ person: { id: 'me', email: null }, documents: fake([{ job: 'Store Manager', site: 'AAA' }]) })
    expect(places.map(place => place.filters)).toEqual([{ store: ['9901'] }])
  })

  it('reads only the Tables it declares', () => {
    expect(PROVIDER_TABLES).toEqual(['Employee', 'Job Assignment', 'Site', 'Plant', 'Section', 'Section Subcategory'])
  })
})
