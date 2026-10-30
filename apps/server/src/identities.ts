// Person + linked identities (OpenSpec change `person-identities`, #275).
//
// A Person is a human. Outside providers (Google, a connected HR system, …) are
// linked to that person in `sign_in_identity`, keyed by the provider's permanent
// subject — never by email. Featherbase's own password is the person's
// `password_hash` (one home, no identity row). Sign-in methods are rows of the
// system Table "Sign In Method", each with its own policy for people it does
// not recognise. This module owns the records and their rules; the shared
// sign-in pipeline is sign-in.ts, and adapters only verify credentials.
import { randomBytes } from 'node:crypto'
import { sql, type Sql, type TxSql } from './db'
import { AppError } from './errors'
import { logActivity } from './audit'
import { saveDoc } from './document'
import { endIdentityIdentifiers, reconcileIdentityEmail, writeThroughIdentity } from './person-identifiers'
import { SIGN_IN_METHOD_KINDS, type NewPersonRule as SharedNewPersonRule, type SignInMethodKind } from 'shared'
import { switchedOn } from './env'

// ---------------------------------------------------------------- folding

/** The one case/space folding rule for every typed name, sign-in name,
 *  test-mode subject and email comparison. Stored values are trimmed. */
export function foldName(value: string): string {
  return value.trim().toLowerCase()
}

// RFC 2606 reserves the `.invalid` top-level domain for names that must never
// resolve; every placeholder address this codebase and the roster sync ever
// invented uses it. Such an address is not contact data: User saves refuse it
// and migration 0100 clears the existing ones (design D9). Other reserved
// names (example.com, .test) are left alone: tests use them as stand-ins.
export function isReservedEmail(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const domain = foldName(email.slice(at + 1)).replace(/\.$/, '')
  return domain === 'invalid' || domain.endsWith('.invalid')
}

/** What an email is stored as: trimmed, or NULL when blank. A `.invalid`
 *  placeholder is refused (417) on every path — User saves, invites, and a
 *  person created by a sign-in. */
export function normaliseEmail(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  if (isReservedEmail(trimmed))
    throw new AppError('ValidationError', 'That address cannot receive mail', { email: 'not a real address (.invalid)' })
  return trimmed
}

/** A username: a lowercase slug (sign-up and the generic User save share it). */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/

export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

// --------------------------------------------------------- sign-in methods

export type MethodKind = SignInMethodKind
export type NewPersonRule = SharedNewPersonRule
export { SIGN_IN_METHOD_KINDS }

export interface SignInMethod {
  key: string
  kind: MethodKind
  label: string
  enabled: boolean
  new_person: NewPersonRule
  allowed_email_domains: string
  self_link: boolean
  client_id: string
  service_url: string
  /** Kind-specific configuration (a delegated provider's wire format). */
  settings: Record<string, unknown> | null
}

/** What each kind's adapter can vouch for, and how the shared pipeline treats
 *  it (design D2/D3). A new kind — say Microsoft OIDC — is one entry here plus
 *  its verify step and routes; policies, linking, sessions and audit are shared.
 *  - trustedSubject: returns a permanent subject it vouches for (may create people, self-link)
 *  - verifiedEmail: returns an email it has verified (domain admission, invites)
 *  - hostedDomain: returns a Workspace-style domain claim that must agree for a company domain
 *  - candidateFirst: the person is found from what they typed BEFORE credentials are checked
 *  - admitsPrivileged: may sign in an Administrator or System Manager
 *  - unique: at most one row of this kind */
export const KINDS: Record<
  MethodKind,
  { trustedSubject: boolean; verifiedEmail: boolean; hostedDomain: boolean; candidateFirst: boolean; admitsPrivileged: boolean; unique: boolean }
> = {
  password: { trustedSubject: true, verifiedEmail: false, hostedDomain: false, candidateFirst: true, admitsPrivileged: true, unique: true },
  google: { trustedSubject: true, verifiedEmail: true, hostedDomain: true, candidateFirst: false, admitsPrivileged: true, unique: true },
  delegated_password: { trustedSubject: false, verifiedEmail: false, hostedDomain: false, candidateFirst: true, admitsPrivileged: false, unique: false },
}

export const METHOD_TABLE = 'Sign In Method'

// The mock Google provider mints a session for ANY typed email from a
// pre-auth endpoint, so only ALLOW_MOCK_OAUTH=1 turns it on (see oauth.ts).
export function mockOAuthEnabled(): boolean {
  return switchedOn('ALLOW_MOCK_OAUTH')
}

