import type { TableController } from '../controllers'
import { applyCustomField, removeCustomField } from '../custom-fields'
import type { CustomFieldRec } from '../custom-fields'

// CUST-001: materialize / tear down the column_def + column when a Custom
// Field record is created or deleted.
const controller: TableController = {
  table: 'Custom Field',
  hooks: {
    after_insert: async ({ row, tx }) => {
      await applyCustomField(row as unknown as CustomFieldRec, tx)
    },
    on_trash: async ({ row }) => {
      await removeCustomField(String(row.dt), String(row.column_name))
    },
  },
}

export default controller
