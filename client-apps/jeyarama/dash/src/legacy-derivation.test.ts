// Today's derivation from the old Store Sections Tables, moved from featherbase's
// sales-target.ts. The cases follow featherbase's sales-target.test.ts (#3783,
// #408); the rows are made up.
import { describe, expect, it } from 'vitest'
import { legacyCoverage, type LegacyTables } from './legacy-derivation.ts'

const TODAY = '2026-10-15'
const person = (codes: string[], ambiguous = false) => ({ id: 'psn_201', codes, ambiguous })

function tables(extra: Partial<LegacyTables> = {}): LegacyTables {
  return {
    assignments: [],
    employeeSections: [],
    ownership: [],
    storeManagers: [],
    aliases: [],
    merchandise: [
      { store_code: '9901', material_group: '010101001', mch_subcategory: 'Kurti', section_name: 'Kurti' },
      { store_code: '9901', material_group: '010101002', mch_subcategory: 'Kurti Set', section_name: 'Kurti' },
      { store_code: '9901', material_group: '010202001', mch_subcategory: 'Boys Tee', section_name: 'Boys Tops' },
      { store_code: '9901', material_group: '010202002', mch_subcategory: 'Boys Shirt', section_name: 'Boys Shirts' },
      { store_code: '9902', material_group: '010303001', mch_subcategory: 'Saree', section_name: 'Sarees' },
    ],
    ...extra,
  }
}
const groupsOf = (stores: ReturnType<typeof legacyCoverage>) => stores.map(s => [s.plant_code, s.material_groups])

