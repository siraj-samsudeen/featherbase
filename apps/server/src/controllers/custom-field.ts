import type { TableController } from '../controllers'
import { applyCustomField, removeCustomField } from '../custom-fields'
import { assertTargetNotSystemWritten } from '../system-written'
import type { CustomFieldRec } from '../custom-fields'

// CUST-001: materialize / tear down the column_def + column when a Custom
// Field record is created or deleted.
const controller: TableController = {
  table: 'Custom Field',
  hooks: {
    // #432: refuse before anything is written, not mid-transaction.
    validate: ({ row }) => assertTargetNotSystemWritten(row.dt, 'changed'),
    after_insert: async ({ row, tx }) => {
      await applyCustomField(row as unknown as CustomFieldRec, tx)
    },
    on_trash: async ({ row }) => {
      // Deleting runs no validate; removing the field changes the columns too.
      await assertTargetNotSystemWritten(row.dt, 'changed')
      await removeCustomField(String(row.dt), String(row.column_name))
    },
  },
}

export default controller