/** Can a method actually sign anyone in? Google also needs a client id (or
 *  the dev mock). Used by every way-in count, so the counts agree. */
export function methodUsable(m: { kind: string; enabled: boolean; client_id?: string | null }): boolean {
  if (!m.enabled) return false
  return m.kind !== 'google' || Boolean(String(m.client_id ?? '').trim()) || mockOAuthEnabled()
}

function toMethod(r: Record<string, unknown>): SignInMethod {
  const settings = r.settings
  return {
    key: String(r.row_id),
    kind: String(r.kind) as MethodKind,
    label: String(r.label ?? '').trim(),
    enabled: r.enabled === true,
    new_person: (String(r.new_person ?? 'refuse') || 'refuse') as NewPersonRule,
    allowed_email_domains: String(r.allowed_email_domains ?? ''),
    self_link: r.self_link === true,
    client_id: String(r.client_id ?? '').trim(),
    service_url: String(r.service_url ?? '').trim(),
    settings: settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : null,
  }
}

const methodFields = () =>
  sql`row_id, kind, label, enabled, new_person, allowed_email_domains, self_link, client_id, service_url, settings`

export async function listSignInMethods(db: Sql | TxSql = sql): Promise<SignInMethod[]> {
  const rows = await db`select ${methodFields()} from sign_in_method order by row_id`
  return rows.map(toMethod)
}

export async function getSignInMethod(key: string): Promise<SignInMethod | null> {
  const [row] = await sql`select ${methodFields()} from sign_in_method where row_id = ${key}`
  return row ? toMethod(row) : null
}

/** The one method of a unique kind (password, google). */
export async function methodOfKind(kind: MethodKind): Promise<SignInMethod | null> {
  const [row] = await sql`select ${methodFields()} from sign_in_method where kind = ${kind} order by row_id limit 1`
  return row ? toMethod(row) : null
}

/** Is `email` on a domain this method admits? Empty admits nobody; `*` all. */
/** The one reading of a method's allowed_email_domains (#693): comma-separated
 *  entries, each trimmed and folded, blanks dropped. Sign-in, the way-in
 *  counts and the lockout guard all use it, so they cannot disagree. */
