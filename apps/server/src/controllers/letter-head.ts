import type { TableController } from '../controllers'

// PRN-004: at most one Letter Head is the default. When a letterhead is saved
// with is_default set, clear the flag on every other one — the print pipeline
// resolves "the default" with `limit 1`, so a single winner must be
// guaranteed. Runs before the row itself is written, inside the transaction.
const controller: TableController = {
  table: 'Letter Head',
  hooks: {
    before_save: async ({ row, tx }) => {
      if (!row.is_default) return
      // The row's id is resolved before before_save runs, on insert as on update.
      const self = String(row.row_id)
      await tx`
        update letter_head set is_default = false
        where is_default = true and row_id <> ${self}`
    },
  },
}

export default controller
