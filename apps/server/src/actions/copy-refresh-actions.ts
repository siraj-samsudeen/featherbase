import { registerCollectionAction } from '../actions'
import { copySchedule, setCopySchedule } from '../copy-refresh'
import { assertSystemManager } from '../permissions'

registerCollectionAction('copy_schedule', {
  effect: 'read',
  description: 'Read the refresh schedule of a copied table.',
  handler: async ({ table, user }) => {
    await assertSystemManager(user.row_id)
    return copySchedule(table)
  },
})

registerCollectionAction('set_copy_schedule', {
  effect: 'write',
  description: 'Set the refresh cadence of a copied table, or pause its schedule.',
  handler: ({ table, user, args }) => setCopySchedule(user, table, args),
})
