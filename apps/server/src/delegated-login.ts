// Delegated password sign-in (OpenSpec change `delegated-password-login`).
//
// An outside service the administrator connected in System Settings checks a
// person's ID and password — StyleHR is the first, for store Team Leaders who
// have no Google identity. Featherbase forwards the pair once and binds the
// result to the ONE User whose configured column holds that ID — looked up
// BEFORE the provider is asked, so Featherbase never checks a password for an
// ID it would not sign in (no password oracle for unlinked IDs).
//
// Fail closed (review of #363): only a 200-family JSON object carrying a
// positive success signal verifies. An empty body, HTML, an unreadable body or
// an unrecognised shape is "could not confirm", never a sign-in. A body that
// says the person has left is refused even with a right password — StyleHR
// keeps authenticating leavers (data-warehouse report_server/stylehr_auth.py,
// whose rules this ports). Binding never depends on the body.
//
// The password is held for one outbound request and never stored, logged,
// thrown or echoed. Failures are logged as label + outcome only.
import { sql } from './db'
import { AppError } from './errors'
import { getSystemSettings } from './settings'
import { PLATFORM_SCHEMA } from './platform-schema'
import { INVALID_CREDENTIALS } from './auth'

export interface DelegatedLoginConfig {
  label: string
  url: string
  userColumn: string
}

// http is accepted only for a stub on this machine (tests, local dev); a
// password never crosses a network in the clear.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The connected provider, or null when the feature is off. Off whenever the
 *  URL is blank or not https (bar a local stub), or no User column is named. */
export async function delegatedLoginConfig(): Promise<DelegatedLoginConfig | null> {
  const s = await getSystemSettings()
  const raw = s.delegated_login_url.trim()
  const userColumn = s.delegated_login_user_column.trim()
  if (!raw || !userColumn) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
  if (!allowed) return null
  return { label: s.delegated_login_label.trim() || url.hostname, url: url.toString(), userColumn }
}

// Injectable for the sandboxed suite — the real provider is never contacted
// from a test (same seam as `_setEmbedFetch` in sales-target.ts).
let delegatedFetch: typeof fetch = (...args) => fetch(...args)
export function _setDelegatedFetch(f: typeof fetch | null) {
  delegatedFetch = f ?? ((...args) => fetch(...args))
}

const TIMEOUT_MS = 10_000

export type ProviderOutcome = 'verified' | 'rejected' | 'unavailable' | 'left'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const lowerKeys = (o: Obj): Obj => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]))
const filled = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 'null' && v !== false && v !== 0

/** The body and the identity-ish objects one level down, keys lower-cased. */
function layers(body: Obj): Obj[] {
  const top = lowerKeys(body)
  return [top, ...['data', 'user', 'employee', 'result'].map((k) => top[k]).filter(isObj).map(lowerKeys)]
}

// A 2xx that says no. Booleans count: {"success": false} and {"status": false} are refusals.
function saysNo(o: Obj): boolean {
  if (filled(o.error) || filled(o.errors)) return true
  if (o.success === false || o.ok === false || o.status === false || o.authenticated === false) return true
  return ['error', 'fail', 'failed', 'failure', 'invalid'].includes(String(o.status ?? '').toLowerCase())
}

// Positive evidence of a session or an identity. Anything else is "could not confirm".
const SUCCESS_KEYS = ['token', 'access', 'access_token', 'key', 'employee_id', 'employee_key', 'id']
function saysYes(o: Obj): boolean {
  return o.success === true || o.ok === true || o.authenticated === true || SUCCESS_KEYS.some((k) => filled(o[k]))
}

// Ported from report_server/stylehr_auth.py looks_resigned: an exit date, an inactive flag,
// or a status that reads as gone.
const EXIT_DATE_KEYS = ['exit_date', 'relieving_date', 'date_of_relieving', 'termination_date', 'resignation_date', 'last_working_date']
const STATUS_KEYS = ['status', 'employment_status', 'employee_status']
const LEFT_WORDS = ['resign', 'terminat', 'reliev', 'exit', 'inactive', 'left', 'separated']
function saysLeft(o: Obj): boolean {
  if (EXIT_DATE_KEYS.some((k) => filled(o[k]) && o[k] !== 'None')) return true
  if (o.is_active === false || o.active === false) return true
  return STATUS_KEYS.some((k) => typeof o[k] === 'string' && LEFT_WORDS.some((w) => String(o[k]).toLowerCase().includes(w)))
}

