import { sql } from './db'
import { activeApps } from './app-lifecycle'
import { accessPolicySchema } from './access-policy'
import { getRoles } from './permissions'

// #852: what a token's owner can reach, said before the token is issued. A
// token acts as its owner, so this is the owner's reach. Every principal also
// holds the built-in All role, so the answer follows the owner's real roles,
// not the roles a person ticked.
//
// It decides each Table the way permissionScope (permissions.ts) does, from
// one read of the owner's matching grants: a Table's mandatory access policy
// must admit one of the owner's roles, only grants of available apps count,
// and a Table reached only through creator-scoped grants is marked as such.
// The reach test checks the answer against real token requests.
export interface TableReach {
  table: string
  /** Reached only for rows the owner created (creator-scoped grants). */
  own_rows: boolean
  /** #628: the owner's roles whose grants reach it, by name. */
  roles: string[]
}

export interface Reach {
  /** Administrator or a System Manager: every Table, without listing them. */
  every_table: boolean
  /** Whether the owner holds any role besides the built-in All and Guest. */
  own_roles: boolean
  /** Whether any of those roles reaches a Table, beyond what every account can. */
  own_reach: boolean
  /** Tables the owner can read. */
  read: TableReach[]
  /** Tables the owner can change: write, create or delete rows. */
  change: TableReach[]
}

const BUILT_IN = new Set(['All', 'Guest'])

type Grant = { all: boolean; own: boolean; roles: Set<string> }

export async function principalReach(owner: string): Promise<Reach> {
  const roles = await getRoles(owner)
  const own_roles = roles.some((role) => !BUILT_IN.has(role))
  if (owner === 'Administrator' || roles.includes('System Manager'))
    return { every_table: true, own_roles: true, own_reach: true, read: [], change: [] }
  const rows = await sql`
    select p.ref_table as name, p.role, p.scope_mode = 'creator' as own_rows_only,
      p.operation = 'read' as can_read, p.operation in ('update', 'create', 'delete') as can_change,
      to_jsonb(t)->'access_policy' as policy
    from permission p
    join table_def t on t.name = p.ref_table
    where p.parent_permission is null and p.requires_permission is null
      and p.role in ${sql(roles)} and t.kind <> 'sub_table'
      and (p.owner_app is null or p.owner_app = any(${[...activeApps]}::text[]))
      and p.operation in ('read', 'update', 'create', 'delete')
    order by p.ref_table`
  let own_reach = false
  const read = new Map<string, Grant>()
  const change = new Map<string, Grant>()
  const add = (into: Map<string, Grant>, table: string, ownOnly: boolean, role: string) => {
    const grant = into.get(table) ?? { all: false, own: false, roles: new Set<string>() }
    if (ownOnly) grant.own = true
    else grant.all = true
    grant.roles.add(role)
    into.set(table, grant)
  }
  for (const row of rows) {
    if (row.policy != null && !accessPolicySchema.parse(row.policy).roles.some((role) => roles.includes(role))) continue
    const table = String(row.name)
    if (!BUILT_IN.has(String(row.role))) own_reach = true
    const role = String(row.role)
    if (row.can_read) add(read, table, Boolean(row.own_rows_only), role)
    if (row.can_change) add(change, table, Boolean(row.own_rows_only), role)
  }
  const list = (grants: Map<string, Grant>): TableReach[] =>
    [...grants].map(([table, g]) => ({ table, own_rows: !g.all, roles: [...g.roles].sort() }))
  return { every_table: false, own_roles, own_reach, read: list(read), change: list(change) }
}
