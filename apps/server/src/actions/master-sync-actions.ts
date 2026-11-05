// #927: a copied table's master sync rule, and running it.
//   GET  /api/table/<copied table>:master_sync
//   POST /api/table/<copied table>:set_master_sync { rule } (rule null removes it)
//   POST /api/table/<copied table>:master_sync_run
// Every action is System Manager only, like the copy it builds on.
import { registerCollectionAction } from '../actions'
import { AppError } from '../errors'
import { assertSystemManager } from '../permissions'
import { masterSyncRule, runMasterSync, setMasterSync } from '../master-sync'

registerCollectionAction('master_sync', {
  effect: 'read',
  description: 'Read the rule that keeps a master Table in step with this copied table.',
  handler: async ({ table, user }) => {
    await assertSystemManager(user.row_id)
    return { rule: await masterSyncRule(table) }
  },
})

registerCollectionAction('set_master_sync', {
  effect: 'write',
  description: 'Set (or remove, with rule null) the master sync rule of a copied table.',
  handler: async ({ table, user, args }) => {
    if (!Object.hasOwn(args, 'rule')) throw new AppError('ValidationError', 'Expected { rule }')
    return { rule: await setMasterSync(user, table, args.rule) }
  },
})

registerCollectionAction('master_sync_run', {
  effect: 'write',
  description: 'Compare the copied table with its master Table now: apply what the source owns, raise tickets for the rest.',
  handler: ({ table, user }) => runMasterSync(user, table),
})