export function parseDomainList(value: string | null | undefined): string[] {
  return String(value ?? '').split(',').map(foldName).filter(Boolean)
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Why a domain list cannot be saved, or null. Blank means no list. Each
 *  entry must be `*` or a domain such as example.com: no empty entry and no
 *  space inside one, which sign-in would read differently than intended. */
export function domainListProblem(value: unknown): string | null {
  const text = String(value ?? '')
  if (!text.trim()) return null
  for (const entry of text.split(',').map(foldName)) {
    if (!entry) return 'has an empty entry: remove the extra comma'
    if (entry !== '*' && !DOMAIN_RE.test(entry)) return `"${entry}" is not a domain such as example.com, or *`
  }
  return null
}

export function domainAllowed(method: SignInMethod, email: string): boolean {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(foldName(email))
  if (!match) return false
  const domains = parseDomainList(method.allowed_email_domains)
  if (!domains.length) return false
  return domains.includes('*') || domains.includes(match[1])
}

/** Does the method name any allowed domains? An empty list means no domain
 *  rule at all. */
export function listsDomains(method: Pick<SignInMethod, 'allowed_email_domains'>): boolean {
  return parseDomainList(method.allowed_email_domains).length > 0
}

/** #693: links that rest on the method's domain rule rather than on an
 *  administrator's decision: a person linking themselves, a person created by
 *  the rule, and a first sign-in for someone marked as expecting it. While the
 *  method lists allowed domains, a sign-in through one of these must still be
 *  admitted by them. An administrator's link or a claimed invite is that
 *  administrator's decision for that account and is not re-checked. */
export const DOMAIN_RULED_LINKS = ['self', 'new-person', 'expected-sign-in'] as const

/** Google's consumer (personal) domains: an address on one needs no
 *  hosted-domain claim. The one list sign-in, the mock provider and the
 *  way-in counts share (#693). */
export const GOOGLE_CONSUMER_DOMAINS: readonly string[] = ['gmail.com', 'googlemail.com']

/** #693: the one transaction lock every change that can reduce someone's ways
 *  in takes BEFORE it reads domain lists or counts credentials, so two such
 *  changes (narrowing a domain list, removing a password, unlinking) cannot
 *  each count the other's way in and both commit. Re-entrant within a
 *  transaction; held until it ends. Rare administrator actions, so short. */
export const WAYS_IN_LOCK_KEY = 693_0001

export async function lockWaysIn(db: Sql | TxSql): Promise<void> {
  await db`select pg_advisory_xact_lock(${WAYS_IN_LOCK_KEY}::bigint)`
}

/** Each method's parsed domain list as JSON, for keepsDomain. `override`
 *  stands in one method's list after a change (the lockout guard). */
async function domainListsJson(db: Sql | TxSql, override?: { key: string; domains: string }): Promise<string> {
  const rows = await db`select row_id, allowed_email_domains from sign_in_method`
  const lists: Record<string, string[]> = {}
  for (const r of rows) lists[String(r.row_id)] = parseDomainList(r.allowed_email_domains as string | null)
  if (override) lists[override.key] = parseDomainList(override.domains)
  return JSON.stringify(lists)
}

/** SQL twin of the #693 re-check (domainAdmitted in sign-in.ts), for the
 *  way-in counts: would link `i` through method `m` still sign in under that
 *  method's list in `lists` (domainListsJson, so parsed once, in TypeScript)?
 *  A company domain also needs the hosted-domain claim from the link's last
 *  sign-in to match: '' records that Google sent none (never counts). NULL
 *  means never recorded (a link from before migration 0005) and is judged
 *  asymmetrically, so a doubt always refuses the change:
 *  - 'possible' (what a change takes away): it may work, so it counts on its
 *    email domain;
 *  - 'proven' (what remains, and every last-way-in check): only a recorded
 *    matching claim proves a company domain works, so it does not count.
 *  Under `*` or a consumer domain no claim is needed either way. Any
 *  non-empty list, `*` included, needs the link's verified address. The link
 *  list is DOMAIN_RULED_LINKS. */
type WayInProof = 'possible' | 'proven'

function keepsDomain(lists: string, proof: WayInProof) {
  const list = sql`coalesce(${lists}::text::jsonb -> m.row_id::text, '[]'::jsonb)`
  const domain = sql`lower(split_part(i.email, '@', 2))`
  return sql`(
    m.kind <> 'google'
    or coalesce(i.linked_by, '') <> all(${[...DOMAIN_RULED_LINKS]}::text[])
    or jsonb_array_length(${list}) = 0
    or (
      -- A non-empty list, even *, admits only a verified address, exactly as
      -- domainAdmitted does: the last sign-in's verification (email_verified;
      -- NULL on a row from before 0005, whose address was stored verified).
      coalesce(i.email, '') like '%_@_%'
      and coalesce(i.email_verified, true)
      and (${list} ? '*' or ${list} ? ${domain})
      and (${list} ? '*' or ${domain} = any(${[...GOOGLE_CONSUMER_DOMAINS]}::text[]) or lower(i.hosted_domain) = ${domain}
        or (i.hosted_domain is null and ${proof === 'possible'}::boolean))
    )
  )`
}

// ------------------------------------------------------------- identities

interface Identity {
  id: string
  person_id: string
  method: string
  subject: string | null
  sign_in_name: string | null
  email: string | null
  display_name: string | null
  pending_email: string | null
  linked_at: string
  linked_by: string
  last_used_at: string | null
  /** person-resolution D5: an ended identity never opens an account again
   *  and stays as history. */
  ended_at: string | null
  ended_reason: 'left' | 'moved' | 'unlinked' | null
  /** #430: when a pending invite's email last went out; null = never. */
  invitation_sent_at: string | null
}

const identityFields = () =>
  sql`id, person_id, method, subject, sign_in_name, email, display_name, pending_email, linked_at, linked_by, last_used_at,
    ended_at, ended_reason, invitation_sent_at`

/** The one id generator for linked identities. */
export function newIdentityId(): string {
  return 'uid_' + randomBytes(9).toString('base64url')
}

/** #473: once a person has a Google sign-in, by any path, they no longer
 *  expect one — clear the mark so a later unlink cannot reopen linking by
 *  address. `updated_at` moves, so a form loaded before is told to reload
 *  rather than echo the mark back. A no-op for any other kind. */
export async function consumeExpectedSignIn(person: string, method: Pick<SignInMethod, 'kind'>, db: Sql | TxSql = sql): Promise<boolean> {
  if (method.kind !== 'google') return false
  const rows = await db`
    update person set expects_google_sign_in = false, updated_at = now()
    where row_id = ${person} and expects_google_sign_in returning row_id`
  return rows.length > 0
}

/** Who did what to whom, with the actor first (review B-M1). */
export async function auditIdentity(actor: string, verb: string, target: string, method: string, id: string) {
  await logActivity(actor, `identity_${verb} ${method} for ${target} (${id})`.slice(0, 140))
}

/** A person's sign-in identities; ended ones only when asked (the
 *  administrator's panel shows them as history). */
export async function listIdentities(user: string, opts: { includeEnded?: boolean } = {}): Promise<Identity[]> {
  return (await sql`
    select ${identityFields()} from sign_in_identity where person_id = ${user}
      ${opts.includeEnded ? sql`` : sql`and ended_at is null`}
    order by ended_at nulls first, linked_at`) as unknown as Identity[]
}

export async function getIdentity(id: string, db: Sql | TxSql = sql): Promise<Identity> {
  const [row] = await db`select ${identityFields()} from sign_in_identity where id = ${id}`
  if (!row) throw new AppError('NotFoundError', `Linked sign-in ${id} not found`)
  return row as unknown as Identity
}

// Only a person has sign-in methods; a service account is not a person
// (person-rename R2) and authenticates only by token.
async function assertHumanUser(user: string, db: Sql | TxSql = sql) {
  const [row] = await db`select 1 from person where row_id = ${user}`
  if (row) return
  const [service] = await db`select 1 from service_account where row_id = ${user}`
  if (service)
    throw new AppError('ValidationError', 'Service accounts have no sign-in methods — issue an access token instead')
  throw new AppError('NotFoundError', `Person ${user} not found`)
}

/** A 409 the roster sync can act on: which rule clashed, and the identity
 *  and person that already hold it (review minor 3). */
async function clash(method: SignInMethod, what: { subject?: string | null; sign_in_name?: string | null; pending_email?: string | null }): Promise<never> {
  const checks: [string, Promise<Record<string, unknown>[]>][] = []
  if (what.subject)
    checks.push(['subject', sql`select id, person_id from sign_in_identity where method = ${method.key} and subject = ${what.subject} and ended_at is null`])
  if (what.sign_in_name)
    checks.push(['sign_in_name', sql`select id, person_id from sign_in_identity where method = ${method.key} and lower(sign_in_name) = ${foldName(what.sign_in_name)} and ended_at is null`])
  if (what.pending_email)
    checks.push(['invite', sql`select id, person_id from sign_in_identity where method = ${method.key} and subject is null and pending_email = ${what.pending_email} and ended_at is null`])
  // The holder may have ended between the violation and this lookup; then
  // there is no one to name and the answer stays general.
  let held: { kind: string; hit: Record<string, unknown> } | null = null
  for (const [kind, query] of checks) {
    const [hit] = await query
    if (hit && !held) held = { kind, hit }
  }
  const label = held?.kind === 'subject' ? `This ${method.label || method.key} ID` : held?.kind === 'sign_in_name' ? 'This sign-in name' : 'This invited address'
  throw new AppError(
    'ConflictError',
    held ? `${label} is already linked to ${held.hit.person_id as string}` : 'This sign-in is already linked to an account',
    held ? { clash: held.kind, identity: String(held.hit.id), person: String(held.hit.person_id) } : undefined,
  )
}

/** Run one write in its own savepoint; a unique violation becomes `onClash`. */
async function guarded<T>(write: (t: Sql) => Promise<T>, onClash: () => Promise<never>): Promise<T> {
  try {
    return await sql.begin((tx) => write(tx as unknown as Sql)) as T
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') return onClash()
    if ((err as { code?: string })?.code === '23503') throw new AppError('ValidationError', 'Unknown sign-in method or person')
    throw err
  }
}

/** Link a subject (and optional sign-in name) to a person. Posting the same
 *  link again is a no-op that returns it (`created: false`); a clash is a 409. */
export async function linkIdentity(
  user: string,
  input: { method: string; subject: string; sign_in_name?: string | null; email?: string | null; display_name?: string | null },
  actor: string,
): Promise<Identity & { created: boolean }> {
  const method = await getSignInMethod(input.method)
  if (!method || method.kind === 'password')
    throw new AppError('ValidationError', `Unknown outside sign-in method "${input.method}"`)
  const subject = String(input.subject ?? '').trim()
  if (!subject) throw new AppError('ValidationError', 'Expected { subject }', { subject: 'required' })
  const signInName = input.sign_in_name == null ? null : String(input.sign_in_name).trim() || null
  await assertHumanUser(user)
  const [same] = await sql`
    select ${identityFields()} from sign_in_identity where method = ${method.key} and subject = ${subject} and person_id = ${user} and ended_at is null`
  if (same && (same.sign_in_name ?? null) === signInName) return { ...(same as unknown as Identity), created: false }
  if (same) return { ...(await updateIdentity(String(same.id), { sign_in_name: signInName }, actor)), created: false }
  const [row] = await guarded(
    async (t) => {
      const rows = await t`insert into sign_in_identity ${t({
        id: newIdentityId(),
        person_id: user,
        method: method.key,
        subject,
        sign_in_name: signInName,
        email: input.email ?? null,
        display_name: input.display_name ?? null,
        linked_by: actor,
      })} returning ${identityFields()}`
      // person-resolution D5: the identity also becomes an identifier row.
      await writeThroughIdentity(String(rows[0].id), t)
      await consumeExpectedSignIn(user, method, t)
      return rows
    },
    () => clash(method, { subject, sign_in_name: signInName }),
  )
  await auditIdentity(actor, 'linked', user, method.key, String(row.id))
  return { ...(row as unknown as Identity), created: true }
}

/** Invite a Google address: the first verified Google sign-in with it links
 *  the account for good (design D5). Re-inviting the same address is a no-op. */
export async function inviteGoogle(user: string, email: string, actor: string): Promise<Identity & { created: boolean }> {
  const method = await methodOfKind('google')
  if (!method) throw new AppError('ValidationError', 'Google sign-in is not set up')
  const address = normaliseEmail(email)
  if (!address || !looksLikeEmail(address)) throw new AppError('ValidationError', 'Expected { email }', { email: 'a real address' })
  await assertHumanUser(user)
  const pending = foldName(address)
  const [same] = await sql`
    select ${identityFields()} from sign_in_identity
    where method = ${method.key} and subject is null and pending_email = ${pending} and person_id = ${user} and ended_at is null`
  if (same) return { ...(same as unknown as Identity), created: false }
  const [row] = await guarded(
    (t) => t`insert into sign_in_identity ${t({
      id: newIdentityId(),
      person_id: user,
      method: method.key,
      subject: null,
      pending_email: pending,
      linked_by: actor,
    })} returning ${identityFields()}`,
    () => clash(method, { pending_email: pending }),
  )
  await auditIdentity(actor, 'invited', user, method.key, String(row.id))
  return { ...(row as unknown as Identity), created: true }
}

/** Rename a sign-in name and/or move a link to another person, atomically.
 *  A rename keeps the identity id, so its sessions survive; a move does not,
 *  and a move may not leave an administrator with no way in. */
export async function updateIdentity(
  id: string,
  change: { sign_in_name?: string | null; person_id?: string },
  actor: string,
): Promise<Identity> {
  const current = await getIdentity(id)
  const method = (await getSignInMethod(current.method))!
  return guarded(
    async (t) => {
      if (change.person_id !== undefined) await lockWaysIn(t)
      const [locked] = await t`select ${identityFields()} from sign_in_identity where id = ${id} for update`
      if (!locked || locked.ended_at) throw new AppError('NotFoundError', `Linked sign-in ${id} not found`)
      const signInName =
        change.sign_in_name !== undefined ? (change.sign_in_name == null ? null : String(change.sign_in_name).trim() || null) : (locked.sign_in_name as string | null)
      const moving = change.person_id !== undefined && change.person_id !== locked.person_id
      if (moving) {
        // person-resolution D4/D5: a move keeps who held it until when — the
        // old link ends (`moved`) and a new one starts for the new holder;
        // their identifier rows close and open the same way.
        await assertHumanUser(change.person_id!, t)
        await assertUserKeepsWayIn(String(locked.person_id), t, id)
        await endIdentityIdentifiers(id, t)
        await t`update sign_in_identity set ended_at = now(), ended_reason = 'moved' where id = ${id}`
        const [row] = await t`insert into sign_in_identity ${t({
          id: newIdentityId(),
          person_id: change.person_id!,
          method: locked.method as string,
          subject: locked.subject as string | null,
          sign_in_name: signInName,
          email: locked.email as string | null,
          display_name: locked.display_name as string | null,
          pending_email: locked.pending_email as string | null,
          linked_by: actor,
        })} returning ${identityFields()}`
        await writeThroughIdentity(String(row.id), t)
        if (locked.subject != null) await consumeExpectedSignIn(change.person_id!, method, t)
        // Logged against the identity that moved; the new link carries on as its own id.
        await auditIdentity(actor, 'moved', `${locked.person_id} to ${change.person_id}`, String(locked.method), id)
        return row as unknown as Identity
      }
      if (signInName === (locked.sign_in_name ?? null)) return locked as unknown as Identity
      const [row] = await t`update sign_in_identity set sign_in_name = ${signInName} where id = ${id} returning ${identityFields()}`
      await auditIdentity(actor, 'renamed', String(locked.person_id), String(locked.method), id)
      return row as unknown as Identity
    },
    () => clash(method, { sign_in_name: change.sign_in_name ?? null }),
  )
}

// A method counts as a way in only when it can actually sign the person in:
// enabled, and for Google configured (or the dev mock on). An Administrator or
// System Manager is never signed in through a delegated method, so for them
// those links do not count (review A-M2).
const usableWhere = (mock: boolean) =>
  sql`m.enabled and (m.kind <> 'google' or coalesce(m.client_id, '') <> '' or ${mock}::boolean)`

/** How many working ways in a person has right now. Pending invites never
 *  count. `excluding` leaves one identity id (or 'password') out. */
async function waysIn(user: string, db: Sql | TxSql, excluding?: string, proof: WayInProof = 'proven'): Promise<number> {
  await lockWaysIn(db)
  const mock = mockOAuthEnabled()
  const lists = await domainListsJson(db)
  const [row] = await db`
    with p as (
      select (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator'))) as privileged
      from person u where u.row_id = ${user}
    )
    select
      (select count(*) from person u join sign_in_method m on m.kind = 'password' and ${usableWhere(mock)}
        where u.row_id = ${user} and u.password_hash is not null and ${excluding ?? ''}::text <> 'password')::int
      + (select count(*) from sign_in_identity i join sign_in_method m on m.row_id = i.method and ${usableWhere(mock)}
        where i.person_id = ${user} and i.subject is not null and i.ended_at is null and i.id <> ${excluding ?? ''}::text
          and not (m.kind = 'delegated_password' and (select privileged from p))
          and ${keepsDomain(lists, proof)})::int as n`
  return Number(row.n)
}

/** An administrator who can sign in now must still be able to afterwards. */
async function assertUserKeepsWayIn(user: string, db: Sql | TxSql, excluding: string): Promise<void> {
  const c = await candidate(user, db)
  if (!c?.privileged || !c.enabled) return
  if ((await waysIn(user, db, undefined, 'possible')) > 0 && (await waysIn(user, db, excluding)) === 0)
    throw new AppError('ValidationError', `This would lock out ${user}: it is their only way to sign in.`)
}

/** Remove one link. `self` refuses removing the person's last working way in;
 *  an administrator removing someone's link may not lock out an
 *  administrator. The user row is locked so concurrent removals cannot both
 *  pass. */
export async function unlinkIdentity(id: string, actor: string, opts: { self?: string } = {}): Promise<void> {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    await lockWaysIn(t)
    const [current] = await t`select person_id, method, subject from sign_in_identity where id = ${id} and ended_at is null`
    if (!current || (opts.self && current.person_id !== opts.self))
      throw new AppError('NotFoundError', `Linked sign-in ${id} not found`)
    await t`select 1 from person where row_id = ${current.person_id as string} for update`
    if (opts.self && current.subject != null && (await waysIn(String(current.person_id), t, id)) === 0)
      throw new AppError('ConflictError', 'This is your last way to sign in. Add another one first.')
    if (!opts.self && current.subject != null) await assertUserKeepsWayIn(String(current.person_id), t, id)
    // person-resolution D5: unlinking ends a link (kept as history, and the
    // same provider id can be linked afresh); a pending invite simply goes.
    if (current.subject == null) await t`delete from sign_in_identity where id = ${id}`
    else {
      await endIdentityIdentifiers(id, t)
      await t`update sign_in_identity set ended_at = now(), ended_reason = 'unlinked' where id = ${id}`
    }
    await auditIdentity(actor, 'unlinked', String(current.person_id), String(current.method), id)
  })
}

