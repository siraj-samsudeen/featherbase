// The scope provider over a stand-in for the platform's provider read context
// (documents.get/list over declared Tables): the system boundary, played by
// rows in memory. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import manifest from '../featherbase.json' with { type: 'json' }
import { PROVIDER_TABLES, orgChartProvider } from './provider.ts'
import { chart, job } from './test-chart.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
const TODAY = '2026-10-15'

/** The platform's documents.list, as far as the provider uses it: '=' and 'in' filters, only the
 *  fields asked for (row_id alone when none are), pages of at most 500 in a stable order. */
function documents(tables: Record<string, Row[]>, reads: string[] = []) {
  return {
    async get(): Promise<Row> { throw new Error('not used') },
    async list(table: string, args: { filters?: Filter[]; fields?: string[]; order_by?: string; limit_start?: number; limit_page_length?: number } = {}) {
      reads.push(table)
      if (!PROVIDER_TABLES.includes(table)) throw new Error(`undeclared Table ${table}`)
      const rows = (tables[table] ?? []).filter(row => (args.filters ?? []).every(([column, operator, value]) =>
        operator === '=' ? row[column] === value : operator === 'in' ? (value as unknown[]).includes(row[column]) : false))
      if (args.order_by !== 'row_id asc') throw new Error('pages need a stable order')
      const fields = args.fields?.length ? args.fields : ['row_id']
      const start = args.limit_start ?? 0
      return rows.slice(start, start + Math.min(args.limit_page_length ?? 20, 500))
        .map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])))
    },
  }
}

function instance(jobs: Row[], extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  const org = chart(jobs)
  return {
    'feather_dash.store_rollout': [{ row_id: '9901', store: '9901', live_since: '2026-10-01' }],
    'feather_dash.store_floor': org.floors,
    'feather_dash.department': org.departments,
    'feather_dash.section': org.sections,
    'feather_dash.section_subcategory': org.placements,
    'feather_dash.job_assignment': org.jobs,
    'Section Merchandise Map': [
      { store_code: '9902', material_group: '010404001', mch_subcategory: 'Belts', section_name: 'Accessories' },
      { store_code: '9902', material_group: '010404002', mch_subcategory: 'Wallets', section_name: 'Accessories' },
      { store_code: '9901', material_group: '010101001', mch_subcategory: 'Saree', section_name: 'Sarees' },
    ],
    'Store Manager': [{ store_code: '9902', employee_code: 'EMP-0120' }, { store_code: '9901', employee_code: 'EMP-0120' }],
    ...extra,
  }
}

const provide = (tables: Record<string, Row[]>, person = 'psn_103', codes: string[] = [], reads: string[] = []) =>
  orgChartProvider({ today: () => TODAY, employeeCodes: async () => ({ codes, ambiguous: false }) })(
    { person: { id: person, email: null }, documents: documents(tables, reads) })

