import { randomUUID } from 'node:crypto'
import { COPY_CADENCES } from 'shared'
import { sql } from './db'
import { actionTransaction } from './action-transaction'
import { appOperation } from './app-lifecycle'
import { AppError, errorMessage } from './errors'
import { saveDoc } from './document'
import { assertSystemManager } from './permissions'
import type { SessionUser } from './auth'
import { copyAgain, copyInfo } from './sources/table-copy'
import { syncAfterCopy } from './master-sync'
import { getMeta } from './meta'
import { FinalJobFailure, enqueue, registerJob, syncScheduledJobs } from './jobs'
import { runAsSystemActor } from './system-actor'
import { queueEmail } from './email'
import { recordUndeliveredNotice, systemManagerEmails } from './system-notice'

export async function copySchedule(target: string) {
  if (!await copyInfo(target)) throw new AppError('NotFoundError', `${target} is not a copied table`)
  const [row] = await sql`select s.* from scheduled_job s join featherbase.copy_refresh_schedule c
    on c.scheduled_job = s.row_id where c.target_table = ${target}`
  return row ?? null
}

export async function setCopySchedule(user: SessionUser, target: string, args: Record<string, unknown>) {
  await assertSystemManager(user.row_id)
  if (!COPY_CADENCES.includes(args.cadence as typeof COPY_CADENCES[number]))
    throw new AppError('ValidationError', 'Choose every 15 minutes, hourly, every 4 hours or daily', { cadence: 'Choose a refresh cadence' })
  if (typeof args.enabled !== 'boolean') throw new AppError('ValidationError', 'enabled must be true or false')
  const row = await actionTransaction(async () => {
    // Serialize schedule creation and hold provenance against concurrent removal.
    const [copy] = await sql`select target_table from featherbase.table_copy where target_table = ${target} for update`
    if (!copy) throw new AppError('NotFoundError', `${target} is not a copied table`)
    const old = await copySchedule(target)
    const method = old ? String(old.method) : `copy_refresh_${randomUUID().replaceAll('-', '')}`
    const saved = await saveDoc('Scheduled Job', {
      ...(old ? { row_id: old.row_id, updated_at: old.updated_at } : {}),
      method, cadence: args.cadence, enabled: args.enabled, description: `Refresh copied table ${target}`,
    }, user.row_id, old ? 'upsert' : 'insert')
    if (!old) await sql`insert into featherbase.copy_refresh_schedule (target_table, scheduled_job) values (${target}, ${method})`
    registerCopyRefresh(method)
    return saved
  })
  await syncScheduledJobs(String(row.method))
  return row
}

function registerCopyRefresh(method: string): void {
  registerJob(method, async (_payload, ctx) => {
    // Never trust a queued payload to choose a table or to restore removed provenance.
    const [link] = await sql`select c.target_table from featherbase.copy_refresh_schedule c
      join scheduled_job s on s.row_id = c.scheduled_job where c.scheduled_job = ${method}`
    if (!link) throw new FinalJobFailure('This copied-table schedule has been removed')
    // #905: an archived copy takes no rows; its schedule waits, quietly, until
    // it is un-archived or deleted.
    if ((await getMeta(String(link.target_table))).archived_at) {
      ctx.setResult(`Skipped: ${String(link.target_table)} is archived`)
      return
    }
    const actor = `copy-refresh:${method.slice('copy_refresh_'.length)}`
    const user: SessionUser = { row_id: actor, kind: 'service_account', email: null, full_name: 'Scheduled copy refresh' }
    const result = await runAsSystemActor(actor, () => copyAgain(user, String(link.target_table)))
    let summary = `${result.inserted} inserted · ${result.changed} changed · ${result.unchanged} unchanged · ${result.conflicts} conflicts · ${result.deleted_at_source} deleted at source · ${result.back_at_source} back at source · batch ${result.run_id}`
    // #927: a copy with a master sync rule brings its master Table in step.
    const sync = await runAsSystemActor(actor, () => syncAfterCopy(user, String(link.target_table)))
    if (sync) {
      summary += ` · master sync: ${sync.applied} applied · ${sync.raised} new differences · ${sync.tickets.length} tickets raised · ${sync.ticket_errors.length} tickets not raised`
    }
    ctx.setResult(summary)
    if (result.conflicts) {
      try {
        await queueConflictNotice(String(link.target_table), result.conflicts)
      } catch {
        // The copy is committed: a mail outage must not retry the import.
        // The notice waits in its own job instead (#934), since a later
        // refresh never reports these conflicts again.
        try {
          await appOperation(() => retryConflictNotice(String(link.target_table), result.conflicts, 1))
          ctx.setResult(`${summary} · Conflict notice could not be queued; it will be tried again`)
        } catch {
          // Not even the job could be kept: still no re-import. The
          // conflicts stay in the table's Import conflicts.
          ctx.setResult(`${summary} · Conflict notice could not be queued or kept for later`)
        }
      }
    }
    // #971: reads with no lifecycle lock; copyAgain and the sync take it to apply.
  }, undefined, { ownLifecycleLock: true })
}

