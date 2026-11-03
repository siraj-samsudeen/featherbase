import { randomUUID } from 'node:crypto'
import { COPY_CADENCES } from 'shared'
import { sql } from './db'
import { actionTransaction } from './action-transaction'
import { AppError } from './errors'
import { saveDoc } from './document'
import { assertSystemManager } from './permissions'
import type { SessionUser } from './auth'
import { copyAgain, copyInfo } from './sources/table-copy'
import { FinalJobFailure, registerJob, syncScheduledJobs } from './jobs'
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
    const actor = `copy-refresh:${method.slice('copy_refresh_'.length)}`
    const user: SessionUser = { row_id: actor, kind: 'service_account', email: null, full_name: 'Scheduled copy refresh' }
    const result = await runAsSystemActor(actor, () => copyAgain(user, String(link.target_table)))
    ctx.setResult(JSON.stringify(result))
    if (result.conflicts) {
      try {
        await actionTransaction(async () => {
          const recipients = await systemManagerEmails()
          if (!recipients.length) return recordUndeliveredNotice(`copy refresh conflicts: ${String(link.target_table)}`)
          for (const to of recipients) await queueEmail({
            to,
            subject: `Copy refresh conflicts: ${String(link.target_table)}`,
            body: `${String(link.target_table)} has ${result.conflicts} new conflict${result.conflicts === 1 ? '' : 's'} from its scheduled refresh. Personal corrections were kept. Open the table's Import conflicts to review them.`,
          })
        })
      } catch {
        // The copy is committed: a mail outage must not retry the import.
        ctx.setResult(`${JSON.stringify(result)} · Conflict notice could not be queued`)
      }
    }
  })
}

export async function registerCopyRefreshJobs(): Promise<void> {
  for (const row of await sql`select scheduled_job from featherbase.copy_refresh_schedule`)
    registerCopyRefresh(String(row.scheduled_job))
}
