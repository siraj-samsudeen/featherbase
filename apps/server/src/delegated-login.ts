// Delegated password sign-in (OpenSpec change `delegated-password-login`).
//
// An outside service the administrator set up as a Sign In Method checks a
// person's ID and password — StyleHR is the first, for store Team Leaders who
// have no Google identity. Featherbase forwards the pair once and binds the
// result to the ONE User whose linked identity carries that sign-in name
// (person-identities) — looked up BEFORE the provider is asked, so Featherbase never checks a password for an
// ID it would not sign in (no password oracle for unlinked IDs).
//
// Fail closed (review of #363): only a 200-family JSON object carrying a
// positive success signal verifies. An empty body, HTML, an unreadable body or
// an unrecognised shape is "could not confirm", never a sign-in. A body that
// says the person has left is refused even with a right password — StyleHR
// keeps authenticating leavers (data-warehouse report_server/stylehr_auth.py,
// whose rules this ports). Binding depends on the body for a link a roster
// first sign-in made (#970), and for every link once the method says where its
// answers name the record (#376): the answer must name the link's record.
//
// The password is held for one outbound request and never stored, logged,
// thrown or echoed. Failures are logged as label + outcome only.
import { sql } from './db'
import { AppError } from './errors'
import { INVALID_CREDENTIALS } from './auth'
import { listSignInMethods, type SignInMethod } from './identities'
import { switchedOn, TEST_MODE_PHRASE } from './env'

// person-identities: the connected service is a Sign In Method row of kind
// `delegated_password`, and the person is found through a linked identity,
// not a User column.
export interface DelegatedLoginConfig {
  key: string
  label: string
  url: string
  wire: DelegatedWire
  /** The Sign In Method row, for the shared pipeline (sign-in.ts). */
  method: SignInMethod
}

/** A delegated provider's wire format, from its row's `settings` JSON
 *  (review: genericity). Every field is optional there; anything left out
 *  takes StyleHR's value, which is what DEFAULT_WIRE holds. A second HR
 *  provider with a different request body or answer shape is configuration
 *  only. Values are matched against JSON keys case-insensitively. */
export interface DelegatedWire {
  /** Request body field names for the typed ID and the password. */
  id_field: string
  password_field: string
  /** Objects one level down that may carry the answer. */
  nested_keys: string[]
  /** A filled value under any of these means "yes, signed in". */
  success_keys: string[]
  /** `true` under any of these means yes; `false` means no. */
  success_flags: string[]
  /** A filled value under any of these means no. */
  error_keys: string[]
  /** The status key, and the values of it that mean no. */
  status_key: string
  error_statuses: string[]
  /** The person has left: a filled date, an inactive flag set false, or a status containing a word. */
  left_date_keys: string[]
  inactive_flags: string[]
  left_status_keys: string[]
  left_words: string[]
}

export const DEFAULT_WIRE: DelegatedWire = {
  id_field: 'email',
  password_field: 'password',
  nested_keys: ['data', 'user', 'employee', 'result'],
  success_keys: ['token', 'access', 'access_token', 'key', 'employee_id', 'employee_key', 'id'],
  success_flags: ['success', 'ok', 'authenticated'],
  error_keys: ['error', 'errors'],
  status_key: 'status',
  error_statuses: ['error', 'fail', 'failed', 'failure', 'invalid'],
  left_date_keys: ['exit_date', 'relieving_date', 'date_of_relieving', 'termination_date', 'resignation_date', 'last_working_date'],
  inactive_flags: ['is_active', 'active'],
  left_status_keys: ['status', 'employment_status', 'employee_status'],
  left_words: ['resign', 'terminat', 'reliev', 'exit', 'inactive', 'left', 'separated'],
}

