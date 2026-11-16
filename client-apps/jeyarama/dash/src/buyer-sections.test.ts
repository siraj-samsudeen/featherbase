// #1246: what the platform suite has no cheap way to reach — the desk changing while a move waits for its
// lock. The platform test runs each test in one transaction, so it cannot hold the lock from a second
// session; here the stand-in's serialize changes the desk at that moment. Made-up people and codes.
import { describe, expect, it } from 'vitest'
import { buyerSectionActions } from './buyer-sections.ts'
import type { ActionContext } from './my-sections.ts'

type Row = Record<string, unknown>

function context(onSerialize: (desk: Row) => void) {
  const desk: Row = { row_id: 'BS-SALWAR', name: 'Salwar', operating_region: 'East', buyer: null, category_head: 'E1', starts_on: '2026-01-01', ends_on: null }
  const tables: Record<string, Row[]> = {
    Employee: [{ row_id: 'E1', name: 'Hema', status: 'Current', person: 'hema' }],
    'Buyer Section': [desk],
  }
  const matches = (row: Row, [column, op, value]: [string, string, unknown]) =>
    op === 'in' ? (value as unknown[]).includes(row[column]) : (row[column] ?? null) === value
  return {
    user: 'hema', roles: [], settings: {}, payload: { subcategory: 'C1', to_section: 'BS-SALWAR' },
    reject(message: string): never { throw new Error(message) },
    baseTables: {
      async list(table: string, args: { filters?: [string, string, unknown][] }) {
        return (tables[table] ?? []).filter(row => (args.filters ?? []).every(filter => matches(row, filter))).map(row => ({ ...row }))
      },
    },
    changeProposals: {
      list: async () => [],
      lockRow: async () => {},
      serialize: async () => onSerialize(desk),
    },
  } as unknown as ActionContext
}

describe('a move whose desk changes while it waits for the lock', () => {
  it('is refused when the desk moves to another region', async () => {
    await expect(buyerSectionActions.move_buyer_subcategory(context(desk => { desk.operating_region = 'West' }))).rejects.toThrow(/just changed/)
  })

  it('is refused when the desk closes', async () => {
    await expect(buyerSectionActions.move_buyer_subcategory(context(desk => { desk.ends_on = '2026-01-02' }))).rejects.toThrow(/your own Buyer Sections/)
  })
})
