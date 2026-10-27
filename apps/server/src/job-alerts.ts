// #464: a scheduled job's run that fails for good (its last attempt) or refuses
// to act emails every System Manager once, in plain words: which job, when,
// and what failed. Once per episode: a job that fails the same way run after
// run mails when it starts failing, not every minute (the Jobs page and the
// instance health banner show it while it lasts). Recipients come from the shared helper, so a notice with
// nobody to send it to is recorded as undelivered (#463). Only a method with a
// Scheduled Job row alerts: a one-off job (an email send among them) has its
// own caller to report to, and a failing send must not mail about itself.
import { JOBS_PATH, fmtInstantIST, jobTitle } from 'shared'
import { config } from './config'
import { sql, withTransaction } from './db'
import { queueEmail, type MailMessage } from './email'
import { adminLinkOrigin } from './instance-addresses'
import { recordUndeliveredNotice, systemManagerEmails } from './system-notice'

export const JOB_ALERT_SUBJECT = {
  failed: 'Scheduled job failed',
  refused: 'Scheduled job refused to act',
} as const

type Sender = (msg: MailMessage) => Promise<unknown>
let sender: Sender = queueEmail
/** Test seam: swap how the alert is handed to the transport. */
export function _setJobAlertSender(fn: Sender | null): void {
  sender = fn ?? queueEmail
}

export interface JobProblem {
  /** The queue row of the run that failed or refused. */
  job: string
  method: string
  outcome: 'failed' | 'refused'
  /** The error message, or the reason the job gave for refusing. */
  message: string
  attempts: number
  at: Date
}

/** An error's first line, at most 300 characters: what failed, without a
 *  stack or a long driver detail. */
function plain(message: string): string {
  const first = message.split('\n').find((l) => l.trim())?.trim() ?? message.trim()
  return first.length > 300 ? `${first.slice(0, 299)}…` : first
}

function alertBody(p: JobProblem): string {
  const name = jobTitle(p.method)
  const message = plain(p.message)
  const when = fmtInstantIST(p.at)
  const lines =
    p.outcome === 'failed'
      ? [
          `The scheduled job "${name}" failed at ${when}, after ${p.attempts} ${p.attempts === 1 ? 'attempt' : 'attempts'}.`,
          '',
          `What failed: ${message}`,
        ]
      : [
          `The scheduled job "${name}" refused to act at ${when}, so it changed nothing.`,
          '',
          `Why: ${message}`,
        ]
  return [
    ...lines,
    '',
    'Its schedule carries on: the next run is at its usual time. While it keeps failing the same way, no further email is sent.',
    `See every job, switch one off or run it now on the Jobs page: ${adminLinkOrigin(config.instanceAddresses, config.environment) ?? ''}${JOBS_PATH}`,
  ].join('\n')
}

/** Mail the System Managers unless this failure episode was already queued
 *  for every recipient. Never throws: the worker has already
 *  recorded the run, and a mail problem must not undo that. Returns how many
 *  were mailed, 'no recipients', or 'repeat'. */
export async function alertJobProblem(p: JobProblem): Promise<number | 'no recipients' | 'repeat'> {
  try {
    // Queue every recipient and acknowledge the episode together. A failed
    // lookup or partial queue rolls back, leaving the next run able to retry.
    return await withTransaction<number | 'no recipients' | 'repeat'>(async () => {
      const [schedule] = await sql`
        select problem_alert_queued from scheduled_job
        where method = ${p.method} and last_outcome = ${p.outcome === 'failed' ? 'error' : 'refused'}
        for update`
      if (!schedule || schedule.problem_alert_queued) return 'repeat'
      const managers = await systemManagerEmails()
      if (!managers.length) {
        await recordUndeliveredNotice(`job alert: ${p.method}`)
        return 'no recipients'
      }
      const subject = `${JOB_ALERT_SUBJECT[p.outcome]}: ${jobTitle(p.method)}`
      const body = alertBody(p)
      for (const to of managers) await sender({ to, subject, body })
      await sql`update scheduled_job set problem_alert_queued = true where method = ${p.method}`
      return managers.length
    })
  } catch (err) {
    console.warn(JSON.stringify({ event: 'job_alert_failed', method: p.method, error: err instanceof Error ? err.message : String(err) }))
    return 0
  }
}
