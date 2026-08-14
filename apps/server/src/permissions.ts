import { sql } from './db'
import { AppError } from './errors'

// PERM-001: role resolution. Every enabled user implicitly holds 'All';
// explicit roles come from the Has Role child table on User.
export async function getRoles(user: string): Promise<string[]> {
  if (user === 'Guest') return ['Guest']
  const rows = await sql`
    select role from has_role
    where parent = ${user} and parenttype = 'User'
    order by role`
  return ['All', ...rows.map((r) => r.role as string)]
}

// PERM-002/003/009: role-based Table permissions from Permission rows.
// Administrator (and System Manager holders) bypass all checks so a fresh
// Table with no Permission rows is still manageable.
export type PermAction =
  | 'read'
  | 'write'
  | 'create'
  | 'delete'
  | 'submit'
  | 'cancel'
  | 'amend'

const ACTION_COLUMN: Record<PermAction, string> = {
  read: 'can_read',
  write: 'can_write',
  create: 'can_create',
  delete: 'can_delete',
  submit: 'can_submit',
  cancel: 'can_cancel',
  amend: 'can_amend',
}

// PERM-007: an own_rows_only grant applies only to rows the user created.
// 'all' = unconditional grant, 'own_rows' = created_by-scoped only, 'none' = denied.
export type PermScope = 'all' | 'own_rows' | 'none'

export async function permissionScope(
  user: string,
  table: string,
  action: PermAction,
): Promise<PermScope> {
  if (user === 'Administrator') return 'all'
  const roles = await getRoles(user)
  if (roles.includes('System Manager')) return 'all'
  const rows = await sql`
    select own_rows_only from permission
    where ref_table = ${table} and tier = 'basic'
      and role in ${sql(roles)}
      and ${sql(ACTION_COLUMN[action])} = true`
  if (rows.some((r) => !r.own_rows_only)) return 'all'
  if (rows.length) return 'own_rows'
  return 'none'
}

export async function hasPermission(
  user: string,
  table: string,
  action: PermAction,
): Promise<boolean> {
  return (await permissionScope(user, table, action)) !== 'none'
}

// PERM-008: is this specific row shared with the user for this action?
export async function isSharedWith(
  user: string,
  table: string,
  name: string,
  action: 'read' | 'write' | 'share',
): Promise<boolean> {
  const col = action === 'read' ? 'read' : action === 'write' ? 'write' : 'share'
  const [row] = await sql`
    select 1 from share
    where share_table = ${table} and share_name = ${name}
      and "user" = ${user} and ${sql(col)} = true limit 1`
  return Boolean(row)
}

// Names of rows of a table shared with the user (for list widening).
export async function sharedNames(user: string, table: string): Promise<string[]> {
  const rows = await sql`
    select share_name from share
    where share_table = ${table} and "user" = ${user} and read = true`
  return rows.map((r) => r.share_name as string)
}

// For operations on a specific existing row: own-rows-scoped grants
// require created_by to match.
export async function assertDocPermission(
  user: string,
  table: string,
  action: PermAction,
  createdBy: string,
) {
  const scope = await permissionScope(user, table, action)
  if (scope === 'all') return
  if (scope === 'own_rows' && createdBy === user) return
  throw new AppError(
    'PermissionError',
    `No ${action} permission on ${table} for ${user}`,
  )
}

export async function assertPermission(
  user: string,
  table: string,
  action: PermAction,
) {
  if (!(await hasPermission(user, table, action)))
    throw new AppError(
      'PermissionError',
      `No ${action} permission on ${table} for ${user}`,
    )
}

export async function isBypassUser(user: string): Promise<boolean> {
  if (user === 'Administrator') return true
  return (await getRoles(user)).includes('System Manager')
}

// PERM-005: map of restricted Table -> allowed row names for a user.
export async function getUserPermissionMap(
  user: string,
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  const rows = await sql`
    select allow_table, for_value from data_scope where "user" = ${user}`
  for (const r of rows) {
    const key = r.allow_table as string
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(r.for_value as string)
  }
  return map
}

// Throws when a row (or its reference values) falls outside the user's
// permitted values.
export function checkUserPermissions(
  user: string,
  table: string,
  linkFields: { column_name: string; reference_table: string | null | undefined }[],
  row: Record<string, unknown>,
  map: Map<string, Set<string>>,
) {
  const own = map.get(table)
  if (own && row.row_id != null && !own.has(String(row.row_id)))
    throw new AppError(
      'PermissionError',
      `${table} ${String(row.row_id)} is outside your permitted values`,
    )
  for (const f of linkFields) {
    if (!f.reference_table) continue
    const allowed = map.get(f.reference_table)
    if (!allowed) continue
    const value = row[f.column_name]
    if (value == null || value === '') continue
    if (!allowed.has(String(value)))
      throw new AppError(
        'PermissionError',
        `${f.reference_table} ${String(value)} is outside your permitted values`,
      )
  }
}

// PERM-006: the set of tiers a user may READ / WRITE on a Table. 'basic' is
// the base grant; 'restricted' needs an explicit Permission row at that
// tier. Because 'restricted' access implies 'basic' access (the old
// "higher permlevel implies lower levels" rule, with two levels instead of
// ten), a restricted grant is expanded to include 'basic' when the set is
// built. Admins/System Managers get both tiers.
export async function permittedTiers(
  user: string,
  table: string,
  action: 'read' | 'write',
): Promise<Set<'basic' | 'restricted'>> {
  if (await isBypassUser(user)) return new Set(['basic', 'restricted'])
  const roles = await getRoles(user)
  const rows = await sql`
    select distinct tier from permission
    where ref_table = ${table}
      and role in ${sql(roles)}
      and ${sql(ACTION_COLUMN[action])} = true`
  const tiers = new Set<'basic' | 'restricted'>()
  for (const r of rows) {
    const tier = r.tier as 'basic' | 'restricted'
    tiers.add(tier)
    if (tier === 'restricted') tiers.add('basic')
  }
  return tiers
}

function allowsTier(tiers: Set<'basic' | 'restricted'>, tier: 'basic' | 'restricted'): boolean {
  return tiers.has(tier)
}

// Strip columns the user can't read at their tier from an outgoing row.
export function filterReadFields(
  columns: { column_name: string; tier: 'basic' | 'restricted' }[],
  tiers: Set<'basic' | 'restricted'>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (tiers.has('basic') && tiers.has('restricted')) return row
  const out: Record<string, unknown> = {}
  const hidden = new Set(
    columns.filter((f) => !allowsTier(tiers, f.tier)).map((f) => f.column_name),
  )
  for (const [k, v] of Object.entries(row)) if (!hidden.has(k)) out[k] = v
  return out
}

// Drop writes to columns above the user's write tier (silently ignored,
// like read_only) so a client can't escalate via restricted-tier columns.
export function stripUnwritableFields(
  columns: { column_name: string; tier: 'basic' | 'restricted' }[],
  tiers: Set<'basic' | 'restricted'>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (tiers.has('basic') && tiers.has('restricted')) return values
  const writable = new Set(
    columns.filter((f) => allowsTier(tiers, f.tier)).map((f) => f.column_name),
  )
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (writable.has(k)) out[k] = v
  return out
}

export async function assertSystemManager(user: string) {
  if (user === 'Administrator') return
  const roles = await getRoles(user)
  if (!roles.includes('System Manager'))
    throw new AppError('PermissionError', 'Requires the System Manager role')
}
