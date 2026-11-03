import type { TableController } from '../controllers'
import { applyCustomField, assertCustomFieldName, removeCustomField } from '../custom-fields'
import { assertTargetNotSystemWritten } from '../system-written'
import type { CustomFieldRec } from '../custom-fields'
import { columnSchema } from '../table-engine'
import { AppError } from '../errors'
import { invalidateMeta } from '../meta'

// CUST-001: materialize / tear down the column_def + column when a Custom
// Field record is created or deleted.
const controller: TableController = {
  table: 'Custom Field',
  hooks: {
    // #432: refuse before anything is written, not mid-transaction.
    validate: async ({ row }) => {
      assertCustomFieldName(row.column_name)
      await assertTargetNotSystemWritten(row.dt, 'changed')
    },
    after_insert: async ({ row, tx }) => {
      await applyCustomField(row as unknown as CustomFieldRec, tx)
    },
    after_save: async ({ row, isNew, tx }) => {
      if (isNew) return
      if (!columnSchema.shape.choice_labels.safeParse(row.choice_labels).success)
        throw new AppError('ValidationError', 'choice_labels must map choice values to strings', { choice_labels: 'Expected an object of strings' })
      await tx`update column_def set choice_labels = ${row.choice_labels == null ? null : tx.json(row.choice_labels as Record<string, string>)}
        where parent = ${String(row.dt)} and column_name = ${String(row.column_name)} and custom = true`
      invalidateMeta(String(row.dt))
    },
    on_trash: async ({ row }) => {
      // Deleting runs no validate; removing the field changes the columns too.
      await assertTargetNotSystemWritten(row.dt, 'changed')
      await removeCustomField(String(row.dt), String(row.column_name))
    },
  },
}

export default controller
