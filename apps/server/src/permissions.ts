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

export async function hasPermission(
  user: string,
  doctype: string,
  action: PermAction,
): Promise<boolean> {
  if (user === 'Administrator') return true
  const roles = await getRoles(user)
  if (roles.includes('System Manager')) return true
  const [row] = await sql`
    select 1 from tab_docperm
    where ref_doctype = ${doctype} and permlevel = 0
      and role in ${sql(roles)}
      and ${sql(ACTION_COLUMN[action])} = true
    limit 1`
  return Boolean(row)
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

export async function assertSystemManager(user: string) {
  if (user === 'Administrator') return
  const roles = await getRoles(user)
  if (!roles.includes('System Manager'))
    throw new AppError('PermissionError', 'Requires the System Manager role')
}
