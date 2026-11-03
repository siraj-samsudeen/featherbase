import { sql } from './db'
import { getRoles, hasPermission } from './permissions'

// #852: what a token's owner can reach, said before the token is issued. A
// token acts as its owner, so this is the owner's reach. Every principal also
// holds the built-in All role, so the answer comes from the same permission
// check every request makes (hasPermission), never from the role list alone.
export interface Reach {
  /** Administrator or a System Manager: every Table, without listing them. */
  every_table: boolean
  /** Whether the owner holds any role besides the built-in All and Guest. */
  own_roles: boolean
  /** Tables the owner can read, by name. */
  read: string[]
  /** Tables the owner can change (write, create or delete rows), by name. */
  change: string[]
}

const BUILT_IN = new Set(['All', 'Guest'])

export async function principalReach(owner: string): Promise<Reach> {
  const roles = await getRoles(owner)
  const own_roles = roles.some((role) => !BUILT_IN.has(role))
  if (owner === 'Administrator' || roles.includes('System Manager'))
    return { every_table: true, own_roles: true, read: [], change: [] }
  // Only Tables some held role has a grant on can be reached; each candidate
  // is then decided by hasPermission, which also applies app availability and
  // mandatory access.
  const candidates = await sql`
    select distinct p.ref_table as name from permission p
    join table_def t on t.name = p.ref_table
    where p.tier = 'basic' and p.role in ${sql(roles)} and t.kind <> 'sub_table'
      and (p.can_read or p.can_write or p.can_create or p.can_delete)`
  const read: string[] = []
  const change: string[] = []
  for (const { name } of candidates) {
    const table = String(name)
    if (await hasPermission(owner, table, 'read')) read.push(table)
    for (const action of ['write', 'create', 'delete'] as const) {
      if (await hasPermission(owner, table, action)) {
        change.push(table)
        break
      }
    }
  }
  return { every_table: false, own_roles, read: read.sort(), change: change.sort() }
}
