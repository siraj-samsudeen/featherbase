import type { TableController } from '../controllers'
import { assertMetadataOverride, getMeta, invalidateMeta } from '../meta'
import { AppError } from '../errors'
import { assertTargetNotSystemWritten } from '../system-written'
import { METADATA_OVERRIDE_BOOLEAN_VALUES } from 'shared'

// CUST-002: any change to a Metadata Override must refresh the target's
// effective metadata (overlays are applied at meta load time).
const controller: TableController = {
  table: 'Metadata Override',
  hooks: {
    // Serialize these infrequent settings writes before locking an existing
    // row, so creates and retargets cannot both pass the tuple check.
    before_lock: async ({ tx }) => {
      await tx`select pg_advisory_xact_lock(hashtext('metadata-overrides'))`
    },
    validate: async ({ row, tx }) => {
      const kind = assertMetadataOverride(row.property, row.column_name)
      if (kind === 'boolean' && (typeof row.value !== 'string' || !Object.hasOwn(METADATA_OVERRIDE_BOOLEAN_VALUES, row.value)))
        throw new AppError('ValidationError', `Value for ${String(row.property)} must be one of: ${Object.keys(METADATA_OVERRIDE_BOOLEAN_VALUES).join(', ')}`)
      // #432: even a cosmetic override (hidden) could hide an audit column.
      await assertTargetNotSystemWritten(row.table_name, 'overridden')
      if (row.column_name) {
        const meta = await getMeta(String(row.table_name))
        if (!meta.columns.some((column) => column.column_name === row.column_name))
          throw new AppError('ValidationError', `Column ${String(row.column_name)} not found on Table ${meta.name}`)
      }
      const [duplicate] = await tx`select row_id from metadata_override
        where table_name = ${String(row.table_name)} and coalesce(column_name, '') = ${String(row.column_name ?? '')}
          and property = ${String(row.property)} and row_id <> ${String(row.row_id ?? '')} limit 1`
      if (duplicate)
        throw new AppError('ValidationError', 'An adjustment already exists for this Table, column and setting. Edit the existing adjustment instead.')
    },
    after_save: ({ row, old }) => {
      if (typeof row.table_name === 'string') invalidateMeta(row.table_name)
      if (typeof old?.table_name === 'string' && old.table_name !== row.table_name) invalidateMeta(old.table_name)
    },
    on_trash: ({ row }) => {
      if (typeof row.table_name === 'string') invalidateMeta(row.table_name)
    },
  },
}

export default controller
