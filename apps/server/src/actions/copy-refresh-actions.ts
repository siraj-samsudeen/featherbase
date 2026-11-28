import { registerCollectionAction } from '../actions'
import { checkCopyNow, copySchedule, setCopySchedule } from '../copy-refresh'
import { assertSystemManager } from '../permissions'

registerCollectionAction('copy_schedule', {
  effect: 'read',
  description: 'Read the refresh schedule of a copied table.',
  handler: async ({ table, user }) => {
    await assertSystemManager(user.row_id)
    return copySchedule(table)
  },
})

// #1418 (design D6): the warehouse, after a build, asks a read-only copy to
// check for a new run now.  POST /api/table/<copy>:copy_check_now
registerCollectionAction('copy_check_now', {
  effect: 'write',
  description: 'Run a read-only copy’s check for a new load now, instead of at the next 15-minute check.',
  handler: ({ table, user }) => checkCopyNow(user, table),
})

registerCollectionAction('set_copy_schedule', {
  effect: 'write',
  description: 'Set the refresh cadence of a copied table, or pause its schedule.',
  handler: ({ table, user, args }) => setCopySchedule(user, table, args),
})
