import { describe, expect, it } from 'vitest'
import { jobs } from './server'

// made-up store 9001, Girls Jean (moved 20%) and Capri (moved 5%); Asha answered both on an earlier Run
const ctx = (moves: { group: Record<string, string>; before: string; after: string }[] | null) => {
  const told: { person: string; subject: string; body: string; email?: boolean; path?: string }[] = []
  const listed: unknown[] = []
  let result = ''
  return {
    told, listed, result: () => result,
    newLoad: moves && { moves: async () => moves },
    documents: { list: async (_t: string, args?: unknown) => { listed.push(args); return [
      { store_code: '9001', subcategory_name: 'Girls Jean', reviewer: 'Asha', forecast_month: '2026-12-01' },
      { store_code: '9001', subcategory_name: 'Capri', reviewer: 'Asha', forecast_month: '2026-12-01' }] } },
    // the live org chart: Omar is the Store Manager of Lakeside (LKS) today
    baseTables: { list: async (table: string) => ({
      Site: [{ row_id: 'LKS', name: 'Lakeside', operating_region: 'North' }],
      'Job Assignment': [{ employee: 'E3', job: 'Store Manager', site: 'LKS', section: null, starts_on: '2026-01-01', ends_on: null }],
      Employee: [{ row_id: 'E3', name: 'Omar' }] } as Record<string, Record<string, unknown>[]>)[table] ?? [] },
    people: { list: async () => [{ person: 'P1', full_name: 'Asha' }, { person: 'P3', full_name: 'Omar' }], notify: async (person: string, m: { subject: string; body: string }) => { told.push({ person, ...m }); return true } },
    setResult: (s: string) => { result = s },
  }
}

describe('carry_changes (#1419)', () => {
  it("tells the people who answered a subcategory that moved by more than 10%, and the store's Store Manager, in the app only", async () => {
    const c = ctx([
      { group: { forecast_month: '2026-12-01', store_code: '9001', store_short_code: 'LKS', subcategory_name: 'Girls Jean' }, before: '100000.00', after: '120000.00' },
      { group: { forecast_month: '2026-12-01', store_code: '9001', store_short_code: 'LKS', subcategory_name: 'Capri' }, before: '100000.00', after: '105000.00' },
    ])
    await jobs.carry_changes(c)
    expect(c.told.map(t => t.person).sort()).toEqual(['P1', 'P3'])
    expect(c.told[0]).toMatchObject({ subject: 'Feather Forecast moved for Girls Jean: answer again', email: false })
    expect(c.told.every(t => !t.body.includes('Capri'))).toBe(true)
    expect(c.result()).toMatch(/2 people told/)
  })

  it('does nothing on its daily run, with no new load', async () => {
    const c = ctx(null)
    await jobs.carry_changes(c)
    expect(c.told).toEqual([]); expect(c.listed).toEqual([])
  })
})
