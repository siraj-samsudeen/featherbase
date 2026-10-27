// #620 (design D4): people never hold an app's roles by hand. An App Role
// Binding row says that holding one of the instance's roles (a job, in time)
// carries one of an app's roles. A System Manager edits the rows in Admin;
// the app's `roleDefaults` suggestions are written once, at install.
import { z } from 'zod'
import { sql } from './db'
import { saveDoc } from './document'
import { logActivity } from './audit'
import { OPEN_ROLES, PLATFORM_ROLES } from './permissions'

const role = z.string().min(1).refine(s => s.trim() === s)

/** The manifest's `roleDefaults`: app role → the instance roles that should
 *  carry it. */
export const roleDefaultsDeclaration = z.record(role, z.array(role).min(1))

/** Why a binding of `app`'s role `appRole` through `boundRole` is refused,
 *  or null. `declared` is the app's declared roles, or null when it is not
 *  installed. */
export function checkRoleBinding(app: string, appRole: string, boundRole: string, declared: unknown): { field: string; message: string } | null {
  if (declared === null) return { field: 'app', message: `App ${app} is not installed` }
  if (PLATFORM_ROLES.includes(appRole) || !Array.isArray(declared) || !declared.includes(appRole))
    return { field: 'app_role', message: `App ${app} does not declare the role ${appRole}` }
  if (OPEN_ROLES.includes(boundRole))
    return { field: 'bound_role', message: `An app role cannot be held through ${boundRole}: it would open ${app} to everyone` }
  return null
}

/** Refuse suggestions an install could never write: an app role the app does
 *  not declare (a platform role among them), or one carried through All or
 *  Guest. Checked when the app is loaded. */
export function validateRoleDefaults(defaults: Record<string, string[]> | undefined, roles: readonly string[] | undefined) {
  for (const [appRole, bound] of Object.entries(defaults ?? {})) {
    if (PLATFORM_ROLES.includes(appRole) || !(roles ?? []).includes(appRole))
      throw new Error(`roleDefaults suggests ${appRole}, which the app does not declare in roles`)
    for (const boundRole of bound)
      if (OPEN_ROLES.includes(boundRole))
        throw new Error(`roleDefaults cannot suggest that ${boundRole} carries ${appRole}: it would open the app to everyone`)
  }
}

/** Install only: write the app's suggestions as binding rows. A suggested
 *  role this instance does not have is skipped (a binding names a Role). An
 *  upgrade never calls this, so it never re-imposes a suggestion an admin
 *  removed. Returns what was written and what was skipped. */
export async function seedRoleBindings(app: string, defaults: Record<string, string[]> | undefined, actor: string) {
  const seeded: string[] = []
  const skipped: string[] = []
  for (const [appRole, bound] of Object.entries(defaults ?? {})) {
    for (const boundRole of bound) {
      const label = `${appRole} <- ${boundRole}`
      const [exists] = await sql`select 1 from role where row_id = ${boundRole}`
      if (!exists) { skipped.push(label); continue }
      await saveDoc('App Role Binding', { app, app_role: appRole, bound_role: boundRole }, actor, 'insert')
      seeded.push(label)
    }
  }
  if (seeded.length || skipped.length)
    await logActivity(actor, `app_role_bindings_seeded ${app}: ${[...seeded, ...skipped.map(s => `skipped ${s} (no such role)`)].join('; ')}`.slice(0, 140))
  return { seeded, skipped }
}
