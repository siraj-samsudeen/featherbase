import type { TableController } from '../controllers'
import { applyCustomField, removeCustomField } from '../custom-fields'
import { getMeta } from '../meta'
import { assertNotSystemWritten } from '../system-written'
import type { CustomFieldRec } from '../custom-fields'

// CUST-001: materialize / tear down the column_def + column when a Custom
// Field record is created or deleted.
const controller: TableController = {
  table: 'Custom Field',
  hooks: {
    // #432: refuse before anything is written, not mid-transaction.
    validate: async ({ row }) => {
      if (typeof row.dt === 'string' && row.dt) assertNotSystemWritten(await getMeta(row.dt), 'changed')
    },
    after_insert: async ({ row, tx }) => {
      await applyCustomField(row as unknown as CustomFieldRec, tx)
    },
    on_trash: async ({ row }) => {
      await removeCustomField(String(row.dt), String(row.column_name))
    },
  },
}

export default controller
