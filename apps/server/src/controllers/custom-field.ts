import type { DocTypeController } from '../controllers'
import { applyCustomField, removeCustomField } from '../custom-fields'
import type { CustomFieldRec } from '../custom-fields'

// CUST-001: materialize / tear down the docfield + column when a Custom
// Field record is created or deleted.
const controller: DocTypeController = {
  doctype: 'Custom Field',
  hooks: {
    after_insert: async ({ doc, tx }) => {
      await applyCustomField(doc as unknown as CustomFieldRec, tx)
    },
    on_trash: async ({ doc }) => {
      await removeCustomField(String(doc.dt), String(doc.fieldname))
    },
  },
}

export default controller
