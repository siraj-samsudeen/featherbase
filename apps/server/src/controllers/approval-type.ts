import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { APPLY_NOW, declaredApprovalTypes } from '../change-proposals'

// #1191: an Approval Type row is `<app>.<type>`, for a type the installed app declares. What the
// type is comes from the app's declaration and never changes here; only the mode is set. A type
// that grants a role or report access is approve first, always.
const ROW_ID = /^([a-z][a-z0-9_]{0,30})\.([a-z][a-z0-9_]{0,63})$/

const controller: TableController = {
  table: 'Approval Type',
  hooks: {
    before_validate: async ({ row, old, isNew, tx }) => {
      const match = ROW_ID.exec(String((isNew ? row.row_id : old?.row_id) ?? ''))
      if (!match)
        throw new AppError('ValidationError', 'An approval type is named <app>.<type>, like dash.subcategory_add', { row_id: 'app.type' })
      const [, app, type] = match
      const declared = await declaredApprovalTypes(app, tx)
      if (!declared) throw new AppError('ValidationError', `App ${app} is not installed`, { row_id: 'unknown app' })
      const found = declared.find(entry => entry.name === type)
      if (!found)
        throw new AppError('ValidationError', `App ${app} does not declare the approval type ${type}${declared.length ? ` (it declares: ${declared.map(entry => entry.name).join(', ')})` : ''}`, { row_id: 'undeclared type' })
      Object.assign(row, { app, approval_type: type, title: found.title, grants_access: found.grantsAccess })
      if (found.grantsAccess && row.mode === APPLY_NOW)
        throw new AppError('ValidationError', `${found.title} gives someone access, so it is always approved first`, { mode: 'Approve first only' })
    },
  },
}

export default controller
