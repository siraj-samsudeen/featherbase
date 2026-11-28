// #1418 (design D5, as ruled 28-Nov-2026: "we want a manually triggered run,
// not an automated one"): a read-only copy loads only when someone asks. A
// System Manager, or a holder of a role its dataset names in `loadRoles`,
// presses "Check for a new run" (loads only when the run check answers a new
// run) or "Load now" (loads whatever the run is) on the copy in the Admin, or
// a script asks the same through POST /api/copy_load. The load runs as one
// background job, since a run can be millions of rows; the Admin reads its
// outcome from the copy's registry rows.
import { sql } from './db'
import { AppError } from './errors'
import { FinalJobFailure, enqueue, registerJob } from './jobs'
import { registerCollectionAction } from './actions'
import { getRoles, hasPermission } from './permissions'
import { packageTitle } from './runtime-packages'
import { checkCopy, declaredCopy } from './read-only-copy'
import type { SessionUser } from './auth'

export const LOAD_JOB = 'read_only_copy_load'

/** A System Manager, or a holder of one of the dataset's load roles. */
async function mayLoad(user: string, loadRoles: readonly string[]): Promise<boolean> {
  if (user === 'Administrator') return true
  const roles = await getRoles(user)
  return roles.includes('System Manager') || loadRoles.some((role) => roles.includes(role))
}

async function pendingLoad(target: string): Promise<string | null> {
  const [pending] = await sql`select row_id, job_status from background_job where method = ${LOAD_JOB}
    and job_status in ('queued', 'running') and payload->>'table' = ${target} order by job_status limit 1`
  if (!pending) return null
  if (pending.job_status === 'running' && !(await loadHeld(target))) {
    // A load the server stopped during (a deploy, a crash) holds no lock: it
    // is over, so it ends as failed and the copy can be loaded again (review, 28-Nov).
    await sql`update background_job set job_status = 'failed', error = 'interrupted: the server stopped during the load', updated_at = now()
      where row_id = ${String(pending.row_id)} and job_status = 'running'`
    return null
  }
  return String(pending.job_status)
}

/** Whether a load of `target` holds its lock now (checkCopy takes it for the whole load). */
async function loadHeld(target: string): Promise<boolean> {
  return sql.begin(async (tx) => !(await tx`select pg_try_advisory_xact_lock(hashtext('read-only-copy:' || ${target})) as free`)[0].free) as Promise<boolean>
}

/** Queue one load of `target`; a request while one waits or runs is that load. */
export async function requestLoad(user: SessionUser, target: string, force: boolean): Promise<{ queued: boolean; message: string }> {
  const entry = declaredCopy(target)
  if (!entry) throw new AppError('NotFoundError', `${target} is not a read-only copy`)
  if (!(await mayLoad(user.row_id, entry.dataset.loadRoles ?? []))) throw new AppError('PermissionError', `Not permitted to load ${target}`)
  const pending = await pendingLoad(target)
  if (pending) return { queued: false, message: pending === 'running' ? 'A load is running now' : 'A load is already waiting to run' }
  // Once: a refused or failed load is pressed again, not retried by itself.
  await enqueue(LOAD_JOB, { table: target, force, requested_by: user.row_id }, { maxAttempts: 1 })
  return { queued: true, message: force ? 'The copy is loading' : 'The check for a new run has started' }
}

registerJob(LOAD_JOB, async (payload, ctx) => {
  const table = String(payload.table ?? '')
  if (!declaredCopy(table)) throw new FinalJobFailure(`${table} is not a read-only copy any installed app declares`)
  // Who asked is what the registry records as having caused the load.
  const outcome = await checkCopy(table, { trigger: String(payload.requested_by), force: payload.force === true })
  if (outcome.status === 'refused') return ctx.refuse(`Load refused: ${outcome.reason}`)
  ctx.setResult(outcome.status === 'loaded' ? `Loaded ${outcome.rows} rows as load ${outcome.snapshot}` : `Nothing loaded: ${outcome.reason}`)
}, undefined, { ownLifecycleLock: true })

/** What the Admin shows on a read-only copy, for whoever may load it; null
 *  for anyone else, and for a Table that is not one (so a list never asks
 *  with a failing request, #1301). */
export async function loadState(user: SessionUser, target: string) {
  const entry = declaredCopy(target)
  if (!entry || !(await mayLoad(user.row_id, entry.dataset.loadRoles ?? []))) return null
  const [copy] = await sql`select last_run_key from featherbase.table_copy where target_table = ${target}`
  const [active] = await sql`select activated_at, row_count from dataset_snapshot where dataset = ${target} and state = 'active'`
  // A failure since the active load: why the copy is older than asked for.
  const [failed] = await sql`select built_at, error from dataset_snapshot where dataset = ${target} and state = 'failed'
    and built_at > ${active?.activated_at ?? new Date(0)} order by built_at desc limit 1`
  return {
    app: entry.app,
    app_title: packageTitle(entry.app) ?? entry.app,
    source: entry.dataset.source,
    // The bar links the Data Source only for someone who may open it.
    can_open_source: await hasPermission(user.row_id, 'Data Source', 'read'),
    run_check: Boolean(entry.dataset.runKey),
    run: copy?.last_run_key ? JSON.parse(String(copy.last_run_key)) as Record<string, unknown> : null,
    loaded_at: active ? new Date(active.activated_at as string).toISOString() : null,
    rows: active ? Number(active.row_count) : null,
    failed: failed ? { at: new Date(failed.built_at as string).toISOString(), reason: String(failed.error) } : null,
    pending: await pendingLoad(target),
  }
}

//   GET /api/table/<copy>:copy_load_state
registerCollectionAction('copy_load_state', {
  effect: 'read',
  description: 'For whoever may load a read-only copy: its last load, the run it holds, why the last load failed, and a load waiting or running.',
  handler: ({ table, user }) => loadState(user, table),
})
