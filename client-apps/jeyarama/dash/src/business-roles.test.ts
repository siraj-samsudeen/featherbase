// #1218: business roles in shadow (option A). Made-up roles, titles and people.
import { describe, expect, it } from 'vitest'
import { appsOf, areaPrefixes, decisionReports, differences, permissionSentence, rolesOf, shadowReceiver, newModelReports, titleList, opensDash, type BusinessRole, type Permission, type TitleRule } from './business-roles'

const ON = '2026-11-17'
const ROLES: BusinessRole[] = [
  { id: 'r-staff', name: 'Staff' }, { id: 'r-tl', name: 'Team Leader' }, { id: 'r-sm', name: 'Store Manager' },
  { id: 'r-cm', name: 'Cluster Manager' }, { id: 'r-buyer', name: 'Buyer' }, { id: 'r-head', name: 'Category Head' },
  { id: 'r-ho', name: 'Head Office' }, { id: 'r-lead', name: 'Leadership' }, { id: 'r-mds', name: 'Master Data Steward', by_hand_only: true },
]
const PERMISSIONS: Permission[] = [
  { role: 'r-staff', app: 'Tasker', level: 'User', verb: 'Edit', thing: 'Tasks', reach: 'Own' },
  { role: 'r-tl', app: 'Dash', level: 'Reader', verb: 'View', thing: 'Reports', reach: 'Area' },
  { role: 'r-sm', app: 'Dash', level: 'Reader', verb: 'View', thing: 'Reports', reach: 'Area' },
  { role: 'r-sm', app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', reach: 'Area' },
  { role: 'r-sm', app: 'Tasker', level: 'Manager', verb: 'Edit', thing: 'Tasks', reach: 'Team' },
  { role: 'r-buyer', app: 'Dash', level: 'Reader', verb: 'View', thing: 'Reports', reach: 'Area' },
  { role: 'r-mds', app: 'Master Data', level: 'Steward', verb: 'Edit', thing: 'Master Tables', reach: 'All' },
]
const RULES: TitleRule[] = [
  { title: 'Staff', role: 'r-staff' }, { title: 'Team Leader', role: 'r-tl' }, { title: 'Store Manager', role: 'r-sm' },
  { title: 'Cluster Manager', role: 'r-cm' }, { title: 'Head office staff', role: 'r-ho' }, { title: 'Director', role: 'r-lead' },
  { title: 'AGM Operations', role: 'r-cm' }, { title: 'Buyer', role: 'r-buyer' }, { title: 'Category head', role: 'r-head' },
]
const model = { rules: RULES, roles: ROLES, permissions: PERMISSIONS, today: ON }
const none = { jobs: [], merchandise: [], clustersHeaded: [], hand: [] }

describe('a person\'s business roles', () => {
  it('takes the role from the designation when the Title Map names it', () => {
    const { held } = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Head office staff', designation: 'AGM Operations' }] }, model)
    expect(held).toEqual([{ role: 'r-cm', source: 'hr_title', title: 'AGM Operations', spot: { kind: 'job', job: 'J1' } }])
  })

  it('falls back to the job when the designation is not mapped', () => {
    const { held } = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Store Manager', designation: 'Operations Executive' }] }, model)
    expect(held.map(r => [r.role, r.title])).toEqual([['r-sm', 'Store Manager']])
  })

  it('lists a title that maps to nothing as not mapped, never guessing a role', () => {
    const { held, unmapped } = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Floor Manager', designation: 'Floor In-charge' }] }, model)
    expect([held, unmapped]).toEqual([[], [{ title: 'Floor In-charge', job: 'Floor Manager' }]])
  })

  it('gives Head Office the whole company', () => {
    const { held } = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Head office staff', designation: null }] }, model)
    expect(held[0].spot).toEqual({ kind: 'company' })
  })

  it('takes a buyer\'s role from their merchandise assignment, at its place', () => {
    const { held } = rolesOf({ ...none, merchandise: [{ id: 'M1', responsibility: 'Buyer' }, { id: 'M2', responsibility: 'Buyer' }] }, model)
    expect(held).toEqual([{ role: 'r-buyer', source: 'merchandise', title: 'Buyer', spot: { kind: 'merchandise', assignments: ['M1', 'M2'] } }])
  })

  it('gives a named cluster head Cluster Manager over that cluster', () => {
    const { held } = rolesOf({ ...none, clustersHeaded: ['NORTH'] }, model)
    expect(held).toEqual([{ role: 'r-cm', source: 'cluster_head', title: null, spot: { kind: 'cluster', cluster: 'NORTH' } }])
  })

  it('replaces the role from the title with a Correct, at the same job', () => {
    const { held } = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Head office staff', designation: null }],
      hand: [{ id: 'H1', change: 'Correct', role: 'r-sm', ends_on: null, reason: 'Runs Lakeside' }] }, model)
    expect(held).toEqual([{ role: 'r-sm', source: 'corrected', title: 'Head office staff', spot: { kind: 'job', job: 'J1' }, hand: 'H1', until: null, reason: 'Runs Lakeside' }])
  })

  it('settles a title not mapped yet with a Correct', () => {
    const { unmapped } = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Floor Manager', designation: 'Floor In-charge' }],
      hand: [{ id: 'H1', change: 'Correct', role: 'r-sm' }] }, model)
    expect(unmapped).toEqual([])
  })

  it('adds an Also give at each of the person\'s jobs', () => {
    const { held } = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Team Leader', designation: null }],
      hand: [{ id: 'H1', change: 'Also give', role: 'r-sm', ends_on: '2027-03-31' }] }, model)
    expect(held.map(r => [r.role, r.source, r.spot])).toEqual([['r-tl', 'hr_title', { kind: 'job', job: 'J1' }], ['r-sm', 'also_given', { kind: 'job', job: 'J1' }]])
  })

  it('gives a role whose every permission reaches All the whole company', () => {
    const { held } = rolesOf({ ...none, hand: [{ id: 'H1', change: 'Also give', role: 'r-mds' }] }, model)
    expect(held[0].spot).toEqual({ kind: 'company' })
  })

  it('ignores a hand change past its end date', () => {
    const { held } = rolesOf({ ...none, hand: [{ id: 'H1', change: 'Also give', role: 'r-mds', ends_on: '2026-11-16' }] }, model)
    expect(held).toEqual([])
  })

  it('ignores a removed hand change', () => {
    const { held } = rolesOf({ ...none, hand: [{ id: 'H1', change: 'Also give', role: 'r-mds', removed: true }] }, model)
    expect(held).toEqual([])
  })
})

