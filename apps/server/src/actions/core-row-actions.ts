import { AppError } from '../errors'
import { amendDoc, cancelDoc, renameDoc, submitDoc } from '../document'
import { applyWorkflowAction } from '../workflow'
import { registerRowAction } from '../actions'

// The row actions every Table gets from the engine itself (not app/plugin
// contributed) — submit/cancel/amend gated by is_submittable, workflow
// actions gated by an active Workflow, both enforced inside the engine
// functions below exactly as the old one-off /api/submit_doc etc. routes did.

registerRowAction('submit', {
  effect: 'write',
  description: 'Submit a draft row (only if its Table is_submittable).',
  handler: ({ table, name, user }) => submitDoc(table, name, user.name),
})

registerRowAction('cancel', {
  effect: 'write',
  description: 'Cancel a submitted row.',
  handler: ({ table, name, user }) => cancelDoc(table, name, user.name),
})

registerRowAction('amend', {
  effect: 'write',
  description: 'Create an editable copy of a cancelled row (amended_from).',
  handler: ({ table, name, user }) => amendDoc(table, name, user.name),
})

registerRowAction('apply_workflow_action', {
  effect: 'write',
  description: 'Apply a named Workflow transition to the row.',
  handler: ({ table, name, args, user }) => {
    const action = args.action
    if (typeof action !== 'string' || !action)
      throw new AppError('ValidationError', 'Expected { action }')
    return applyWorkflowAction(table, name, action, user.name)
  },
})

registerRowAction('rename', {
  effect: 'write',
  description: 'Rename a row, cascading the new name to every Link reference.',
  handler: ({ table, name, args, user }) => {
    const newName = args.new_name
    if (typeof newName !== 'string' || !newName)
      throw new AppError('ValidationError', 'Expected { new_name }')
    return renameDoc(table, name, newName, user.name)
  },
})
