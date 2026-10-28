import type { TableController } from '../controllers'
import { sql } from '../db'
import { AppError } from '../errors'
import { tableRelation } from '../table-engine'
import { isPrivileged } from '../permissions'

// #611: a scheduled email runs its report as the person who set the schedule
// up (#338), so a change to the report widens what goes to their recipients.
// A report that any schedule sends is therefore changed only by someone who
// set up every such schedule, or by a System Manager.
const controller: TableController = {
  table: 'Report',
  hooks: {
    validate: async ({ row, isNew, user, tx }) => {
      if (isNew) return
      const db = (tx ?? sql) as typeof sql
      const owners = (await db`
        select distinct created_by from ${db(await tableRelation('Auto Email Report'))}
        where report = ${String(row.row_id)}`).map((r) => String(r.created_by))
      if (owners.every((o) => o === user) || (await isPrivileged(user))) return
      throw new AppError(
        'PermissionError',
        'A scheduled email sends this report, so only the person who set up that schedule can change it',
      )
    },
  },
}

export default controller
