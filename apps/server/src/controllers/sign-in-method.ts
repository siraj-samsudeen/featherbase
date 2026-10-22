import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { KINDS, METHOD_TABLE, assertNoAdminLockout, type MethodKind } from '../identities'
import { wireFrom } from '../delegated-login'

// person-identities (D2): a Sign In Method row is configuration. Its policy
// values are checked against what the kind's adapter can vouch for, a unique
// kind (password, Google) has one row, a delegated row's wire format must
// parse, and no change may leave an Administrator or System Manager with no
// way in — counting only methods that can actually sign someone in.
const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true'

function parseSettings(v: unknown): Record<string, unknown> | null {
  if (v == null || v === '') return null
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, unknown>
    } catch {
      throw new AppError('ValidationError', 'settings must be JSON', { settings: 'not JSON' })
    }
  }
  return v as Record<string, unknown>
}

const controller: TableController = {
  table: METHOD_TABLE,
  hooks: {
    before_validate: async ({ row, old, isNew, tx }) => {
      const kind = String(row.kind ?? old?.kind ?? '') as MethodKind
      const caps = KINDS[kind]
      if (!caps) throw new AppError('ValidationError', `Unknown kind "${kind}"`, { kind: 'password, google or delegated_password' })
      if (!isNew && old && row.kind !== undefined && row.kind !== old.kind)
        throw new AppError('ValidationError', 'A sign-in method cannot change kind', { kind: 'fixed once created' })
      const newPerson = String(row.new_person ?? old?.new_person ?? 'refuse')
      if (newPerson === 'create' && !caps.trustedSubject)
        throw new AppError('ValidationError', 'This method cannot vouch for a permanent ID, so it cannot create accounts', {
          new_person: 'refuse',
        })
      if (newPerson === 'create_if_email_domain_allowed' && !caps.verifiedEmail)
        throw new AppError('ValidationError', 'This method does not return a verified email address', {
          new_person: kind === 'password' ? 'create or refuse' : 'refuse',
        })
      const selfLink = row.self_link !== undefined ? truthy(row.self_link) : truthy(old?.self_link)
      if (selfLink && !caps.trustedSubject)
        throw new AppError('ValidationError', 'People cannot link this method themselves: it cannot vouch for a permanent ID', {
          self_link: 'off',
        })
      if (isNew && caps.unique) {
        const [other] = await tx`select row_id from sign_in_method where kind = ${kind}`
        if (other) throw new AppError('ConflictError', `There is already a ${kind} sign-in method (${other.row_id as string})`)
      }
      if (kind === 'delegated_password' && row.settings !== undefined) {
        try {
          wireFrom(parseSettings(row.settings))
        } catch (err) {
          throw new AppError('ValidationError', (err as Error).message, { settings: (err as Error).message })
        }
      }
    },
    before_save: async ({ row, old, isNew, tx }) => {
      if (isNew || !old) return
      const enabledChanged = row.enabled !== undefined && truthy(old.enabled) !== truthy(row.enabled)
      const clientChanged = row.client_id !== undefined && String(row.client_id ?? '') !== String(old.client_id ?? '')
      if (!enabledChanged && !clientChanged) return
      await assertNoAdminLockout(
        String(old.row_id),
        {
          enabled: row.enabled !== undefined ? truthy(row.enabled) : truthy(old.enabled),
          client_id: String((row.client_id !== undefined ? row.client_id : old.client_id) ?? ''),
        },
        tx,
      )
    },
    on_trash: async ({ row, tx }) => {
      if (row.kind === 'password')
        throw new AppError('ValidationError', 'The password sign-in method cannot be deleted; turn it off instead')
      await assertNoAdminLockout(String(row.row_id), null, tx)
      const [{ n }] = await tx`select count(*)::int as n from user_identity where method = ${String(row.row_id)}`
      if (n > 0)
        throw new AppError('ConflictError', `${n} linked sign-in(s) use this method; remove them first or turn the method off`)
    },
  },
}

export default controller