/** The row's settings over the defaults; refuses a malformed shape. */
export function wireFrom(settings: Record<string, unknown> | null): DelegatedWire {
  const wire: DelegatedWire = { ...DEFAULT_WIRE }
  if (!settings) return wire
  for (const [key, fallback] of Object.entries(DEFAULT_WIRE) as [keyof DelegatedWire, string | string[]][]) {
    const value = settings[key]
    if (value === undefined) continue
    const ok = Array.isArray(fallback)
      ? Array.isArray(value) && value.every((v) => typeof v === 'string')
      : typeof value === 'string' && value.trim() !== ''
    if (!ok) throw new Error(`settings.${key} must be ${Array.isArray(fallback) ? 'a list of strings' : 'a string'}`)
    ;(wire as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? value.map((v) => String(v).toLowerCase()) : String(value)
  }
  return wire
}

/** Where a method finds staff who have never signed in (#970): the method's
 *  `settings.roster`. The Table and its columns are the instance's; the
 *  platform names none of them. The ID typed must match `sign_in_id_column`,
 *  and the service's answer must carry the row's `record_number_column` under
 *  `provider_record_key`, so a service that signs in somebody else on a shared
 *  ID cannot link the wrong row. `identifiers` maps an identifier system to the
 *  column holding its value, recorded on the new person. */
export interface RosterLink {
  table: string
  sign_in_id_column: string
  record_number_column: string
  person_column: string
  name_column: string
  status_column: string
  current_status: string
  provider_record_key: string
  identifiers: Record<string, string>
}

/** `linked_by` on a link a roster first sign-in made. */
export const ROSTER_LINK = 'roster-first-sign-in'

const COLUMN_NAME = /^[a-z][a-z0-9_]*$/
const ROSTER_COLUMNS = ['sign_in_id_column', 'record_number_column', 'person_column', 'name_column', 'status_column'] as const

/** The method's roster, or null when it has none; refuses a malformed one. */
export function rosterFrom(settings: Record<string, unknown> | null): RosterLink | null {
  const raw = settings?.roster
  if (raw === undefined || raw === null) return null
  if (!isObj(raw)) throw new Error('settings.roster must be an object')
  const text = (key: string) => {
    const value = raw[key]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`settings.roster.${key} must be a string`)
    return value.trim()
  }
  for (const key of ROSTER_COLUMNS)
    if (!COLUMN_NAME.test(text(key))) throw new Error(`settings.roster.${key} must be a column name`)
  const identifiers = raw.identifiers ?? {}
  if (!isObj(identifiers) || !Object.values(identifiers).every((c) => typeof c === 'string' && COLUMN_NAME.test(c)))
    throw new Error('settings.roster.identifiers must map an identifier system to a column name')
  return {
    table: text('table'),
    sign_in_id_column: text('sign_in_id_column'),
    record_number_column: text('record_number_column'),
    person_column: text('person_column'),
    name_column: text('name_column'),
    status_column: text('status_column'),
    current_status: text('current_status'),
    provider_record_key: text('provider_record_key').toLowerCase(),
    identifiers: identifiers as Record<string, string>,
  }
}

// http is accepted only for a stub on this machine (tests, local dev); a
// password never crosses a network in the clear.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Is this a service address a password may be sent to (https, or a local stub)? */
export function usableServiceUrl(raw: string): boolean {
  return usable(raw) !== null
}

function usable(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
  return allowed ? url : null
}

/** Every enabled delegated method whose URL is usable (https, or a local stub). */
export async function delegatedMethods(): Promise<DelegatedLoginConfig[]> {
  const out: DelegatedLoginConfig[] = []
  for (const m of await listSignInMethods()) {
    if (m.kind !== 'delegated_password' || !m.enabled) continue
    const url = usable(m.service_url)
    let wire: DelegatedWire
    try {
      wire = wireFrom(m.settings)
    } catch (err) {
      // A malformed wire format leaves the method off, like a bad URL — said
      // out loud, naming the row, so an operator can find it.
      console.warn(`[delegated-login] ${m.key}: skipped, its settings are malformed (${(err as Error).message})`)
      continue
    }
    if (url) out.push({ key: m.key, label: m.label || url.hostname, url: url.toString(), wire, method: { ...m, label: m.label || url.hostname } })
  }
  return out
}

