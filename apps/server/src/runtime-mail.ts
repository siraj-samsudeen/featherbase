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
  const [row] = await sql`select email, enabled, built_in from person where row_id = ${person}`
  // A merged-away person is always disabled (person_replaced_is_disabled).
  const skip = !row ? 'unknown_person' : !row.enabled ? 'disabled' : row.built_in ? 'built_in'
    : !String(row.email ?? '').trim() ? 'no_email' : null
  if (skip) return logSkip(app, person, skip, message)
  const origin = message.path === undefined ? null : appLinkOrigin(config.instanceAddresses, config.environment, app)
  await queueEmail({
    to: String(row.email).trim(),
    subject: message.subject.replace(/\s+/g, ' ').trim(),
    body: origin ? `${message.body}\n\nOpen it here: ${origin}${appHref(app)}${message.path}` : message.body,
    ref_table: message.ref_table,
    reference_name: message.reference_name,
  })
}

/** Whether a person may open one row: a refusal answers false, never failing the caller. */
export async function readsRow(person: string, table: string, rowId: string): Promise<boolean> {
  try {
    await getDoc(table, rowId, person)
    return true
  } catch (error) {
    if (error instanceof AppError && (error.type === 'PermissionError' || error.type === 'NotFoundError')) return false
    throw error
  }
}

export function callerMail(app: string, allowed: string[]): RuntimeActionContext['mail'] {
  return Object.freeze({
    async mayRead(person: string, table: string, rowId: string) {
      if (!allowed.includes(table)) throw new AppError('ValidationError', `Action has not declared Table ${table}`)
      return readsRow(person, table, rowId)
    },
    async toPerson(person: string, message: Message) {
      await afterDocumentCommit(() => send(app, person, message))
    },
  })
}