describe('the org_chart scope provider', () => {
  it("gives a live store's Team Leader their section, confirmed", async () => {
    expect(await provide(instance([job('psn_103', 'Team Leader', { section: 's-sarees' })]))).toEqual([{
      label: '9901 / Section: Sarees',
      filters: { store: ['9901'], subcategory: ['010101001', '010303001'] },
      basis: 'team_leader',
      confirmation: { store: { '9901': 'confirmed' }, subcategory: { '010101001': 'confirmed', '010303001': 'confirmed' } },
    }])
  })

  it("gives a live store's Store Manager the store itself, with no narrower filter", async () => {
    const [store] = await provide(instance([job('psn_101', 'Store Manager')]), 'psn_101')
    expect(store).toEqual({ label: '9901', filters: { store: ['9901'] }, basis: 'store_manager', confirmation: { store: { '9901': 'confirmed' } } })
  })

  it("gives a live store's Store Manager each section of the store as a place too, so a report can group by section", async () => {
    const places = await provide(instance([job('psn_101', 'Store Manager')]), 'psn_101')
    expect(places.map(p => p.label)).toEqual(['9901', '9901 / Section: Kids Wear', '9901 / Section: Lehenga',
      '9901 / Section: Sarees', '9901 / Section: Silk Sarees', '9901 / Section: Women Tops'])
  })

  it('gives a Floor Manager one place per section on their floor', async () => {
    const places = await provide(instance([job('psn_102', 'Floor Manager', { floor: 'f-ground' })]), 'psn_102')
    expect(places.map(p => [p.label, p.filters, p.basis])).toEqual([
      ['9901 / Section: Sarees', { store: ['9901'], subcategory: ['010101001', '010303001'] }, 'floor_manager'],
      ['9901 / Section: Women Tops', { store: ['9901'], subcategory: ['010303002'] }, 'floor_manager'],
    ])
  })

  it('gives a Department Manager one place per section in their department', async () => {
    const places = await provide(instance([job('psn_109', 'Department Manager', { department: 'd-kids' })]), 'psn_109')
    expect(places.map(p => p.label)).toEqual(['9901 / Section: Kids Wear', '9901 / Section: Women Tops'])
  })

  it("never names a floor or a section row in a place's filters, which a dataset of store and subcategory could not apply", async () => {
    const places = await provide(instance([job('psn_102', 'Floor Manager', { floor: 'f-ground' }), job('psn_102', 'Team Leader', { section: 's-silk' })]), 'psn_102')
    expect([...new Set(places.flatMap(p => Object.keys(p.filters)))].sort()).toEqual(['store', 'subcategory'])
  })

  it('merges the places of two rows on one section', async () => {
    const rows = [job('psn_103', 'Team Leader', { section: 's-silk' }), { ...job('psn_103', 'Staff', { section: 's-silk' }), acting: true }]
    expect((await provide(instance(rows))).map(p => [p.label, p.basis])).toEqual([['9901 / Section: Silk Sarees', 'acting_section_staff, team_leader']])
  })

  it('lists places by label, whatever order the rows come in', async () => {
    const rows = [job('psn_107', 'Department Manager', { department: 'd-ethnic' }), job('psn_107', 'Department Manager', { department: 'd-bridal' })]
    expect((await provide(instance(rows), 'psn_107')).map(p => p.label)).toEqual(['9901 / Section: Lehenga', '9901 / Section: Sarees', '9901 / Section: Silk Sarees'])
  })

  it('leaves out a place whose sections own no subcategory on the date', async () => {
    const tables = instance([job('psn_103', 'Team Leader', { section: 's-silk' })])
    tables['feather_dash.section_subcategory'] = []
    expect(await provide(tables)).toEqual([])
  })

  it('uses the old rules for a store not yet live, marked assumed, one place per section of the merchandise map', async () => {
    expect(await provide(instance([]), 'psn_120', ['EMP-0120'])).toEqual([{
      label: '9902 / Section: Accessories', filters: { store: ['9902'], subcategory: ['010404001', '010404002'] }, basis: 'store_manager',
      confirmation: { store: { '9902': 'assumed' }, subcategory: { '010404001': 'assumed', '010404002': 'assumed' } },
    }])
  })

  it('ignores the old rules for a live store', async () => {
    const places = await provide(instance([]), 'psn_120', ['EMP-0120'])
    expect(places.map(p => p.filters.store)).toEqual([['9902']])
  })

  it('ignores the new chart for a store not yet live', async () => {
    expect(await provide(instance([job('psn_121', 'Team Leader', { section: 's-hill-acc' }, '9902')]), 'psn_121')).toEqual([])
  })

  it('keeps a store on the old rules until its live date arrives', async () => {
    const tables = instance([job('psn_103', 'Team Leader', { section: 's-sarees' })])
    tables['feather_dash.store_rollout'] = [{ row_id: '9901', store: '9901', live_since: '2026-10-16' }]
    expect(await provide(tables)).toEqual([])
  })

  it('answers an empty scope for a person who covers nothing', async () => {
    expect(await provide(instance([]), 'psn_999')).toEqual([])
  })

  it('adds the explicit Sales Target Assignment rows of a store not yet live', async () => {
    const tables = instance([], { 'Sales Target Assignment': [{ employee: 'psn_130', plant_code: '9902', material_group: '010404002' }] })
    expect((await provide(tables, 'psn_130')).map(p => [p.label, p.filters.subcategory, p.basis])).toEqual([['9902 / Section: Accessories', ['010404002'], 'assignment']])
  })

  it("puts old-rule subcategories outside the merchandise map in a place named by the store", async () => {
    const tables = instance([], { 'Sales Target Assignment': [{ employee: 'psn_130', plant_code: '9902', material_group: '010909001' }] })
    expect((await provide(tables, 'psn_130')).map(p => [p.label, p.filters])).toEqual([['9902', { store: ['9902'], subcategory: ['010909001'] }]])
  })

  // #4486: the page says which job gives which section, so an old-rule place carries the bases of
  // its own subcategories, not every basis the person has in the store.
  it("gives each old-rule place the bases of its own subcategories, not the store's", async () => {
    const tables = instance([], {
      'Section Merchandise Map': [
        { store_code: '9902', material_group: '010404001', mch_subcategory: 'Belts', section_name: 'Accessories' },
        { store_code: '9902', material_group: '010505001', mch_subcategory: 'Handbags', section_name: 'Bags' },
      ],
      'Section Ownership': [{ store_code: '9902', section_name: 'Accessories', tl_employee_code: 'EMP-0140', dm_employee_code: null, effective_from: null }],
      'Employee Section Map': [{ store_code: '9902', employee_code: 'EMP-0140', subcategory: 'Handbags' }],
    })
    expect((await provide(tables, 'psn_140', ['EMP-0140'])).map(p => [p.label, p.filters.subcategory, p.basis])).toEqual([
      ['9902 / Section: Accessories', ['010404001'], 'team_leader'],
      ['9902 / Section: Bags', ['010505001'], 'section_staff'],
    ])
  })

  // The default provider reads the person's employee codes from the identifiers the platform hands it
  // (#660), each saying whether another person holds the same code today (#662).
  type Held = { value: string; shared: boolean }
  const asPlatform = (tables: Record<string, Row[]>, id: string, identifiers?: Record<string, Held[]>) =>
    orgChartProvider({ today: () => TODAY })({ person: { id, email: null, ...(identifiers ? { identifiers } : {}) }, documents: documents(tables) })
  const explicitRow = (person: string) => ({ 'Sales Target Assignment': [{ employee: person, plant_code: '9902', material_group: '010404002' }] })
  const codes = (...held: Held[]) => ({ 'stylehr-employee-code': held })

  it('gives a person who holds no employee code today their explicit assignment rows from the old rules', async () => {
    const places = await asPlatform(instance([], explicitRow('psn_130')), 'psn_130', codes())
    expect(places.map(p => [p.label, p.filters.subcategory, p.basis])).toEqual([['9902 / Section: Accessories', ['010404002'], 'assignment']])
  })

  it('gives a person whose codes are all unshared their old-rule coverage from those codes, plus their explicit rows', async () => {
    const places = await asPlatform(instance([], explicitRow('psn_120')), 'psn_120', codes({ value: 'EMP-0120', shared: false }))
    expect(places.map(p => [p.label, p.filters.subcategory, p.basis])).toEqual([['9902 / Section: Accessories', ['010404001', '010404002'], 'assignment, store_manager']])
  })

  it('gives a person with one shared code among several nothing from the old rules, explicit rows included', async () => {
    const places = await asPlatform(instance([], explicitRow('psn_120')), 'psn_120',
      codes({ value: 'EMP-0120', shared: false }, { value: 'EMP-0999', shared: true }))
    expect(places).toEqual([])
  })

  it('gives no old-rule coverage when the platform hands over no employee codes at all', async () => {
    expect(await asPlatform(instance([], explicitRow('psn_130')), 'psn_130')).toEqual([])
  })

  it("keeps the new chart for a live store whatever the person's identifiers", async () => {
    const places = await asPlatform(instance([job('psn_103', 'Team Leader', { section: 's-sarees' })]), 'psn_103', codes({ value: 'EMP-0103', shared: true }))
    expect(places.map(p => p.label)).toEqual(['9901 / Section: Sarees'])
  })

  it('declares the employee-code identifier system it reads', () => {
    expect(manifest.scopeProvider.identifiers).toEqual(['stylehr-employee-code'])
  })

  it('gives a person whose employee code is shared nothing from the old rules, explicit rows included', async () => {
    const tables = instance([], { 'Sales Target Assignment': [{ employee: 'psn_130', plant_code: '9902', material_group: '010404002' }] })
    const places = await orgChartProvider({ today: () => TODAY, employeeCodes: async () => ({ codes: ['EMP-0130'], ambiguous: true }) })(
      { person: { id: 'psn_130', email: null }, documents: documents(tables) })
    expect(places).toEqual([])
  })

  it('gives nothing from a section whose store code is padded, as the comparison does', async () => {
    const tables = instance([job('psn_103', 'Team Leader', { section: 's-sarees' })])
    tables['feather_dash.section'] = tables['feather_dash.section'].map(s => s.row_id === 's-sarees' ? { ...s, store: ' 9901 ' } : s)
    expect(await provide(tables)).toEqual([])
  })

  it('reads every page of a long Table', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ employee: 'psn_130', plant_code: '9902', material_group: String(10404100 + i).padStart(9, '0') }))
    const [place] = await provide(instance([], { 'Sales Target Assignment': many }), 'psn_130')
    expect(place.filters.subcategory).toHaveLength(1200)
  })

  it('reads only the Tables the manifest declares for it', () => {
    expect(PROVIDER_TABLES).toEqual(manifest.scopeProvider.tables)
  })

  it('is the provider the manifest names', () => {
    expect(manifest.scopeProvider.name).toBe('org_chart')
  })
})
