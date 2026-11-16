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

export interface Options { user?: string; payload?: unknown; proposals?: Row[]; route?: 'people' | 'none'; reads?: (table: string, call: number) => Row[] | undefined }

/** The tables as given, read with the filters the code uses. `reads` may answer a table's nth read
 *  differently, to stand in for a row that changed between a read and the read under lock. */
export function context(tables: Record<string, Row[]>, { user = 'sm', payload, proposals = [], route = 'people', reads }: Options = {}) {
  const sent: { call: string; request: unknown }[] = []
  const locked: [string, string][] = []
  const count = new Map<string, number>()
  const answer = (call: string) => async (first: unknown, second?: unknown) => {
    sent.push({ call, request: second ?? first })
    return { row_id: 'new', maker: user, state: 'Pending', about: null, decision_reason: null, changes: [], created_at: `${today}T00:00:00Z`, decided_at: null, route: { people: route === 'none' ? [] : ['mgr'], roles: [] } }
  }
  const ctx = {
    user, payload, settings: { linked_tables: JSON.stringify(BASE_TABLES) }, roles: [],
    reject(message: string): never { throw new Error(message) },
    baseTables: {
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
      async list(filter: { states?: string[]; start?: number; limit?: number } = {}) {
        const rows = proposals.filter(p => !filter.states || filter.states.includes(String(p.state)))
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
