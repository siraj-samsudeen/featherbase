// Person + linked identities (OpenSpec change `person-identities`, #275).
//
// A User is a person. Outside providers (Google, a connected HR system, …) are
// linked to that person in `user_identity`, keyed by the provider's permanent
// subject — never by email. Featherbase's own password is the person's
// `password_hash` (one home, no identity row). Sign-in methods are rows of the
// system Table "Sign In Method", each with its own policy for people it does
// not recognise. This module owns those rules; adapters (oauth.ts,
// delegated-login.ts, auth.ts) only verify credentials.
import { randomBytes } from 'node:crypto'
import { sql, type Sql, type TxSql } from './db'
import { AppError } from './errors'
import { logActivity } from './audit'
import { saveDoc } from './document'

// ---------------------------------------------------------------- folding

/** The one case/space folding rule for every typed name, sign-in name,
 *  test-mode subject and email comparison. Stored values are trimmed. */
export function foldName(value: string): string {
  return value.trim().toLowerCase()
}

// RFC 2606 reserves the `.invalid` top-level domain for names that must never
// resolve; every placeholder address in this codebase and in the roster sync
// uses it. Such an address is not contact data, so it is not kept
// (time-boxed shim, design D9). Other reserved names (example.com, .test) are
// left alone: tests and dev seeds use them as stand-ins for real addresses.
export function isReservedEmail(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const domain = foldName(email.slice(at + 1)).replace(/\.$/, '')
  return domain === 'invalid' || domain.endsWith('.invalid')
}

/** What a User's email is stored as: trimmed, or NULL when blank or reserved. */
export function normaliseEmail(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  if (!trimmed || isReservedEmail(trimmed)) return null
  return trimmed
}

// --------------------------------------------------------- sign-in methods

export type MethodKind = 'password' | 'google' | 'delegated_password'
export type NewPersonRule = 'create' | 'create_if_email_domain_allowed' | 'refuse'

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
}

/** What each kind's adapter can vouch for (design D2). Policy values are
 *  validated against these, not against a list of kinds. */
export const KIND_CAPABILITIES: Record<MethodKind, { trustedSubject: boolean; verifiedEmail: boolean }> = {
  password: { trustedSubject: true, verifiedEmail: false },
  google: { trustedSubject: true, verifiedEmail: true },
  delegated_password: { trustedSubject: false, verifiedEmail: false },
}

export const METHOD_TABLE = 'Sign In Method'

function toMethod(r: Record<string, unknown>): SignInMethod {
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
  }
}

export async function listSignInMethods(db: Sql | TxSql = sql): Promise<SignInMethod[]> {
  const rows = await db`
    select row_id, kind, label, enabled, new_person, allowed_email_domains, self_link, client_id, service_url
    from sign_in_method order by row_id`
  return rows.map(toMethod)
}

export async function getSignInMethod(key: string): Promise<SignInMethod | null> {
  const [row] = await sql`
    select row_id, kind, label, enabled, new_person, allowed_email_domains, self_link, client_id, service_url
    from sign_in_method where row_id = ${key}`
  return row ? toMethod(row) : null
}

/** The one method of a kind (password, google). */
export async function methodOfKind(kind: MethodKind): Promise<SignInMethod | null> {
  const [row] = await sql`
    select row_id, kind, label, enabled, new_person, allowed_email_domains, self_link, client_id, service_url
    from sign_in_method where kind = ${kind} order by row_id limit 1`
  return row ? toMethod(row) : null
}

/** Is `email` on a domain this method admits? Empty admits nobody; `*` all. */
export function domainAllowed(method: SignInMethod, email: string): boolean {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(foldName(email))
  if (!match) return false
  const domains = method.allowed_email_domains.split(',').map(foldName).filter(Boolean)
  if (!domains.length) return false
  return domains.includes('*') || domains.includes(match[1])
}

// ------------------------------------------------------------- identities

export interface Identity {
  id: string
  user_id: string
  method: string
  subject: string | null
  sign_in_name: string | null
  email: string | null
  display_name: string | null
  pending_email: string | null
  linked_at: string
  linked_by: string
  last_used_at: string | null
}

const identityFields = () =>
  sql`id, user_id, method, subject, sign_in_name, email, display_name, pending_email, linked_at, linked_by, last_used_at`

const newIdentityId = () => 'uid_' + randomBytes(9).toString('base64url')

function conflict(err: unknown, what: string): never {
  const e = err as { code?: string }
  if (e?.code === '23505') throw new AppError('ConflictError', `${what} is already linked to an account`)
  if (e?.code === '23503') throw new AppError('ValidationError', 'Unknown sign-in method or user')
  throw err
}

export async function listIdentities(user: string): Promise<Identity[]> {
  return (await sql`
    select ${identityFields()} from user_identity where user_id = ${user} order by linked_at`) as unknown as Identity[]
}

