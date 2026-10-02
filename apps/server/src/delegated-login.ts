// Delegated password sign-in (OpenSpec change `delegated-password-login`).
//
// An outside service the administrator connected in System Settings checks a
// person's ID and password — StyleHR is the first, for store Team Leaders who
// have no Google identity. Featherbase forwards the pair once and binds the
// result to the ONE User whose configured column holds that ID. The
// provider's success body is undocumented, so nothing here reads it beyond
// refusing an obvious error body; binding never depends on it.
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

export type ProviderOutcome = 'verified' | 'rejected' | 'unavailable'

function isErrorBody(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [k.toLowerCase(), v]))
  return Boolean(lower.error) || Boolean(lower.errors) || String(lower.status ?? '').toLowerCase() === 'error'
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
  if (res.status >= 400 && res.status < 500) {
    logOutcome(cfg, 'rejected', `http_${res.status}`)
    return 'rejected'
  }
  if (res.status < 200 || res.status >= 300) {
    logOutcome(cfg, 'unavailable', `http_${res.status}`)
    return 'unavailable'
  }
  // Some providers answer 200 with an error body. Fail closed on it.
  const text = await res.text().catch(() => '')
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (isErrorBody(body)) {
    logOutcome(cfg, 'rejected', `http_${res.status}_error_body keys=${Object.keys(body as object).sort().join(',')}`)
    return 'rejected'
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
  const ok =
    SAFE_IDENTIFIER.test(cfg.userColumn) &&
    (
      await sql`
        select 1 from information_schema.columns
        where table_schema = ${PLATFORM_SCHEMA} and table_name = 'user' and column_name = ${cfg.userColumn}`
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

/** The one human account linked to `id`, after the provider verified it.
 *  Ambiguity refuses rather than picking; a disabled account gets password
 *  login's refusal. Call `assertUserColumn` first. */
export async function linkedUser(cfg: DelegatedLoginConfig, id: string): Promise<string> {
  const rows = await sql`
    select row_id, enabled from "user"
    where lower(trim(${sql(cfg.userColumn)})) = lower(trim(${id}))
      and coalesce(user_type, '') <> 'service'
    limit 2`
  if (rows.length === 0)
    throw new AppError('PermissionError', `No account is linked to this ${cfg.label} ID`)
  if (rows.length > 1)
    throw new AppError('ConflictError', `More than one account is linked to this ${cfg.label} ID. Contact your administrator.`)
  if (!rows[0].enabled) throw new AppError('AuthenticationError', INVALID_CREDENTIALS)
  return String(rows[0].row_id)
}
