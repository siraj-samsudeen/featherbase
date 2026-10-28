import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { isPrivileged } from '../permissions'

// #338: a schedule's report runs as the person who set it up, so only they
// (or a System Manager) may change which report it sends or to whom.
// Otherwise anyone who may edit the schedule could point its creator's view
// at recipients the creator never chose.
const GUARDED = ['report', 'recipients'] as const

const controller: TableController = {
  table: 'Auto Email Report',
  hooks: {
    validate: async ({ row, old, user, isNew }) => {
      if (isNew || !old || user === old.created_by) return
      const changed = GUARDED.filter((f) => String(row[f] ?? '') !== String(old[f] ?? ''))
      if (!changed.length || (await isPrivileged(user))) return
      throw new AppError(
        'PermissionError',
        `Only the person who set up this schedule can change its ${changed.join(' or ')}`,
      )
    },
  },
}

export default controller