describe("today's derivation", () => {
  it("gives section staff the subcategory codes of their own subcategories", () => {
    const data = tables({ employeeSections: [{ store_code: '9901', employee_code: 'EMP-0101', subcategory: 'Kurti', section_name: 'Kurti' }] })
    expect(groupsOf(legacyCoverage(person(['EMP-0101']), data, TODAY))).toEqual([['9901', ['010101001']]])
  })

  it('matches subcategory names whatever their surrounding space and case', () => {
    const data = tables({ employeeSections: [{ store_code: '9901', employee_code: ' emp-0101 ', subcategory: ' kurti SET ', section_name: 'Kurti' }] })
    expect(groupsOf(legacyCoverage(person(['EMP-0101']), data, TODAY))).toEqual([['9901', ['010101002']]])
  })

  it('gives a Team Leader every subcategory of the Section they lead', () => {
    const data = tables({ ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '2026-07-01' }] })
    expect(groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY))).toEqual([['9901', ['010101001', '010101002']]])
  })

  it('reaches every merchandise Section that Section Name Alias maps a roster Section to', () => {
    const data = tables({
      ownership: [{ store_code: '9901', section_name: 'Boys Top', tl_employee_code: 'EMP-0202', effective_from: '' }],
      aliases: [
        { store_code: '9901', roster_section_name: 'Boys Top', merch_section_name: 'Boys Tops' },
        { store_code: '9901', roster_section_name: 'Boys Top', merch_section_name: 'Boys Shirts' },
      ],
    })
    expect(groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY))).toEqual([['9901', ['010202001', '010202002']]])
  })

  it("counts only each Section's current roster row", () => {
    const data = tables({ ownership: [
      { store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '2026-07-01' },
      { store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0203', effective_from: '2026-08-06' },
    ] })
    expect(groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY))).toEqual([])
  })

  it('gives nothing from a roster row dated after today', () => {
    const data = tables({ ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '2026-11-01' }] })
    expect(groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY))).toEqual([])
  })

  it('gives two Team Leaders rostered from the same day the same Section', () => {
    const rows = ['EMP-0202', 'EMP-0203'].map(code => ({ store_code: '9901', section_name: 'Kurti', tl_employee_code: code, effective_from: '2026-07-01' }))
    const data = tables({ ownership: rows })
    expect([groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY)), groupsOf(legacyCoverage(person(['EMP-0203']), data, TODAY))])
      .toEqual([[['9901', ['010101001', '010101002']]], [['9901', ['010101001', '010101002']]]])
  })

  it('drops a roster row whose date is not an ISO day, and never reads a slash date month-first', () => {
    const data = tables({ ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '06/08/2026' }] })
    expect(groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY))).toEqual([])
  })

  it('reads a roster date that arrives as a timestamp by its day', () => {
    const data = tables({ ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '2026-07-01T00:00:00.000Z' }] })
    expect(groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY))).toEqual([['9901', ['010101001', '010101002']]])
  })

  it('gives a Department Manager every Section they manage', () => {
    const data = tables({ ownership: [{ store_code: '9901', section_name: 'Boys Tops', tl_employee_code: 'EMP-0202', dm_employee_code: 'EMP-0301', effective_from: '2026-07-01' }] })
    expect(legacyCoverage(person(['EMP-0301']), data, TODAY)[0]).toMatchObject({ material_groups: ['010202001'], scope_basis: ['department_manager'] })
  })

  it('gives a Store Manager every subcategory of their store, and no other store', () => {
    const data = tables({ storeManagers: [{ store_code: '9901', employee_code: 'EMP-0401' }] })
    expect(groupsOf(legacyCoverage(person(['EMP-0401']), data, TODAY))).toEqual([['9901', ['010101001', '010101002', '010202001', '010202002']]])
  })

  it('adds the explicit Sales Target Assignment rows of the person', () => {
    const data = tables({ assignments: [{ employee: 'psn_201', plant_code: '9902', store_label: 'Hillview', material_group: '010303001' }] })
    expect(legacyCoverage(person([]), data, TODAY)).toMatchObject([{ plant_code: '9902', store_label: 'Hillview', material_groups: ['010303001'], scope_basis: ['assignment'] }])
  })

  it('gives one entry per store, sorted by store code', () => {
    const data = tables({
      assignments: [{ employee: 'psn_201', plant_code: '9902', material_group: '010303001' }],
      employeeSections: [{ store_code: '9901', employee_code: 'EMP-0101', subcategory: 'Kurti', section_name: 'Kurti' }],
    })
    expect(legacyCoverage(person(['EMP-0101']), data, TODAY).map(s => s.plant_code)).toEqual(['9901', '9902'])
  })

  it('names every reason once, sorted', () => {
    const data = tables({
      employeeSections: [{ store_code: '9901', employee_code: 'EMP-0202', subcategory: 'Kurti', section_name: 'Kurti' }],
      ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '2026-07-01' }],
    })
    expect(legacyCoverage(person(['EMP-0202']), data, TODAY)[0].scope_basis).toEqual(['section_staff', 'team_leader'])
  })

  it('records each subcategory with the reasons that gave it', () => {
    const data = tables({
      employeeSections: [{ store_code: '9901', employee_code: 'EMP-0202', subcategory: 'Kurti', section_name: 'Kurti' }],
      ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '2026-07-01' }],
    })
    expect(legacyCoverage(person(['EMP-0202']), data, TODAY)[0].basis_by_material_group)
      .toEqual({ '010101001': ['section_staff', 'team_leader'], '010101002': ['team_leader'] })
  })

  it("carries each subcategory's merchandise Section", () => {
    const data = tables({ storeManagers: [{ store_code: '9902', employee_code: 'EMP-0401' }] })
    expect(legacyCoverage(person(['EMP-0401']), data, TODAY)[0].section_by_material_group).toEqual({ '010303001': 'Sarees' })
  })

  it('leaves out a subcategory code that is not nine digits', () => {
    const data = tables({ assignments: [{ employee: 'psn_201', plant_code: '9902', material_group: '1010' }, { employee: 'psn_201', plant_code: '9902', material_group: '010303001' }] })
    expect(groupsOf(legacyCoverage(person([]), data, TODAY))).toEqual([['9902', ['010303001']]])
  })

  it('refuses a store code that is not four digits', () => {
    const data = tables({ assignments: [{ employee: 'psn_201', plant_code: 'LKS', material_group: '010303001' }] })
    expect(() => legacyCoverage(person([]), data, TODAY)).toThrow(/not four digits/)
  })

  it('gives a person with an ambiguous employee code nothing at all', () => {
    const data = tables({
      assignments: [{ employee: 'psn_201', plant_code: '9902', material_group: '010303001' }],
      storeManagers: [{ store_code: '9901', employee_code: 'EMP-0401' }],
    })
    expect(legacyCoverage(person(['EMP-0401'], true), data, TODAY)).toEqual([])
  })

  it('gives a person without an employee code nothing from the Store Sections Tables', () => {
    const data = tables({ storeManagers: [{ store_code: '9901', employee_code: 'EMP-0401' }] })
    expect(legacyCoverage(person([]), data, TODAY)).toEqual([])
  })

  describe("keeps the original SQL's exact semantics", () => {
    it('gives no coverage from a subcategory code padded with spaces (the original keeps the raw value)', () => {
      const data = tables({
        merchandise: [{ store_code: '9901', material_group: ' 010101001 ', mch_subcategory: 'Kurti', section_name: 'Kurti' }],
        employeeSections: [{ store_code: '9901', employee_code: 'EMP-0101', subcategory: 'Kurti', section_name: 'Kurti' }],
      })
      expect(groupsOf(legacyCoverage(person(['EMP-0101']), data, TODAY))).toEqual([['9901', []]])
    })

    it('never joins a null subcategory name to another null', () => {
      const data = tables({
        merchandise: [{ store_code: '9901', material_group: '010101001', mch_subcategory: null, section_name: 'Kurti' }],
        employeeSections: [{ store_code: '9901', employee_code: 'EMP-0101', subcategory: null, section_name: 'Kurti' }],
      })
      expect(legacyCoverage(person(['EMP-0101']), data, TODAY)).toEqual([])
    })

    it('never joins a null store code to another null', () => {
      const data = tables({
        merchandise: [{ store_code: null, material_group: '010101001', mch_subcategory: 'Kurti', section_name: 'Kurti' }],
        storeManagers: [{ store_code: null, employee_code: 'EMP-0401' }],
      })
      expect(legacyCoverage(person(['EMP-0401']), data, TODAY)).toEqual([])
    })

    it('never matches a roster row with no Section name', () => {
      const data = tables({
        merchandise: [{ store_code: '9901', material_group: '010101001', mch_subcategory: 'Kurti', section_name: null }],
        ownership: [{ store_code: '9901', section_name: null, tl_employee_code: 'EMP-0202', effective_from: '' }],
      })
      expect(legacyCoverage(person(['EMP-0202']), data, TODAY)).toEqual([])
    })

    it('trims only spaces from a code, as SQL trim does, so a tab-padded code does not match', () => {
      const data = tables({ storeManagers: [{ store_code: '9901', employee_code: '\tEMP-0401' }] })
      expect(legacyCoverage(person(['EMP-0401']), data, TODAY)).toEqual([])
    })

    it('compares Section names after trimming only spaces, so a tab-padded name does not match', () => {
      const data = tables({ ownership: [{ store_code: '9901', section_name: 'Kurti\t', tl_employee_code: 'EMP-0202', effective_from: '' }] })
      expect(legacyCoverage(person(['EMP-0202']), data, TODAY)).toEqual([])
    })

    it('reads a roster date with a leading space as neither dated nor undated, so the row is out', () => {
      const data = tables({ ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: ' 2026-07-01' }] })
      expect(legacyCoverage(person(['EMP-0202']), data, TODAY)).toEqual([])
    })

    it('reads a roster date of spaces only as undated, in force from the start', () => {
      const data = tables({ ownership: [{ store_code: '9901', section_name: 'Kurti', tl_employee_code: 'EMP-0202', effective_from: '   ' }] })
      expect(groupsOf(legacyCoverage(person(['EMP-0202']), data, TODAY))).toEqual([['9901', ['010101001', '010101002']]])
    })

    it('fails, as the original query does, on an ISO-shaped roster date that is not a real day', () => {
      const data = tables({ ownership: [{ store_code: '9902', section_name: 'Other', tl_employee_code: 'EMP-0999', effective_from: '2026-02-30' }] })
      expect(() => legacyCoverage(person(['EMP-0202']), data, TODAY)).toThrow(/not a real day/)
    })

    it('counts a merchandise Section name of spaces as a name, as `<> \'\'` does', () => {
      const data = tables({
        merchandise: [{ store_code: '9902', material_group: '010303001', mch_subcategory: 'Saree', section_name: '  ' }],
        storeManagers: [{ store_code: '9902', employee_code: 'EMP-0401' }],
      })
      expect(legacyCoverage(person(['EMP-0401']), data, TODAY)[0].section_by_material_group).toEqual({ '010303001': '  ' })
    })
  })
})

