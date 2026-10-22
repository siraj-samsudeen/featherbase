import type { TableController } from '../controllers'
import { normaliseEmail } from '../identities'

// person-identities (D9): email is optional contact data. Blank, and an
// address on a domain reserved to never receive mail, are stored as no email,
// so nothing invented is kept whichever path writes the row.
const controller: TableController = {
  table: 'User',
  hooks: {
    before_validate: ({ row }) => {
      if ('email' in row) row.email = normaliseEmail(row.email)
    },
  },
}

export default controller
