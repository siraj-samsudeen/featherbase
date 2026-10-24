import type { TableController } from '../controllers'
import { assertMetadataOverride, invalidateMeta } from '../meta'
import { assertTargetNotSystemWritten } from '../system-written'

// CUST-002: any change to a Metadata Override must refresh the target's
// effective metadata (overlays are applied at meta load time).
const controller: TableController = {
  table: 'Metadata Override',
  hooks: {
    validate: async ({ row }) => {
      assertMetadataOverride(row.property, row.column_name)
      // #432: even a cosmetic override (hidden) could hide an audit column.
      await assertTargetNotSystemWritten(row.table_name, 'overridden')
    },
    after_save: ({ row }) => {
      if (typeof row.table_name === 'string') invalidateMeta(row.table_name)
    },
    on_trash: ({ row }) => {
      if (typeof row.table_name === 'string') invalidateMeta(row.table_name)
    },
  },
}

export default controller
