import { describe, expect, it } from 'vitest'
import { compareStore, renderComparison, type Snapshot } from './compare.ts'
import { LAKESIDE, chart, job } from './test-chart.ts'
import type { Row } from './coverage.ts'

const ON = '2026-10-15'

/** Lakeside under both rules. The old sheets use roster names for the same sections. */
function snapshot(jobs: Row[], edit: (s: Snapshot) => void = () => {}): Snapshot {
  const s: Snapshot = {
    rollout: [],
    chart: chart(jobs),
    sectionAliases: [],
    legacy: {
      assignments: [],
      employeeSections: [],
      ownership: [],
      storeManagers: [],
      aliases: [],
      merchandise: [
        { store_code: LAKESIDE, material_group: '010101001', mch_subcategory: 'Saree', section_name: 'Sarees' },
        { store_code: LAKESIDE, material_group: '010303001', mch_subcategory: 'Scarf', section_name: 'Sarees' },
        { store_code: LAKESIDE, material_group: '010101002', mch_subcategory: 'Silk Saree', section_name: 'Silk Sarees' },
        { store_code: LAKESIDE, material_group: '010202001', mch_subcategory: 'Kids Tee', section_name: 'Kids Wear' },
      ],
    },
    codeHolders: { 'EMP-0103': ['psn_103'], 'EMP-0104': ['psn_104'], 'EMP-0101': ['psn_101'] },
    people: { psn_101: 'P-101', psn_103: 'P-103', psn_104: 'P-104', psn_105: 'P-105' },
  }
  edit(s)
  return s
}
const personIn = (c: ReturnType<typeof compareStore>, person: string) => c.people.find(p => p.person === person)!

