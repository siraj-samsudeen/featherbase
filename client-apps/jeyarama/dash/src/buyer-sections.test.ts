// #1246: what the platform suite has no cheap way to reach, on an in-memory stand-in — the Buyer Section changing
// while a move waits for its lock (the platform test runs each test in one transaction, so it cannot hold
// the lock from a second session), malformed requests, and the rarer shapes of the data. Made-up people
// and codes.
import { describe, expect, it } from 'vitest'
import { buyerSectionActions, buyerSectionReads } from './buyer-sections.ts'
import type { ActionContext, ReadContext } from './my-sections.ts'
import { istToday } from './report.ts'

type Row = Record<string, unknown>
const today = istToday()
const later = '2999-01-01'

const buyerSection = (row_id: string, over: Row = {}): Row => ({ row_id, name: row_id, operating_region: 'East', buyer: null, category_head: 'E1', starts_on: '2026-01-01', ends_on: null, ...over })
const move = (row_id: string, over: Row = {}, about: Row = {}): Row => ({ row_id, maker: 'hema', state: 'Pending', decision_reason: null, created_at: `${today}T00:00:00Z`, decided_at: null,
  about: { kind: 'buyer_section', subcategory: 'C1', subcategory_name: 'Sarees', region: 'East', from_section: '', from: '', to_section: 'BS1', to: 'BS1', maker_name: 'Hema', link: '', ...about }, ...over })

function world(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    Employee: [{ row_id: 'E1', name: 'Hema', status: 'Current', person: 'hema' }, { row_id: 'E9', name: 'Elan', status: 'Current', person: 'elan' }],
    'Merchandise Assignment': [{ row_id: 'MA1', employee: 'E1', responsibility: 'Category head', subcategory: 'C1', category: null, subdivision: null, division: null, operating_region: 'East', starts_on: '2026-01-01', ends_on: null }],
    Subcategory: [{ row_id: 'C1', subcategory: 'Sarees', category: 'CAT1', subdivision: 'SUB1', division: 'DIV1', subcategory_type: 'Merchandise' }],
    'Buyer Section': [buyerSection('BS1')],
    'Buyer Section Subcategory': [],
    ...over,
  }
}

