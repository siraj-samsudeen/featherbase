import type { TableController } from '../controllers'
import { deleteStored } from '../storage'

// FILE-002: deleting a File row also removes its storage object, so
// attachments never leave orphaned files on disk.
const controller: TableController = {
  table: 'File',
  hooks: {
    on_trash: async ({ row }) => {
      if (typeof row.file_url === 'string' && row.file_url) await deleteStored(row.file_url)
    },
  },
}

export default controller