describe('the coverage comparison', () => {
  it('lists a person the old and new rules agree on, with no differences', () => {
    const data = snapshot([job('psn_103', 'Team Leader', { section: 's-sarees' })], s => {
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Sarees', tl_employee_code: 'EMP-0103', effective_from: '2026-07-01' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_103')).toMatchObject({
      name: 'P-103', old: { subcategories: ['010101001', '010303001'] }, new: { subcategories: ['010101001', '010303001'] }, added: [], removed: [],
    })
  })

  it('gives each subcategory the new rules add the job that adds it and why the old rules did not', () => {
    const data = snapshot([job('psn_104', 'Team Leader', { section: 's-silk' })], s => {
      s.legacy.employeeSections = [{ store_code: LAKESIDE, employee_code: 'EMP-0104', subcategory: 'Kids Tee', section_name: 'Kids Wear' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_104').added).toEqual([{
      subcategory: '010101002', reason: 'new: Team Leader of Silk Sarees; old: no old rule gives it (old basis here: section_staff)',
    }])
  })

  it('gives each subcategory the new rules remove its old basis and why the new chart does not reach it', () => {
    const data = snapshot([job('psn_104', 'Team Leader', { section: 's-silk' })], s => {
      s.legacy.employeeSections = [{ store_code: LAKESIDE, employee_code: 'EMP-0104', subcategory: 'Kids Tee', section_name: 'Kids Wear' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_104').removed).toEqual([{
      subcategory: '010202001', reason: 'old: section_staff; new: owned by Kids Wear (floor First, department dm-P-109), which their Team Leader of Silk Sarees does not reach',
    }])
  })

  it('says when a person has no job assignment at the store', () => {
    const data = snapshot([], s => {
      s.legacy.storeManagers = [{ store_code: LAKESIDE, employee_code: 'EMP-0101' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_101').removed[0].reason).toBe('old: store_manager; new: no job assignment at 9901 on 2026-10-15')
  })

  it('shows a Store Manager the whole store, not a list of subcategories', () => {
    expect(personIn(compareStore(LAKESIDE, snapshot([job('psn_101', 'Store Manager')]), ON), 'psn_101').new)
      .toEqual({ wholeStore: true, jobs: ['Store Manager of 9901'], subcategories: [] })
  })

  it('never counts an old subcategory as removed when the new scope is the whole store, placed or not', () => {
    const data = snapshot([job('psn_101', 'Store Manager')], s => {
      s.chart.placements = []
      s.legacy.assignments = [{ employee: 'psn_101', plant_code: LAKESIDE, material_group: '010909001' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_101')).toMatchObject({ new: { wholeStore: true }, removed: [], added: [] })
  })

  it('reports finite old access becoming the whole store as a widening, with its reason', () => {
    const data = snapshot([job('psn_103', 'Store Manager')], s => {
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Sarees', tl_employee_code: 'EMP-0103', effective_from: '2026-07-01' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_103').widened)
      .toBe('new: Store Manager of 9901 covers the whole store, every subcategory placed or not; old: 2 subcategories (team_leader)')
  })

  it('reports no widening and no difference when the old and new finite sets are equal', () => {
    const data = snapshot([job('psn_103', 'Team Leader', { section: 's-sarees' })], s => {
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Sarees', tl_employee_code: 'EMP-0103', effective_from: '2026-07-01' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_103')).toMatchObject({ widened: null, added: [], removed: [] })
  })

  it('says when the old rules give nothing because an employee code is held by someone else too', () => {
    const data = snapshot([job('psn_103', 'Team Leader', { section: 's-silk' })], s => {
      s.codeHolders['EMP-0103'] = ['psn_103', 'psn_199']
      s.legacy.employeeSections = [{ store_code: LAKESIDE, employee_code: 'EMP-0103', subcategory: 'Saree', section_name: 'Sarees' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_103').added[0].reason)
      .toBe('new: Team Leader of Silk Sarees; old: an employee code of theirs is current on someone else too, so the old rules give them nothing')
  })

  it('says when the old rules give nothing because no employee code is matched to the person', () => {
    const data = snapshot([job('psn_105', 'Staff', { section: 's-silk' })])
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_105').added[0].reason)
      .toBe('new: Staff of Silk Sarees; old: no employee code of theirs appears in the old Tables')
  })

  it('lists an employee code in the old Tables that matches no one as needing matching', () => {
    const data = snapshot([], s => {
      s.legacy.employeeSections = [{ store_code: LAKESIDE, employee_code: 'EMP-0999', subcategory: 'Saree', section_name: 'Sarees' }]
    })
    expect(compareStore(LAKESIDE, data, ON).needsMatching).toEqual([
      { kind: 'employee_code', value: 'EMP-0999', message: 'Employee code EMP-0999 (Employee Section Map) matches no current person' },
    ])
  })

  it('lists an old roster section name that matches no section or section alias as needing matching', () => {
    const data = snapshot([], s => {
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Saree Section', tl_employee_code: 'EMP-0103', effective_from: '' }]
    })
    expect(compareStore(LAKESIDE, data, ON).needsMatching).toEqual([
      { kind: 'section_name', value: 'Saree Section', message: 'Old section name "Saree Section" (Section Ownership) matches no section or section alias' },
    ])
  })

  it('takes a section alias as a match for an old roster section name', () => {
    const data = snapshot([], s => {
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Saree Section', tl_employee_code: 'EMP-0103', effective_from: '' }]
      s.sectionAliases = [{ store: LAKESIDE, source: 'store-sections', alias: 'saree section', section: 's-sarees' }]
    })
    expect(compareStore(LAKESIDE, data, ON).needsMatching).toEqual([])
  })

  it('lists people by name, whatever their ids', () => {
    const data = snapshot([job('psn_901', 'Staff', { section: 's-silk' }), job('psn_902', 'Staff', { section: 's-silk' })], s => {
      s.people = { psn_901: 'Zara', psn_902: 'Anil' }
    })
    expect(compareStore(LAKESIDE, data, ON).people.map(p => p.name)).toEqual(['Anil', 'Zara'])
  })

  it('reports an addition where a padded subcategory code gave the original nothing', () => {
    const data = snapshot([job('psn_103', 'Team Leader', { section: 's-silk' })], s => {
      s.legacy.merchandise = [{ store_code: LAKESIDE, material_group: ' 010101002 ', mch_subcategory: 'Silk Saree', section_name: 'Silk Sarees' }]
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Silk Sarees', tl_employee_code: 'EMP-0103', effective_from: '' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_103')).toMatchObject({ old: { subcategories: [] }, added: [{ subcategory: '010101002' }] })
  })

  it('reports an addition where null join keys gave the original nothing', () => {
    const data = snapshot([job('psn_103', 'Team Leader', { section: 's-silk' })], s => {
      s.legacy.merchandise = [{ store_code: LAKESIDE, material_group: '010101002', mch_subcategory: null, section_name: 'Silk Sarees' }]
      s.legacy.employeeSections = [{ store_code: LAKESIDE, employee_code: 'EMP-0103', subcategory: null, section_name: 'Silk Sarees' }]
    })
    expect(personIn(compareStore(LAKESIDE, data, ON), 'psn_103')).toMatchObject({ old: { subcategories: [] }, added: [{ subcategory: '010101002' }] })
  })

  it('does not take an alias pointing at another store\'s section as a match, and lists it as a conflict', () => {
    const data = snapshot([], s => {
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Saree Section', tl_employee_code: 'EMP-0103', effective_from: '' }]
      s.sectionAliases = [{ row_id: 'al1', store: LAKESIDE, source: 'store-sections', alias: 'Saree Section', section: 's-hill-acc' }]
    })
    const c = compareStore(LAKESIDE, data, ON)
    expect([c.needsMatching.map(n => n.value), c.conflicts.filter(x => x.kind === 'alias_target_invalid').map(x => x.message)])
      .toEqual([['Saree Section'], ['Section alias "Saree Section" (store-sections) points at Accessories of store 9902, not a section of 9901']])
  })

  it('does not take an alias pointing at a section that does not exist as a match, and lists it as a conflict', () => {
    const data = snapshot([], s => {
      s.legacy.ownership = [{ store_code: LAKESIDE, section_name: 'Saree Section', tl_employee_code: 'EMP-0103', effective_from: '' }]
      s.sectionAliases = [{ row_id: 'al1', store: LAKESIDE, source: 'store-sections', alias: 'Saree Section', section: 's-gone' }]
    })
    const c = compareStore(LAKESIDE, data, ON)
    expect([c.needsMatching.map(n => n.value), c.conflicts.filter(x => x.kind === 'alias_target_invalid').map(x => x.message)])
      .toEqual([['Saree Section'], ['Section alias "Saree Section" (store-sections) points at a section that does not exist (s-gone)']])
  })

  it('gives nothing from a section whose store code is padded, as the provider does, and lists the row', () => {
    const data = snapshot([job('psn_103', 'Team Leader', { section: 's-sarees' })], s => {
      s.chart.sections = s.chart.sections.map(x => x.row_id === 's-sarees' ? { ...x, store: ' 9901 ' } : x)
    })
    const c = compareStore(LAKESIDE, data, ON)
    expect([personIn(c, 'psn_103').new.subcategories, c.conflicts.filter(x => x.kind === 'store_code_not_canonical').map(x => x.message)])
      .toEqual([[], ['Section Sarees has store code " 9901 ", not "9901": it covers nothing until corrected']])
  })

  it("carries the store's conflict list", () => {
    const data = snapshot([job('psn_101', 'Store Manager'), job('psn_102', 'Store Manager')])
    expect(compareStore(LAKESIDE, data, ON).conflicts.map(c => c.kind)).toContain('several_store_managers')
  })

  it('says whether the store is live', () => {
    const data = snapshot([], s => { s.rollout = [{ store: LAKESIDE, live_since: '2026-10-01' }] })
    expect(compareStore(LAKESIDE, data, ON).live).toBe(true)
  })

  it('renders a store as text a person can read', () => {
    const data = snapshot([job('psn_104', 'Team Leader', { section: 's-silk' })], s => {
      s.legacy.employeeSections = [{ store_code: LAKESIDE, employee_code: 'EMP-0999', subcategory: 'Saree', section_name: 'Sarees' }]
    })
    expect(renderComparison(compareStore(LAKESIDE, data, ON))).toContain([
      'P-104 (psn_104)',
      '  old: nothing',
      '  new: 010101002 (Team Leader of Silk Sarees)',
      '  + 010101002: new: Team Leader of Silk Sarees; old: no employee code of theirs appears in the old Tables',
    ].join('\n'))
  })
})