/** The enabled, usable delegated method a sign-in names; null when it is off. */
export async function delegatedLoginConfig(key: string): Promise<DelegatedLoginConfig | null> {
  return (await delegatedMethods()).find((m) => m.key === key) ?? null
}

// Test mode (#3783): DELEGATED_LOGIN_TEST_MODE=trust-any-password skips the
// provider, so a rollout can be tried as any linked Team Leader. An exact
// phrase, not a boolean, so a stray "1" never opens it; environment-only, so
// no Admin edit can. linkedUser still runs first: it decides WHOSE account,
// and never yields a disabled or privileged one.
export { TEST_MODE_PHRASE }
export function delegatedTestMode(): boolean {
  return switchedOn('DELEGATED_LOGIN_TEST_MODE')
}

/** Say once, at boot, that the provider is being skipped — same reasoning as announcePreviewLogin. */
export function announceDelegatedTestMode(log: (message: string) => void = console.warn): void {
  if (delegatedTestMode()) log('delegated sign-in TEST MODE: the provider is not asked; a linked account signs in by its employee code, without a password')
}

// Injectable for the sandboxed suite — the real provider is never contacted
// from a test (same seam as `_setEmbedFetch` in sales-target.ts).
let delegatedFetch: typeof fetch | null = null
export function _setDelegatedFetch(f: typeof fetch | null) {
  delegatedFetch = f
}

const TIMEOUT_MS = 10_000

type ProviderOutcome = 'verified' | 'rejected' | 'unavailable' | 'left' | 'another_record'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const lowerKeys = (o: Obj): Obj => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]))
const filled = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 'null' && v !== false && v !== 0

/** The body and the identity-ish objects one level down, keys lower-cased. */
function layers(body: Obj, w: DelegatedWire): Obj[] {
  const top = lowerKeys(body)
  return [top, ...w.nested_keys.map((k) => top[k]).filter(isObj).map(lowerKeys)]
}

// A 2xx that says no. Booleans count: {"success": false} and {"status": false} are refusals.
function saysNo(o: Obj, w: DelegatedWire): boolean {
  if (w.error_keys.some((k) => filled(o[k]))) return true
  if ([...w.success_flags, w.status_key].some((k) => o[k] === false)) return true
  return w.error_statuses.includes(String(o[w.status_key] ?? '').toLowerCase())
}

// Positive evidence of a session or an identity. Anything else is "could not confirm".
function saysYes(o: Obj, w: DelegatedWire): boolean {
  return w.success_flags.some((k) => o[k] === true) || w.success_keys.some((k) => filled(o[k]))
}

// Ported from report_server/stylehr_auth.py looks_resigned: an exit date, an
// inactive flag, or a status that reads as gone — as configured.
function saysLeft(o: Obj, w: DelegatedWire): boolean {
  if (w.left_date_keys.some((k) => filled(o[k]) && o[k] !== 'None')) return true
  if (w.inactive_flags.some((k) => o[k] === false)) return true
  return w.left_status_keys.some((k) => typeof o[k] === 'string' && w.left_words.some((word) => String(o[k]).toLowerCase().includes(word)))
}

/** Ask the provider whether `id`/`password` are good. Never throws. With
 *  `mustName`, a yes that does not carry this record under this key is
 *  `another_record`, not a yes. */