export async function getIdentity(id: string, db: Sql | TxSql = sql): Promise<Identity> {
  const [row] = await db`select ${identityFields()} from user_identity where id = ${id}`
  if (!row) throw new AppError('NotFoundError', `Linked sign-in ${id} not found`)
  return row as unknown as Identity
}

async function assertHumanUser(user: string, db: Sql | TxSql = sql) {
  const [row] = await db`select user_type from "user" where row_id = ${user}`
  if (!row) throw new AppError('NotFoundError', `User ${user} not found`)
  if (row.user_type === 'service')
    throw new AppError('ValidationError', 'Service accounts have no sign-in methods — issue an access token instead')
}

/** Link a subject (and optional sign-in name) to a person. 409 on collision. */
export async function linkIdentity(
  user: string,
  input: { method: string; subject: string; sign_in_name?: string | null; email?: string | null; display_name?: string | null },
  actor: string,
): Promise<Identity> {
  const method = await getSignInMethod(input.method)
  if (!method || method.kind === 'password')
    throw new AppError('ValidationError', `Unknown outside sign-in method "${input.method}"`)
  const subject = String(input.subject ?? '').trim()
  if (!subject) throw new AppError('ValidationError', 'Expected { subject }', { subject: 'required' })
  const signInName = input.sign_in_name == null ? null : String(input.sign_in_name).trim() || null
  await assertHumanUser(user)
  let row
  try {
    // Its own savepoint/transaction, so a collision leaves the caller's intact.
    ;[row] = await sql.begin((tx) => (tx as unknown as Sql)`insert into user_identity ${sql({
      id: newIdentityId(),
      user_id: user,
      method: method.key,
      subject,
      sign_in_name: signInName,
      email: input.email ?? null,
      display_name: input.display_name ?? null,
      linked_by: actor,
    })} returning ${identityFields()}`)
  } catch (err) {
    conflict(err, `This ${method.label} ID`)
  }
  await logActivity(user, `identity_linked:${method.key}:${row!.id}`)
  return row as unknown as Identity
}

/** Invite a Google address: the first verified Google sign-in with it links
 *  the account for good (design D5). */
export async function inviteGoogle(user: string, email: string, actor: string): Promise<Identity> {
  const method = await methodOfKind('google')
  if (!method) throw new AppError('ValidationError', 'Google sign-in is not set up')
  const address = normaliseEmail(email)
  if (!address || !address.includes('@')) throw new AppError('ValidationError', 'Expected { email }', { email: 'a real address' })
  await assertHumanUser(user)
  let row
  try {
    ;[row] = await sql.begin((tx) => (tx as unknown as Sql)`insert into user_identity ${sql({
      id: newIdentityId(),
      user_id: user,
      method: method.key,
      subject: null,
      pending_email: foldName(address),
      linked_by: actor,
    })} returning ${identityFields()}`)
  } catch (err) {
    conflict(err, 'This Google address')
  }
  await logActivity(user, `identity_invited:${method.key}:${row!.id}`)
  return row as unknown as Identity
}

/** Rename a sign-in name and/or move a link to another person, atomically.
 *  A rename keeps the identity id, so its sessions survive; a move does not. */
export async function updateIdentity(
  id: string,
  change: { sign_in_name?: string | null; user_id?: string },
  actor: string,
): Promise<Identity> {
  return (await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const [current] = await t`select ${identityFields()} from user_identity where id = ${id} for update`
    if (!current) throw new AppError('NotFoundError', `Linked sign-in ${id} not found`)
    const patch: Record<string, unknown> = {}
    if (change.sign_in_name !== undefined)
      patch.sign_in_name = change.sign_in_name == null ? null : String(change.sign_in_name).trim() || null
    if (change.user_id !== undefined && change.user_id !== current.user_id) {
      await assertHumanUser(change.user_id, t)
      patch.user_id = change.user_id
      patch.linked_at = new Date()
      patch.linked_by = actor
    }
    if (!Object.keys(patch).length) return current
    let row
    try {
      ;[row] = await t`update user_identity set ${t(patch)} where id = ${id} returning ${identityFields()}`
    } catch (err) {
      conflict(err, 'This sign-in name')
    }
    if (patch.user_id) {
      await logActivity(String(current.user_id), `identity_moved_out:${current.method}:${id}`)
      await logActivity(String(patch.user_id), `identity_moved_in:${current.method}:${id}`)
    } else await logActivity(String(current.user_id), `identity_renamed:${current.method}:${id}`)
    return row
  })) as unknown as Identity
}

/** How many working ways in a person has: a password with the password method
 *  on, plus claimed identities on enabled methods. Pending invites never count.
 *  `excluding` leaves one identity (or 'password') out of the count. */
