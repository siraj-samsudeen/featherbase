import { AppError } from '../errors'
import { amendDoc, cancelDoc, renameDoc, submitDoc } from '../document'
import { applyWorkflowAction } from '../workflow'
import { registerRowAction } from '../actions'
import { activeBookFor } from '../budget'
import { sql } from '../db'

// The row actions every Table gets from the engine itself (not app/plugin
// contributed) — submit/cancel/amend gated by is_submittable, workflow
// actions gated by an active Workflow, both enforced inside the engine
// functions below exactly as the old one-off /api/submit_doc etc. routes did.

registerRowAction('submit', {
  effect: 'write',
  description: 'Submit a draft row (only if its Table is_submittable).',
  handler: ({ table, name, user }) => submitDoc(table, name, user.row_id),
})

registerRowAction('cancel', {
  effect: 'write',
  description: 'Cancel a submitted row.',
  handler: ({ table, name, user }) => cancelDoc(table, name, user.row_id),
})

registerRowAction('amend', {
  effect: 'write',
  description: 'Create an editable copy of a cancelled row (amended_from).',
  handler: ({ table, name, user }) => amendDoc(table, name, user.row_id),
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
  handler: async ({ table, name, args, user }) => {
    const newName = args.new_name
    if (typeof newName !== 'string' || !newName)
      throw new AppError('ValidationError', 'Expected { new_name }')
    // Spec 0007 BUD-R3 (audit bug #3): renameDoc runs no lifecycle hooks, so
    // the budget write-lock cannot see it — and a rename would orphan every
    // budget_version_line pointing at the old row id. Gate it here.
    const book = await activeBookFor(sql, table)
    if (book)
      throw new AppError(
        'ValidationError',
        `${book.name} is active — rows of a governed budget cannot be renamed`,
      )
    return renameDoc(table, name, newName, user.row_id)
  },
})
