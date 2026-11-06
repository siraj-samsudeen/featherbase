// #923: roles every signed-in person holds, from one System Settings field
// (one role per line). They are never written to a Person: getRoles adds them
// for any person, so a role removed here goes from everyone who held it only
// this way, and a role given to a person directly stays.
import type { sql } from './db'
import { AppError } from './errors'
import { PLATFORM_ROLES } from './permissions'

export const EVERYONE_ROLES_FIELD = 'everyone_roles'

/** The roles named in the field's text, trimmed, blank lines and repeats dropped. */
export function parseEveryoneRoles(text: unknown): string[] {
  return [...new Set(String(text ?? '').split('\n').map((role) => role.trim()).filter(Boolean))]
}

/** The roles every signed-in person holds now. */
export async function everyoneRoles(tx: typeof sql): Promise<string[]> {
  const [row] = await tx`select value from single_value where table_name = 'System Settings' and field = ${EVERYONE_ROLES_FIELD}`
  const named = parseEveryoneRoles(row?.value).filter((role) => !PLATFORM_ROLES.includes(role))
  // As getRoles reads it: a role deleted since the setting was saved is held by nobody.
  const existing = named.length ? new Set((await tx`select row_id from role where row_id in ${tx(named)}`).map((r) => String(r.row_id))) : new Set()
  return named.filter((role) => existing.has(role))
}

/** Each role must exist, and none may be a platform role: System Manager for
 *  everyone would hand the whole instance to anyone who signs in. */
export async function checkEveryoneRoles(tx: typeof sql, roles: string[]): Promise<void> {
  for (const role of roles) {
    if (PLATFORM_ROLES.includes(role))
      throw new AppError('ValidationError', `${role} cannot be given to everyone who signs in`, { [EVERYONE_ROLES_FIELD]: `${role} cannot be given to everyone` })
    const [known] = await tx`select 1 from role where row_id = ${role}`
    if (!known) throw new AppError('ValidationError', `There is no role ${role}`, { [EVERYONE_ROLES_FIELD]: `There is no role ${role}` })
  }
}
