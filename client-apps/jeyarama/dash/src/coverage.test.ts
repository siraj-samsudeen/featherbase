import { describe, expect, it } from 'vitest'
import { coverageOf } from './coverage.ts'
import { HILLVIEW, LAKESIDE, chart, job } from './test-chart.ts'

const ON = '2026-10-15'
const sectionsOf = (units: ReturnType<typeof coverageOf>) => units.flatMap(u => u.sections).sort()
const subcategoriesOf = (units: ReturnType<typeof coverageOf>) => [...new Set(units.flatMap(u => u.subcategories))].sort()

describe('coverage on the new org chart', () => {
  it('gives a Store Manager the whole store', () => {
    const [unit] = coverageOf('psn_101', chart([job('psn_101', 'Store Manager')]), ON)
    expect(unit).toMatchObject({ store: LAKESIDE, kind: 'store', wholeStore: true })
  })

  it("gives a Store Manager every section of the store, including those no reporting line reaches", () => {
    expect(sectionsOf(coverageOf('psn_101', chart([job('psn_101', 'Store Manager')]), ON)))
      .toEqual(['s-kids', 's-lehenga', 's-sarees', 's-silk', 's-tops'])
  })

  it('gives a Floor Manager the sections on their floor only', () => {
    expect(sectionsOf(coverageOf('psn_102', chart([job('psn_102', 'Floor Manager', { floor: 'f-ground' })]), ON)))
      .toEqual(['s-sarees', 's-tops'])
  })

  it('gives a Department Manager the sections in their department, across floors', () => {
    expect(sectionsOf(coverageOf('psn_107', chart([job('psn_107', 'Department Manager', { department: 'd-ethnic' })]), ON)))
      .toEqual(['s-sarees', 's-silk'])
  })

  it('gives a Department Manager with two departments the sections of both', () => {
    const rows = [job('psn_107', 'Department Manager', { department: 'd-ethnic' }), job('psn_107', 'Department Manager', { department: 'd-bridal' })]
    expect(sectionsOf(coverageOf('psn_107', chart(rows), ON))).toEqual(['s-lehenga', 's-sarees', 's-silk'])
  })

  it('gives a Team Leader their section', () => {
    expect(sectionsOf(coverageOf('psn_103', chart([job('psn_103', 'Team Leader', { section: 's-silk' })]), ON))).toEqual(['s-silk'])
  })

  it('gives a Staff member their section', () => {
    expect(sectionsOf(coverageOf('psn_105', chart([job('psn_105', 'Staff', { section: 's-silk' })]), ON))).toEqual(['s-silk'])
  })

  it('gives each of two Team Leaders on one section the whole section', () => {
    const data = chart([job('psn_110', 'Team Leader', { section: 's-kids' }), job('psn_111', 'Team Leader', { section: 's-kids' })])
    expect([subcategoriesOf(coverageOf('psn_110', data, ON)), subcategoriesOf(coverageOf('psn_111', data, ON))])
      .toEqual([['010202001'], ['010202001']])
  })

  it('gives a Cluster Manager each of their stores, in full', () => {
    const rows = [job('psn_106', 'Cluster Manager'), job('psn_106', 'Cluster Manager', {}, HILLVIEW)]
    expect(coverageOf('psn_106', chart(rows), ON).map(u => [u.store, u.wholeStore])).toEqual([[LAKESIDE, true], [HILLVIEW, true]])
  })

  it('brings the subcategories a section owns on the date', () => {
    expect(subcategoriesOf(coverageOf('psn_103', chart([job('psn_103', 'Team Leader', { section: 's-sarees' })]), ON)))
      .toEqual(['010101001', '010303001'])
  })

  it("leaves out a subcategory the section owned only before the date", () => {
    expect(subcategoriesOf(coverageOf('psn_104', chart([job('psn_104', 'Team Leader', { section: 's-tops' })]), ON)))
      .toEqual(['010303002'])
  })

  it('works out a past date from the rows current then', () => {
    expect(subcategoriesOf(coverageOf('psn_104', chart([job('psn_104', 'Team Leader', { section: 's-tops' })]), '2026-08-01')))
      .toEqual(['010303001', '010303002'])
  })

  it('counts an acting row', () => {
    const rows = [job('psn_102', 'Floor Manager', { floor: 'f-ground' }),
      { ...job('psn_102', 'Store Manager'), acting: true, starts_on: '2026-10-03', ends_on: '2026-10-17' }]
    expect(coverageOf('psn_102', chart(rows), ON).some(u => u.wholeStore && u.acting)).toBe(true)
  })

  it('gives nothing from a row that ended before the date', () => {
    const rows = [{ ...job('psn_103', 'Team Leader', { section: 's-silk' }), ends_on: '2026-10-15' }]
    expect(coverageOf('psn_103', chart(rows), ON)).toEqual([])
  })

  it('gives nothing from a row that starts after the date', () => {
    const rows = [{ ...job('psn_103', 'Team Leader', { section: 's-silk' }), starts_on: '2026-10-16' }]
    expect(coverageOf('psn_103', chart(rows), ON)).toEqual([])
  })

  it("gives nothing from another person's rows", () => {
    expect(coverageOf('psn_999', chart([job('psn_103', 'Team Leader', { section: 's-silk' })]), ON)).toEqual([])
  })

  it("gives nothing from a link to another store's section", () => {
    expect(coverageOf('psn_103', chart([job('psn_103', 'Team Leader', { section: 's-hill-acc' })]), ON)).toEqual([])
  })

  it('gives nothing from a job the coverage rules do not know', () => {
    expect(coverageOf('psn_130', chart([job('psn_130', 'Cashier')]), ON)).toEqual([])
  })

  it('names the job row each unit comes from', () => {
    const row = job('psn_103', 'Team Leader', { section: 's-silk' })
    expect(coverageOf('psn_103', chart([row]), ON)[0]).toMatchObject({ job: 'Team Leader', jobRow: row.row_id, unitName: 'Silk Sarees' })
  })

  it('names an unnamed department by its key', () => {
    expect(coverageOf('psn_109', chart([job('psn_109', 'Department Manager', { department: 'd-kids' })]), ON)[0].unitName).toBe('dm-P-109')
  })
})
