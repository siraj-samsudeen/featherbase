import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { isReservedEmail, normaliseEmail } from '../identities'

// person-identities (D9): email is optional contact data. Blank means none;
// a placeholder on the never-resolving `.invalid` domain is refused like any
// other invalid input, so nothing invented is stored.
const controller: TableController = {
  table: 'User',
  hooks: {
    before_validate: ({ row }) => {
      if ('email' in row && row.email != null && isReservedEmail(String(row.email)))
        throw new AppError('ValidationError', 'That address cannot receive mail', { email: 'not a real address (.invalid)' })
      if ('email' in row) row.email = normaliseEmail(row.email)
      if ('username' in row) row.username = row.username == null ? null : String(row.username).trim().toLowerCase() || null
    },
  },
}

export default controller
