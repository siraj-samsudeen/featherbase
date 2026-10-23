// The one sign-in pipeline (person-identities, design D3). Every method —
// password, Google, a connected HR system, and any kind added later — supplies
// only a verify step returning a VerifiedIdentity. Everything after it is
// here and shared: resolve the person (linked subject → one-time invite →
// the method's rule for people it does not know), check eligibility, act on a
// leaver, issue the session with its method and identity, and audit.
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { logActivity } from './audit'
import { saveDoc } from './document'
import { INVALID_CREDENTIALS, burnPasswordCheck, findPasswordAccount, issueSession, verifyPassword, type IssuedSession } from './auth'
import {
  KINDS,
  auditIdentity,
  candidate,
  disableLeaver,
  domainAllowed,
  foldName,
  methodOfKind,
  newIdentityId,
  newPersonId,
  normaliseEmail,
  touchIdentity,
  type SignInMethod,
} from './identities'

export type VerifyStatus = 'verified' | 'rejected' | 'left' | 'unavailable'

/** What a method's verify step returns. Only `status` is required; a kind
 *  supplies what it can vouch for (see KINDS). */
export interface VerifiedIdentity {
  status: VerifyStatus
  subject?: string
  sign_in_name?: string
  email?: string | null
  email_verified?: boolean
  display_name?: string | null
  hosted_domain?: string | null
}

/** A person found from what they typed, before credentials were checked. */
export interface Found {
  user: string
  identity: string | null
}

const NOT_PROVISIONED = 'Access not provisioned for this account. Contact IT.'
const CONSUMER_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export function unavailableError(method: SignInMethod): AppError {
  return new AppError(
    'ServiceUnavailableError',
    `${method.label || method.key} is not responding right now. This is not your password — please try again in a few minutes.`,
  )
}

export function leftError(method: SignInMethod): AppError {
  return new AppError('PermissionError', `${method.label || method.key} shows this account as no longer active. Contact your administrator.`)
}

/** ONE refusal for a person who may not sign in this way (#137): disabled,
 *  service account, or privileged through a method that may not admit them. */
export async function assertEligible(method: SignInMethod, user: string): Promise<void> {
  const c = await candidate(user)
  if (!c || !c.enabled || c.user_type === 'service' || (c.privileged && !KINDS[method.kind].admitsPrivileged))
    throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
}

/** Domain admission (design D4): a verified email on an allowed domain; for a
 *  kind that reports a hosted domain, a company domain must also match it, so
 *  a personal account registered on a company address is not that company's. */
export function domainAdmitted(method: SignInMethod, v: VerifiedIdentity): { ok: boolean; reason: string } {
  if (!v.email_verified || !v.email) return { ok: false, reason: 'no verified email' }
  if (!domainAllowed(method, v.email)) return { ok: false, reason: 'domain not allowed' }
  if (!KINDS[method.kind].hostedDomain) return { ok: true, reason: 'allowed domain' }
  const domain = v.email.split('@')[1] ?? ''
  if (CONSUMER_DOMAINS.has(domain) || method.allowed_email_domains.split(',').map(foldName).includes('*'))
    return { ok: true, reason: 'allowed domain' }
  return v.hosted_domain === domain
    ? { ok: true, reason: 'allowed company domain' }
    : { ok: false, reason: v.hosted_domain ? 'hosted domain differs' : 'no hosted-domain claim for a company domain' }
}

async function linkedBySubject(method: SignInMethod, subject: string): Promise<Found | null> {
  const [row] = await sql`select id, user_id from user_identity where method = ${method.key} and subject = ${subject}`
  return row ? { user: String(row.user_id), identity: String(row.id) } : null
}

/** Claim a one-time invite for a verified address, onto an eligible owner only
 *  (design D5, review M1). Null when there is none to claim. */
async function claimInvite(method: SignInMethod, v: VerifiedIdentity): Promise<Found | null> {
  if (!KINDS[method.kind].verifiedEmail || !v.email_verified || !v.email || !v.subject) return null
  try {
    const claimed = await withTransaction(async () => {
      const [invite] = await sql`
        select id, user_id from user_identity
        where method = ${method.key} and subject is null and pending_email = ${foldName(v.email!)}
        for update`
      if (!invite) return null
      await assertEligible(method, String(invite.user_id))
      await sql`
        update user_identity set subject = ${v.subject!}, pending_email = null, linked_at = now(),
          linked_by = 'first-sign-in', email = ${v.email!}, display_name = ${v.display_name ?? null}, last_used_at = now()
        where id = ${String(invite.id)}`
      return { user: String(invite.user_id), identity: String(invite.id) }
    })
    if (claimed) await auditIdentity(claimed.user, 'claimed', claimed.user, method.key, claimed.identity!)
    return claimed
  } catch (err) {
    // Lost a race to the same subject (review minor 5): the winner linked it.
    if ((err as { code?: string })?.code === '23505') return linkedBySubject(method, v.subject)
    throw err
  }
}

