import { AppError } from '../errors'
import { amendDoc, cancelDoc, reactivateDoc, renameDoc, retireDoc, rowCapabilities, submitDoc } from '../document'
import { applyWorkflowAction } from '../workflow'
import { rowForCaller } from '../row-readers'
import { registerRowAction } from '../actions'

// The row actions every Table gets from the engine itself (not app/plugin
// contributed) — submit/cancel/amend gated by is_submittable, workflow
// actions gated by an active Workflow, both enforced inside the engine
// functions below exactly as the old one-off /api/submit_doc etc. routes did.

registerRowAction('capabilities', {
  effect: 'read',
  description: 'Display advice for operations on an already readable row; never a write grant.',
  handler: ({ table, name, user }) => rowCapabilities(table, name, user.row_id),
})

registerRowAction('submit', {
  effect: 'write',
  description: 'Submit a draft row (only if its Table is_submittable).',
  handler: async ({ table, name, user }) => rowForCaller(table, await submitDoc(table, name, user.row_id), user.row_id),
})

registerRowAction('cancel', {
  effect: 'write',
  description: 'Cancel a submitted row.',
  handler: async ({ table, name, user }) => rowForCaller(table, await cancelDoc(table, name, user.row_id), user.row_id),
})

registerRowAction('amend', {
  effect: 'write',
  description: 'Create an editable copy of a cancelled row (amended_from).',
  handler: async ({ table, name, user }) => rowForCaller(table, await amendDoc(table, name, user.row_id), user.row_id),
})

// #859: take a row out of use without deleting it ({ reason } required; the
// delete right), or put it back (the write right).
registerRowAction('retire', {
  effect: 'write',
  description: 'Retire a row: hide it from lists and pickers, keeping it and its history. Expects { reason }.',
  handler: async ({ table, name, args, user }) => rowForCaller(table, await retireDoc(table, name, args.reason, user.row_id), user.row_id),
})

registerRowAction('reactivate', {
  effect: 'write',
  description: 'Reactivate a retired row, putting it back in lists and pickers.',
  handler: async ({ table, name, user }) => rowForCaller(table, await reactivateDoc(table, name, user.row_id), user.row_id),
})

registerRowAction('apply_workflow_action', {
  effect: 'write',
  description: 'Apply a named Workflow transition to the row.',
  handler: ({ table, name, args, user }) => {
    const action = args.action
    if (typeof action !== 'string' || !action)
      throw new AppError('ValidationError', 'Expected { action }')
    return applyWorkflowAction(table, name, action, user.row_id)
  },
})

registerRowAction('rename', {
  effect: 'write',
  description: 'Rename a row, cascading the new name to every Link reference.',
  handler: ({ table, name, args, user }) => {
    const newName = args.new_name
    if (typeof newName !== 'string' || !newName)
      throw new AppError('ValidationError', 'Expected { new_name }')
    return renameDoc(table, name, newName, user.row_id)
  },
})