/** Remove the person's own password (clears the hash; ends password sessions). */
export async function removeOwnPassword(user: string): Promise<void> {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    await lockWaysIn(t)
    await t`select 1 from person where row_id = ${user} for update`
    if ((await waysIn(user, t, 'password')) === 0)
      throw new AppError('ConflictError', 'This is your last way to sign in. Add another one first.')
    await t`update person set password_hash = null where row_id = ${user}`
    await logActivity(user, 'password_removed')
  })
}

/** Stamp a successful sign-in through an identity. */
export async function touchIdentity(
  id: string,
  attrs: { email?: string | null; display_name?: string | null; hosted_domain?: string | null; email_verified?: boolean } = {},
) {
  const [before] = await sql`select email from sign_in_identity where id = ${id}`
  // #693: a kind that reports a hosted domain passes it on every sign-in, and
  // its absence is recorded too, as '' (a personal account has none).
  const hd = attrs.hosted_domain !== undefined
  await sql`
    update sign_in_identity set last_used_at = now(),
      email = coalesce(${attrs.email ?? null}, email),
      display_name = coalesce(${attrs.display_name ?? null}, display_name),
      hosted_domain = case when ${hd}::boolean then ${attrs.hosted_domain ?? ''}::text else hosted_domain end,
      email_verified = coalesce(${attrs.email_verified ?? null}::boolean, email_verified)
    where id = ${id}`
  // person-resolution D5: the address mirror follows the provider's.
  if (attrs.email && before && String(before.email ?? '').toLowerCase() !== attrs.email.toLowerCase()) {
    await reconcileIdentityEmail(id, (before.email as string | null) ?? null)
    await followGoogleAddress(id, (before.email as string | null) ?? null, attrs.email)
  }
}

