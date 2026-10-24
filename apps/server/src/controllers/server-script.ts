import type { TableController } from '../controllers'
import { assertTargetNotSystemWritten } from '../system-written'

// #432: a Document Event script on a system-written Table could rewrite or
// drop the audit row it fires on, so none may target one.
const controller: TableController = {
  table: 'Server Script',
  hooks: {
    validate: ({ row }) => assertTargetNotSystemWritten(row.ref_table, 'scripted'),
  },
}

export default controller
