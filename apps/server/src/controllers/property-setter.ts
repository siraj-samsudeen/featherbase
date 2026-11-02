import type { TableController } from '../controllers'
import { assertMetadataOverride, invalidateMeta } from '../meta'
import { assertTargetNotSystemWritten } from '../system-written'
import { METADATA_OVERRIDE_BOOLEAN_VALUES } from 'shared'
import { AppError } from '../errors'

// CUST-002: any change to a Metadata Override must refresh the target's
// effective metadata (overlays are applied at meta load time).
const controller: TableController = {
  table: 'Metadata Override',
  hooks: {
    validate: async ({ row }) => {
      const kind = assertMetadataOverride(row.property, row.column_name)
      if (kind === 'boolean' && (typeof row.value !== 'string' || !Object.hasOwn(METADATA_OVERRIDE_BOOLEAN_VALUES, row.value)))
        throw new AppError('ValidationError', `Value for ${String(row.property)} must be one of: ${Object.keys(METADATA_OVERRIDE_BOOLEAN_VALUES).join(', ')}`)
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
