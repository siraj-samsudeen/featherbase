import type { TableController } from '../controllers'
import { invalidateMeta } from '../meta'

// CUST-002: any change to a Property Setter must refresh the target's
// effective metadata (overlays are applied at meta load time).
const controller: TableController = {
  table: 'Property Setter',
  hooks: {
    after_save: ({ row }) => {
      if (typeof row.ref_table === 'string') invalidateMeta(row.ref_table)
    },
    on_trash: ({ row }) => {
      if (typeof row.ref_table === 'string') invalidateMeta(row.ref_table)
    },
  },
}

export default controller
