// #1277: which reports business roles give, and whether Dash opens. Made-up keys and people.
import { describe, expect, it } from 'vitest'
import { MANAGING_ROLES, businessReports, businessReportsReaching, businessRolesOpen, opensDashByBusinessRoles } from './business-reports'
import { TEAM_MANAGER } from './team-access'
import { VIEW_AS_TESTER } from './view-as-people'

const row = (over: Record<string, string | null>) => ({ report: null, report_bundle: null, person: null, role: null, job: null, business_role: null, ...over })

describe('reports under business roles', () => {
  it('gives a report given to the person, or to a business role they hold', () => {
    const rows = [row({ report: 'mine', person: 'p1' }), row({ report: 'vs', business_role: 'r-sm' }), row({ report: 'other', business_role: 'r-buyer' })]
    expect([...businessReportsReaching({ person: 'p1', roles: ['r-sm'], everyReport: [] }, rows, [], [])]).toEqual([
      ['mine', [{ person: true, bundle: null }]], ['vs', [{ role: 'r-sm', bundle: null }]],
    ])
  })

  it('gives nothing through a grant to a job or to Dash Reader', () => {
    const rows = [row({ report: 'vs', job: 'Store Manager' }), row({ report: 'st', role: 'Dash Reader' })]
    expect(businessReportsReaching({ person: 'p1', roles: ['r-sm'], everyReport: [] }, rows, [], []).size).toBe(0)
  })

  it('gives nothing through a row naming two receivers, or a report and a bundle', () => {
    const rows = [row({ report: 'vs', business_role: 'r-sm', role: 'Dash Reader' }), row({ report: 'st', report_bundle: 'b1', person: 'p1' }), row({ report: 'x', person: 'p2' })]
    expect(businessReportsReaching({ person: 'p1', roles: ['r-sm'], everyReport: [] }, rows, [], []).size).toBe(0)
  })

  it('gives a bundle\'s reports, saying through which bundle', () => {
    const got = businessReportsReaching({ person: 'p1', roles: ['r-sm'], everyReport: [] }, [row({ report_bundle: 'b1', business_role: 'r-sm' })],
      [{ report_bundle: 'b1', report: 'vs' }, { report_bundle: 'b2', report: 'other' }], [])
    expect([...got]).toEqual([['vs', [{ role: 'r-sm', bundle: 'b1' }]]])
  })

  it('offers a filtered report only with a place, and a whole-stores one only with a whole store', () => {
    const rows = [row({ report: 'vs', business_role: 'r-sm' }), row({ report: 'whole', business_role: 'r-sm' }), row({ report: 'open', business_role: 'r-sm' })]
    const shapes = new Map([['vs', 'Stores and subcategories'], ['whole', 'Whole stores'], ['open', 'No filter']])
    const part = [{ label: '9901 / Assigned subcategories', filters: { store: ['9901'], subcategory: ['010101001'] } }]
    expect(businessReports('p1', { roles: ['r-sm'], everyReport: [], places: [] }, rows, [], shapes).offered).toEqual(['open'])
    expect(businessReports('p1', { roles: ['r-sm'], everyReport: [], places: part }, rows, [], shapes).offered).toEqual(['open', 'vs'])
    expect(businessReports('p1', { roles: ['r-sm'], everyReport: [], places: [{ label: '9901', filters: { store: ['9901'] } }] }, rows, [], shapes).offered).toEqual(['open', 'vs', 'whole'])
  })
})

describe('whether Dash opens under business roles', () => {
  it('opens, behind a Dash role, for a business role holding a Dash permission, a managing role, or any report offered', () => {
    expect(opensDashByBusinessRoles(['Dash Reader'], true, 0)).toBe(true)
    expect(opensDashByBusinessRoles(['Report Access Manager'], false, 0)).toBe(true)
    expect(opensDashByBusinessRoles(['Dash Reader'], false, 1)).toBe(true)
  })

  it('stays shut for Dash Reader or Dash All-Stores Reader alone', () => {
    expect(opensDashByBusinessRoles(['Dash Reader', 'Dash All-Stores Reader'], false, 0)).toBe(false)
  })

  it('stays shut without one of Dash\'s own roles, which the platform asks first, whatever the business role', () => {
    expect([opensDashByBusinessRoles([], true, 3), businessRolesOpen([], true, 3)]).toEqual([false, true])
  })

  it('names the managing roles as Dash declares them', () => {
    expect([...MANAGING_ROLES].sort()).toEqual(['Report Access Manager', 'System Manager', TEAM_MANAGER, VIEW_AS_TESTER].sort())
  })
})
