import { describe, expect, it } from 'vitest'
import { jobs } from './server'

// made-up store 9001, subcategories 101 (moved 20%) and 102 (moved 5%); Asha answered both on an earlier Run
const ctx = (moves: { group: Record<string, string>; before: string; after: string }[] | null) => {
  const told: { person: string; subject: string; body: string; email?: boolean; path?: string }[] = []
  const listed: unknown[] = []
  let result = ''
  return {
    told, listed, result: () => result,
    newLoad: moves && { moves: async () => moves },
    datasets: { active: async () => [{ store_code: '9001', subcategory_code: '101', subcategory_name: 'Girls Jean' }, { store_code: '9001', subcategory_code: '102', subcategory_name: 'Capri' }] },
    documents: { list: async (_t: string, args?: unknown) => { listed.push(args); return [
      { store_code: '9001', subcategory_name: 'Girls Jean', reviewer: 'Asha', forecast_month: '2026-12-01' },
      { store_code: '9001', subcategory_name: 'Capri', reviewer: 'Asha', forecast_month: '2026-12-01' }] } },
    people: { list: async () => [{ person: 'P1', full_name: 'Asha' }], notify: async (person: string, m: { subject: string; body: string }) => { told.push({ person, ...m }); return true } },
    setResult: (s: string) => { result = s },
  }
}

describe('carry_changes (#1419)', () => {
  it('tells the people who answered a subcategory that moved by more than 10%, in the app only', async () => {
    const c = ctx([
      { group: { forecast_month: '2026-12-01', store_code: '9001', subcategory_code: '101' }, before: '100000.00', after: '120000.00' },
      { group: { forecast_month: '2026-12-01', store_code: '9001', subcategory_code: '102' }, before: '100000.00', after: '105000.00' },
    ])
    await jobs.carry_changes(c)
    expect(c.told).toHaveLength(1)
    expect(c.told[0]).toMatchObject({ person: 'P1', subject: 'Feather Forecast moved for Girls Jean: answer again', email: false })
    expect(c.told[0].body).not.toContain('Capri')
    expect(c.result()).toMatch(/1 people told/)
  })

  it('does nothing on its daily run, with no new load', async () => {
    const c = ctx(null)
    await jobs.carry_changes(c)
    expect(c.told).toEqual([]); expect(c.listed).toEqual([])
  })
})