describe('the less common routes to a role', () => {
  it('lists a job with no designation and no mapping by the job', () => {
    expect(rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Floor Manager', designation: null }] }, model).unmapped).toEqual([{ title: 'Floor Manager', job: 'Floor Manager' }])
  })

  it('lists a merchandise responsibility nobody has mapped', () => {
    expect(rolesOf({ ...none, merchandise: [{ id: 'M1', responsibility: 'Division head' }] }, model).unmapped).toEqual([{ title: 'Division head', job: 'Division head' }])
  })

  it('gives a Correct to someone with no job the whole company, for a role reaching it', () => {
    expect(rolesOf({ ...none, hand: [{ id: 'H1', change: 'Correct', role: 'r-lead' }] }, model).held.map(r => r.spot)).toEqual([{ kind: 'company' }])
  })

  it('gives a Correct to someone with no job no place, for a role reaching only an area', () => {
    expect(rolesOf({ ...none, hand: [{ id: 'H1', change: 'Correct', role: 'r-sm' }] }, model).held.map(r => r.spot)).toEqual([{ kind: 'none' }])
  })

  it('adds an Also give at a buyer\'s merchandise place when they hold no job', () => {
    expect(rolesOf({ ...none, merchandise: [{ id: 'M1', responsibility: 'Buyer' }], hand: [{ id: 'H1', change: 'Also give', role: 'r-head' }] }, model).held.map(r => r.spot))
      .toEqual([{ kind: 'merchandise', assignments: ['M1'] }, { kind: 'merchandise', assignments: ['M1'] }])
  })

  it('gives a named cluster head nothing while Cluster Manager maps to no role', () => {
    expect(rolesOf({ ...none, clustersHeaded: ['NORTH'] }, { ...model, rules: [] }).held).toEqual([])
  })

  it('ignores a mapping to a role that no longer exists', () => {
    expect(rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Store Manager', designation: null }] }, { ...model, rules: [{ title: 'Store Manager', role: 'gone' }] }).held).toEqual([])
  })
})

describe('apps and levels', () => {
  it('lists each app and level once, with the roles that give it', () => {
    const held = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Store Manager', designation: null }, { id: 'J2', job: 'Team Leader', designation: null }] }, model).held
    expect(appsOf(held, model)).toEqual([
      { app: 'Dash', level: 'Manager', via: ['Store Manager'] },
      { app: 'Dash', level: 'Reader', via: ['Store Manager', 'Team Leader'] },
      { app: 'Tasker', level: 'Manager', via: ['Store Manager'] },
    ])
  })

  it('opens Dash only for a role with a Dash permission', () => {
    const staff = rolesOf({ ...none, jobs: [{ id: 'J1', job: 'Staff', designation: null }] }, model).held
    expect(opensDash(staff, model)).toBe(false)
  })
})

describe('a permission as a sentence', () => {
  it('reads "Store Managers can Edit Sections in their Area"', () => {
    expect(permissionSentence('Store Manager', PERMISSIONS[3])).toBe('Store Managers can Edit Sections in their Area')
  })

  it('keeps a collective name as it is', () => {
    expect(permissionSentence('Staff', PERMISSIONS[0])).toBe('Staff can Edit Tasks they own')
  })
})

describe('the Title Map', () => {
  it('puts titles not mapped yet first, with how many people hold each', () => {
    const list = titleList([{ title: 'Store Manager', people: ['p1', 'p2'] }, { title: 'Floor In-charge', people: ['p3'] }, { title: 'Operations Executive', people: ['p4', 'p5'], job: 'Store Manager' }], { ...model, rules: [{ title: 'Store Manager', role: 'r-sm' }] })
    expect(list.map(row => [row.title, row.role, row.people, row.falls_back_to ?? null])).toEqual([
      ['Floor In-charge', null, 1, null], ['Operations Executive', null, 2, 'Store Manager'], ['Store Manager', 'r-sm', 2, null],
    ])
  })
})

describe('report grants in the new shape', () => {
  it('turns a grant to a job into a grant to its business role', () => {
    expect(shadowReceiver({ report: 'vs', report_bundle: null, person: null, role: null, job: 'Store Manager' }, model)).toEqual({ kind: 'role', role: 'r-sm' })
  })

  it('marks a grant to Dash Reader as needing a decision', () => {
    expect(shadowReceiver({ report: 'vs', report_bundle: null, person: null, role: 'Dash Reader', job: null }, model)).toEqual({ kind: 'decision', name: 'Dash Reader' })
  })

  it('keeps a grant to a person', () => {
    expect(shadowReceiver({ report: 'vs', report_bundle: null, person: 'p1', role: null, job: null }, model)).toEqual({ kind: 'person', person: 'p1' })
  })

  it('marks a grant to a job nobody has mapped as needing a decision', () => {
    expect(shadowReceiver({ report: 'vs', report_bundle: null, person: null, role: null, job: 'Floor In-charge' }, model)).toEqual({ kind: 'decision', name: 'Floor In-charge' })
  })

  it('reads a row naming no receiver as giving nothing', () => {
    expect(shadowReceiver({ report: 'vs', report_bundle: null, person: null, role: null, job: null }, model)).toBeNull()
  })

  it('gives nothing through a row that names both a report and a bundle, or another person', () => {
    const rows = [{ report: 'vs', report_bundle: 'b1', person: 'p1', role: null, job: null }, { report: 'st', report_bundle: null, person: 'p2', role: null, job: null },
      { report: 'mine', report_bundle: null, person: 'p1', role: null, job: null }]
    expect([...newModelReports('p1', [], rows, [], model)]).toEqual([['mine', [{ person: true, bundle: null }]]])
  })

  it('gives a report through a bundle to everyone holding the role, saying why', () => {
    const rows = [{ report: null, report_bundle: 'b1', person: null, role: null, job: 'Store Manager' }]
    const got = newModelReports('p1', ['r-sm'], rows, [{ report_bundle: 'b1', report: 'vs' }, { report_bundle: 'b2', report: 'other' }], model)
    expect([...got]).toEqual([['vs', [{ role: 'r-sm', bundle: 'b1' }]]])
  })
})

describe('reports needing a decision', () => {
  it('names a report reaching someone only through Dash Reader', () => {
    const rows = [{ report: 'vs', report_bundle: null, person: null, role: 'Dash Reader', job: null }, { report: 'st', report_bundle: null, person: null, role: 'Dash Reader', job: null },
      { report: 'st', report_bundle: null, person: null, role: null, job: 'Store Manager' }]
    expect(decisionReports({ person: 'p1', roles: ['Dash Reader'], jobs: ['Store Manager'] }, rows, [])).toEqual(['vs'])
  })
})

describe('today against the new model', () => {
  const side = (over = {}) => ({ opens: true, places: { '9901': null } as Record<string, string[] | null>, reports: ['vs'], ...over })

  it('finds no difference for the same access', () => {
    expect(differences(side(), side(), []).kind).toBeNull()
  })

  it('says who would lose Dash first', () => {
    expect(differences(side(), side({ opens: false, places: {}, reports: [] }), []).kind).toBe('loses_dash')
  })

  it('says who would gain Dash', () => {
    expect(differences(side({ opens: false, places: {}, reports: [] }), side(), []).kind).toBe('gains_dash')
  })

  it('finds a report gained with the same stores', () => {
    expect(differences(side(), side({ reports: ['vs', 'st'] }), []).gained).toEqual(['st'])
  })

  it('finds a store lost', () => {
    expect(differences(side({ places: { '9901': null, '9902': null } }), side(), []).kind).toBe('stores')
  })

  it('finds a report lost that no decision covers', () => {
    expect(differences(side(), side({ reports: [] }), []).kind).toBe('reports')
  })

  it('finds a store gained', () => {
    expect(differences(side(), side({ places: { '9901': null, '9902': null } }), []).storesGained).toEqual(['9902'])
  })

  it('counts a report lost only through Dash Reader as needing a decision', () => {
    const found = differences(side(), side({ reports: [] }), ['vs'])
    expect([found.kind, found.decisions, found.lost]).toEqual(['decision', ['vs'], []])
  })

  it('finds different subcategories in the same store', () => {
    expect(differences(side({ places: { '9901': ['010101001'] } }), side({ places: { '9901': ['010101001', '010101002'] } }), []).kind).toBe('stores')
  })
})

describe('a merchandise area as code prefixes', () => {
  const every = ['010101001', '010101002', '010102001', '020101001']
  it('sends a category wholly held as its prefix', () => {
    expect(areaPrefixes(['010101001', '010101002', '010102001'], every)).toEqual(['01'])
  })

  it('keeps a code the hierarchy does not know as itself', () => {
    expect(areaPrefixes(['99'], every)).toEqual(['99'])
  })

  it('keeps a subcategory whose siblings are not held as itself', () => {
    expect(areaPrefixes(['010101001'], every)).toEqual(['010101001'])
  })
})