export async function waysIn(user: string, db: Sql | TxSql, excluding?: string): Promise<number> {
  const [row] = await db`
    select
      (select count(*) from "user" u join sign_in_method m on m.kind = 'password' and m.enabled
        where u.row_id = ${user} and u.password_hash is not null and ${excluding ?? ''}::text <> 'password')::int
      + (select count(*) from user_identity i join sign_in_method m on m.row_id = i.method and m.enabled
        where i.user_id = ${user} and i.subject is not null and i.id <> ${excluding ?? ''}::text)::int as n`
  return Number(row.n)
}

/** Remove one link. `self` refuses removing the person's last working way in;
 *  the user row is locked so two concurrent removals cannot both pass. */
export async function unlinkIdentity(id: string, actor: string, opts: { self?: string } = {}): Promise<void> {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const [current] = await t`select user_id, method, subject from user_identity where id = ${id}`
    if (!current || (opts.self && current.user_id !== opts.self))
      throw new AppError('NotFoundError', `Linked sign-in ${id} not found`)
    await t`select 1 from "user" where row_id = ${current.user_id as string} for update`
    if (opts.self && current.subject != null && (await waysIn(String(current.user_id), t, id)) === 0)
      throw new AppError('ConflictError', 'This is your last way to sign in. Add another one first.')
    await t`delete from user_identity where id = ${id}`
    await logActivity(String(current.user_id), `identity_unlinked:${current.method}:${id}${actor === current.user_id ? '' : ` by ${actor}`}`.slice(0, 140))
  })
}

/** Remove the person's own password (clears the hash; ends password sessions). */
export async function removeOwnPassword(user: string): Promise<void> {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    await t`select 1 from "user" where row_id = ${user} for update`
    if ((await waysIn(user, t, 'password')) === 0)
      throw new AppError('ConflictError', 'This is your last way to sign in. Add another one first.')
    await t`update "user" set password_hash = null where row_id = ${user}`
    await logActivity(user, 'password_removed')
  })
}

/** Stamp a successful sign-in through an identity. */
export async function touchIdentity(id: string, attrs: { email?: string | null; display_name?: string | null } = {}) {
  await sql`
    update user_identity set last_used_at = now(),
      email = coalesce(${attrs.email ?? null}, email),
      display_name = coalesce(${attrs.display_name ?? null}, display_name)
    where id = ${id}`
}

// ------------------------------------------------------------ eligibility

export interface Candidate {
  row_id: string
  enabled: boolean
  user_type: string | null
  privileged: boolean
}

export async function candidate(user: string, db: Sql | TxSql = sql): Promise<Candidate | null> {
  const [row] = await db`
    select u.row_id, u.enabled, u.user_type,
      (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator'))) as privileged
    from "user" u where u.row_id = ${user}`
  return row ? (row as unknown as Candidate) : null
}

/** Disable a person a connected service reports as gone (design D7): a normal
 *  row save, so history is versioned; every session ends with the flag. */
export async function disableLeaver(user: string, methodKey: string): Promise<void> {
  const [row] = await sql`select updated_at, enabled from "user" where row_id = ${user}`
  if (!row || !row.enabled) return
  await saveDoc('User', { row_id: user, updated_at: row.updated_at, enabled: false }, 'Administrator')
  await logActivity(user, `disabled_as_leaver:${methodKey}`)
}

// --------------------------------------------------------- lockout guard

/** Refuse a method change that would leave an enabled Administrator or System
 *  Manager who can sign in now with no way in afterwards (design D2, M5).
 *  `next` is the method's enabled flag after the change; null = deleted. */
export async function assertNoAdminLockout(methodKey: string, next: boolean | null, db: Sql | TxSql = sql) {
  const after = next === true
  const rows = await db`
    with privileged as (
      select u.row_id from "user" u
      where u.enabled and coalesce(u.user_type, 'human') <> 'service'
        and (u.row_id = 'Administrator' or exists (
          select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator')))
    ), methods as (
      select row_id, kind, enabled as before_enabled,
        case when row_id = ${methodKey}::text then ${after}::boolean else enabled end as after_enabled
      from sign_in_method
    ), ways as (
      select p.row_id,
        (select count(*) from "user" u join methods m on m.kind = 'password'
          where u.row_id = p.row_id and u.password_hash is not null and m.before_enabled) +
        (select count(*) from user_identity i join methods m on m.row_id = i.method and m.kind <> 'delegated_password'
          where i.user_id = p.row_id and i.subject is not null and m.before_enabled) as before_n,
        (select count(*) from "user" u join methods m on m.kind = 'password'
          where u.row_id = p.row_id and u.password_hash is not null and m.after_enabled) +
        (select count(*) from user_identity i join methods m on m.row_id = i.method and m.kind <> 'delegated_password'
          where i.user_id = p.row_id and i.subject is not null and m.after_enabled) as after_n
      from privileged p
    )
    select row_id from ways where before_n > 0 and after_n = 0 order by row_id`
  if (rows.length)
    throw new AppError(
      'ValidationError',
      `This would lock out ${rows.map((r) => r.row_id).join(', ')}: it is their only way to sign in.`,
    )
}