/** The method's rule for a person it does not know (design D4). */
async function newPerson(method: SignInMethod, v: VerifiedIdentity): Promise<Found> {
  const kind = KINDS[method.kind]
  let admitted = false
  let reason = 'rule is refuse'
  if (method.new_person === 'create' && kind.trustedSubject) {
    admitted = true
    reason = 'rule is create'
  } else if (method.new_person === 'create_if_email_domain_allowed' && kind.verifiedEmail) {
    ;({ ok: admitted, reason } = domainAdmitted(method, v))
  }
  if (!admitted || !v.subject) {
    // Server-side only, never the address itself (review minor 9).
    console.warn(`[sign-in] ${method.key}: unknown person refused (${reason}; hd ${v.hosted_domain ? 'present' : 'absent'})`)
    throw new AppError('AuthenticationError', NOT_PROVISIONED)
  }
  const email = v.email_verified ? normaliseEmail(v.email) : null
  // An opaque, permanent id — the address is contact data, not the anchor.
  const rowId = newPersonId()
  try {
    return await withTransaction(async () => {
      const [taken] = await sql`
        select 1 from "user"
        where ${email}::text is not null and (lower(email) = ${email ? foldName(email) : ''} or lower(row_id) = ${email ? foldName(email) : ''})`
      // Never turned into a link: an address already in use belongs to someone
      // an administrator must decide about.
      if (taken) throw new AppError('AuthenticationError', 'An account already uses this address. Contact your administrator.')
      const created = await saveDoc(
        'User',
        { row_id: rowId, email, full_name: v.display_name || email || rowId, enabled: true, roles: [] },
        'Administrator',
      )
      const id = newIdentityId()
      await sql`insert into user_identity ${sql({
        id,
        user_id: String(created.row_id),
        method: method.key,
        subject: v.subject!,
        email,
        display_name: v.display_name ?? null,
        linked_by: 'new-person',
        last_used_at: new Date(),
      })}`
      await auditIdentity(String(created.row_id), 'linked', String(created.row_id), method.key, id)
      return { user: String(created.row_id), identity: id }
    })
  } catch (err) {
    // Two first sign-ins with one subject: the loser signs in as the winner.
    if ((err as { code?: string })?.code === '23505') {
      const winner = await linkedBySubject(method, v.subject)
      if (winner) return winner
      throw new AppError('AuthenticationError', 'An account already uses this address. Contact your administrator.')
    }
    throw err
  }
}

/** Resolve a verified outside identity to a person: linked subject, then a
 *  one-time invite, then the method's rule. Never by email match alone. */
export async function resolveVerified(method: SignInMethod, v: VerifiedIdentity): Promise<Found> {
  if (!v.subject) throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  const linked = await linkedBySubject(method, v.subject)
  if (linked) return linked
  const claimed = await claimInvite(method, v)
  if (claimed) return claimed
  // A concurrent claim may have linked it a moment ago.
  return (await linkedBySubject(method, v.subject)) ?? newPerson(method, v)
}

/** The shared tail of every sign-in. `found` is the person a candidate-first
 *  kind resolved before verifying; redirect kinds pass null. */
export async function completeSignIn(
  method: SignInMethod,
  v: VerifiedIdentity,
  found: Found | null,
  opts: { testMode?: boolean } = {},
): Promise<IssuedSession> {
  if (!method.enabled) throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  if (v.status === 'unavailable') throw unavailableError(method)
  if (v.status === 'rejected') throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  if (v.status === 'left') {
    // Refused everywhere (review M4): disabling the person ends every session
    // and every other way in; history is kept.
    if (found) await disableLeaver(found.user, method.key)
    throw leftError(method)
  }
  const person = found ?? (await resolveVerified(method, v))
  await assertEligible(method, person.user)
  if (person.identity)
    await touchIdentity(person.identity, {
      email: v.email_verified ? v.email ?? null : null,
      display_name: v.display_name ?? null,
    })
  return issueSession(person.user, {
    method: method.key,
    ...(person.identity ? { identity: person.identity } : {}),
    ...(opts.testMode ? { testMode: true } : {}),
  })
}

/** Link a verified outside identity to the signed-in person who started a
 *  link flow (design D6). The caller has checked the session. */
export async function linkVerifiedToSelf(method: SignInMethod, user: string, v: VerifiedIdentity): Promise<string> {
  if (!KINDS[method.kind].trustedSubject || !v.subject)
    throw new AppError('PermissionError', 'This sign-in method cannot be linked by its owner')
  try {
    return await withTransaction(async () => {
      const linked = await linkedBySubject(method, v.subject!)
      if (linked?.user === user) return linked.identity!
      if (linked) throw new AppError('ConflictError', 'This account is already linked to another person')
      if (v.email_verified && v.email) {
        const [invite] = await sql`
          select id, user_id from user_identity
          where method = ${method.key} and subject is null and pending_email = ${foldName(v.email)} for update`
        if (invite && invite.user_id !== user)
          throw new AppError('ConflictError', 'This address is reserved for another account. Contact your administrator.')
        if (invite) await sql`delete from user_identity where id = ${String(invite.id)}`
      }
      const id = newIdentityId()
      await sql`insert into user_identity ${sql({
        id,
        user_id: user,
        method: method.key,
        subject: v.subject!,
        email: v.email_verified ? v.email ?? null : null,
        display_name: v.display_name ?? null,
        linked_by: 'self',
      })}`
      await auditIdentity(user, 'linked', user, method.key, id)
      return id
    })
  } catch (err) {
    if ((err as { code?: string })?.code === '23505')
      throw new AppError('ConflictError', 'This account is already linked to another person')
    throw err
  }
}

// ------------------------------------------------------------------ kinds
// Each kind's verify step. Password and delegated kinds find the person from
// what was typed BEFORE checking credentials, so an unknown name never reaches
// a credential check that could tell it apart (no oracle); Google verifies
// first and is resolved by subject.

/** Featherbase's own password: the User id (or contact email) and its hash. */
export async function passwordSignIn(usr: string, pwd: string): Promise<IssuedSession> {
  const method = await methodOfKind('password')
  const account = await findPasswordAccount(usr)
  if (!method?.enabled || !account?.password_hash) {
    // As slow as a real check, so timing does not tell names apart.
    burnPasswordCheck(pwd)
    throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  }
  const ok = verifyPassword(pwd, String(account.password_hash))
  return completeSignIn(method, { status: ok ? 'verified' : 'rejected' }, { user: String(account.row_id), identity: null })
}
