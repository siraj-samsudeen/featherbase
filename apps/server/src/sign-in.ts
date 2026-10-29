// The one sign-in pipeline (person-identities, design D3). Every method —
// password, Google, a connected HR system, and any kind added later — supplies
// only a verify step returning a VerifiedIdentity. Everything after it is
// here and shared: resolve the person (linked subject → one-time invite →
// the method's rule for people it does not know), check eligibility, act on a
// leaver, issue the session with its method and identity, and audit.
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { saveDoc } from './document'
import { writeThroughIdentity } from './person-identifiers'
import { alertNewArrival, isMockProvider } from './waiting-for-access'
import { INVALID_CREDENTIALS, burnPasswordCheck, findPasswordAccount, issueSession, verifyPassword, type IssuedSession } from './auth'
import {
  KINDS,
  auditIdentity,
  candidate,
  consumeExpectedSignIn,
  disableLeaver,
  DOMAIN_RULED_LINKS,
  domainAllowed,
  foldName,
  listsDomains,
  methodOfKind,
  newIdentityId,
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
interface Found {
  user: string
  identity: string | null
  /** Who made the link a sign-in came through (#693). */
  linkedBy?: string
}

export const NOT_PROVISIONED = 'Access not provisioned for this account. Contact IT.'
export const ADDRESS_IN_USE = 'An account already uses this address. Contact your administrator.'
const CONSUMER_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export const GOOGLE_OFF = 'Google sign-in is not configured'
/** #693: a person may link only an account the method's domains admit. */
export const LINK_DOMAIN_NOT_ALLOWED = 'This account is not on a domain this sign-in method allows. Link your work account instead.'

/** The reasons a browser-navigation sign-in (the Google callback) can be
 *  refused, as the short code the sign-in page explains. Only the code
 *  travels — never the address, the domain or the server's message. */
type SignInRefusal = 'not_provisioned' | 'not_allowed' | 'address_in_use' | 'google_off' | 'expired' | 'google_failed'

export function signInRefusal(err: unknown): SignInRefusal {
  if (!(err instanceof AppError)) return 'google_failed'
  if (err.message === NOT_PROVISIONED) return 'not_provisioned'
  if (err.message === ADDRESS_IN_USE) return 'address_in_use'
  if (err.message === GOOGLE_OFF) return 'google_off'
  // A disabled person, a method that may not admit them, a leaver.
  if (err.message === INVALID_CREDENTIALS || err.type === 'PermissionError') return 'not_allowed'
  // Google itself failed to answer the exchange: not this browser's state.
  if (/^Google /.test(err.message)) return 'google_failed'
  // The login challenge: missing, from another browser, forged or too old.
  if (/state|token|expired|signature/i.test(err.message)) return 'expired'
  return 'google_failed'
}

function unavailableError(method: SignInMethod): AppError {
  return new AppError(
    'ServiceUnavailableError',
    `${method.label || method.key} is not responding right now. This is not your password — please try again in a few minutes.`,
  )
}

function leftError(method: SignInMethod): AppError {
  return new AppError('PermissionError', `${method.label || method.key} shows this account as no longer active. Contact your administrator.`)
}

/** ONE refusal for a person who may not sign in this way (#137): unknown
 *  (a service account is not a person), disabled, or privileged through a
 *  method that may not admit them. */
export async function assertEligible(method: SignInMethod, user: string): Promise<void> {
  const c = await candidate(user)
  if (!c || !c.enabled || (c.privileged && !KINDS[method.kind].admitsPrivileged))
    throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
}

/** Domain admission (design D4): a verified email on an allowed domain; for a
 *  kind that reports a hosted domain, a company domain must also match it, so
 *  a personal account registered on a company address is not that company's. */
function domainAdmitted(method: SignInMethod, v: VerifiedIdentity): { ok: boolean; reason: string } {
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
  // person-resolution D5: an ended identity never opens an account.
  const [row] = await sql`select id, person_id, linked_by from sign_in_identity where method = ${method.key} and subject = ${subject} and ended_at is null`
  return row ? { user: String(row.person_id), identity: String(row.id), linkedBy: String(row.linked_by ?? '') } : null
}

/** #693: does the method's domain rule govern this link? Only while the
 *  method lists domains and only for a kind that vouches for an email. */
function domainRuled(method: SignInMethod): boolean {
  return KINDS[method.kind].verifiedEmail && listsDomains(method)
}

/** #693: a sign-in through a link the domain rule made (DOMAIN_RULED_LINKS)
 *  must still be admitted by it: the list may have narrowed since, and a link
 *  a person made themselves before #693 was never checked. Refused like an
 *  unknown address from a domain that is not allowed. An administrator's link
 *  or a claimed invite was that administrator's decision and is kept. */
function assertLinkStillAdmitted(method: SignInMethod, v: VerifiedIdentity, found: Found): Found {
  if (!domainRuled(method) || !(DOMAIN_RULED_LINKS as readonly string[]).includes(found.linkedBy ?? '')) return found
  const { ok, reason } = domainAdmitted(method, v)
  if (ok) return found
  console.warn(`[sign-in] ${method.key}: linked account refused (${reason}; hd ${v.hosted_domain ? 'present' : 'absent'})`)
  throw new AppError('AuthenticationError', NOT_PROVISIONED)
}

/** Claim a one-time invite for a verified address, onto an eligible owner only
 *  (design D5, review M1). Null when there is none to claim. */
async function claimInvite(method: SignInMethod, v: VerifiedIdentity): Promise<Found | null> {
  if (!KINDS[method.kind].verifiedEmail || !v.email_verified || !v.email || !v.subject) return null
  try {
    const claimed = await withTransaction(async () => {
      const [invite] = await sql`
        select id, person_id from sign_in_identity
        where method = ${method.key} and subject is null and pending_email = ${foldName(v.email!)} and ended_at is null
        for update`
      if (!invite) return null
      await assertEligible(method, String(invite.person_id))
      await sql`
        update sign_in_identity set subject = ${v.subject!}, pending_email = null, linked_at = now(),
          linked_by = 'first-sign-in', email = ${v.email!}, display_name = ${v.display_name ?? null},
          hosted_domain = ${v.hosted_domain ?? null}, last_used_at = now()
        where id = ${String(invite.id)}`
      await writeThroughIdentity(String(invite.id))
      await consumeExpectedSignIn(String(invite.person_id), method)
      return { user: String(invite.person_id), identity: String(invite.id) }
    })
    if (claimed) await auditIdentity(claimed.user, 'claimed', claimed.user, method.key, claimed.identity!)
    return claimed
  } catch (err) {
    // Lost a race to the same subject (review minor 5): the winner linked it.
    if ((err as { code?: string })?.code === '23505') return linkedBySubject(method, v.subject)
    throw err
  }
}

/** #473: link the first Google sign-in to the person a System Manager marked
 *  as expecting it — only when ALL hold: the mark is set; Google verified the
 *  address; the address is admitted by the method's domains (and, for a
 *  company domain, Google's hosted-domain claim agrees — domainAdmitted); it
 *  is that person's own address, compared folded; the person is enabled and
 *  eligible; and they have no current Google sign-in, linked or invited. The
 *  mark is consumed in the same transaction. Null when any fails, so the
 *  caller falls through to today's answer (refused, or a new person). */
async function claimExpectedSignIn(method: SignInMethod, v: VerifiedIdentity): Promise<Found | null> {
  if (method.kind !== 'google' || !v.subject || !v.email_verified || !v.email) return null
  if (!domainAdmitted(method, v).ok) return null
  const address = foldName(v.email)
  try {
    return await withTransaction(async () => {
      const people = await sql`
        select row_id, email, enabled, replaced_by, expects_google_sign_in from person
        where lower(email) = ${address} limit 2 for update`
      // One holder only: two people on one address is for an administrator.
      if (people.length !== 1) return null
      const [p] = people
      const person = String(p.row_id)
      if (p.expects_google_sign_in !== true || p.enabled !== true || p.replaced_by != null) return null
      if (foldName(String(p.email ?? '')) !== address) return null
      const [held] = await sql`
        select 1 from sign_in_identity where person_id = ${person} and method = ${method.key} and ended_at is null limit 1`
      if (held) return null
      const c = await candidate(person)
      if (!c || !c.enabled || (c.privileged && !KINDS[method.kind].admitsPrivileged)) return null
      if (!(await consumeExpectedSignIn(person, method))) return null
      const id = newIdentityId()
      await sql`insert into sign_in_identity ${sql({
        id,
        person_id: person,
        method: method.key,
        subject: v.subject!,
        email: v.email!,
        display_name: v.display_name ?? null,
        linked_by: 'expected-sign-in',
        hosted_domain: v.hosted_domain ?? null,
        last_used_at: new Date(),
      })}`
      await writeThroughIdentity(id)
      // A system action: no person did it in that moment; the method is named.
      await auditIdentity('system', 'linked_on_expected_sign_in', person, method.key, id)
      return { user: person, identity: id }
    })
  } catch (err) {
    // The same Google account linked a moment ago by a concurrent sign-in.
    if ((err as { code?: string })?.code === '23505') return linkedBySubject(method, v.subject)
    throw err
  }
}

/** A new person's starting name: their display name, or the part of the
 *  address before the @ — never the address itself (#429). An administrator
 *  can correct it. */
function starterName(v: VerifiedIdentity, email: string | null): string | null {
  const shown = v.display_name?.trim() || ''
  if (shown && !shown.includes('@')) return shown
  return (shown || email || '').split('@')[0] || null
}

async function newPerson(method: SignInMethod, v: VerifiedIdentity, opts: { testMode?: boolean } = {}): Promise<Found> {
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
  try {
    const found = await withTransaction(async () => {
      const [taken] = await sql`
        select 1 from person
        where ${email}::text is not null and (lower(email) = ${email ? foldName(email) : ''} or lower(row_id) = ${email ? foldName(email) : ''})`
      // Never turned into a link: an address already in use belongs to someone
      // an administrator must decide about.
      if (taken) throw new AppError('AuthenticationError', ADDRESS_IN_USE)
      // An opaque, permanent id (minted by the Person Table's id pattern) —
      // the address is contact data, not the anchor.
      const created = await saveDoc(
        'Person',
        { email, full_name: starterName(v, email), enabled: true, roles: [] },
        'Administrator',
        'insert',
      )
      const id = newIdentityId()
      await sql`insert into sign_in_identity ${sql({
        id,
        person_id: String(created.row_id),
        method: method.key,
        subject: v.subject!,
        email,
        display_name: v.display_name ?? null,
        linked_by: 'new-person',
        hosted_domain: v.hosted_domain ?? null,
        last_used_at: new Date(),
      })}`
      await writeThroughIdentity(id)
      await auditIdentity(String(created.row_id), 'linked', String(created.row_id), method.key, id)
      return { user: String(created.row_id), identity: id }
    })
    // #429: tell System Managers someone is waiting — never for a test-mode
    // or mock-provider sign-in, which would mail real people. Never throws.
    if (!opts.testMode && !isMockProvider(method)) await alertNewArrival(found.user, method)
    return found
  } catch (err) {
    // Two first sign-ins with one subject: the loser signs in as the winner.
    if ((err as { code?: string })?.code === '23505') {
      const winner = await linkedBySubject(method, v.subject)
      if (winner) return winner
    }
    throw err
  }
}

/** Resolve a verified outside identity to a person: linked subject, then a
 *  one-time invite, then a person marked as expecting it (#473), then the
 *  method's rule. Never by email match alone. */
export async function resolveVerified(method: SignInMethod, v: VerifiedIdentity, opts: { testMode?: boolean } = {}): Promise<Found> {
  if (!v.subject) throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  const linked = await linkedBySubject(method, v.subject)
  if (linked) return assertLinkStillAdmitted(method, v, linked)
  const claimed = await claimInvite(method, v)
  if (claimed) return claimed
  const expected = await claimExpectedSignIn(method, v)
  if (expected) return expected
  // A concurrent claim may have linked it a moment ago.
  const raced = await linkedBySubject(method, v.subject)
  return raced ? assertLinkStillAdmitted(method, v, raced) : newPerson(method, v, opts)
}

/** The shared tail of every sign-in. `found` is the person a candidate-first
 *  kind resolved before verifying; redirect kinds pass null. */
export async function completeSignIn(
  method: SignInMethod,
  v: VerifiedIdentity,
  found: Found | null,
  opts: { testMode?: boolean; ipAddress?: string | null } = {},
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
  const person = found ?? (await resolveVerified(method, v, { testMode: opts.testMode }))
  await assertEligible(method, person.user)
  if (person.identity)
    await touchIdentity(person.identity, {
      email: v.email_verified ? v.email ?? null : null,
      display_name: v.display_name ?? null,
      // #693: the way-in counts need the claim the last sign-in carried.
      ...(KINDS[method.kind].hostedDomain ? { hosted_domain: v.hosted_domain ?? null } : {}),
    })
  return issueSession(person.user, {
    method: method.key,
    ...(person.identity ? { identity: person.identity } : {}),
    ...(opts.testMode ? { testMode: true } : {}),
    ipAddress: opts.ipAddress ?? null,
  })
}

/** Link a verified outside identity to the signed-in person who started a
 *  link flow (design D6). The caller has checked the session. */
export async function linkVerifiedToSelf(method: SignInMethod, user: string, v: VerifiedIdentity): Promise<string> {
  if (!KINDS[method.kind].trustedSubject || !v.subject)
    throw new AppError('PermissionError', 'This sign-in method cannot be linked by its owner')
  // #693: the same domain rule as a first sign-in (verified address, allowed
  // domain, and Google's hosted-domain claim for a company domain), before
  // anything is read or written.
  if (domainRuled(method)) {
    const { ok, reason } = domainAdmitted(method, v)
    if (!ok) {
      console.warn(`[link] ${method.key}: self-link refused (${reason}; hd ${v.hosted_domain ? 'present' : 'absent'})`)
      throw new AppError('PermissionError', LINK_DOMAIN_NOT_ALLOWED)
    }
  }
  try {
    return await withTransaction(async () => {
      const linked = await linkedBySubject(method, v.subject!)
      if (linked?.user === user) return linked.identity!
      if (linked) throw new AppError('ConflictError', 'This account is already linked to another person')
      if (v.email_verified && v.email) {
        const [invite] = await sql`
          select id, person_id from sign_in_identity
          where method = ${method.key} and subject is null and pending_email = ${foldName(v.email)} and ended_at is null for update`
        if (invite && invite.person_id !== user)
          throw new AppError('ConflictError', 'This address is reserved for another account. Contact your administrator.')
        if (invite) await sql`delete from sign_in_identity where id = ${String(invite.id)}`
      }
      const id = newIdentityId()
      await sql`insert into sign_in_identity ${sql({
        id,
        person_id: user,
        method: method.key,
        subject: v.subject!,
        email: v.email_verified ? v.email ?? null : null,
        display_name: v.display_name ?? null,
        linked_by: 'self',
        hosted_domain: v.hosted_domain ?? null,
      })}`
      await writeThroughIdentity(id)
      await consumeExpectedSignIn(user, method)
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
export async function passwordSignIn(usr: string, pwd: string, ipAddress: string | null = null): Promise<IssuedSession> {
  const method = await methodOfKind('password')
  const account = await findPasswordAccount(usr)
  if (!method?.enabled || !account?.password_hash) {
    // As slow as a real check, so timing does not tell names apart.
    burnPasswordCheck(pwd)
    throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  }
  const ok = verifyPassword(pwd, String(account.password_hash))
  return completeSignIn(method, { status: ok ? 'verified' : 'rejected' }, { user: String(account.row_id), identity: null }, { ipAddress })
}
