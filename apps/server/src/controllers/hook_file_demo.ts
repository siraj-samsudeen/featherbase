import type { DocTypeController } from '../controllers'
import { AppError } from '../errors'

// Reference controller proving file-based registration (DOC-004).
// Applies to the 'Hook File Demo' DocType (fields: title Data, slug Data).
const controller: DocTypeController = {
  doctype: 'Hook File Demo',
  hooks: {
    validate: ({ doc }) => {
      if (doc.title === 'forbidden')
        throw new AppError('ValidationError', 'title may not be "forbidden"', {
          title: 'this title is not allowed',
        })
    },
    before_save: ({ doc }) => {
      if (typeof doc.title === 'string')
        doc.slug = doc.title.toLowerCase().replace(/\s+/g, '-')
    },
  },
}

export default controller