/** A person whose contact address was their Google address keeps it in step
 *  when Google reports a new verified one. An address someone set by hand, or
 *  one another person already uses, is left alone. A normal row save, so the
 *  change is versioned. */
async function followGoogleAddress(id: string, oldEmail: string | null, newEmail: string) {
  if (!oldEmail) return
  const [i] = await sql`
    select i.person_id, m.kind, p.email, p.updated_at
    from sign_in_identity i
    join sign_in_method m on m.row_id = i.method
    join person p on p.row_id = i.person_id
    where i.id = ${id} and i.ended_at is null`
  if (!i || i.kind !== 'google') return
  if (String(i.email ?? '').toLowerCase() !== oldEmail.toLowerCase()) return
  const [taken] = await sql`select 1 from person where lower(email) = lower(${newEmail}) and row_id <> ${i.person_id}`
  if (taken) return
  await saveDoc('Person', { row_id: i.person_id, updated_at: i.updated_at, email: newEmail }, 'Administrator')
}

// ------------------------------------------------------------ eligibility

interface Candidate {
  row_id: string
  enabled: boolean
  privileged: boolean
}

export async function candidate(user: string, db: Sql | TxSql = sql): Promise<Candidate | null> {
  const [row] = await db`
    select u.row_id, u.enabled,
      (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator'))) as privileged
    from person u where u.row_id = ${user}`
  return row ? (row as unknown as Candidate) : null
}

