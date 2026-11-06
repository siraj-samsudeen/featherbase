import { registerCollectionAction } from '../actions'
import { AppError } from '../errors'
import { purgePreview, purgeRows, purgeRunRemaining } from '../purge'

// #859: a System Manager deletes rows permanently (design decisions 9-14).
// GET /api/table/:table:purge_preview?ids=[...]|run_id=…&links=cascade|clear
// POST /api/table/:table:purge { ids | run_id, links, reason, confirm: true }
registerCollectionAction('purge_preview', {
  effect: 'read',
  description: 'System Manager only: what deleting these rows permanently would remove or unlink.',
  handler: ({ table, args, user }) => purgePreview(table, args, user.row_id),
})

registerCollectionAction('purge_run_remaining', {
  effect: 'read',
  description: 'System Manager only: how many rows one import added are still there.',
  handler: ({ table, args, user }) => {
    if (typeof args.run_id !== 'string' || !args.run_id) throw new AppError('ValidationError', 'Expected { run_id }')
    return purgeRunRemaining(table, args.run_id, user.row_id)
  },
})

registerCollectionAction('purge', {
  effect: 'write',
  description: 'System Manager only: delete rows permanently with their history; dependents deleted too or unlinked. Expects { ids | run_id, links, reason, confirm: true }.',
  handler: ({ table, args, user }) => purgeRows(table, args, user.row_id),
})
