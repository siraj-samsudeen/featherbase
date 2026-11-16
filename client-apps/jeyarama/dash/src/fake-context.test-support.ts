// An in-memory stand-in for the platform's base-table and change-proposal helpers, shared by the
// manager-area tests (#1223). Made-up stores and people only. Not part of the backend inventory:
// nothing the server imports reaches it.
import type { ActionContext, ReadContext } from './my-sections.ts'
import { BASE_TABLES } from './my-sections.ts'
import { istToday } from './report.ts'

export type Row = Record<string, unknown>
export const today = istToday()
export const later = '2999-01-01'

export function matches(row: Row, [column, op, value]: [string, string, unknown]) {
  const cell = row[column]
  if (op === '=') return (cell ?? null) === value
  if (op === '!=') return (cell ?? null) !== value
  if (op === 'in') return (value as unknown[]).includes(cell)
  const needle = String(value).replaceAll('%', '').toLowerCase()
  return String(cell ?? '').toLowerCase().includes(needle)
}

export interface Options { user?: string; payload?: unknown; roles?: string[]; proposals?: Row[]; route?: 'people' | 'none'; reads?: (table: string, call: number) => Row[] | undefined }

/** The tables as given, read with the filters the code uses. `reads` may answer a table's nth read
 *  differently, to stand in for a row that changed between a read and the read under lock. */