/** Disable a person a connected service reports as gone (design D7): a normal
 *  row save, so history is versioned; every session ends with the flag. */
export async function disableLeaver(user: string, methodKey: string): Promise<void> {
  const [row] = await sql`select updated_at, enabled from person where row_id = ${user}`
  if (!row || !row.enabled) return
  await saveDoc('Person', { row_id: user, updated_at: row.updated_at, enabled: false }, 'Administrator')
  await logActivity(user, `disabled_as_leaver ${methodKey}`)
}

/** #693 (Siraj, 30-Oct-2026): when a change to a Google method's domain list
 *  stops admitting a link the domain rule made (DOMAIN_RULED_LINKS), the
 *  sessions opened through that link end. Called in the method change's
 *  transaction, after the lockout guard allowed it. Stamps the link (kept,
 *  so re-admitting the domain lets the person sign in again, while the ended
 *  sessions stay ended) and logs once per person, never an address. Turning
 *  the method off or deleting it already ends every session opened through
 *  it (resolveToken). Returns the people affected. */
export async function endSessionsNoLongerAdmitted(methodKey: string, nextDomains: string, db: Sql | TxSql = sql): Promise<string[]> {
  await lockWaysIn(db)
  const before = await domainListsJson(db)
  const after = await domainListsJson(db, { key: methodKey, domains: nextDomains })
  const ended = await db`
    update sign_in_identity i set sessions_ended_at = now()
    from sign_in_method m
    where m.row_id = i.method and i.method = ${methodKey} and m.kind = 'google'
      and i.subject is not null and i.ended_at is null
      and i.linked_by = any(${[...DOMAIN_RULED_LINKS]}::text[])
      and ${keepsDomain(before, 'possible')} and not ${keepsDomain(after, 'possible')}
    returning i.person_id`
  const people = [...new Set(ended.map((r) => String(r.person_id)))].sort()
  for (const person of people) await logActivity(person, `google_sessions_ended_domain_not_allowed ${methodKey}`)
  return people
}