function context(tables: Record<string, Row[]>, { user = 'hema', payload, proposals = [], onSerialize }: { user?: string; payload?: unknown; proposals?: Row[]; onSerialize?: () => void } = {}) {
  const sent: { call: string; request: unknown }[] = []
  const matches = (row: Row, [column, op, value]: [string, string, unknown]) =>
    op === 'in' ? (value as unknown[]).includes(row[column]) : (row[column] ?? null) === value
  const answer = (call: string) => async (request: unknown) => { sent.push({ call, request }); return { row_id: 'new', state: 'Pending' } }
  const ctx = {
    user, payload, roles: [], settings: {},
    reject(message: string): never { throw new Error(message) },
    baseTables: {
      available: async () => true,
      async list(table: string, args: { filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) {
        const rows = (tables[table] ?? []).filter(row => (args.filters ?? []).every(filter => matches(row, filter))).map(row => ({ ...row }))
        const start = args.limit_start ?? 0
        return rows.slice(start, start + (args.limit_page_length ?? 500))
      },
    },
    changeProposals: {
      async list(filter: { ids?: string[]; states?: string[]; makers?: string[]; start?: number; limit?: number } = {}) {
        const rows = proposals.filter(p => (!filter.ids || filter.ids.includes(String(p.row_id))) && (!filter.states || filter.states.includes(String(p.state)))
          && (!filter.makers || filter.makers.includes(String(p.maker))))
        const start = filter.start ?? 0
        return rows.slice(start, start + (filter.limit ?? 200))
      },
      mayDecide: async () => true,
      lockRow: async () => {},
      serialize: async () => onSerialize?.(),
      propose: answer('propose'), approve: answer('approve'), needsFreshReview: answer('needsFreshReview'),
    },
  }
  return { ctx: ctx as unknown as ActionContext & ReadContext, sent }
}

describe('a move whose Buyer Section changes while it waits for the lock', () => {
  const asked = { subcategory: 'C1', to_section: 'BS1' }
  it('is refused when the Buyer Section moves to another region', async () => {
    const tables = world()
    const { ctx } = context(tables, { payload: asked, onSerialize: () => { tables['Buyer Section'][0].operating_region = 'West' } })
    await expect(buyerSectionActions.move_buyer_subcategory(ctx)).rejects.toThrow(/just changed/)
  })

  it('is refused when the Buyer Section closes', async () => {
    const tables = world()
    const { ctx } = context(tables, { payload: asked, onSerialize: () => { tables['Buyer Section'][0].ends_on = '2026-01-02' } })
    await expect(buyerSectionActions.move_buyer_subcategory(ctx)).rejects.toThrow(/your own Buyer Sections/)
  })
})

describe('asking for a move', () => {
  it('refuses a request that names no Buyer Section or no subcategory', async () => {
    await expect(buyerSectionActions.move_buyer_subcategory(context(world()).ctx)).rejects.toThrow(/your own Buyer Sections/)
    await expect(buyerSectionActions.move_buyer_subcategory(context(world(), { payload: { to_section: 'BS1', subcategory: 7 } }).ctx)).rejects.toThrow(/subcategory from the list/)
  })

  it('a head of one subcategory puts it in their Buyer Section; a Buyer Section in another region set to take it later is no bar, nor are other changes', async () => {
    const tables = world({ 'Buyer Section': [buyerSection('BS1'), buyerSection('BS-W', { operating_region: 'West' })],
      'Buyer Section Subcategory': [{ row_id: 'L-W', buyer_section: 'BS-W', subcategory: 'C1', starts_on: later, ends_on: null }] })
    // More than a page of other open changes: every page is read before the move is allowed.
    const others = Array.from({ length: 500 }, (_, i) => ({ row_id: `X${i}`, maker: 'someone', state: 'Pending', about: { kind: 'section' }, created_at: `${today}T00:00:00Z` }))
    const { ctx, sent } = context(tables, { payload: { subcategory: 'C1', to_section: 'BS1' }, proposals: others })
    expect(await buyerSectionActions.move_buyer_subcategory(ctx)).toMatchObject({ state: 'Pending' })
    expect(sent).toEqual([expect.objectContaining({ call: 'propose', request: expect.objectContaining({ row: null, changes: { buyer_section: 'BS1', subcategory: 'C1' } }) })])
  })
})

describe('what a head and the master data team see', () => {
  it('a Buyer Section that buys nothing yet; a put into a Buyer Section is shown from nowhere; a decision with no date is not recent', async () => {
    const decided = [move('P1', { state: 'Rejected', decision_reason: 'No', decided_at: `${today}T01:00:00Z` }), move('P2', { state: 'Rejected', decided_at: null })]
    const answer = await buyerSectionReads.buyer_sections(context(world(), { proposals: decided }).ctx)
    expect(answer.buyerSections).toEqual([{ id: 'BS1', name: 'BS1', region: 'East', buyer: null, subcategories: [] }])
    expect(answer.decided).toEqual([expect.objectContaining({ id: 'P1', from: null, state: 'Rejected', reason: 'No' })])
  })

  it('the approvals name a put as coming from nowhere', async () => {
    const approvals = await buyerSectionReads.buyer_section_approvals(context(world(), { user: 'elan', proposals: [move('P1')] }).ctx)
    expect(approvals).toEqual([expect.objectContaining({ id: 'P1', who_code: 'E1', from: null, from_id: null, to_id: 'BS1' })])
  })
})

describe('deciding a move', () => {
  it('refuses a request that names no change', async () => {
    await expect(buyerSectionActions.decide_buyer_section(context(world(), { user: 'elan' }).ctx)).rejects.toThrow(/no longer waiting/)
  })

  it('goes stale when the person who asked is no longer on the staff list', async () => {
    const tables = world({ Employee: [{ row_id: 'E9', name: 'Elan', status: 'Current', person: 'elan' }] })
    const { ctx, sent } = context(tables, { user: 'elan', payload: { proposal: 'P1', decision: 'approve' }, proposals: [move('P1')] })
    await buyerSectionActions.decide_buyer_section(ctx)
    expect(sent).toEqual([expect.objectContaining({ call: 'needsFreshReview' })])
  })
})
