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
    async available(table: string) { return table in data },
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

  // featherbase #1345: the business role each job gives, for the Person Label, as Explain finds it.
  it("names each job's business role: by HR's title, else the job's, through the Title Map; a Correct in force wins", async () => {
    const data: Record<string, Row[]> = {
      ...DATA,
      Employee: [...DATA.Employee!, { row_id: 'E4', employee_code: '6000', person: 'p-corrected', status: 'Current' }],
      'Job Assignment': [
        // HR's title as a Designation record (Codex standard round 1): its id is not its words.
        { row_id: 'J1', employee: 'E1', job: 'Team Leader', site: 'LKS', designation: 'D123', starts_on: '2026-01-01', ends_on: null },
        { row_id: 'J2', employee: 'E1', job: 'Buyer', site: '', starts_on: '2026-01-01', ends_on: null },
        { row_id: 'J4', employee: 'E4', job: 'Cashier', site: 'LKS', starts_on: '2026-01-01', ends_on: null },
      ],
      Designation: [{ row_id: 'D123', designation: 'Senior Team Lead' }],
      'dash.business_role': [
        { row_id: 'br-lead', role_name: 'Floor Lead', by_hand_only: 0 },
        { row_id: 'br-buyer', role_name: 'Buyer', by_hand_only: 0 },
        { row_id: 'br-cash', role_name: 'Cashier', by_hand_only: 0 },
        { row_id: 'br-owner', role_name: 'Owner Director', by_hand_only: 1 },
      ],
      'dash.title_map': [
        { row_id: 't1', title: 'senior team lead', business_role: 'br-lead' },
        { row_id: 't2', title: 'Buyer', business_role: 'br-buyer' },
        { row_id: 't3', title: 'Cashier', business_role: 'br-cash' },
      ],
      'dash.role_assignment': [
        { row_id: 'h1', person: 'p-corrected', change: 'Correct', business_role: 'br-owner', ends_on: null, removed: 0 },
      ],
    }
    const ctx = { ...context({ persons: ['p-asha', 'p-corrected'] }), baseTables: tables(data) }
    const [asha, corrected] = await describePeople(ctx, ON)
    expect(asha!.jobs).toEqual([
      { job: 'Buyer', business_role: { table: 'dash.business_role', id: 'br-buyer', name: 'Buyer' } },
      { job: 'Team Leader', site: { table: 'Site', id: 'LKS', name: 'Lakeside' }, business_role: { table: 'dash.business_role', id: 'br-lead', name: 'Floor Lead' } },
    ])
    expect(corrected!.jobs).toEqual([
      { job: 'Cashier', site: { table: 'Site', id: 'LKS', name: 'Lakeside' }, business_role: { table: 'dash.business_role', id: 'br-owner', name: 'Owner Director' } },
    ])
  })

  it("still names the job's role by its job title where Job Assignment carries no HR title", async () => {
    const data: Record<string, Row[]> = {
      ...DATA,
      'dash.business_role': [{ row_id: 'br-lead', role_name: 'Floor Lead', by_hand_only: 0 }],
      'dash.title_map': [{ row_id: 't1', title: 'Team Leader', business_role: 'br-lead' }],
    }
    // No Designation Table here, so the designation column is never asked for.
    const base = tables(data)
    const strict = { ...base, async list(table: string, args: { fields?: string[] } & Parameters<typeof base.list>[1]) {
      if (table === 'Job Assignment' && args.fields?.includes('designation')) throw new Error('Unknown field designation')
      return base.list(table, args)
    } }
    const [asha] = await describePeople({ ...context({ persons: ['p-asha'] }), baseTables: strict }, ON)
    expect(asha!.jobs.find(j => j.job === 'Team Leader')?.business_role).toEqual({ table: 'dash.business_role', id: 'br-lead', name: 'Floor Lead' })
  })

  it('asks nothing for no persons', async () => {
    expect(await describePeople(context({}), ON)).toEqual([])
  })
})
