import type { TableController } from '../controllers'
import { assertNotAccessTarget } from '../security-tables'

// #437: a rule stamps its assignee into a column directly, after the save
// that triggered it, so it may never target a column that decides access.
const controller: TableController = {
  table: 'Assignment Rule',
  hooks: {
    validate: ({ row }) => {
      if (typeof row.ref_table === 'string' && row.ref_table)
        assertNotAccessTarget(row.ref_table, String(row.assign_to_field ?? '').trim(), 'An assignment rule')
    },
  },
}

export default controller