export async function checkWithProvider(
  cfg: DelegatedLoginConfig,
  id: string,
  password: string,
  mustName?: { key: string; record: string },
): Promise<ProviderOutcome> {
  if (delegatedTestMode()) return 'verified'
  let res: Response
  try {
    res = await (delegatedFetch ?? fetch)(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ [cfg.wire.id_field]: id, [cfg.wire.password_field]: password }),
      // A redirected POST silently stops being a POST with this body.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    // The error object itself is not logged: a library is free to put the
    // request in it. Its class name is enough to tell timeout from refusal.
    logOutcome(cfg, 'unavailable', err instanceof Error ? err.name : 'error')
    return 'unavailable'
  }
  // 408 and 429 are the provider being busy, not a verdict on the password.
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    logOutcome(cfg, 'rejected', `http_${res.status}`)
    return 'rejected'
  }
  if (res.status < 200 || res.status >= 300) {
    logOutcome(cfg, 'unavailable', `http_${res.status}`)
    return 'unavailable'
  }
  // A body that cannot be read in full (reset, timeout mid-stream) is not an answer.
  let text: string
  try {
    text = await res.text()
  } catch (err) {
    logOutcome(cfg, 'unavailable', `http_${res.status}_body_unreadable ${err instanceof Error ? err.name : 'error'}`)
    return 'unavailable'
  }
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!isObj(body)) {
    logOutcome(cfg, 'unavailable', `http_${res.status}_not_a_json_object`)
    return 'unavailable'
  }
  const ls = layers(body, cfg.wire)
  // Key NAMES only — enough to diagnose the first real sign-in, never a value.
  const keys = `keys=${Object.keys(body).sort().join(',')}`
  if (ls.some((o) => saysNo(o, cfg.wire))) {
    logOutcome(cfg, 'rejected', `http_${res.status}_error_body ${keys}`)
    return 'rejected'
  }
  // Before the left check: an answer about somebody else, or about nobody it
  // names, says nothing about this person; nor does one naming two records. A body
  // with neither a yes nor a leaver falls through to "could not confirm".
  if (mustName) {
    const named = ls.map((o) => o[mustName.key]).filter(filled)
    const speaks = ls.some((o) => saysYes(o, cfg.wire) || saysLeft(o, cfg.wire))
    if (named.length ? named.some((v) => String(v).trim() !== mustName.record) : speaks) {
      logOutcome(cfg, 'another_record', `http_${res.status} ${keys}`)
      return 'another_record'
    }
  }
  if (ls.some((o) => saysLeft(o, cfg.wire))) {
    logOutcome(cfg, 'left', `http_${res.status} ${keys}`)
    return 'left'
  }
  if (!ls.some((o) => saysYes(o, cfg.wire))) {
    logOutcome(cfg, 'unavailable', `http_${res.status}_unrecognised_success ${keys}`)
    return 'unavailable'
  }
  return 'verified'
}

function logOutcome(cfg: DelegatedLoginConfig, outcome: ProviderOutcome, detail: string) {
  console.warn(`[delegated-login] ${cfg.label}: ${outcome} (${detail})`)
}

/** The one human account linked to `id` at this service — resolved BEFORE
 *  the provider is asked. No link, a disabled account or a privileged one all
 *  get password login's refusal, and the password is never forwarded for
 *  them: answering "not linked" after a provider check would turn this route
 *  into a password checker for every unlinked ID. Matching ignores case and
 *  surrounding spaces; the unique index makes a second match impossible, and
 *  anything but exactly one match refuses rather than picking. */
export async function linkedUser(cfg: DelegatedLoginConfig, id: string): Promise<{ user: string; identity: string | null }> {
  if (delegatedTestMode()) return testModeUser(cfg, id)
  const rows = await sql`
    select u.row_id, u.enabled, i.id as identity,
           (u.row_id = 'Administrator' or exists (
             select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator'))) as privileged
    from sign_in_identity i join person u on u.row_id = i.person_id
    where i.method = ${cfg.key} and i.subject is not null and i.ended_at is null
      and lower(i.sign_in_name) = lower(trim(${id}))
    limit 2`
  return eligibleOne(rows)
}

function eligibleOne(rows: Record<string, unknown>[]): { user: string; identity: string | null } {
  if (rows.length !== 1) throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  // Whoever administers the outside service can reset passwords there; that must
  // never reach the Administrator or a System Manager here. They use their own password.
  if (!rows[0].enabled || rows[0].privileged)
    throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  return { user: String(rows[0].row_id), identity: String(rows[0].identity) }
}

