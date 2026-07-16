import type { DocTypeController } from '../controllers'
import { sql } from '../db'

// PRN-004: at most one Letter Head is the default. When a letterhead is saved
// with is_default set, clear the flag on every other one — the print pipeline
// resolves "the default" with `limit 1`, so a single winner must be
// guaranteed. Runs before the row itself is written, inside the transaction.
const controller: DocTypeController = {
  doctype: 'Letter Head',
  hooks: {
    before_save: async ({ doc, tx }) => {
      if (!doc.is_default) return
      const stx = (tx ?? sql) as typeof sql
      const self = String(doc.name ?? '')
      await stx`
        update tab_letter_head set is_default = false
        where is_default = true and name <> ${self}`
    },
  },
}

export default controller
