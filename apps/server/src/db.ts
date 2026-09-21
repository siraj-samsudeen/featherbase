import postgres from 'postgres'
import { config } from './config'
import { AsyncLocalStorage } from 'node:async_hooks'

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
const transactions = new AsyncLocalStorage<Sql>()

// An app install composes normal metadata and document operations atomically.
// Nested begin calls remain savepoints; never swap the process-wide delegate.
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return sql.begin((tx) => transactions.run(tx as unknown as Sql, fn)) as Promise<T>
}

export function _setSqlDelegate(tx: TxSql | null) {
  delegate = (tx as unknown as Sql) ?? root
}

export function _getRootSql(): Sql {
  return root
}

export const sql: Sql = new Proxy((() => {}) as unknown as Sql, {
  apply(_target, _thisArg, args) {
    return ((transactions.getStore() ?? delegate) as unknown as (...a: unknown[]) => unknown)(...args)
  },
  get(_target, prop) {
    const current = transactions.getStore() ?? delegate
    if (current !== root) {
      if (prop === 'begin') {
        return (first: unknown, second?: unknown) => {
          const fn = (typeof first === 'function' ? first : second) as (s: TxSql) => unknown
          return (current as unknown as TxSql).savepoint(fn)
        }
      }
      // A sandboxed suite must not be able to close the shared pool.
      if (prop === 'end') return async () => {}
    }
    const value = (current as never)[prop] as unknown
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(current) : value
  },
})
