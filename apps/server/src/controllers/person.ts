import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { USERNAME_RE, normaliseEmail } from '../identities'
import { mergedInto, writeThroughEmail } from '../person-identifiers'

// person-identities (D9): email is optional contact data — blank means none,
// a `.invalid` placeholder is refused (normaliseEmail). A username is a
// lowercase slug. Neither a username nor a new id may equal another person's
// id, username or email, ignoring case: password sign-in looks all three up,
// and a name shared across them would shadow someone else's sign-in.
const controller: TableController = {
  table: 'Person',
  hooks: {
    // person-resolution D3: identifiers are history and block deleting a
    // person (`on delete restrict`). The rows that only MIRROR the person's
    // own email or sign-ins (write-through) go with the person, like the
    // sign-ins themselves; anything recorded independently still blocks.
    on_trash: async ({ row, tx }) => {
      const [identifiers] = await tx`select to_regclass('featherbase.person_identifier') as r`
      if (!identifiers?.r) return
      await tx`delete from person_identifier where person_id = ${String(row.row_id)} and source in ('person-email', 'self-email', 'sign-in')`
      const [{ n }] = await tx`select count(*)::int as n from person_identifier where person_id = ${String(row.row_id)}`
      if (n > 0)
        throw new AppError('ConflictError', `This person has ${n} recorded identifier(s); end them or disable the person instead`, { code: 'has_identifiers' })
    },
    // person-resolution C7: every address is also an `email` identifier row.
    // The saved row always carries every column, email included.
    after_save: async ({ row, old, user, tx }) => {
      const [identifiers] = await tx`select to_regclass('featherbase.person_identifier') as r`
      if (!identifiers?.r) return
      await writeThroughEmail(String(row.row_id), (old?.email as string | null) ?? null, (row.email as string | null) ?? null, user, tx)
    },
    before_validate: async ({ row, old, isNew, tx }) => {
      // person-rename R1: a person's id is minted by Featherbase (`psn_…`),
      // never typed: Person's opaque id rule refuses a typed one before any
      // hook runs. Built-in is a read-only column, so no save changes it.
      // person-resolution D1: a replaced record is inert; edit its survivor.
      if (!isNew && old?.replaced_by)
        throw await mergedInto(String(old.replaced_by), tx)
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
          select row_id from person
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
