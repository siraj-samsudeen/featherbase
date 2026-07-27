import type { TableController } from '../controllers'
import { invalidateMeta } from '../meta'

// CUST-002: any change to a Metadata Override must refresh the target's
// effective metadata (overlays are applied at meta load time).
const controller: TableController = {
  table: 'Metadata Override',
  hooks: {
    after_save: ({ row }) => {
      if (typeof row.table_name === 'string') invalidateMeta(row.table_name)
    },
    on_trash: ({ row }) => {
      if (typeof row.table_name === 'string') invalidateMeta(row.table_name)
    },
  },
}

export default controller
