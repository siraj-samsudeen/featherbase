import { describe, expect, it } from 'vitest'
import { conflictsOf } from './conflicts.ts'
import { HILLVIEW, LAKESIDE, chart, job } from './test-chart.ts'
import type { OrgChart, Row } from './coverage.ts'

const ON = '2026-10-15'
const name = (person: string) => person.replace('psn_', 'P-')

/** A Lakeside chart with every section led and every department managed, so each test adds one fault. */
function clean(extra: Row[] = [], edit: (c: OrgChart) => void = () => {}): OrgChart {
  const rows = [
    job('psn_101', 'Store Manager'),
    { ...job('psn_102', 'Floor Manager', { floor: 'f-ground' }), reports_to: 'psn_101' },
    { ...job('psn_112', 'Floor Manager', { floor: 'f-first' }), reports_to: 'psn_101' },
    { ...job('psn_107', 'Department Manager', { department: 'd-ethnic' }), reports_to: 'psn_102' },
    { ...job('psn_108', 'Department Manager', { department: 'd-bridal' }), reports_to: 'psn_112' },
    { ...job('psn_109', 'Department Manager', { department: 'd-kids' }), reports_to: 'psn_112' },
    { ...job('psn_103', 'Team Leader', { section: 's-sarees' }), reports_to: 'psn_107' },
    { ...job('psn_104', 'Team Leader', { section: 's-silk' }), reports_to: 'psn_107' },
    { ...job('psn_105', 'Team Leader', { section: 's-lehenga' }), reports_to: 'psn_108' },
    { ...job('psn_106', 'Team Leader', { section: 's-kids' }), reports_to: 'psn_109' },
    { ...job('psn_110', 'Team Leader', { section: 's-tops' }), reports_to: 'psn_109' },
    ...extra,
  ]
  const data = chart(rows)
  data.departments = data.departments.map(d => d.row_id === 'd-kids' ? { ...d, name: 'Kids' } : d)
  edit(data)
  return data
}
const kinds = (data: OrgChart) => conflictsOf(LAKESIDE, data, ON, name).map(c => c.kind)
const messages = (data: OrgChart) => conflictsOf(LAKESIDE, data, ON, name).map(c => c.message)

