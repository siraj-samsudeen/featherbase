// #1267: Dash says who people are for the platform's Person page, from the same
// whoIs() its own screens use. Made-up Tables in memory, as view-as-people.test.ts.
import { describe, expect, it } from 'vitest'
import { DESCRIBE_ACTOR, describePeople } from './people-describe'
import type { AccessContext } from './report-access-server'

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

const ON = '2026-11-17'
const DATA: Record<string, Row[]> = {
  Employee: [
    { row_id: 'E1', employee_code: '2001', person: 'p-asha', status: 'Current' },
    { row_id: 'E2', employee_code: '3999', person: 'p-old', status: 'Left' },
    { row_id: 'E3', employee_code: '5000', person: 'p-jobless', status: 'Current' },
  ],
  'Job Assignment': [
    { row_id: 'J1', employee: 'E1', job: 'Team Leader', site: 'LKS', starts_on: '2026-01-01', ends_on: null },
    { row_id: 'J2', employee: 'E1', job: 'Buyer', site: '', starts_on: '2026-01-01', ends_on: null },
  ],
  Site: [{ row_id: 'LKS', name: 'Lakeside' }],
}

function context(payload: unknown, user = DESCRIBE_ACTOR, roles = ['All', 'System Manager']): AccessContext {
  return { user, roles, payload, baseTables: tables(DATA), reject(message: string): never { throw new Error(message) } }
}

describe('describe_people', () => {
  it('answers only the platform describing people', async () => {
    await expect(describePeople(context({ persons: ['p-asha'] }, 'p-someone'), ON)).rejects.toThrow('Only the platform describes people')
    // The actor's name alone is not enough: it holds System Manager only while the platform runs it.
    await expect(describePeople(context({ persons: ['p-asha'] }, DESCRIBE_ACTOR, ['Dash Reader']), ON)).rejects.toThrow('Only the platform')
  })

  it('says each person is current, left or none, in the order asked, with jobs and their sites', async () => {
    expect(await describePeople(context({ persons: ['p-old', 'p-asha', 'p-nobody', 'p-jobless', 7, 'p-asha'] }), ON)).toEqual([
      { person: 'p-old', status: 'left', code: '3999', jobs: [] },
      { person: 'p-asha', status: 'current', code: '2001', jobs: [{ job: 'Buyer' }, { job: 'Team Leader', site: { table: 'Site', id: 'LKS', name: 'Lakeside' } }] },
      { person: 'p-nobody', status: 'none', code: null, jobs: [] },
      { person: 'p-jobless', status: 'current', code: '5000', jobs: [] },
    ])
  })

  it('asks nothing for no persons', async () => {
    expect(await describePeople(context({}), ON)).toEqual([])
  })
})