export function context(tables: Record<string, Row[]>, { user = 'sm', payload, roles = [], proposals = [], route = 'people', reads }: Options = {}) {
  const sent: { call: string; request: unknown }[] = []
  const locked: [string, string][] = []
  const count = new Map<string, number>()
  const answer = (call: string) => async (first: unknown, second?: unknown) => {
    sent.push({ call, request: second ?? first })
    return { row_id: 'new', maker: user, state: 'Pending', about: null, decision_reason: null, changes: [], created_at: `${today}T00:00:00Z`, decided_at: null, route: { people: route === 'none' ? [] : ['mgr'], roles: [] } }
  }
  const ctx = {
    user, payload, settings: { linked_tables: JSON.stringify(BASE_TABLES) }, roles,
    reject(message: string): never { throw new Error(message) },
    baseTables: {
      // A Table is installed when the test's tables name it (#1246's Buyer Sections are optional).
      available: async (table: string) => table in tables,
      async list(table: string, args: { filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) {
        const n = (count.get(table) ?? 0) + 1
        count.set(table, n)
        const source = reads?.(table, n) ?? tables[table] ?? []
        const rows = source.filter(row => (args.filters ?? []).every(filter => matches(row, filter)))
        const start = args.limit_start ?? 0
        return rows.slice(start, start + (args.limit_page_length ?? 500))
      },
    },
    changeProposals: {
      async list(filter: { ids?: string[]; states?: string[]; start?: number; limit?: number } = {}) {
        const rows = proposals.filter(p => (!filter.ids || filter.ids.includes(String(p.row_id))) && (!filter.states || filter.states.includes(String(p.state))))
        const start = filter.start ?? 0
        return rows.slice(start, start + (filter.limit ?? 200))
      },
      mayDecide: async () => true,
      modeOf: async () => 'Approve first',
      routeFor: async (_maker: string, approvers: { people: string[] }) => (route === 'none' ? null : { people: approvers.people, roles: [] }),
      lockRow: async (table: string, id: string) => { locked.push([table, id]) },
      serialize: async () => {},
      propose: answer('propose'), approve: answer('approve'), reject: answer('reject'), needsFreshReview: answer('needsFreshReview'), withdraw: answer('withdraw'), confirm: answer('confirm'), undo: answer('undo'),
    },
  }
  return { ctx: ctx as unknown as ActionContext & ReadContext, sent, locked }
}

/** A made-up store, Lakeside: managers of each kind, staff, a department, merchandise heads and buyers. */
export const job = (row_id: string, employee: string, name: string, over: Row = {}) => ({ row_id, employee, job: name, site: 'LKS', section: null, floor: null, reports_to: 'E-SM', starts_on: '2026-01-01', ends_on: null, ...over })
export const assignment = (row_id: string, employee: string, responsibility: string, over: Row = {}) =>
  ({ row_id, employee, responsibility, division: null, subdivision: null, category: null, subcategory: null, operating_region: null, starts_on: '2026-01-01', ends_on: null, ...over })
export const sub = (row_id: string, name: string, over: Row = {}) => ({ row_id, subcategory: name, category: 'CAT1', subdivision: 'SUB1', division: 'DIV1', subcategory_type: 'Merchandise', ...over })

export function world(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    Employee: [
      { row_id: 'E-SM', name: 'Sundar', status: 'Current', person: 'sm' },
      { row_id: 'E-FM', name: 'Farida', status: 'Current', person: 'fm' },
      { row_id: 'E-DM', name: 'Devi', status: 'Current', person: 'dm' },
      { row_id: 'E-TL', name: 'Tara', status: 'Current', person: 'tl' },
      { row_id: 'E-ST', name: 'Sam', status: 'Current', person: 'st' },
      { row_id: 'E-ST2', name: '', status: 'Current', person: 'st2' },
      { row_id: 'E-CH', name: 'Chitra', status: 'Current', person: 'ch' },
      { row_id: 'E-BUY', name: 'Bala', status: 'Current', person: 'buy' },
      { row_id: 'E-BUY2', name: 'Bhanu', status: 'Current', person: 'buy2' },
      { row_id: 'E-GONE', name: 'Gopal', status: 'Left', person: 'gone' },
      { row_id: 'E-NOJOB', name: 'Nila', status: 'Current', person: 'nojob' },
    ],
    'Job Assignment': [
      job('J-SM', 'E-SM', 'Store Manager', { reports_to: null }),
      job('J-FM', 'E-FM', 'Floor Manager', { floor: 'F1' }),
      job('J-DM', 'E-DM', 'Department Manager'),
      job('J-TL', 'E-TL', 'Team Leader', { section: 'S1', floor: 'F1' }),
      job('J-ST', 'E-ST', 'Staff', { section: 'S1', floor: 'F1', reports_to: 'E-TL' }),
      job('J-ST2', 'E-ST2', 'Staff', { floor: 'F1' }),
      job('J-OLD', 'E-ST', 'Staff', { section: 'S2', starts_on: '2020-01-01', ends_on: '2020-12-31' }),
    ],
    Site: [{ row_id: 'LKS', name: 'Lakeside' }],
    'Store Floor': [{ row_id: 'F1', name: 'Ground', site: 'LKS' }, { row_id: 'F2', name: '', site: 'LKS' }],
    Section: [
      { row_id: 'S1', name: 'Ladies', site: 'LKS', floor: 'F1', status: 'Active' },
      { row_id: 'S2', name: 'Kids', site: 'LKS', floor: 'F2', status: 'Active' },
      { row_id: 'S3', name: 'Counter', site: 'LKS', floor: null, status: 'Active' },
      { row_id: 'S4', name: 'Closed', site: 'LKS', floor: 'F1', status: 'Inactive' },
    ],
    Department: [{ row_id: 'D1', department_id: 'D1', store: 'LKS', name: 'Womens', manager: 'E-DM', starts_on: '2026-01-01', ends_on: null }],
    'Department Section': [{ row_id: 'L1', store: 'LKS', department: 'D1', section: 'S2', starts_on: '2026-01-01', ends_on: null }],
    'Section Subcategory': [
      { row_id: 'P1', section_subcategory_id: 'P1', store: 'LKS', section: 'S1', subcategory: 'C1', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'P2', section_subcategory_id: 'P2', store: 'LKS', section: 'S2', subcategory: 'C9', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'P3', section_subcategory_id: 'P3', store: 'LKS', section: 'S1', subcategory: 'C3', starts_on: later, ends_on: null },
    ],
    Subcategory: [
      sub('C1', 'Sarees'), sub('C2', 'Silk'), sub('C3', 'Lehenga'),
      sub('C4', 'Belts', { category: 'CAT2', subdivision: 'SUB2' }), sub('C5', 'Toys', { category: 'CAT3', subdivision: 'SUB3', division: 'DIV2' }),
      sub('C8', 'Bags', { subcategory_type: 'Consumable' }), sub('C9', ''),
    ],
    'Merchandise Assignment': [
      assignment('M-CH', 'E-CH', 'Category head', { category: 'CAT1', operating_region: 'East' }),
      assignment('M-CH2', 'E-CH', 'Subdivision head', { subdivision: 'SUB2' }),
      assignment('M-CH3', 'E-CH', 'Division head', { division: 'DIV2' }),
      assignment('M-CH4', 'E-CH', 'Category head', { subcategory: 'C4' }),
      assignment('M-CH5', 'E-CH', 'Merchandising head'),
      assignment('M-B1', 'E-BUY', 'Buyer', { subcategory: 'C1' }),
      assignment('M-B2', 'E-BUY2', 'Buyer', { category: 'CAT1', operating_region: 'West' }),
      assignment('M-B3', 'E-BUY', 'Buyer', { subdivision: 'SUB2' }),
      assignment('M-B4', 'E-BUY', 'Buyer', { division: 'DIV2', operating_region: 'East' }),
      assignment('M-B5', 'E-BUY', 'Buyer'),
      assignment('M-B6', 'E-GONE', 'Buyer', { subcategory: 'C2' }),
    ],
    ...over,
  }
}