describe('the conflict list', () => {
  it('is empty for a clean store', () => {
    expect(conflictsOf(LAKESIDE, clean(), ON, name)).toEqual([])
  })

  it('names a section with more non-acting Team Leaders than it allows', () => {
    expect(messages(clean([{ ...job('psn_111', 'Team Leader', { section: 's-tops' }), reports_to: 'psn_109' }])))
      .toEqual(['Women Tops has 2 Team Leaders, allows 1: P-110, P-111'])
  })

  it('accepts two Team Leaders on a section that allows two', () => {
    expect(kinds(clean([{ ...job('psn_111', 'Team Leader', { section: 's-kids' }), reports_to: 'psn_109' }]))).toEqual([])
  })

  it('ignores an acting Team Leader when counting', () => {
    expect(kinds(clean([{ ...job('psn_111', 'Team Leader', { section: 's-tops' }), reports_to: 'psn_109', acting: true }]))).toEqual([])
  })

  it('names a Team Leader on more than one section', () => {
    expect(kinds(clean([{ ...job('psn_110', 'Team Leader', { section: 's-kids' }), reports_to: 'psn_109' }])))
      .toEqual(['team_leader_on_several_sections'])
  })

  it('names a manager with no reporting line', () => {
    expect(messages(clean([], c => { c.jobs = c.jobs.map(r => r.person === 'psn_104' ? { ...r, reports_to: null } : r) })))
      .toEqual(['P-104 (Team Leader) has no reporting line'])
  })

  it('names a section with no Team Leader', () => {
    expect(messages(clean([], c => { c.jobs = c.jobs.filter(r => r.person !== 'psn_104') }))).toEqual(['Silk Sarees has no Team Leader'])
  })

  it('names a section with no department', () => {
    expect(messages(clean([], c => { c.sections = c.sections.map(s => s.row_id === 's-silk' ? { ...s, department: null } : s) })))
      .toEqual(['Silk Sarees has no department'])
  })

  it('names a department with no current Department Manager', () => {
    expect(messages(clean([], c => { c.jobs = c.jobs.filter(r => r.person !== 'psn_108') }))).toEqual(['Bridal has no Department Manager'])
  })

  it('names a department with no name', () => {
    expect(messages(clean([], c => { c.departments = c.departments.map(d => d.row_id === 'd-kids' ? { ...d, name: '' } : d) })))
      .toEqual(['Department dm-P-109 has no name: name this department'])
  })

  it('names a Team Leader reporting to the Department Manager of another department', () => {
    expect(messages(clean([], c => { c.jobs = c.jobs.map(r => r.person === 'psn_104' ? { ...r, reports_to: 'psn_108' } : r) })))
      .toEqual(['P-104 leads Silk Sarees (Ladies Ethnic) but reports to P-108, Department Manager of Bridal'])
  })

  it('names a Department Manager reporting to a Floor Manager whose floors hold none of their sections', () => {
    expect(messages(clean([], c => { c.jobs = c.jobs.map(r => r.person === 'psn_108' ? { ...r, reports_to: 'psn_102' } : r) })))
      .toEqual(['P-108 manages Bridal but reports to P-102, Floor Manager of Ground, which holds none of its sections'])
  })

  it("checks each of a Department Manager's assignments against its own reporting line", () => {
    const data = clean([{ ...job('psn_108', 'Department Manager', { department: 'd-kids' }), reports_to: 'psn_112' }],
      c => { c.jobs = c.jobs.map(r => r.person === 'psn_108' && r.department === 'd-bridal' ? { ...r, reports_to: 'psn_102' } : r) })
    expect(messages(data)).toEqual(['P-108 manages Bridal but reports to P-102, Floor Manager of Ground, which holds none of its sections'])
  })

  it('names a subcategory placed in two sections for overlapping dates', () => {
    expect(kinds(clean([], c => { c.placements.push({ row_id: 'p9', store: LAKESIDE, subcategory: '010101001', section: 's-silk', starts_on: '2026-09-01', ends_on: null }) })))
      .toEqual(['overlapping_placement'])
  })

  it('names a person holding jobs in two stores at once', () => {
    expect(messages(clean([job('psn_103', 'Staff', { section: 's-hill-acc' }, HILLVIEW)])))
      .toEqual(['P-103 holds jobs in 9901 and 9902 on overlapping dates'])
  })

  it('lets a Cluster Manager hold several stores', () => {
    expect(kinds(clean([job('psn_120', 'Cluster Manager'), job('psn_120', 'Cluster Manager', {}, HILLVIEW)]))).toEqual([])
  })

  it('names a Store Manager who is also Cluster Manager of another store on overlapping dates', () => {
    expect(messages(clean([job('psn_101', 'Cluster Manager', {}, HILLVIEW)])))
      .toEqual(['P-101 holds jobs in 9901 and 9902 on overlapping dates'])
  })

  it('names an acting Team Leader reporting to the Department Manager of another department', () => {
    expect(messages(clean([{ ...job('psn_111', 'Team Leader', { section: 's-silk' }), reports_to: 'psn_108', acting: true }])))
      .toEqual(['P-111 leads Silk Sarees (Ladies Ethnic) but reports to P-108, Department Manager of Bridal'])
  })

  it("names a link to another store's floor, department or section", () => {
    expect(messages(clean([], c => { c.sections = c.sections.map(s => s.row_id === 's-silk' ? { ...s, department: 'd-hill' } : s) })))
      .toEqual(['Silk Sarees names department Hillview Apparel of store 9902'])
  })

  it('names a second non-acting Store Manager', () => {
    expect(kinds(clean([job('psn_130', 'Store Manager')]))).toEqual(['several_store_managers'])
  })

  it('ignores an acting Store Manager', () => {
    expect(kinds(clean([{ ...job('psn_102', 'Store Manager'), acting: true }]))).toEqual([])
  })

  it('names a job the coverage rules do not know', () => {
    expect(messages(clean([job('psn_131', 'Cashier')]))).toEqual(['P-131 holds Cashier, which no coverage rule knows: it covers nothing'])
  })
})
