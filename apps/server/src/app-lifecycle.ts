import { AsyncLocalStorage } from 'node:async_hooks'
import postgres from 'postgres'
import { config } from './config'
import { ignoreNotice, sql } from './db'
import { AppError } from './errors'

// A separate pool holds the operation-length lock: document work needs its
// ordinary pool after COMMIT for assignment rules and after_commit hooks.
// Taking both connections from one pool can deadlock under saturation.
const locks = postgres(config.databaseUrl, {
  max: 10, onnotice: ignoreNotice, prepare: false,
  // CLI migrations also use document operations; released lock connections
  // must not keep those short-lived processes alive after their main pool ends.
  idle_timeout: 1,
})
const scope = new AsyncLocalStorage<{ exclusive: boolean; provisioning?: string }>()
const clientVersion = new AsyncLocalStorage<Map<string, string>>()
export const activeApps = new Set<string>()

export function withAppClientVersion<T>(version: string, fn: () => Promise<T>) {
  const identities = new Map<string, string>()
  for (const entry of version ? version.split(',') : []) {
    const identity = entry.trim()
    const match = /^([a-z][a-z0-9_]{0,30})@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(identity)
    if (!match || identities.has(match[1]))
      throw new AppError('ValidationError', 'Expected distinct application@version identities; reload the client')
    identities.set(match[1], identity)
  }
  return clientVersion.run(identities, fn)
}

/** #559: platform-internal work done on an app's behalf (its scope provider)
 *  runs as that app's verified installed version, whatever the request named
 *  for it. The request's identities for every other app are kept. */
export function withAppIdentity<T>(app: string, version: string, fn: () => Promise<T>) {
  const supplied = clientVersion.getStore()
  // A trusted in-process call has no HTTP identities to correct.
  if (supplied === undefined) return fn()
  const identities = new Map(supplied)
  identities.set(app, `${app}@${version}`)
  return clientVersion.run(identities, fn)
}

// Identity discovery grants no data access. Never infer a request's version here.
export async function activeRuntimeVersions(): Promise<string[]> {
  const rows = await sql`select name, package_version from installed_app
    where runtime_package and enabled and not activation_pending and package_version is not null
    order by name`
  return rows.filter(row => activeApps.has(row.name)).map(row => `${row.name}@${row.package_version}`)
}

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

/** #625 (E5): the installed version and artifact an app is serving now. An
 *  outbound read records it before its handler runs outside every lock. */
export async function servingIdentity(app: string): Promise<string> {
  const [row] = await sql`select package_version, artifact_digest from installed_app where name = ${app}`
  return `${String(row?.package_version)}:${String(row?.artifact_digest)}`
}

/** #625 (E5): after an outbound handler ran outside every lock, is its app
 *  still enabled, active and serving the version it was authorized under?
 *  Checked under the shared lifecycle lock, before anything it produced is
 *  answered; `then` (its view records) runs under that same lock, only when
 *  the check passes, so nothing is written for an app changed meanwhile. */
export function assertStillServing(app: string, identity: string, then: () => Promise<void>): Promise<void> {
  return appOperation(async () => {
    const [installed] = await sql`select enabled, activation_pending from installed_app where name = ${app}`
    if (!installed?.enabled || installed.activation_pending || !activeApps.has(app))
      throw new AppError('PermissionError', `App ${app} is disabled or unavailable`)
    if (await servingIdentity(app) !== identity)
      throw new AppError('ConflictError', `App ${app} was upgraded while this read ran. Reload its current client and retry`)
    await then()
  })
}

export function provisionApp<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return appOperation(() => scope.run({ exclusive: true, provisioning: name }, fn), true)
}

export async function assertAppAvailable(name: string, exactClientIdentity = false): Promise<void> {
  if (!name.includes('.')) return
  const owner = name.split('.')[0]
  if (scope.getStore()?.provisioning === owner) return
  const [installed] = await sql`select enabled, activation_pending, package_version, migration_ledger from installed_app where name = ${owner}`
  if (!installed?.enabled || installed.activation_pending || !activeApps.has(owner))
    throw new AppError('PermissionError', `App ${owner} is disabled or unavailable`)
  const supplied = clientVersion.getStore()
  // The declared boundary requires an exact HTTP identity even on first install.
  // Trusted in-process calls have no HTTP client snapshot; legacy CRUD is unchanged.
  if (exactClientIdentity && supplied !== undefined && supplied.get(owner) !== `${owner}@${installed.package_version}`)
    throw new AppError('PermissionError', 'Application access refused')
  if (supplied !== undefined && (installed.migration_ledger as unknown[]).length > 0 &&
      supplied.get(owner) !== `${owner}@${installed.package_version}`)
    throw new AppError('ConflictError', `App ${owner} was upgraded. Reload its current client and retry with the installed application version`)
}
