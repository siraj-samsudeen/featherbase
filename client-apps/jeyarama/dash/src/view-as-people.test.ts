// View as's people read (#1222) against made-up Tables in memory: who may ask, describing people,
// and finding them by name, employee code, or job and store. The real-read test on the platform is
// platform-test/view-as.test.ts.
import { describe, expect, it } from 'vitest'
import { viewAsPeople, VIEW_AS_TESTER } from './view-as-people'
import type { AccessContext } from './report-access-server'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]

/** Made-up Tables, read with the filters the code uses: =, in and like. */
function tables(data: Record<string, Row[]>) {
  const matches = (row: Row, [column, operator, value]: Filter) =>
    operator === '=' ? row[column] === value
      : operator === 'in' ? (value as unknown[]).includes(row[column])
        : String(row[column] ?? '').toLowerCase().includes(String(value).replaceAll('%', '').toLowerCase())
  return {
    async list(table: string, args: { filters?: Filter[]; limit_start?: number; limit_page_length?: number }) {
      const rows = (data[table] ?? []).filter(row => (args.filters ?? []).every(filter => matches(row, filter)))
      const start = args.limit_start ?? 0
      return rows.slice(start, start + (args.limit_page_length ?? rows.length))
    },
  }
}

const ON = '2026-11-17'
const job = (employee: string, title: string, site: string) => ({ row_id: `JA-${employee}-${site}`, employee, job: title, site, starts_on: '2026-01-01', ends_on: null })
const DATA: Record<string, Row[]> = {
  Employee: [
    { row_id: 'E1', employee_code: '2001', name: 'Asha Leader', person: 'p-asha', status: 'Current' },
    { row_id: 'E2', employee_code: '3013', name: 'Mohan Manager', person: 'p-mohan', status: 'Current' },
    { row_id: 'E3', employee_code: '3014', name: 'Kavya Example', person: 'p-kavya', status: 'Current' },
    { row_id: 'E4', employee_code: '3999', name: 'Old Leader', person: 'p-old', status: 'Left' },
    { row_id: 'E5', employee_code: '4000', name: 'No Sign-in', person: null, status: 'Current' },
    { row_id: 'E6', employee_code: '2000', name: 'Asha Leader', person: 'p-asha2', status: 'Current' },
    { row_id: 'E7', employee_code: '5000', name: 'Jobless Example', person: 'p-jobless', status: 'Current' },
    // Kavya's second record (#1216): one person, two employee rows, one name in the answer.
    { row_id: 'E8', employee_code: '3015', name: 'Kavya Example', person: 'p-kavya', status: 'Current' },
    { row_id: 'E9', employee_code: '', name: 'Nocode Example', person: 'p-nocode', status: 'Current' },
    { row_id: 'E10', employee_code: '6000', name: 'Nocode Example', person: 'p-nocode2', status: 'Current' },
    { row_id: 'E11', employee_code: '', name: 'Nocode Example', person: 'p-nocode3', status: 'Current' },
  ],
  'Job Assignment': [job('E1', 'Team Leader', 'LKS'), job('E2', 'Store Manager', 'LKS'), job('E2', 'Team Leader', 'HLV'),
    job('E3', 'Team Leader', 'HLV'), job('E4', 'Team Leader', 'LKS'), job('E6', 'Team Leader', 'LKS')],
  Site: [{ row_id: 'LKS', name: 'Lakeside' }, { row_id: 'HLV', name: 'Hillview' }],
}

function context(payload: unknown, roles: string[] = [VIEW_AS_TESTER]): AccessContext {
  return {
    user: 'tester', roles, payload, baseTables: tables(DATA),
    people: { async names(ids: string[]) { return Object.fromEntries(ids.filter(id => id === 'p-asha').map(id => [id, 'Asha Leader'])) } },
    reject(message: string): never { throw new Error(message) },
  }
}
const find = async (q: string) => (await viewAsPeople(context({ q }), ON)).map(p => `${p.name} ${p.code}`)

describe('View as people', () => {
  it('answers only a View As Tester', async () => {
    await expect(viewAsPeople(context({ q: 'asha' }, ['Dash Reader']), ON)).rejects.toThrow('Only a View As Tester')
    await expect(viewAsPeople({ ...context({ q: 'asha' }), roles: undefined }, ON)).rejects.toThrow('Only a View As Tester')
  })

  it('looks as of today unless told a day', async () => {
    expect((await viewAsPeople(context({ q: '3013' }))).map(p => p.code)).toEqual(['3013'])
  })

  it('describes the people asked about, in order, leaving a name it cannot read blank for the platform', async () => {
    expect(await viewAsPeople(context({ persons: ['p-mohan', 7, '', 'p-asha', 'p-nobody'] }), ON)).toEqual([
      { person: 'p-mohan', name: 'Mohan Manager', code: '3013', jobs: ['Store Manager · Lakeside', 'Team Leader · Hillview'] },
      { person: 'p-asha', name: 'Asha Leader', code: '2001', jobs: ['Team Leader · Lakeside'] },
      { person: 'p-nobody', name: '', code: null, jobs: [] },
    ])
  })

  it('needs two letters before it looks', async () => {
    expect(await viewAsPeople(context({ q: 'a' }), ON)).toEqual([])
    expect(await viewAsPeople(context({}), ON)).toEqual([])
  })

  it('finds current staff by name, by code, and by job and store, sorted by name then code', async () => {
    expect(await find('asha')).toEqual(['Asha Leader 2000', 'Asha Leader 2001'])
    expect(await find('3013')).toEqual(['Mohan Manager 3013'])
    // Job and store in one line: Mohan leads a team at Hillview and manages Lakeside, so he is not a Lakeside team leader.
    expect(await find('Team Leader Lakeside')).toEqual(['Asha Leader 2000', 'Asha Leader 2001'])
    expect(await find('hillview')).toEqual(['Kavya Example 3014', 'Mohan Manager 3013'])
  })

  it('leaves out who has left, who has no sign-in, and lets a one-letter word only narrow', async () => {
    expect(await find('leader')).not.toContain('Old Leader 3999')
    expect(await find('sign-in')).toEqual([])
    expect(await find('jobless')).toEqual(['Jobless Example 5000'])
    // Same name: those without a code come first, then by code.
    expect(await find('nocode')).toEqual(['Nocode Example null', 'Nocode Example null', 'Nocode Example 6000'])
    // One person found through two employee records is offered once.
    expect(await find('kavya')).toEqual(['Kavya Example 3014'])
    expect(await find('asha l 2001')).toEqual(['Asha Leader 2001'])
  })
})
