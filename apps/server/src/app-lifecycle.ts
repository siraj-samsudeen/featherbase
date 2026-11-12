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
/** #1211: an agent's call through /mcp speaks each app's installed version,
 *  read at the check itself (under the lifecycle lock), never a snapshot. */
const INSTALLED = Symbol('installed application versions')
const clientVersion = new AsyncLocalStorage<Map<string, string> | typeof INSTALLED>()
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

/** #1211: an agent has no loaded client to go stale, so its calls through
 *  /mcp (marked in-process by runAsAgent, never by a header) are checked
 *  against each app's installed version. Browser requests keep their header. */
export function withInstalledAppVersions<T>(fn: () => Promise<T>) {
  return clientVersion.run(INSTALLED, fn)
}

/** #559: platform-internal work done on an app's behalf (its scope provider)
 *  runs as that app's verified installed version, whatever the request named
 *  for it. The request's identities for every other app are kept. */
export function withAppIdentity<T>(app: string, version: string, fn: () => Promise<T>) {
  const supplied = clientVersion.getStore()
  // A trusted in-process call has no HTTP identities to correct; an agent's
  // already speaks every app's installed version.
  if (supplied === undefined || supplied === INSTALLED) return fn()
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

export interface DeployLockWait { attemptSeconds: number; pauseSeconds: number; attempts: number }

/** #971: how a deploy waits for the exclusive lifecycle lock: 585 seconds in
 *  all. A waiting attempt stalls every new request behind it (Postgres queues
 *  them; deploy-instance.test.ts proves it), so an attempt is short and the
 *  pause equal to it: people get at least half the time, and a normal request
 *  finishes within one attempt. Railway sets no pre-deploy limit by default. */
export const DEPLOY_LOCK_WAIT: DeployLockWait = { attemptSeconds: 15, pauseSeconds: 15, attempts: 20 }

class DeployLockBusy extends Error {}

/** Who holds the shared lifecycle lock, for the log: a failed try names them. */
async function lifecycleLockHolders(): Promise<string> {
  const [row] = await locks`select count(*)::int as n, coalesce(ceil(extract(epoch from max(clock_timestamp() - a.xact_start))), 0)::int as oldest
    from pg_locks l join pg_stat_activity a on a.pid = l.pid
    where l.locktype = 'advisory' and l.classid = 296 and l.objid = 1 and l.granted
      and l.database = (select oid from pg_database where datname = current_database())`
  return `${row.n} live request${row.n === 1 ? '' : 's'} or job${row.n === 1 ? '' : 's'}, the oldest running for ${row.oldest} seconds`
}

/** #943: an instance deploy holds the exclusive lifecycle lock from before its
 *  transaction takes any lock until it ends, so it never waits for live
 *  requests while holding a row they wait for: nested app operations (install,
 *  discovery, the settings apply) then run inside it.
 *  #971: each try is its own transaction, so a pause holds nothing and nothing
 *  queues behind it. Only the wait for this lock is retried: a lock wait inside
 *  `fn` is the deploy's own failure and has changed nothing, so it just fails. */
export async function instanceDeployOperation<T>(fn: () => Promise<T>, wait: DeployLockWait, log: (line: string) => void = () => {}): Promise<T> {
  if (scope.getStore()) throw new Error('An instance deploy cannot run inside another app operation')
  const started = Date.now()
  const elapsed = () => Math.ceil((Date.now() - started) / 1000)
  for (let attempt = 1; ; attempt++) {
    try {
      return await locks.begin(async (tx) => {
        try {
          await tx.unsafe(`set local lock_timeout = '${Math.ceil(wait.attemptSeconds * 1000)}ms'`)
          await tx`select pg_advisory_xact_lock(296, 1)`
        } catch (error) {
          if ((error as { code?: string }).code === '55P03') throw new DeployLockBusy()
          throw error
        }
        log(`Deploy: lifecycle lock taken on try ${attempt}, after ${elapsed()} seconds`)
        return scope.run({ exclusive: true }, fn)
      }) as T
    } catch (error) {
      if (!(error instanceof DeployLockBusy)) throw error
    }
    const holders = await lifecycleLockHolders()
    const last = attempt >= wait.attempts
    log(`Deploy: try ${attempt} of ${wait.attempts}: the live server is still busy (${holders})${last ? '' : `; trying again in ${wait.pauseSeconds} seconds`}`)
    if (last) throw new Error(`The live server kept the apps busy for ${elapsed()} seconds, so the deploy did not start; nothing changed. Deploy again.`)
    await new Promise((resolve) => setTimeout(resolve, wait.pauseSeconds * 1000))
  }
}

export function provisionApp<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return appOperation(() => scope.run({ exclusive: true, provisioning: name }, fn), true)
}

/** #912: refused like any unavailable app (403, audited), but answered with
 *  its plain reason, never as a bare "Application access refused". */
export class AppNotRunningError extends AppError {
  constructor(message: string) { super('PermissionError', message) }
}

export async function assertAppAvailable(name: string, exactClientIdentity = false): Promise<void> {
  if (!name.includes('.')) return
  const owner = name.split('.')[0]
  if (scope.getStore()?.provisioning === owner) return
  const [installed] = await sql`select enabled, activation_pending, package_version, migration_ledger from installed_app where name = ${owner}`
  if (!installed?.enabled || installed.activation_pending)
    throw new AppError('PermissionError', `App ${owner} is disabled or unavailable`)
  // #912: installed or enabled by another process while this one ran: start
  // it now, or say plainly why it cannot run here (not an access refusal).
  if (!activeApps.has(owner)) {
    const apps = await import('./apps')
    if (!(await apps.activateInstalledApp(owner))) throw new AppNotRunningError(await apps.whyAppNotRunning(owner))
  }
  const snapshot = clientVersion.getStore()
  // An agent's call speaks the version installed now, so it passes both checks.
  if (snapshot === INSTALLED) return
  const supplied = snapshot
  // The declared boundary requires an exact HTTP identity even on first install.
  // Trusted in-process calls have no HTTP client snapshot; legacy CRUD is unchanged.
  if (exactClientIdentity && supplied !== undefined && supplied.get(owner) !== `${owner}@${installed.package_version}`)
    throw new AppError('PermissionError', 'Application access refused')
  if (supplied !== undefined && (installed.migration_ledger as unknown[]).length > 0 &&
      supplied.get(owner) !== `${owner}@${installed.package_version}`)
    throw new AppError('ConflictError', `App ${owner} was upgraded. Reload its current client and retry with the installed application version`)
}
