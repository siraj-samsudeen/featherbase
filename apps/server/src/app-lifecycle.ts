import { AsyncLocalStorage } from 'node:async_hooks'
import postgres from 'postgres'
import { config } from './config'
import { sql } from './db'
import { AppError } from './errors'

// A separate pool holds the operation-length lock: document work needs its
// ordinary pool after COMMIT for assignment rules and after_commit hooks.
// Taking both connections from one pool can deadlock under saturation.
const locks = postgres(config.databaseUrl, {
  max: 10, onnotice: () => {}, prepare: false,
  // CLI migrations also use document operations; released lock connections
  // must not keep those short-lived processes alive after their main pool ends.
  idle_timeout: 1,
})
const scope = new AsyncLocalStorage<{ exclusive: boolean; provisioning?: string }>()
export const activeApps = new Set<string>()

export async function appOperation<T>(fn: () => Promise<T>, exclusive = false): Promise<T> {
  const current = scope.getStore()
  if (current) {
    if (exclusive && !current.exclusive)
      throw new AppError('ConflictError', 'An app lifecycle change cannot run inside a data operation')
    return fn()
  }
  return locks.begin(async (tx) => {
    if (exclusive) await tx`select pg_advisory_xact_lock(296, 1)`
    else await tx`select pg_advisory_xact_lock_shared(296, 1)`
    return scope.run({ exclusive }, fn)
  }) as Promise<T>
}

export function provisionApp<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return appOperation(() => scope.run({ exclusive: true, provisioning: name }, fn), true)
}

export async function assertAppAvailable(name: string): Promise<void> {
  if (!name.includes('.')) return
  const owner = name.split('.')[0]
  if (scope.getStore()?.provisioning === owner) return
  const [installed] = await sql`select enabled from installed_app where name = ${owner}`
  if (!installed?.enabled || !activeApps.has(owner))
    throw new AppError('PermissionError', `App ${owner} is disabled or unavailable`)
}