/** Ask the provider whether `id`/`password` are good. Never throws. */
export async function checkWithProvider(cfg: DelegatedLoginConfig, id: string, password: string): Promise<ProviderOutcome> {
  let res: Response
  try {
    res = await delegatedFetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: id, password }),
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
  const ls = layers(body)
  // Key NAMES only — enough to diagnose the first real sign-in, never a value.
  const keys = `keys=${Object.keys(body).sort().join(',')}`
  if (ls.some(saysNo)) {
    logOutcome(cfg, 'rejected', `http_${res.status}_error_body ${keys}`)
    return 'rejected'
  }
  if (ls.some(saysLeft)) {
    logOutcome(cfg, 'left', `http_${res.status} ${keys}`)
    return 'left'
  }
  if (!ls.some(saysYes)) {
    logOutcome(cfg, 'unavailable', `http_${res.status}_unrecognised_success ${keys}`)
    return 'unavailable'
  }
  return 'verified'
}

function logOutcome(cfg: DelegatedLoginConfig, outcome: ProviderOutcome, detail: string) {
  console.warn(`[delegated-login] ${cfg.label}: ${outcome} (${detail})`)
}

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** Refuse a configured User column that is not a plain, existing column. It
 *  is interpolated into SQL as an identifier, so it is never trusted as is. */
export async function assertUserColumn(cfg: DelegatedLoginConfig): Promise<void> {
  // A text column only: lower(trim()) on anything else fails AFTER the provider verified.
  const ok =
    SAFE_IDENTIFIER.test(cfg.userColumn) &&
    (
      await sql`
        select 1 from information_schema.columns
        where table_schema = ${PLATFORM_SCHEMA} and table_name = 'user' and column_name = ${cfg.userColumn}
          and data_type in ('character varying', 'text')`
    ).length === 1
  if (!ok) {
    logOutcome(cfg, 'unavailable', 'user column is not a column of User')
    throw new AppError('ServiceUnavailableError', `Sign-in with ${cfg.label} is not set up correctly. Contact your administrator.`)
  }
}

export function unavailable(cfg: DelegatedLoginConfig): AppError {
  return new AppError(
    'ServiceUnavailableError',
    `${cfg.label} is not responding right now. This is not your password — please try again in a few minutes.`,
  )
}

/** The one human account linked to `id` — resolved BEFORE the provider is
 *  asked. No link, a disabled account or a privileged one all get password
 *  login's refusal, and the password is never forwarded for them: answering
 *  "not linked" after a provider check would turn this route into a password
 *  checker for every unlinked ID. Ambiguity refuses rather than picking.
 *  Call `assertUserColumn` first. */
export async function linkedUser(cfg: DelegatedLoginConfig, id: string): Promise<string> {
  const rows = await sql`
    select u.row_id, u.enabled,
           exists (select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator')) as privileged
    from "user" u
    where lower(trim(${sql(cfg.userColumn)})) = lower(trim(${id}))
      and coalesce(u.user_type, '') <> 'service'
    limit 2`
  if (rows.length === 0) throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  if (rows.length > 1)
    throw new AppError('ConflictError', `More than one account is linked to this ${cfg.label} ID. Contact your administrator.`)
  // Whoever administers the outside service can reset passwords there; that must
  // never reach the Administrator or a System Manager here. They use their own password.
  if (!rows[0].enabled || rows[0].privileged || rows[0].row_id === 'Administrator')
    throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  return String(rows[0].row_id)
}

export function left(cfg: DelegatedLoginConfig): AppError {
  return new AppError('PermissionError', `${cfg.label} shows this account as no longer active. Contact your administrator.`)
}
