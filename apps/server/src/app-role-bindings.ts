// #620 (design D4): people never hold an app's roles by hand. An App Role
// Binding row says that holding one of the instance's roles (a job, in time)
// carries one of an app's roles. A System Manager edits the rows in Admin;
// the app's `roleDefaults` suggestions are written once, at install.
import { z } from 'zod'

const role = z.string().min(1).refine(s => s.trim() === s)

/** The manifest's `roleDefaults`: app role → the instance roles that should
 *  carry it. */
export const roleDefaultsDeclaration = z.record(role, z.array(role).min(1))
