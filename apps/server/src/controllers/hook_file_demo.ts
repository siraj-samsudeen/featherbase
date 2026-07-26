import type { TableController } from '../controllers'
import { AppError } from '../errors'

// Reference controller proving file-based registration (DOC-004).
// Applies to the 'Hook File Demo' Table (columns: title Data, slug Data).
const controller: TableController = {
  table: 'Hook File Demo',
  hooks: {
    validate: ({ row }) => {
      if (row.title === 'forbidden')
        throw new AppError('ValidationError', 'title may not be "forbidden"', {
          title: 'this title is not allowed',
        })
    },
    before_save: ({ row }) => {
      if (typeof row.title === 'string')
        row.slug = row.title.toLowerCase().replace(/\s+/g, '-')
    },
  },
}

export default controller