// --------------------------------------------------------- lockout guard

/** Refuse a method change that would leave an enabled Administrator or System
 *  Manager who can sign in now with no way in afterwards (design D2, M5).
 *  `next` is the method's state after the change; null = deleted. */
export async function assertNoAdminLockout(
  methodKey: string,
  next: { enabled: boolean; client_id: string; allowed_email_domains?: string } | null,
  db: Sql | TxSql = sql,
) {
  await lockWaysIn(db)
  const mock = mockOAuthEnabled()
  const nextEnabled = next?.enabled === true
  const nextClient = next?.client_id ?? ''
  // #693: narrowing the domain list can end a link's sign-ins too.
  const before = await domainListsJson(db)
  const after =
    next?.allowed_email_domains !== undefined ? await domainListsJson(db, { key: methodKey, domains: next.allowed_email_domains }) : before
  const rows = await db`
    with privileged as (
      select u.row_id from person u
      where u.enabled
        and (u.row_id = 'Administrator' or exists (
          select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator')))
    ), m0 as (
      select row_id, kind, enabled, client_id from sign_in_method
    ), m1 as (
      select row_id, kind,
        case when row_id = ${methodKey}::text then ${nextEnabled}::boolean else enabled end as enabled,
        case when row_id = ${methodKey}::text then ${nextClient}::text else client_id end as client_id
      from sign_in_method
    ), links as (
      -- Each live link, judged before and after: possible (may work) and
      -- proven (known to work), per keepsDomain.
      select i.person_id,
        exists (select 1 from m0 m where m.row_id = i.method and m.kind <> 'delegated_password' and ${usableWhere(mock)}
          and ${keepsDomain(before, 'possible')}) as possible_before,
        exists (select 1 from m0 m where m.row_id = i.method and m.kind <> 'delegated_password' and ${usableWhere(mock)}
          and ${keepsDomain(before, 'proven')}) as proven_before,
        exists (select 1 from m1 m where m.row_id = i.method and m.kind <> 'delegated_password' and ${usableWhere(mock)}
          and ${keepsDomain(after, 'possible')}) as possible_after,
        exists (select 1 from m1 m where m.row_id = i.method and m.kind <> 'delegated_password' and ${usableWhere(mock)}
          and ${keepsDomain(after, 'proven')}) as proven_after
      from sign_in_identity i join privileged p on p.row_id = i.person_id
      where i.subject is not null and i.ended_at is null
    ), passwords as (
      select p.row_id as person_id,
        exists (select 1 from person u join m0 m on m.kind = 'password' and ${usableWhere(mock)}
          where u.row_id = p.row_id and u.password_hash is not null) as before_ok,
        exists (select 1 from person u join m1 m on m.kind = 'password' and ${usableWhere(mock)}
          where u.row_id = p.row_id and u.password_hash is not null) as after_ok
      from privileged p
    ), ways as (
      -- #693 (Codex round 5): refuse only when the change restricts one of
      -- the person's possible ways in (it stops being possible, or now needs
      -- a hosted-domain claim it did not need before and has none recorded)
      -- AND leaves them no proven way in. Widening a list, or changing
      -- another method, restricts nothing.
      select p.row_id,
        (select count(*) from links l where l.person_id = p.row_id
          and l.possible_before and (not l.possible_after or (l.proven_before and not l.proven_after)))
        + (select count(*) from passwords w where w.person_id = p.row_id and w.before_ok and not w.after_ok) as restricted_n,
        (select count(*) from links l where l.person_id = p.row_id and l.proven_after)
        + (select count(*) from passwords w where w.person_id = p.row_id and w.after_ok) as proven_after_n
      from privileged p
    )
    select row_id from ways where restricted_n > 0 and proven_after_n = 0 order by row_id`
  if (rows.length)
    throw new AppError(
      'ValidationError',
      `This would lock out ${rows.map((r) => r.row_id).join(', ')}: it is their only way to sign in.`,
    )
}
