import { describe, expect, it } from 'vitest'
import { signedIn } from './signedIn'

type Row = Record<string, unknown>
// made-up: psn_a signs in and is employee E1 (current) and E0 (left); E1 is a Director at head office; E2 is the
// Managing Director; E3 was a Director whose job ended; E4 holds a Director job but has left
const TABLES: Record<string, Row[]> = {
  Employee: [
    { row_id: 'E0', name: 'Asha', person: 'psn_a', status: 'Left' },
    { row_id: 'E1', name: 'Asha', person: 'psn_a', status: 'Current' },
    { row_id: 'E2', name: 'Kumar', person: 'psn_k', status: 'Current' },
    { row_id: 'E3', name: 'Lena', person: 'psn_l', status: 'Current' },
    { row_id: 'E4', name: 'Omar', person: 'psn_o', status: 'Left' },
    { row_id: 'E5', name: 'Ravi', person: 'psn_r', status: 'Current' },
    { row_id: 'E6', name: 'Lena', person: 'psn_c', status: 'Current' },
  ],
  'Job Assignment': [
    { employee: 'E1', job: 'Director', starts_on: '2024-01-01', ends_on: null },
    { employee: 'E2', job: 'Managing Director', starts_on: '2024-01-01', ends_on: null },
    { employee: 'E3', job: 'Director', starts_on: '2024-01-01', ends_on: '2026-11-27' },
    { employee: 'E4', job: 'Director', starts_on: '2024-01-01', ends_on: null },
    { employee: 'E5', job: 'Store Manager', starts_on: '2024-01-01', ends_on: null },
    { employee: 'E6', job: 'Chief Operating Officer', starts_on: '2024-01-01', ends_on: null },
  ],
}
let running = 0
const base = {
  list: async (table: string, args: { filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) => {
    if (running++) throw new Error('Base Table helpers must be awaited one at a time')
    await new Promise(r => setTimeout(r, 0))
    running--
    const start = args.limit_start ?? 0
    return (TABLES[table] ?? []).filter(r => (args.filters ?? []).every(([c, op, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v))).slice(start, start + (args.limit_page_length ?? 20))
  },
}

describe('who is signed in, on the org chart (#1438)', () => {
  it('passes the signed-in person and their roles from the read to the org chart', async () => {
    const { reads } = await import('./server')
    expect(await reads.signed_in({ user: 'psn_x', roles: ['System Manager'], baseTables: base })).toMatchObject({ admin: true, orgChart: true })
    expect(await reads.signed_in({ user: 'psn_a', baseTables: base })).toMatchObject({ admin: false, employees: ['E1'] })
  })

  it("finds the person's current Employee rows by their Person, and their own Chief Executive job today", async () => {
    expect(await signedIn(base, 'psn_a', [], '2026-11-28')).toEqual({ admin: false, orgChart: true, employees: ['E1'], chiefs: [{ id: 'E1', name: 'Asha', job: 'Director' }] })
  })

  it('gives a Store Manager no Chief Executive job, and someone with no Employee row nothing', async () => {
    expect(await signedIn(base, 'psn_r', [], '2026-11-28')).toEqual({ admin: false, orgChart: true, employees: ['E5'], chiefs: [] })
    expect(await signedIn(base, 'psn_nobody', [], '2026-11-28')).toEqual({ admin: false, orgChart: true, employees: [], chiefs: [] })
  })

  it("gives an administrator every Chief Executive today, the Managing Director first; not an ended job or a leaver's", async () => {
    const got = await signedIn(base, 'Administrator', [], '2026-11-28')
    expect(got.admin).toBe(true)
    expect(got.chiefs.map(c => c.id)).toEqual(['E2', 'E1', 'E6'])
    expect((await signedIn(base, 'psn_x', ['System Manager'], '2026-11-27')).chiefs.map(c => c.id)).toEqual(['E2', 'E1', 'E3', 'E6'])
  })

  it('knows no one on an instance without the org chart, but still knows an administrator', async () => {
    expect(await signedIn(undefined, 'psn_a', [], '2026-11-28')).toEqual({ admin: false, orgChart: false, employees: [], chiefs: [] })
    expect(await signedIn({ ...base, available: async () => false }, 'psn_a', ['System Manager'], '2026-11-28')).toEqual({ admin: true, orgChart: false, employees: [], chiefs: [] })
  })
})
