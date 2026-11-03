import { sql } from './db'
import { getRoles, hasPermission } from './permissions'

// #852: what a token's owner can reach, said before the token is issued. A
// token acts as its owner, so this is the owner's reach. Every principal also
// holds the built-in All role, so the answer comes from the same permission
// check every request makes (hasPermission), never from the role list alone.
export interface Reach {
  /** Administrator or a System Manager: every Table, without counting. */
  every_table: boolean
  /** Tables the owner can read. */
  read: number
  /** Tables the owner can change: write, create or delete rows. */
  change: number
}

export async function principalReach(owner: string): Promise<Reach> {
  const roles = await getRoles(owner)
  if (owner === 'Administrator' || roles.includes('System Manager'))
    return { every_table: true, read: 0, change: 0 }
  // Only Tables some held role has a grant on can be reached; each candidate
  // is then decided by hasPermission, which also applies app availability and
  // mandatory access.
  const candidates = await sql`
    select distinct p.ref_table as name from permission p
    join table_def t on t.name = p.ref_table
    where p.tier = 'basic' and p.role in ${sql(roles)} and t.kind <> 'sub_table'
      and (p.can_read or p.can_write or p.can_create or p.can_delete)`
  let read = 0
  let change = 0
  for (const { name } of candidates) {
    const table = String(name)
    if (await hasPermission(owner, table, 'read')) read++
    for (const action of ['write', 'create', 'delete'] as const) {
      if (await hasPermission(owner, table, action)) {
        change++
        break
      }
    }
  }
  return { every_table: false, read, change }
}
