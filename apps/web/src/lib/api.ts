import type { SignInMethodKind } from 'shared'
import { followDevice } from '@featherbase/shop-floor/theme'
import { clearVisitJournal } from './recents'
import { pageLoad } from './page-load'
// Thin authenticated client for the Featherbase server API.

const TOKEN_KEY = 'fc_token'
const USER_KEY = 'fc_user'
let runtimeSnapshot: { token: string; versions: Promise<string[]> } | undefined
// These requests establish/end credentials or serve public content. A saved
// expired bearer must not insert a protected request in front of them.
const PUBLIC_API_PATHS = new Set([
  '/api/login', '/api/login/delegated', '/api/signup', '/api/logout', '/api/oauth/session',
  '/api/reset_password_request', '/api/reset_password', '/api/brand', '/api/ping',
  // #1255: the browser's accounts read only the browser's own cookies.
  '/api/accounts', '/api/accounts/switch', '/api/accounts/remove', '/api/accounts/sign_out', '/api/accounts/sign_out_all',
])

export interface SessionUser {
  row_id: string
  /** Optional contact data (person-identities): null when the person has none. */
  email: string | null
  full_name: string | null
  // Where this account lands after sign-in on this address when it is not the
  // Admin (#3755, #488: on Feather Dash's address, its report). Absent = /admin.
  landing?: string
  /** The apps this person can open, as the sign-in answered: a return path to any other goes to the landing. */
  apps?: string[]
}

/** A sign-in's answer as the page acts on it: the session's user, plus — when
 *  this person belongs on another address of the instance — the one-time
 *  hand-off URL to go to there (#488). The hand-off is never stored. */
export type SignedIn = SessionUser & { handoff?: string }

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getSessionUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY)
  return raw ? (JSON.parse(raw) as SessionUser) : null
}

export function clearSession() {
  runtimeSnapshot = undefined
  clearVisitJournal()
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  // #380: whoever uses this browser next sees their device's theme, not the
  // departing person's choice. Every sign-out path ends here.
  followDevice()
}

// The single place a session is written down. Both sign-in paths land here:
// the password login below, and the OAuth callback (#150), which redeems its
// one-time handoff code for exactly this pair.
export function setSession(token: string, user: SessionUser) {
  runtimeSnapshot = undefined
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

// #1255 D9: tabs share localStorage. When another tab changes the signed-in
// account in any way (a switch, a sign-out, a sign-in), this tab loads
// afresh, so no page shows one account while acting as another.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY && e.oldValue !== e.newValue) pageLoad.reload()
  })

export class ApiError extends Error {
  status: number
  type: string
  fields?: Record<string, string>
  constructor(status: number, type: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.type = type
    this.fields = fields
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  // Pin before metadata/data reads. Refetch and 409 must never relabel an old
  // form as new code; only a new login or page reload obtains another snapshot.
  let versions: string[] = []
  const endpoint = path.split('?')[0]
  if (token && endpoint !== '/api/runtime_app_versions' &&
      !PUBLIC_API_PATHS.has(endpoint) && !endpoint.startsWith('/api/web_form/')) {
    if (runtimeSnapshot?.token !== token) {
      runtimeSnapshot = { token, versions: request<string[]>('/api/runtime_app_versions') }
    }
    const snapshot = runtimeSnapshot
    versions = await snapshot.versions
    if (getToken() !== token || runtimeSnapshot !== snapshot)
      throw new ApiError(409, 'ConflictError', 'Session changed. Reload before retrying')
  }
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
      ...(versions.length ? { 'X-Featherbase-App-Version': versions.join(', ') } : {}),
    },
  })
  // #1255: a 401 ends only the session it was sent with. When the account
  // changed meanwhile (a switch, or sign-out continuing as another), the
  // answer is about the departed one and must not end the new one.
  if (res.status === 401 && getToken() === token) {
    clearSession()
    // Already on the login screen there is nothing to redirect to — a hard
    // reload here just destroys in-flight state (a stale query 401ing during
    // the logout transition, #101 review).
    if (!path.endsWith('/api/login') && !path.endsWith('/api/login/delegated') && window.location.pathname !== '/featherbase/login') {
      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
      // A session that existed and was refused has ended (a disabled account,
      // an upgrade that re-keyed every account): the sign-in page says so.
      window.location.href = `${loginHref(next)}${token ? '&ended=1' : ''}`
    }
  }
  const body = (await res.json().catch(
    /* istanbul ignore next -- a body that is not JSON comes only from something between the browser and the server (a proxy's error page); the server answers JSON on every path, errors and not-found included */
    () => ({}),
  )) as {
    error?: { type: string; message: string; fields?: Record<string, string> }
  }
  // #1222: View as just ended on the server; reload so the page never shows two people at once.
  if (res.status === 409 && body.error?.message?.startsWith('View as has ended')) window.location.reload()
  if (!res.ok)
    throw new ApiError(
      res.status,
      body.error?.type ?? 'InternalError',
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.fields,
    )
  return body as T
}

