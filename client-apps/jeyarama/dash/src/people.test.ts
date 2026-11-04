import { describe, expect, it } from 'vitest'
import { employmentProblem, shown, timeProblem } from './people.ts'

type Row = Record<string, unknown>
const stint = (id: string, extra: Row = {}): Row =>
  ({ row_id: id, employee: 'emp-1', legal_company: 'DEMO-CO', employee_number: 'DEMO-0101', joined_on: '2024-10-09', left_on: '2026-01-22', ...extra })

describe('employment', () => {
  it('accepts a rejoin that starts on the day the last stint ended', () => {
    expect(employmentProblem(stint('e2', { joined_on: '2026-01-22', left_on: null }), [stint('e1')])).toBeNull()
  })

  it('refuses a stint that overlaps another at the same company', () => {
    expect(employmentProblem(stint('e2', { joined_on: '2026-01-21', left_on: null }), [stint('e1')]))
      .toEqual({ field: 'joined_on', message: expect.stringMatching(/overlaps the person's stint at DEMO-CO from 09-Oct-2024 to 22-Jan-2026/) })
  })

  it('refuses a second current stint at the same company', () => {
    expect(employmentProblem(stint('e2', { joined_on: '2026-03-01', left_on: null }), [stint('e1', { left_on: null })])?.message)
      .toMatch(/from 09-Oct-2024, still current/)
  })

  it('lets the same person work for two companies at once', () => {
    expect(employmentProblem(stint('e2', { legal_company: 'DEMO-CO2', employee_number: 'X-1' }), [stint('e1')])).toBeNull()
  })

  it('does not compare a row with its own saved copy', () => {
    expect(employmentProblem(stint('e1', { left_on: '2026-02-01' }), [stint('e1')])).toBeNull()
  })

  it('refuses a company number that already belongs to another person', () => {
    expect(employmentProblem(stint('e2', { employee: 'emp-2', joined_on: '2026-03-01', left_on: null }), [stint('e1')]))
      .toEqual({ field: 'employee_number', message: 'Employee number DEMO-0101 at DEMO-CO already belongs to another person' })
  })

  it('lets a rejoin keep its old number', () => {
    expect(employmentProblem(stint('e2', { joined_on: '2026-02-04', left_on: null }), [stint('e1')])).toBeNull()
  })
})

describe('a person\'s time', () => {
  const ON = '2026-08-10'
  const job = (id: string, assignment_type: string, percentage: number, extra: Row = {}): Row =>
    ({ row_id: id, person: 'psn_101', assignment_type, percentage, starts_on: '2026-08-01', ends_on: null, acting: false, ...extra })

  it('accepts a Primary and Secondary that add up to 100%', () => {
    expect(timeProblem([job('a', 'Primary', 60), job('b', 'Secondary', 40)], ON)).toBeNull()
  })

  it('accepts a temporary deployment taken out of the Primary, which stays Primary', () => {
    expect(timeProblem([job('a', 'Primary', 100), job('b', 'Temporary deployment', 100)], ON)).toBeNull()
  })

  it('names two Primary assignments on the same day', () => {
    expect(timeProblem([job('a', 'Primary', 50), job('b', 'Primary', 50)], ON)).toMatchObject({ kind: 'several_primary_assignments' })
  })

  it('names Primary and Secondary over 100%', () => {
    expect(timeProblem([job('a', 'Primary', 100), job('b', 'Secondary', 20)], ON))
      .toMatchObject({ kind: 'time_over_100_percent', message: 'has Primary and Secondary assignments taking 120% of their time on 10-Aug-2026: at most 100%' })
  })

  it('names a deployment larger than the Primary it is taken from', () => {
    expect(timeProblem([job('a', 'Primary', 50), job('b', 'Secondary', 50), job('c', 'Temporary deployment', 60)], ON))
      .toMatchObject({ kind: 'deployment_over_primary_share', rows: [expect.objectContaining({ row_id: 'a' }), expect.objectContaining({ row_id: 'c' })] })
  })

  it('names a deployment with no Primary', () => {
    expect(timeProblem([job('c', 'Temporary deployment', 100)], ON)?.message).toMatch(/no Primary assignment/)
  })

  it('leaves out acting cover, rows that ended and rows with no assignment type', () => {
    expect(timeProblem([job('a', 'Primary', 100), job('b', 'Primary', 100, { acting: true }),
      job('c', 'Secondary', 50, { ends_on: '2026-08-10' }), job('d', '', 50)], ON)).toBeNull()
  })

  it('shows days as DD-Mon-YYYY', () => {
    expect(shown('2026-01-05')).toBe('05-Jan-2026')
  })
})

describe('stored dates', () => {
  it('reads a stored Date as its calendar day', () => {
    expect(employmentProblem(stint('e2', { joined_on: new Date('2026-01-21T00:00:00.000Z'), left_on: null }), [stint('e1', { left_on: new Date('2026-01-22T00:00:00.000Z') })])?.message)
      .toMatch(/to 22-Jan-2026/)
  })
})
