// Which reports reach a person, and why (#1046). Made-up rows only.
import { describe, expect, it } from 'vitest'
import { reportsReaching, type AccessRow, type BundleMember, type Receiver } from './report-access'

const asha: Receiver = { person: 'asha', roles: ['Store Reviewers'], jobs: ['Team Leader'] }
const row = (over: Partial<AccessRow>): AccessRow => ({ report: null, report_bundle: null, person: null, role: null, job: null, ...over })
const members: BundleMember[] = [
  { report_bundle: 'Team pack', report: 'sales' },
  { report_bundle: 'Team pack', report: 'stock' },
]
const keys = (rows: AccessRow[], receiver = asha, inBundles = members) => [...reportsReaching(receiver, rows, inBundles).keys()].sort()

describe('what reaches a person', () => {
  it('nothing, with no rows', () => {
    expect(keys([])).toEqual([])
  })

  it('a report given directly, through a role and through a job', () => {
    expect(keys([row({ report: 'a', person: 'asha' }), row({ report: 'b', role: 'Store Reviewers' }), row({ report: 'c', job: 'Team Leader' })])).toEqual(['a', 'b', 'c'])
  })

  it('every report in a bundle, by any route', () => {
    expect(keys([row({ report_bundle: 'Team pack', job: 'Team Leader' })])).toEqual(['sales', 'stock'])
  })

  it('not what was given to someone else', () => {
    expect(keys([row({ report: 'a', person: 'ben' }), row({ report: 'b', role: 'Other' }), row({ report: 'c', job: 'Store Manager' })])).toEqual([])
  })

  it('not a report taken out of a bundle', () => {
    expect(keys([row({ report_bundle: 'Team pack', person: 'asha' })], asha, [members[0]])).toEqual(['sales'])
  })

  it('nothing from a bundle with no reports', () => {
    expect(keys([row({ report_bundle: 'Empty', person: 'asha' })])).toEqual([])
  })

  it('adds routes up, with nothing subtracted', () => {
    const reached = reportsReaching(asha, [row({ report: 'sales', person: 'asha' }), row({ report_bundle: 'Team pack', job: 'Team Leader' })], members)
    expect(reached.get('sales')).toEqual([
      { kind: 'person', receiver: 'asha', bundle: null },
      { kind: 'job', receiver: 'Team Leader', bundle: 'Team pack' },
    ])
  })
})

describe('a malformed row gives nothing', () => {
  it.each([
    ['no receiver', row({ report: 'a' })],
    ['no report or bundle', row({ person: 'asha' })],
    ['two receivers', row({ report: 'a', person: 'asha', job: 'Team Leader' })],
    ['a report and a bundle', row({ report: 'a', report_bundle: 'Team pack', person: 'asha' })],
    ['an empty string as the receiver', row({ report: 'a', person: '' })],
  ])('%s', (_name, bad) => {
    expect(keys([bad])).toEqual([])
  })
})