// #411: sign-out ends this session on the server. If the server could not
// confirm it (a 5xx or no answer), the session may still work: the caller
// says so and keeps the user signed in so they can try again.
export const SIGN_OUT_INCOMPLETE = 'Sign-out did not complete. Check your connection and try again.'
// #1255 D6: signing out goes through the browser's accounts. When another
// account is held, the server continues as it and answers with its session.
export type SignOutResult = { ok: false } | { ok: true; next: SignedIn | null }
export async function signOut(): Promise<SignOutResult> {
  try {
    const res = await api.post<LoginResponse | { signed_out: true }>('/api/accounts/sign_out', {})
    return { ok: true, next: 'token' in res ? rememberLogin(res) : null }
  } catch {
    return { ok: false }
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  upload: <T>(body: FormData) => request<T>('/api/upload_file', { method: 'POST', body }),
  // API surface design (#61): PATCH, not PUT, for row updates — Tables gain
  // columns at runtime via Custom Field, and a PUT from a client that read a
  // row before a column existed would silently null it on write. `put` stays
  // for the handful of endpoints that aren't row data (e.g. /api/user_settings,
  // a per-user preferences blob whose saves merge top-level keys).
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

type LoginResponse = { token: string; user: SessionUser; landing?: string; handoff?: string; apps?: string[] }

/** Stores the session; returns the user, with the hand-off when there is one. */
export function rememberLogin(res: LoginResponse): SignedIn {
  const user = { ...res.user, ...(res.landing ? { landing: res.landing } : {}), apps: res.apps }
  setSession(res.token, user)
  // #1255 D2: every sign-in tells the switcher, so the account joins this
  // browser's list. keepalive: the page may be leaving for the landing.
  void fetch('/api/accounts', { method: 'POST', keepalive: true }).catch(() => {})
  return res.handoff ? { ...user, handoff: res.handoff } : user
}

export async function login(usr: string, pwd: string): Promise<SignedIn> {
  return rememberLogin(await api.post<LoginResponse>('/api/login', { usr, pwd }))
}

/** Sign in through a connected service (a Sign In Method row of kind
 *  `delegated_password`, e.g. StyleHR) named by its key. Same session shape. */
export async function loginDelegated(usr: string, pwd: string, method: string): Promise<SignedIn> {
  return rememberLogin(await api.post<LoginResponse>('/api/login/delegated', { usr, pwd, method }))
}

/** Direct sign-up (person-identities): a username and a password, when the
 *  instance has opened it. Signs the new person in like `login`. */
export async function signUp(username: string, password: string): Promise<SignedIn> {
  return rememberLogin(await api.post<LoginResponse>('/api/signup', { username, password }))
}

/** One way in, as `/api/brand` lists it for the sign-in page. */
export interface BrandSignInMethod {
  key: string
  kind: SignInMethodKind
  label: string
  test_mode: boolean
}

/** The sign-in page, carrying where the person was headed. The Login page
 *  re-checks `next` (safeLoginNext) before using it. */
export function loginHref(next: string): string {
  return `/featherbase/login?next=${encodeURIComponent(next)}`
}

/** The signed-in account's landing path: the Admin unless the server said otherwise (#3755). */
export function landingPath(user: SessionUser | null = getSessionUser()): string {
  return user?.landing ?? '/featherbase/admin'
}

interface ListResult<T = Record<string, unknown>> {
  data: T[]
  total: number
  limit_start: number
  limit_page_length: number
}

export function listResource<T = Record<string, unknown>>(
  table: string,
  params: {
    filters?: unknown[]
    fields?: string[]
    order_by?: string
    limit_start?: number
    limit_page_length?: number
    /** #859: list retired rows too; the server leaves them out by default. */
    with_retired?: boolean
  } = {},
) {
  const qs = new URLSearchParams()
  if (params.with_retired) qs.set('with_retired', 'true')
  if (params.filters?.length) qs.set('filters', JSON.stringify(params.filters))
  if (params.fields?.length) qs.set('fields', JSON.stringify(params.fields))
  if (params.order_by) qs.set('order_by', params.order_by)
  if (params.limit_start != null) qs.set('limit_start', String(params.limit_start))
  if (params.limit_page_length != null)
    qs.set('limit_page_length', String(params.limit_page_length))
  const suffix = qs.size ? `?${qs}` : ''
  return api.get<ListResult<T>>(`/api/table/${encodeURIComponent(table)}${suffix}`)
}

/** #1255: an account signed in on this browser, as the switcher lists it. Never a token. */
export interface BrowserAccount {
  session: string
  person: string
  name: string | null
  method: string | null
  method_kind: SignInMethodKind | null
  method_label: string | null
  /** What they would type to sign in again: a connected service's ID, else the email or username. */
  sign_in_id: string | null
  /** Seconds since the epoch. */
  last_used: number
  active: boolean
  state: 'live' | 'ended'
  reason_text?: string
}
export interface BrowserAccounts { accounts: BrowserAccount[]; full: boolean }

export const browserAccounts = {
  list: () => api.post<BrowserAccounts>('/api/accounts'),
  /** Continue as a held account; its session is stored as a sign-in's is. */
  switchTo: async (session: string) => rememberLogin(await api.post<LoginResponse>('/api/accounts/switch', { session })),
  remove: (session: string) => api.post<BrowserAccounts>('/api/accounts/remove', { session }),
  signOutAll: () => api.post<{ signed_out: true }>('/api/accounts/sign_out_all'),
}
