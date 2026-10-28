import type { TableController } from '../controllers'
import { assertDirectWriteAllowed } from '../security-tables'

// #437: a rule stamps its assignee into a column directly, after the save
// that triggered it, so it may never target a column that decides access.
const controller: TableController = {
  table: 'Assignment Rule',
  hooks: {
    validate: async ({ row }) => {
      if (typeof row.ref_table === 'string' && row.ref_table)
        await assertDirectWriteAllowed(row.ref_table, String(row.assign_to_field ?? '').trim(), 'An assignment rule')
    },
  },
}

export default controller
