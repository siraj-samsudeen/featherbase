import type { DocTypeController } from '../controllers'
import { invalidateMeta } from '../meta'

// CUST-002: any change to a Property Setter must refresh the target's
// effective metadata (overlays are applied at meta load time).
const controller: DocTypeController = {
  doctype: 'Property Setter',
  hooks: {
    after_save: ({ doc }) => {
      if (typeof doc.doc_type === 'string') invalidateMeta(doc.doc_type)
    },
    on_trash: ({ doc }) => {
      if (typeof doc.doc_type === 'string') invalidateMeta(doc.doc_type)
    },
  },
}

export default controller
