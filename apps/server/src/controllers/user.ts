import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { USERNAME_RE, normaliseEmail } from '../identities'

// person-identities (D9): email is optional contact data — blank means none,
// a `.invalid` placeholder is refused (normaliseEmail). A username is a
// lowercase slug. Neither a username nor a new id may equal another person's
// id, username or email, ignoring case: password sign-in looks all three up,
// and a name shared across them would shadow someone else's sign-in.
const controller: TableController = {
  table: 'User',
  hooks: {
    before_validate: async ({ row, old, isNew, tx }) => {
      if ('email' in row) row.email = normaliseEmail(row.email)
      if ('username' in row) {
        const username = row.username == null ? null : String(row.username).trim().toLowerCase() || null
        if (username && !USERNAME_RE.test(username))
          throw new AppError('ValidationError', 'A username is 3–64 lowercase letters, digits, dots, dashes or underscores', { username: 'invalid' })
        row.username = username
      }
      const self = String(row.row_id ?? old?.row_id ?? '')
      const clash = async (value: string, field: string) => {
        const [hit] = await tx`
          select row_id from "user"
          where row_id <> ${self}
            and (lower(row_id) = lower(${value}) or lower(username) = lower(${value}) or lower(email) = lower(${value}))
          limit 1`
        if (hit) throw new AppError('ValidationError', `"${value}" already names another person`, { [field]: 'already in use' })
      }
      if (row.username) await clash(String(row.username), 'username')
      if (isNew && self) await clash(self, 'row_id')
    },
  },
}

export default controller
