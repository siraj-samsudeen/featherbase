import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { checkRoleBinding } from '../app-role-bindings'

// #620 (design D4): a binding names an installed app, a role that app
// declares, and the instance role that carries it. Never All or Guest (that
// would open the app to everyone), never a platform role as the app role, and
// never the same binding twice.
const controller: TableController = {
  table: 'App Role Binding',
  hooks: {
    before_validate: async ({ row, old, tx }) => {
      const merged = { ...(old ?? {}), ...row }
      const app = String(merged.app ?? '')
      const appRole = String(merged.app_role ?? '')
      const boundRole = String(merged.bound_role ?? '')
      const [installed] = await tx`select manifest from installed_app where name = ${app}`
      const problem = checkRoleBinding(app, appRole, boundRole, installed ? (installed.manifest as { roles?: unknown } | null)?.roles ?? [] : null)
      if (problem) throw new AppError('ValidationError', problem.message, { [problem.field]: problem.message })
      const [same] = await tx`select row_id from app_role_binding
        where app = ${app} and app_role = ${appRole} and bound_role = ${boundRole} and row_id <> ${String(merged.row_id ?? '')}`
      if (same) throw new AppError('ValidationError', `${boundRole} already carries ${app}'s role ${appRole}`, { bound_role: 'already bound' })
    },
  },
}

export default controller
