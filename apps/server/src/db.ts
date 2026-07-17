import postgres from 'postgres'
import { config } from './config'

export type Sql = postgres.Sql<Record<string, never>>
export type TxSql = postgres.TransactionSql<Record<string, never>>

const root: Sql = postgres(config.databaseUrl, {
  onnotice: () => {},
  // META-004: schema sync ALTERs tables at runtime. Cached prepared
  // statements on warm pooled connections then fail with PG 0A000
  // ("cached plan must not change result type") on their next use, so
  // statement caching must stay off in a system that changes its own DDL.
  prepare: false,
})

// Test sandbox seam (Ecto SQL Sandbox pattern): the exported `sql` delegates
// to the real pool by default; a test harness can swap in a transaction
// handle so every query in the process runs inside one transaction that the
// harness rolls back. While sandboxed, app-level `sql.begin` calls must
// become SAVEPOINTs — a real BEGIN/COMMIT on the sandbox connection would
// commit the outer test transaction.
let delegate: Sql = root

export function _setSqlDelegate(tx: TxSql | null) {
  delegate = (tx as unknown as Sql) ?? root
}

export function _getRootSql(): Sql {
  return root
}

export const sql: Sql = new Proxy((() => {}) as unknown as Sql, {
  apply(_target, _thisArg, args) {
    return (delegate as unknown as (...a: unknown[]) => unknown)(...args)
  },
  get(_target, prop) {
    if (delegate !== root) {
      if (prop === 'begin') {
        return (first: unknown, second?: unknown) => {
          const fn = (typeof first === 'function' ? first : second) as (s: TxSql) => unknown
          return (delegate as unknown as TxSql).savepoint(fn)
        }
      }
      // A sandboxed suite must not be able to close the shared pool.
      if (prop === 'end') return async () => {}
    }
    const value = (delegate as never)[prop] as unknown
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(delegate) : value
  },
})
