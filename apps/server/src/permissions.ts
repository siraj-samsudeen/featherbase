import { sql } from './db'
import { AppError } from './errors'

// PERM-001: role resolution. Every enabled user implicitly holds 'All';
// explicit roles come from the Has Role child table on User.
export async function getRoles(user: string): Promise<string[]> {
  if (user === 'Guest') return ['Guest']
  const rows = await sql`
    select role from tab_has_role
    where parent = ${user} and parenttype = 'User'
    order by role`
  return ['All', ...rows.map((r) => r.role as string)]
}

// PERM-002/003/009: role-based DocType permissions from DocPerm rows.
// Administrator (and System Manager holders) bypass all checks so a fresh
// DocType with no DocPerm rows is still manageable.
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

// PERM-007: an if_owner grant applies only to documents the user owns.
// 'all' = unconditional grant, 'owner' = owner-scoped only, 'none' = denied.
export type PermScope = 'all' | 'owner' | 'none'

export async function permissionScope(
  user: string,
  doctype: string,
  action: PermAction,
): Promise<PermScope> {
  if (user === 'Administrator') return 'all'
  const roles = await getRoles(user)
  if (roles.includes('System Manager')) return 'all'
  const rows = await sql`
    select if_owner from tab_docperm
    where ref_doctype = ${doctype} and permlevel = 0
      and role in ${sql(roles)}
      and ${sql(ACTION_COLUMN[action])} = true`
  if (rows.some((r) => !r.if_owner)) return 'all'
  if (rows.length) return 'owner'
  return 'none'
}

export async function hasPermission(
  user: string,
  doctype: string,
  action: PermAction,
): Promise<boolean> {
  return (await permissionScope(user, doctype, action)) !== 'none'
}

// For operations on a specific existing document: owner-scoped grants
// require ownership.
export async function assertDocPermission(
  user: string,
  doctype: string,
  action: PermAction,
  owner: string,
) {
  const scope = await permissionScope(user, doctype, action)
  if (scope === 'all') return
  if (scope === 'owner' && owner === user) return
  throw new AppError(
    'PermissionError',
    `No ${action} permission on ${doctype} for ${user}`,
  )
}

export async function assertPermission(
  user: string,
  doctype: string,
  action: PermAction,
) {
  if (!(await hasPermission(user, doctype, action)))
    throw new AppError(
      'PermissionError',
      `No ${action} permission on ${doctype} for ${user}`,
    )
}

export async function isBypassUser(user: string): Promise<boolean> {
  if (user === 'Administrator') return true
  return (await getRoles(user)).includes('System Manager')
}

// PERM-005: map of restricted DocType -> allowed document names for a user.
export async function getUserPermissionMap(
  user: string,
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  const rows = await sql`
    select allow, for_value from tab_user_permission where "user" = ${user}`
  for (const r of rows) {
    const key = r.allow as string
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(r.for_value as string)
  }
  return map
}

// Throws when a document (or its link values) falls outside the user's
// permitted values.
export function checkUserPermissions(
  user: string,
  doctype: string,
  linkFields: { fieldname: string; options: string | null }[],
  doc: Record<string, unknown>,
  map: Map<string, Set<string>>,
) {
  const own = map.get(doctype)
  if (own && doc.name != null && !own.has(String(doc.name)))
    throw new AppError(
      'PermissionError',
      `${doctype} ${String(doc.name)} is outside your permitted values`,
    )
  for (const f of linkFields) {
    if (!f.options) continue
    const allowed = map.get(f.options)
    if (!allowed) continue
    const value = doc[f.fieldname]
    if (value == null || value === '') continue
    if (!allowed.has(String(value)))
      throw new AppError(
        'PermissionError',
        `${f.options} ${String(value)} is outside your permitted values`,
      )
  }
}

export async function assertSystemManager(user: string) {
  if (user === 'Administrator') return
  const roles = await getRoles(user)
  if (!roles.includes('System Manager'))
    throw new AppError('PermissionError', 'Requires the System Manager role')
}
