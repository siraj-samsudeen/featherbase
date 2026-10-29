import postgres from 'postgres'
import { config } from './config'
import { AsyncLocalStorage } from 'node:async_hooks'
import { qualifyPlatformSql } from './platform-schema'

export type Sql = postgres.Sql<Record<string, never>>
export type TxSql = postgres.TransactionSql<Record<string, never>>

/** Server NOTICEs (an `if exists` that found nothing, …) are not worth a log line. */
export function ignoreNotice(): void {}

// #541: a whole-number (Int) column is a bigint, and the client hands bigint
// back as text by default, so a saved 13 read back as '13'. Parse it as a
// number; a value past the safe-integer range stays text rather than
// silently losing digits (a save can't write one — Int is bounded there).
// Currency (numeric) stays text on purpose: its precision exceeds a float.
export const BIGINT_AS_NUMBER = {
  to: 20,
  from: [20],
  serialize: (value: unknown) => String(value),
  parse: (text: string) => {
    const n = Number(text)
    return Number.isSafeInteger(n) ? n : text
  },
}

// The custom type widens the client's generic; the app's Sql type stays the plain one.
const root = postgres(config.databaseUrl, {
  onnotice: ignoreNotice,
  types: { bigint: BIGINT_AS_NUMBER },
  // META-004: schema sync ALTERs tables at runtime. Cached prepared
  // statements on warm pooled connections then fail with PG 0A000
  // ("cached plan must not change result type") on their next use, so
  // statement caching must stay off in a system that changes its own DDL.
  prepare: false,
}) as unknown as Sql

// Test sandbox seam (Ecto SQL Sandbox pattern): the exported `sql` delegates
// to the real pool by default; a test harness can swap in a transaction
// handle so every query in the process runs inside one transaction that the
// harness rolls back. While sandboxed, app-level `sql.begin` calls must
// become SAVEPOINTs — a real BEGIN/COMMIT on the sandbox connection would
// commit the outer test transaction.
let delegate: Sql = root
const transactions = new AsyncLocalStorage<Sql>()

// #448: work to run once the outermost app transaction has ended, committed
// or rolled back. Until then other connections still read what was there
// before, so a cache cleared inside the transaction can be refilled with it.
const endings = new AsyncLocalStorage<(() => void)[]>()

/** Run `fn` once the transaction this call is inside has ended (and so its
 *  change is visible to every connection, or gone). Outside one, nothing is
 *  pending and `fn` is not run. */
export function whenTransactionEnds(fn: () => void): void {
  endings.getStore()?.push(fn)
}

async function endingTransaction<T>(begin: () => Promise<T>): Promise<T> {
  if (endings.getStore()) return begin()
  const pending: (() => void)[] = []
  try {
    return await endings.run(pending, begin)
  } finally {
    for (const fn of pending) fn()
  }
}

// An app install composes normal metadata and document operations atomically.
// Nested begin calls remain savepoints; never swap the process-wide delegate.
// Like `sql.begin`, work deferred with whenTransactionEnds runs only once the
// outermost transaction has ended.
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const current = transactions.getStore() ?? delegate
  const run = (tx: TxSql) => transactions.run(tx as unknown as Sql, fn)
  return endingTransaction(() => (current !== root ? (current as unknown as TxSql).savepoint(run) : root.begin(run)) as Promise<T>)
}

/** The current transaction WITHOUT platform-name
 *  qualification: for SQL that must run as written, such as the .sql
 *  migrations (the baseline names everything in full). */
export function _getUnqualifiedSql(): Sql {
  const tx = transactions.getStore()
  // Outside a transaction a `set local search_path` would not reach the next
  // statement, which the pool may run on another connection.
  if (!tx) throw new Error('_getUnqualifiedSql needs a transaction (withTransaction)')
  return tx
}

/** #625: is this async context inside an app transaction? While it is, `sql`
 *  runs on that transaction's connection, holding its locks; an outbound
 *  read's handler must see false. */
export function inAppTransaction(): boolean {
  return transactions.getStore() !== undefined
}

export function _setSqlDelegate(tx: TxSql | null) {
  delegate = (tx as unknown as Sql) ?? root
}

export function _getRootSql(): Sql {
  return root
}

function qualifiedClient(client: Sql): Sql {
  // The client itself is the proxy target (it is callable); every call and
  // property read goes through the traps below.
  return new Proxy(client, {
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
      // No caller passes begin() options (an isolation level): only the callback form.
      return (fn: (s: TxSql) => unknown) => {
        const run = (tx: TxSql) => fn(qualifiedClient(tx as unknown as Sql) as unknown as TxSql)
        if (current !== root) return endingTransaction(() => (current as unknown as TxSql).savepoint(run))
        return endingTransaction(() => root.begin(run))
      }
    }
    if (current !== root && prop === 'end') return async () => {}
    return (qualifiedClient(current) as never)[prop]
  },
})
