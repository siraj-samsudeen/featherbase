import { randomBytes } from 'node:crypto'
import { sql } from './db'

// PLAT-007: append-only audit logs. Written with direct inserts (not saveDoc)
// so an activity row can be recorded during login — before any session exists —
// and so a user can never mutate the record of their own actions.

function id(): string {
  return randomBytes(8).toString('hex')
}

async function tableExists(table: string): Promise<boolean> {
  const [row] = await sql`select 1 from information_schema.tables where table_name = ${table}`
  return Boolean(row)
}

export async function logActivity(
  user: string,
  operation: string,
  extra: { full_name?: string | null; ip_address?: string | null } = {},
): Promise<void> {
  if (!(await tableExists('tab_activity_log'))) return
  const now = new Date()
  await sql`insert into tab_activity_log ${sql({
    name: id(),
    owner: user,
    modified_by: user,
    creation: now,
    modified: now,
    docstatus: 0,
    user,
    operation,
    full_name: extra.full_name ?? null,
    ip_address: extra.ip_address ?? null,
  })}`
}

export async function logAccess(
  user: string,
  operation: string,
  ref: { doctype?: string; name?: string; method?: string } = {},
): Promise<void> {
  if (!(await tableExists('tab_access_log'))) return
  const now = new Date()
  await sql`insert into tab_access_log ${sql({
    name: id(),
    owner: user,
    modified_by: user,
    creation: now,
    modified: now,
    docstatus: 0,
    user,
    operation,
    reference_doctype: ref.doctype ?? null,
    reference_name: ref.name ?? null,
    method: ref.method ?? null,
  })}`
}