/** Where the method's answers name the person's record, for every link
 *  (#376): `settings.provider_record_key`. Null when the method has none;
 *  refuses a malformed one. */
export function recordKeyFrom(settings: Record<string, unknown> | null): string | null {
  const raw = settings?.provider_record_key
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('settings.provider_record_key must be a string')
  return raw.trim().toLowerCase()
}

/** What a sign-in through this link must have the provider name. A link a
 *  roster first sign-in made is keyed on the row's record (#970); any other
 *  link is held to its subject, the person's record at the service, when the
 *  method says where its answers name it (#376). Either way an ID that comes
 *  to answer for someone else cannot open this person's account. Refused when
 *  the method's settings no longer say where, rather than stop checking. */
export async function recordToName(cfg: DelegatedLoginConfig, identity: string | null): Promise<{ key: string; record: string } | undefined> {
  const [link] = await sql`select subject, linked_by from sign_in_identity where id = ${identity}`
  if (link?.linked_by !== ROSTER_LINK) {
    let key: string | null
    try {
      key = recordKeyFrom(cfg.method.settings)
    } catch {
      console.warn(`[delegated-login] ${cfg.label}: a sign-in refused, settings.provider_record_key is malformed`)
      throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
    }
    return key && link ? { key, record: String(link.subject) } : undefined
  }
  let roster: RosterLink | null = null
  try {
    roster = rosterFrom(cfg.method.settings)
  } catch {
    /* malformed: the same as none */
  }
  if (!roster) {
    console.warn(`[delegated-login] ${cfg.label}: a roster-made link refused, the method has no roster to check it with`)
    throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  }
  return { key: roster.provider_record_key, record: String(link.subject) }
}

/** Does no live link carry this sign-in name? Then the method's rule for people
 *  it does not know decides, before the provider is asked. */
export async function noLinkCarries(cfg: DelegatedLoginConfig, id: string): Promise<boolean> {
  const rows = await sql`
    select 1 from sign_in_identity
    where method = ${cfg.key} and subject is not null and ended_at is null and lower(sign_in_name) = lower(trim(${id})) limit 1`
  return rows.length === 0
}

/** Test mode (person-resolution D5): a tester knows the employee code, not
 *  the person's login name. The code is resolved through the people's
 *  CURRENT employee-code identifier rows, in any mix of capitals; a code
 *  current on two people is refused and neither is chosen; and the person
 *  must have a live, not-ended link to this service. */
export async function testModeUser(cfg: DelegatedLoginConfig, typed: string): Promise<{ user: string; identity: string | null }> {
  // The method's own employee-code system: the employee-record system fed by
  // the same roster as the record numbers its sign-ins carry (StyleHR →
  // stylehr-employee-code). A code from any other namespace is not a
  // credential for this method (Codex review on #385).
  const holders = await sql`
    select distinct i.person_id from person_identifier i
    join identifier_system c on c.row_id = i.system and c.kind = 'employee-record' and c.enabled
    join identifier_system r on r.source = c.source and r.kind = 'external-record'
    join sign_in_method m on m.identifier_system = r.row_id and m.row_id = ${cfg.key}
    where i.value = upper(trim(${typed})) and upper_inf(i.valid)`
  if (holders.length > 1)
    throw new AppError('ConflictError', `This employee code is current on more than one person. Contact your administrator.`)
  if (holders.length === 0) throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  const rows = await sql`
    select u.row_id, u.enabled, i.id as identity,
           (u.row_id = 'Administrator' or exists (
             select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator'))) as privileged
    from sign_in_identity i join person u on u.row_id = i.person_id
    where i.method = ${cfg.key} and i.subject is not null and i.ended_at is null
      and i.person_id = ${String(holders[0].person_id)}
    order by i.linked_at
    limit 1`
  return eligibleOne(rows)
}
