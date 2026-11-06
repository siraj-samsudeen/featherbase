// #1001: an app action emails a person by Person ID. The platform holds the
// address, so an app never sees it, and queues the email only after the
// action's transaction commits: a rolled-back action sends nothing, a replay
// never runs the handler again, and a failure to queue leaves the action done.
import type { RuntimeActionContext } from 'shared'
import { appHref } from 'shared'
import { afterDocumentCommit } from './action-transaction'
import { config } from './config'
import { sql } from './db'
import { getDoc } from './document'
import { queueEmail } from './email'
import { AppError } from './errors'
import { appLinkOrigin } from './instance-addresses'

type Message = Parameters<RuntimeActionContext['mail']['toPerson']>[1]

/** One log line per skipped email: why and for whom, never an address. */
function logSkip(app: string, person: string, reason: string, message: Message): void {
  console.warn(JSON.stringify({ level: 'warn', event: 'app_mail_skipped', app, reason, person,
    ...(message.ref_table ? { ref_table: message.ref_table, reference_name: message.reference_name } : {}) }))
}

async function send(app: string, person: string, message: Message): Promise<void> {
  const [row] = await sql`select email, enabled, built_in, replaced_by from person where row_id = ${person}`
  const skip = !row ? 'unknown_person' : !row.enabled ? 'disabled' : row.built_in ? 'built_in' : row.replaced_by ? 'merged_away'
    : !String(row.email ?? '').trim() ? 'no_email' : null
  if (skip) return logSkip(app, person, skip, message)
  const origin = appLinkOrigin(config.instanceAddresses, config.environment, app)
  await queueEmail({
    to: String(row.email).trim(),
    subject: message.subject.replace(/\s+/g, ' ').trim(),
    body: message.path !== undefined && origin ? `${message.body}\n\nOpen it here: ${origin}${appHref(app)}${message.path}` : message.body,
    ref_table: message.ref_table,
    reference_name: message.reference_name,
  })
}

export function callerMail(app: string, allowed: string[]): RuntimeActionContext['mail'] {
  return Object.freeze({
    async mayRead(person: string, table: string, rowId: string) {
      if (!allowed.includes(table)) throw new AppError('ValidationError', `Action has not declared Table ${table}`)
      try {
        await getDoc(table, rowId, person)
        return true
      } catch (error) {
        if (error instanceof AppError && (error.type === 'PermissionError' || error.type === 'NotFoundError')) return false
        throw error
      }
    },
    async toPerson(person: string, message: Message) {
      await afterDocumentCommit(() => send(app, person, message))
    },
  })
}