/** Tell every System Manager about a refresh's new conflicts, in one transaction. */
async function queueConflictNotice(table: string, conflicts: number): Promise<void> {
  await appOperation(() => actionTransaction(async () => {
    const recipients = await systemManagerEmails()
    if (!recipients.length) return recordUndeliveredNotice(`copy refresh conflicts: ${table}`)
    for (const to of recipients) await queueEmail({
      to,
      subject: `Copy refresh conflicts: ${table}`,
      body: `${table} has ${conflicts} new conflict${conflicts === 1 ? '' : 's'} from its scheduled refresh. Personal corrections were kept. Open the table's Import conflicts to review them.`,
    })
  }))
}

// #934: a conflict notice that could not be queued is tried again every
// quarter hour for a day, apart from the copy, so it is never lost and never
// re-runs an import.
export const CONFLICT_NOTICE_JOB = 'copy_refresh_conflict_notice'
const NOTICE_RETRY_MINUTES = 15
const NOTICE_TRIES = 96

async function retryConflictNotice(table: string, conflicts: number, tries: number): Promise<void> {
  // Its own transaction, so a refused insert leaves the caller's work alone.
  await actionTransaction(() => enqueue(CONFLICT_NOTICE_JOB, { table, conflicts, tries }, { maxAttempts: 1, runAt: new Date(Date.now() + NOTICE_RETRY_MINUTES * 60_000) }))
}

registerJob(CONFLICT_NOTICE_JOB, async (payload, ctx) => {
  const table = String(payload.table ?? '')
  const conflicts = Number(payload.conflicts)
  const tries = Number(payload.tries ?? 1)
  // A queued payload names the table only in a notice, and only a copy's.
  if (!(await copyInfo(table)) || !Number.isInteger(conflicts) || conflicts < 1)
    throw new FinalJobFailure('A conflict notice names a copied table and its new conflicts')
  try {
    await queueConflictNotice(table, conflicts)
    ctx.setResult(`Conflict notice for ${table} queued`)
  } catch (err) {
    if (tries >= NOTICE_TRIES)
      throw new FinalJobFailure(`The conflict notice for ${table} could not be queued for a day: ${errorMessage(err)}`)
    await appOperation(() => retryConflictNotice(table, conflicts, tries + 1))
    ctx.setResult(`Conflict notice for ${table} could not be queued; trying again in ${NOTICE_RETRY_MINUTES} minutes`)
  }
})

export async function registerCopyRefreshJobs(): Promise<void> {
  // Let the existing startup migration check report a database awaiting 0010.
  const [schema] = await sql`select to_regclass('featherbase.copy_refresh_schedule') as relation`
  if (!schema.relation) return
  for (const row of await sql`select scheduled_job from featherbase.copy_refresh_schedule`)
    registerCopyRefresh(String(row.scheduled_job))
}
