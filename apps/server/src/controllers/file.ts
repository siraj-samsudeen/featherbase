import type { DocTypeController } from '../controllers'
import { deleteStored } from '../storage'

// FILE-002: deleting a File doc also removes its storage object, so
// attachments never leave orphaned files on disk.
const controller: DocTypeController = {
  doctype: 'File',
  hooks: {
    on_trash: async ({ doc }) => {
      if (typeof doc.file_url === 'string' && doc.file_url) await deleteStored(doc.file_url)
    },
  },
}

export default controller
