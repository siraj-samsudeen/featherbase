import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { KINDS, METHOD_TABLE, SIGN_IN_METHOD_KINDS, assertNoAdminLockout, domainListProblem, lockWaysIn, methodUsable, type MethodKind } from '../identities'
import { usableServiceUrl, wireFrom } from '../delegated-login'

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
    // #693: every Sign In Method write takes the ways-in lock BEFORE its row
    // is locked. An identity move takes the same lock and then waits on this
    // row (its foreign key), so the reverse order would deadlock.
    before_lock: async ({ tx }) => {
      await lockWaysIn(tx)
    },
    before_validate: async ({ row, old, isNew, tx }) => {
      // Already held from before_lock; taken again (re-entrant) in case a
      // write path reaches the hooks without it.
      await lockWaysIn(tx)
      const kind = String(row.kind ?? old?.kind ?? '') as MethodKind
      const caps = KINDS[kind]
      if (!caps) throw new AppError('ValidationError', `Unknown kind "${kind}"`, { kind: SIGN_IN_METHOD_KINDS.join(', ') })
      if (!isNew && old && row.kind !== undefined && row.kind !== old.kind)
        throw new AppError('ValidationError', 'A sign-in method cannot change kind', { kind: 'fixed once created' })
      // #693: one reading of the list everywhere, so a typo is refused here
      // rather than read one way by the lockout guard and another by sign-in.
      if (row.allowed_email_domains !== undefined) {
        const problem = domainListProblem(row.allowed_email_domains)
        if (problem) throw new AppError('ValidationError', `Allowed email domains ${problem}`, { allowed_email_domains: problem })
      }
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
      // An enabled method must be able to sign someone in (Codex P2 on #371):
      // Google needs a client id (or the dev mock); a delegated method a usable
      // address. Turn it off instead. Checked after the lockout guard below so
      // a lockout is reported by name first.
      const merged = { ...(old ?? {}), ...row }
      const usableCheck = () => {
        if (!truthy(merged.enabled)) return
        const kind = String(merged.kind)
        if (kind === 'google' && !methodUsable({ kind, enabled: true, client_id: String(merged.client_id ?? '') }))
          throw new AppError('ValidationError', 'Google cannot be on without a client id; set one or turn it off', { client_id: 'required while on' })
        if (kind === 'delegated_password' && !usableServiceUrl(String(merged.service_url ?? '')))
          throw new AppError('ValidationError', 'A connected service needs an https address (or a local stub) while it is on', { service_url: 'https required' })
      }
      if (isNew || !old) return usableCheck()
      const enabledChanged = row.enabled !== undefined && truthy(old.enabled) !== truthy(row.enabled)
      const clientChanged = row.client_id !== undefined && String(row.client_id ?? '') !== String(old.client_id ?? '')
      // #693: links ruled by the domain list stop signing in when it narrows.
      const domainsChanged =
        row.allowed_email_domains !== undefined && String(row.allowed_email_domains ?? '') !== String(old.allowed_email_domains ?? '')
      if (!enabledChanged && !clientChanged && !domainsChanged) return usableCheck()
      await assertNoAdminLockout(
        String(old.row_id),
        {
          enabled: row.enabled !== undefined ? truthy(row.enabled) : truthy(old.enabled),
          client_id: String((row.client_id !== undefined ? row.client_id : old.client_id) ?? ''),
          allowed_email_domains: String((row.allowed_email_domains !== undefined ? row.allowed_email_domains : old.allowed_email_domains) ?? ''),
        },
        tx,
      )
      usableCheck()
    },
    on_trash: async ({ row, tx }) => {
      await lockWaysIn(tx)
      if (row.kind === 'password')
        throw new AppError('ValidationError', 'The password sign-in method cannot be deleted; turn it off instead')
      await assertNoAdminLockout(String(row.row_id), null, tx)
      const [{ n }] = await tx`select count(*)::int as n from sign_in_identity where method = ${String(row.row_id)}`
      if (n > 0)
        throw new AppError('ConflictError', `${n} linked sign-in(s) use this method; remove them first or turn the method off`)
    },
  },
}

export default controller
