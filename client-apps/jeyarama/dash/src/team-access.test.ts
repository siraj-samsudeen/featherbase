// Who is in a Team Report Manager's team (#1217), against made-up Tables in memory. The
// refusals on the platform are platform-test/team-report-access.test.ts.
import { describe, expect, it } from 'vitest'
import { givableBundles, teamOf } from './team-access'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]

function tables(data: Record<string, Row[]>) {
  const matches = (row: Row, [column, operator, value]: Filter) =>
    operator === '=' ? row[column] === value : operator === 'in' ? (value as unknown[]).includes(row[column]) : false
  return {
    async list(table: string, args: { filters?: Filter[]; limit_start?: number; limit_page_length?: number }) {
      const rows = (data[table] ?? []).filter(row => (args.filters ?? []).every(filter => matches(row, filter)))
      const start = args.limit_start ?? 0
      return rows.slice(start, start + (args.limit_page_length ?? rows.length))
    },
  }
}

const ON = '2026-11-16'
const employee = (row_id: string, person: string | null, status = 'Current') => ({ row_id, name: `Made-up ${row_id}`, person, status })
const job = (row_id: string, emp: string, reports_to: string | null, ends_on: string | null = null) => ({ row_id, employee: emp, job: 'Buyer', reports_to, starts_on: '2026-01-01', ends_on })

const base = tables({
  Employee: [
    employee('E-HEAD', 'head'), employee('E-BYJOB', 'by-job'), employee('E-BYEMP', 'by-employee'),
    employee('E-ENDED', 'ended'), employee('E-LEFT', 'left', 'Left'), employee('E-NOSIGNIN', null),
    employee('E-OTHER', 'other'), employee('E-OLD', 'old-job'),
  ],
  'Job Assignment': [
    job('JA-HEAD', 'E-HEAD', null), job('JA-HEAD-OLD', 'E-HEAD', null, '2026-03-01'),
    job('JA-BYJOB', 'E-BYJOB', 'JA-HEAD'),
    job('JA-BYEMP', 'E-BYEMP', 'E-HEAD'),
    job('JA-ENDED', 'E-ENDED', 'E-HEAD', '2026-06-01'),
    job('JA-LEFT', 'E-LEFT', 'E-HEAD'),
    job('JA-NOSIGNIN', 'E-NOSIGNIN', 'E-HEAD'),
    job('JA-OTHER', 'E-OTHER', 'E-SOMEONE-ELSE'),
    job('JA-OLD', 'E-OLD', 'JA-HEAD-OLD'),
    job('JA-SELF', 'E-HEAD', 'E-HEAD'),
  ],
})

describe('a Team Report Manager’s team', () => {
  it('is the people whose current job reports to their job assignment or their employee record', async () => {
    expect([...(await teamOf(base, 'head', ON))].sort()).toEqual([
      ['by-employee', 'Made-up E-BYEMP'], ['by-job', 'Made-up E-BYJOB'],
    ])
  })

  it('leaves out an ended job, someone who left, someone with no sign-in, someone reporting elsewhere, a job reporting to an ended job of theirs, and themselves', async () => {
    const team = await teamOf(base, 'head', ON)
    for (const person of ['ended', 'left', 'other', 'old-job', 'head']) expect([person, team.has(person)]).toEqual([person, false])
  })

  it('is no one for someone not on the staff list', async () => {
    expect((await teamOf(base, 'stranger', ON)).size).toBe(0)
  })
})

describe('the bundles a Team Report Manager may give', () => {
  const members = [
    { report_bundle: 'b-held', report: 'sales' },
    { report_bundle: 'b-mixed', report: 'sales' }, { report_bundle: 'b-mixed', report: 'vendors' },
  ]
  it('are those whose every report they can open, and never an empty one', () => {
    expect([...givableBundles(['b-held', 'b-mixed', 'b-empty'], members, new Set(['sales']))]).toEqual(['b-held'])
  })
})
