import postgres from 'postgres'
import { config } from './config'
import { AsyncLocalStorage } from 'node:async_hooks'
import { qualifyPlatformSql } from './platform-schema'

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

function qualifiedClient(client: Sql): Sql {
  return new Proxy((() => {}) as unknown as Sql, {
  apply(_target, _thisArg, args) {
    if (Array.isArray(args[0]) && Object.prototype.hasOwnProperty.call(args[0], 'raw')) {
      const strings = args[0] as unknown as TemplateStringsArray
      const qualified = strings.map(qualifyPlatformSql) as unknown as TemplateStringsArray
      Object.defineProperty(qualified, 'raw', { value: qualified })
      return (client as unknown as (...a: unknown[]) => unknown)(qualified, ...args.slice(1))
    }
    return (client as unknown as (...a: unknown[]) => unknown)(...args)
  },
  get(_target, prop) {
    if (prop === 'unsafe') {
      return (query: string, parameters?: unknown[]) =>
        (client.unsafe as unknown as (q: string, p?: unknown[]) => unknown)(
          qualifyPlatformSql(query), parameters,
        )
    }
    const value = (client as never)[prop] as unknown
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value
  },
  })
}

export const sql: Sql = new Proxy((() => {}) as unknown as Sql, {
  apply(_target, _thisArg, args) {
    const current = qualifiedClient(transactions.getStore() ?? delegate)
    return (current as unknown as (...a: unknown[]) => unknown)(...args)
  },
  get(_target, prop) {
    const current = transactions.getStore() ?? delegate
    if (prop === 'begin') {
      return (first: unknown, second?: unknown) => {
        const fn = (typeof first === 'function' ? first : second) as (s: TxSql) => unknown
        const run = (tx: TxSql) => fn(qualifiedClient(tx as unknown as Sql) as unknown as TxSql)
        if (current !== root) return (current as unknown as TxSql).savepoint(run)
        return typeof first === 'function'
          ? root.begin(run)
          : root.begin(first as never, run)
      }
    }
    if (current !== root && prop === 'end') return async () => {}
    return (qualifiedClient(current) as never)[prop]
  },
})
