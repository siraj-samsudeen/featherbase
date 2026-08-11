import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { config } from './config'
import { sql } from './db'
import { AppError, errorResponse } from './errors'
import { getMeta, resolveTableName } from './meta'
import { createTable, deleteTable, setIdPattern, updateTable } from './doctype-engine'
import { deleteDoc, getDoc, saveDoc } from './document'
import { countDocs, getList, groupCount } from './query'
import { loadControllers } from './controllers'
import { getAccessToken, issueAccessToken, listAccessTokens, login, resolveToken, revokeAccessToken, setUserPassword, issueSession, type SessionUser } from './auth'
import { createServiceAccount, listServiceAccounts, setServiceAccountEnabled } from './service-accounts'
import { googleAuthorizeUrl, mockConsentHtml, mockApproveRedirect, exchangeCode, findOrCreateGoogleUser, newLoginChallenge, codeChallengeFor, verifyState, oauthClientId, assertSignInAvailable, assertMockProviderAllowed, OAUTH_CALLBACK_PATH } from './oauth'
import { assertPermission, assertSystemManager, getRoles, permissionScope } from './permissions'
import { ensureHomePageForTable, getVisibleHomePages } from './home-pages'
import { readStored, saveUpload, signFileUrl, verifyFileSignature } from './storage'
import { isThumbnable, makeThumbnailDataUrl } from './thumbnails'
import { globalSearch } from './search'
import { callMethod, loadMethods, methodAllowsGuest, methodEffect } from './methods'
import {
  getCollectionAction,
  getRowAction,
  isKnownCollectionSuffix,
  isKnownRowSuffix,
  listActions,
  splitSuffix,
} from './actions'
import './actions/core-row-actions'
import './actions/collection-import'
import './actions/source-actions'
import './actions/row-connections'
import './actions/collection-aggregate'
import { renderPdf, renderPrintHtml } from './print'
import { availableActions, currentState, getActiveWorkflow } from './workflow'
import { reapplyCustomFields } from './custom-fields'
import { enqueue, loadJobs, retryJob, startWorker } from './jobs'
import { attachRealtime, publishDocEvent, publishUserEvent } from './realtime'
import { createAssignment } from './assign'
import { queueEmail, sendTestEmail } from './email'
import { getSystemSettings } from './settings'
import { requestPasswordReset, resetPassword } from './password-reset'
import { renderWebPage } from './website'
import { getWebFormConfig, submitWebForm } from './webform'
import { logAccess } from './audit'
import { eventSummary, recordEvents, routineSuggestion, validateEventBatch } from './events'
import { createSavedView, deleteSavedView, listSavedViews, setSavedViewShared } from './saved-views'
import { runApiScript } from './server-scripts'
import { exportCustomizations, importCustomizations } from './customizations'
import { getCatalog } from './i18n'
import { rateLimit } from './rate-limit'
import { parseFilters, runQueryReport } from './query-report'
import { deliverAutoEmailReport } from './auto-email-report'
import { runReportChart, pinChartToDashboard } from './report-chart'
import { registerApp, loadInstalledApps, installApp, installAppFromManifest, uninstallApp, listInstalledApps, getAvailableApps } from './apps'
import { createSite, listSites, resolveSite, siteCreateDoctype, siteListDoctypes, siteCreateUser, siteListUsers } from './tenancy'
import helloCrm from './sample-apps/hello-crm'
import helpdesk from './sample-apps/helpdesk'
import checklists from './sample-apps/checklists'
import { loadScriptReports, runScriptReport, scriptReportMeta } from './script-report'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

await loadControllers()
await loadMethods()
await loadJobs()
await loadScriptReports()
// CUST-001: re-apply custom fields so they survive a core re-seed.
await reapplyCustomFields()
// PLAT-001: register the apps this build ships, then re-wire the doc_events of
// any that are already installed (their DocTypes persist in the DB).
registerApp(helloCrm)
// Registered, NOT installed: a fresh deployment has zero helpdesk tables
// until POST /api/install_app { name: 'helpdesk' } (PLAT-006, #78).
registerApp(helpdesk)
// Same discipline: checklist tables exist only after
// POST /api/install_app { name: 'checklists' }.
registerApp(checklists)
await loadInstalledApps()

type Env = { Variables: { user: SessionUser } }

export const app = new Hono<Env>()

app.onError((err, c) => errorResponse(c, err))

// API-006: even unknown routes answer with the error envelope.
app.notFound((c) =>
  c.json({ error: { type: 'NotFoundError', message: `Route not found: ${c.req.method} ${c.req.path}` } }, 404),
)

// API-008: CORS restricted to the Admin origin(s) + standard security
// headers. Runs before auth so preflight OPTIONS (which carries no
// Authorization header) is answered here.
app.use('*', secureHeaders())
app.use(
  '/api/*',
  cors({
    origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
)

// ---- Public routes (no session required) -----------------------------------

app.get('/api/ping', async (c) => {
  const [row] = await sql`select 1 as ok`
  return c.json({ message: 'pong', db: row.ok === 1 })
})

// SET-004: the instance's display name, public so the login page (pre-auth)
// can brand itself. app_name only — everything else in System Settings
// stays behind the session like /api/settings.
app.get('/api/brand', async (c) => {
  const s = await getSystemSettings()
  return c.json({ app_name: s.app_name })
})

// Frappe wire parity: sessions ride an HttpOnly `sid` cookie (as in real
// Frappe) in addition to the Bearer token the SPA stores. Either credential
// authenticates a request; the cookie lets Frappe-style clients work
// unchanged and keeps the token out of reach of page scripts.
function setSidCookie(c: Context, token: string) {
  setCookie(c, 'sid', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

// The Authorization header wins; an sid cookie is the fallback credential.
function authCredential(c: Context): string | undefined {
  const header = c.req.header('authorization')
  if (header) return header
  const sid = getCookie(c, 'sid')
  return sid ? `Bearer ${sid}` : undefined
}

app.post('/api/login', async (c) => {
  const { usr, pwd } = (await c.req.json()) as { usr?: string; pwd?: string }
  if (!usr || !pwd) throw new AppError('ValidationError', 'Expected { usr, pwd }')
  const session = await login(usr, pwd)
  setSidCookie(c, session.token)
  return c.json(session)
})

// Frappe-compatible login/logout: POST /api/method/login {usr, pwd} answers
// with Frappe's shape and sets the sid cookie; logout clears it. Registered
// as explicit routes so they take precedence over the generic RPC dispatcher.
app.post('/api/method/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { usr?: string; pwd?: string }
  const usr = body.usr ?? c.req.query('usr')
  const pwd = body.pwd ?? c.req.query('pwd')
  if (!usr || !pwd) throw new AppError('ValidationError', 'Expected { usr, pwd }')
  const session = await login(usr, pwd)
  setSidCookie(c, session.token)
  return c.json({
    message: 'Logged In',
    home_page: '/admin',
    full_name: session.user.full_name ?? session.user.row_id,
  })
})

app.post('/api/method/logout', async (c) => {
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ message: '' })
})

// The SPA's sign-out. Public — it must clear the sid cookie even when the
// bearer token is already gone or expired, otherwise the cookie survives as
// a live credential and any token-less request after logout re-authenticates
// as the departed user (found via #101: a post-logout whoami refetch answered
// as the previous user and poisoned the cache for the next account).
app.post('/api/logout', (c) => {
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

// SET-002: password reset (public — the caller is logged out). The request
// always returns ok so it can't be used to probe which accounts exist.
app.post('/api/reset_password_request', async (c) => {
  const { usr } = (await c.req.json().catch(() => ({}))) as { usr?: string }
  if (!usr) throw new AppError('ValidationError', 'Expected { usr }')
  await requestPasswordReset(usr)
  return c.json({ ok: true })
})

app.post('/api/reset_password', async (c) => {
  const { key, new_password } = (await c.req.json().catch(() => ({}))) as {
    key?: string
    new_password?: string
  }
  await resetPassword(key ?? '', new_password ?? '')
  return c.json({ ok: true })
})

// FILE-001: serve stored files. Only files registered as a File doc are
// readable. Public bucket needs no session; the private bucket accepts a
// bearer header or ?token= (so <img src> and download links work).
async function serveFile(c: Context<Env>, fileUrl: string, isPrivate: boolean) {
  const [row] = await sql`
    select row_id, file_name, mime_type, ref_table, ref_name
    from file where file_url = ${fileUrl}`
  if (!row) throw new AppError('NotFoundError', `File not found: ${fileUrl}`)

  // FILE-003: private files require either a valid signed URL (minted after a
  // permission check) or a session that can read the linked row. A user
  // without read on that row gets a 403.
  if (isPrivate) {
    const signed = verifyFileSignature(fileUrl, c.req.query('expires'), c.req.query('signature'))
    if (!signed) {
      // #137: the header still accepts any credential; the ?token= fallback
      // refuses access tokens, which must never travel in a URL.
      const header = c.req.header('authorization')
      const token = c.req.query('token')
      const user = header
        ? await resolveToken(header)
        : await resolveToken(token ? `Bearer ${token}` : undefined, { fromUrl: true })
      if (row.ref_table && row.ref_name)
        await getDoc(row.ref_table as string, row.ref_name as string, user.row_id)
      else await getDoc('File', row.row_id as string, user.row_id)
    }
  }

  const content = await readStored(fileUrl)
  return c.body(new Uint8Array(content), 200, {
    'content-type': (row.mime_type as string) || 'application/octet-stream',
    'content-disposition': `inline; filename="${(row.file_name as string).replace(/"/g, '')}"`,
  })
}

app.get('/files/:stored', (c) => serveFile(c, `/files/${c.req.param('stored')}`, false))
app.get('/private/files/:stored', (c) =>
  serveFile(c, `/private/files/${c.req.param('stored')}`, true),
)

// WEB-002: public web-form config + submit (no session — anonymous forms).
// Registered before the auth middleware. Only whitelisted fields of the
// configured DocType are accepted; server validation still runs.
app.get('/api/web_form/:route', async (c) => {
  return c.json(await getWebFormConfig(c.req.param('route')))
})

app.post('/api/web_form/:route', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { values?: Record<string, unknown> }
  // The route is public, but a logged-in submitter (Bearer token or sid
  // cookie) gets the document created in their name — that's what makes
  // their if_owner portal show it. An invalid/absent credential is anonymous.
  const sessionUser = await resolveToken(authCredential(c))
    .then((u) => u.row_id)
    .catch(() => undefined)
  return c.json(await submitWebForm(c.req.param('route'), body.values ?? {}, sessionUser), 201)
})

// WEB-001: public, server-rendered Web Pages. No session required; only
// published pages render (others 404). Path may contain slashes.
app.get('/web/:route{.+}', async (c) => {
  const page = await renderWebPage(c.req.param('route'))
  return c.html(page.html, page.found ? 200 : 404)
})

// API-003: RPC for whitelisted server methods. Registered before the global
// auth middleware so guest-allowed methods work without a session — but that
// means it must resolve auth AND apply rate limiting itself (#62 bug 1: this
// route used to return before ever reaching the global `rateLimit` use()
// registered below, so API-007 was silently unenforced on the whole RPC
// surface). Each registered method declares effect: 'read' | 'write'
// (methods.ts); the dispatcher requires POST for 'write' instead of accepting
// either verb (#62 bug 2: GET on frappe.client.delete/insert/set_value used to
// execute the mutation straight from the query string — a live CSRF vector
// given the sid cookie is sameSite: 'Lax'). Path may contain slashes.
app.on(
  ['GET', 'POST'],
  '/api/method/:path{.+}',
  async (c, next) => {
    const path = c.req.param('path') as string
    const user = methodAllowsGuest(path)
      ? { row_id: 'Guest', email: 'guest@example.com', full_name: 'Guest' }
      : await resolveToken(authCredential(c))
    c.set('user', user)
    await next()
  },
  rateLimit,
  async (c) => {
    const path = c.req.param('path') as string
    if (methodEffect(path) === 'write' && c.req.method !== 'POST')
      throw new AppError('MethodNotAllowedError', `Method ${path} mutates and requires POST`)
    const args =
      c.req.method === 'POST'
        ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
        : c.req.query()
    return c.json({ message: await callMethod(path, args, c.get('user')) })
  },
)

// The origin a browser reaches this instance on. `SITE_URL` is configuration
// and therefore authoritative: a request header cannot steer it. Only a
// checkout that has not been told where it lives falls back to the request,
// and then `x-forwarded-proto` is read as what it is — a LIST. A proxy chain
// APPENDS its hop rather than overwriting, so a request that reached the edge
// over TLS arrives as `https,http`; comparing that whole string to 'https'
// read false and set the login cookies without `Secure`, and interpolated
// `https,http://host` into the redirect_uri. Only the first hop is the
// client's, and anything that is not http/https is not a protocol we will
// paste into an origin.
function externalOrigin(c: Context): URL {
  if (config.siteUrl) return new URL(config.siteUrl)
  const url = new URL(c.req.url)
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : url.protocol.slice(0, -1)
  return new URL(`${proto}://${url.host}`)
}

// PLAT-006: Google OAuth (public — the caller is logging in). In dev a mock
// provider stands in for Google. Flow: login → provider consent → callback →
// find/create User → issue session → bounce back into the SPA with the token.
// Mock flow stays same-origin (relative) so the dev proxy keeps the browser
// on the SPA origin end to end; real Google needs an absolute redirect_uri
// that byte-matches the registered one.
function oauthRedirectUri(c: Context, clientId: string): string {
  if (!clientId) return OAUTH_CALLBACK_PATH
  return `${externalOrigin(c).origin}${OAUTH_CALLBACK_PATH}`
}

// The login challenge (OAuth `state` + PKCE verifier) rides HttpOnly cookies
// so it is bound to the browser that started the sign-in. Same attributes as
// the sid cookie, plus `secure` whenever the browser reached us over TLS and a
// ten-minute life — they exist only for the length of one consent round trip.
const OAUTH_STATE_COOKIE = 'oauth_state'
const OAUTH_VERIFIER_COOKIE = 'oauth_verifier'

// Derived from the external origin, not NODE_ENV: behind Railway's TLS-
// terminating edge the container sees http, and a `secure` cookie on a
// plain-http dev origin is silently dropped by the browser. Same origin the
// redirect_uri comes from, so the two can never disagree.
function oauthCookieOptions(c: Context) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: 600,
    secure: externalOrigin(c).protocol === 'https:',
  }
}

function setLoginChallengeCookies(c: Context, state: string, verifier: string) {
  setCookie(c, OAUTH_STATE_COOKIE, state, oauthCookieOptions(c))
  setCookie(c, OAUTH_VERIFIER_COOKIE, verifier, oauthCookieOptions(c))
}

function clearLoginChallengeCookies(c: Context) {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })
  deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: '/' })
}

app.get('/api/oauth/google/login', async (c) => {
  const clientId = await oauthClientId()
  assertSignInAvailable(clientId)
  const redirectUri = oauthRedirectUri(c, clientId)
  const { state, verifier } = newLoginChallenge()
  setLoginChallengeCookies(c, state, verifier)
  const hint = { email: c.req.query('email'), name: c.req.query('name') }
  return c.redirect(googleAuthorizeUrl(clientId, state, redirectUri, codeChallengeFor(verifier), hint))
})

app.get('/api/oauth/mock/consent', async (c) => {
  assertMockProviderAllowed(await oauthClientId())
  const state = c.req.query('state') ?? ''
  const redirectUri = c.req.query('redirect_uri') ?? ''
  const email = c.req.query('email') ?? 'demo.user@gmail.com'
  const name = c.req.query('name') ?? 'Demo User'
  return c.html(mockConsentHtml(state, redirectUri, email, name))
})

app.get('/api/oauth/mock/approve', async (c) => {
  assertMockProviderAllowed(await oauthClientId())
  const state = c.req.query('state') ?? ''
  const redirectUri = c.req.query('redirect_uri') ?? ''
  verifyState(state, getCookie(c, OAUTH_STATE_COOKIE))
  const email = c.req.query('email') ?? ''
  const name = c.req.query('name') ?? ''
  return c.redirect(mockApproveRedirect(state, redirectUri, email, name))
})

app.get('/api/oauth/google/callback', async (c) => {
  const clientId = await oauthClientId()
  assertSignInAvailable(clientId)
  // The state must match the cookie this browser got at login. Without that
  // binding an attacker could complete consent with their own account and
  // hand the victim the callback URL, planting the attacker's session.
  verifyState(c.req.query('state'), getCookie(c, OAUTH_STATE_COOKIE))
  const verifier = getCookie(c, OAUTH_VERIFIER_COOKIE)
  // One challenge, one use — clear it whether or not the exchange succeeds.
  clearLoginChallengeCookies(c)
  const { email, name } = await exchangeCode(c.req.query('code'), oauthRedirectUri(c, clientId), clientId, verifier)
  const userName = await findOrCreateGoogleUser(email, name)
  const { token } = await issueSession(userName)
  // The cookie matters here too: beacons (e.g. the unload-time event batch,
  // #101) cannot carry a bearer token, so an OAuth session without the sid
  // cookie would silently drop them (PR #104 review).
  setSidCookie(c, token)
  // Bounce back into the SPA (same origin via the dev proxy), which stores the
  // token and lands in the Admin.
  return c.redirect(`/oauth-callback?token=${encodeURIComponent(token)}`)
})

// ---- API-004: everything below requires a valid session --------------------

app.use('/api/*', async (c, next) => {
  const user = await resolveToken(authCredential(c))
  c.set('user', user)
  await next()
})

// API-007: throttle authenticated requests per user (runs after auth so it can
// key by the resolved user and read their budget).
app.use('/api/*', rateLimit)

const who = (c: { get: (k: 'user') => SessionUser }) => c.get('user').row_id

app.get('/api/whoami', async (c) => {
  const user = c.get('user')
  const [row] = await sql`select theme, palette, language from "user" where row_id = ${user.row_id}`
  return c.json({
    ...user,
    roles: await getRoles(user.row_id),
    theme: (row?.theme as string) || 'light',
    palette: (row?.palette as string) || 'classic',
    language: (row?.language as string) || 'en',
  })
})

// #101 Phase 3: batched capture of the caller's read-side intent (rows
// visited, lists filtered, searches run). The user always comes from the
// session — a client cannot write anyone else's trail — and reads are
// scoped to the caller for the same reason.
app.post('/api/events', async (c) => {
  const events = validateEventBatch(await c.req.json().catch(() => null))
  const inserted = await recordEvents(who(c), events)
  // Nudge the poster's own "Mine" feed on their personal channel (PR #104
  // review — the 'feed' channel is System Manager-only).
  publishUserEvent(who(c), 'feed_mine')
  return c.json({ inserted })
})

app.get('/api/events/summary', async (c) => {
  return c.json({ entries: await eventSummary(who(c)) })
})

// #101 Phase 6: saved views — list is owner's + shared; create/share/delete
// are owner-scoped inside the module.
app.get('/api/saved_views', async (c) => {
  const table = c.req.query('table')
  if (!table) throw new AppError('ValidationError', 'Expected ?table=<Table name>')
  return c.json({ views: await listSavedViews(who(c), table) })
})

app.post('/api/saved_views', async (c) => {
  const view = await createSavedView(who(c), await c.req.json().catch(() => null))
  return c.json(view, 201)
})

app.post('/api/saved_views/:name/share', async (c) => {
  const { shared } = (await c.req.json().catch(() => ({}))) as { shared?: boolean }
  if (typeof shared !== 'boolean') throw new AppError('ValidationError', 'Expected { shared: boolean }')
  await setSavedViewShared(who(c), c.req.param('name'), shared)
  return c.json({ ok: true })
})

app.delete('/api/saved_views/:name', async (c) => {
  await deleteSavedView(who(c), c.req.param('name'))
  return c.json({ ok: true })
})

// #101 Phase 5: destinations this user opens on many distinct days — the
// Home Page offers to pin them as a workspace. Empty when no routine holds.
app.get('/api/routine_suggestion', async (c) => {
  return c.json({ targets: await routineSuggestion(who(c)) })
})

// #101 Phase 4: the homepage activity feed. 'mine' is the caller's own raw
// trail (reads included — visible to them alone). 'team' shows CHANGES only
// — Version rows and logins, never what a colleague merely viewed — and is
// gated to System Manager.
app.get('/api/activity_feed', async (c) => {
  const user = who(c)
  const scope = c.req.query('scope') === 'team' ? 'team' : 'mine'
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 30, 1), 100)

  if (scope === 'mine') {
    const rows = await sql`
      select kind, ref_key, label, sub_label, path, occurred_at
      from user_event where created_by = ${user}
      order by occurred_at desc limit ${limit}`
    return c.json({
      items: rows.map((r) => ({
        who: user,
        kind: r.kind as string,
        label: (r.label as string | null) ?? (r.ref_key as string),
        sub: (r.sub_label as string | null) ?? undefined,
        path: (r.path as string | null) ?? '',
        at: new Date(r.occurred_at as string).toISOString(),
      })),
    })
  }

  const roles = await getRoles(user)
  if (!roles.includes('System Manager'))
    throw new AppError('PermissionError', 'The team feed requires the System Manager role')
  const versions = await sql`
    select created_by, ref_table, ref_name, created_at
    from version order by created_at desc limit ${limit}`
  const logins = await sql`
    select "user", full_name, created_at
    from activity_log where operation = 'login'
    order by created_at desc limit ${limit}`
  const items = [
    ...versions.map((v) => ({
      who: v.created_by as string,
      kind: 'change',
      label: (v.ref_name as string | null) ?? '',
      sub: (v.ref_table as string | null) ?? undefined,
      path: v.ref_table && v.ref_name ? `/admin/${v.ref_table}/${v.ref_name}` : '',
      at: new Date(v.created_at as string).toISOString(),
    })),
    ...logins.map((l) => ({
      who: l.user as string,
      kind: 'login',
      label: (l.full_name as string | null) || (l.user as string),
      sub: 'signed in',
      path: '',
      at: new Date(l.created_at as string).toISOString(),
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
  return c.json({ items })
})

// UI-024: persist the caller's theme preference (light/dark), per user.
app.post('/api/set_theme', async (c) => {
  const { theme } = (await c.req.json().catch(() => ({}))) as { theme?: string }
  if (theme !== 'light' && theme !== 'dark')
    throw new AppError('ValidationError', 'theme must be "light" or "dark"')
  await sql`update "user" set theme = ${theme} where row_id = ${who(c)}`
  return c.json({ ok: true, theme })
})

// UI-025: persist the caller's palette preference, per user.
const PALETTES = ['classic', 'ivory', 'graphite', 'indigo'] as const
app.post('/api/set_palette', async (c) => {
  const { palette } = (await c.req.json().catch(() => ({}))) as { palette?: string }
  if (!PALETTES.includes(palette as (typeof PALETTES)[number]))
    throw new AppError('ValidationError', `palette must be one of ${PALETTES.join(', ')}`)
  await sql`update "user" set palette = ${palette!} where row_id = ${who(c)}`
  return c.json({ ok: true, palette })
})

// I18N-001/002: per-user language + the translation catalog for a language.
app.post('/api/set_language', async (c) => {
  const { language } = (await c.req.json().catch(() => ({}))) as { language?: string }
  if (!language || !/^[a-z]{2}(-[a-z]{2})?$/i.test(language))
    throw new AppError('ValidationError', 'Expected a language code like "en" or "fr"')
  await sql`update "user" set language = ${language} where row_id = ${who(c)}`
  return c.json({ ok: true, language })
})

app.get('/api/translations/:lang', async (c) => {
  return c.json(await getCatalog(c.req.param('lang')))
})

// SET-004: global display/formatting settings, readable by any signed-in
// user (they are not sensitive). The client formats dates and numbers with
// these. Editing them still goes through the guarded System Settings single.
app.get('/api/settings', async (c) => {
  const s = await getSystemSettings()
  return c.json({
    app_name: s.app_name,
    date_format: s.date_format,
    currency: s.currency,
    currency_precision: s.currency_precision,
    float_precision: s.float_precision,
  })
})

// Set a user's password. A user may set their own; a System Manager may set
// anyone's. Passwords never travel through the generic document API.
app.post('/api/set_password', async (c) => {
  const { user, password } = (await c.req.json()) as { user?: string; password?: string }
  const target = user ?? who(c)
  if (!password) throw new AppError('ValidationError', 'Expected { password }')
  if (target !== who(c)) await assertSystemManager(who(c))
  // #131: a service account must never become password-login-able.
  const [targetRow] = await sql`select user_type from "user" where row_id = ${target}`
  if (targetRow?.user_type === 'service')
    throw new AppError('ValidationError', 'Service accounts have no password — issue an access token instead')
  await setUserPassword(target, password)
  return c.json({ ok: true })
})

// #131: access tokens (replaces the API-005 key pair). Users manage their
// own; System Managers can target any principal — and only they see or act
// on tokens beyond their own.
app.post('/api/access_tokens', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    label?: string
    owner?: string
    expires_at?: string
  }
  const owner = body.owner ?? who(c)
  if (owner !== who(c)) await assertSystemManager(who(c))
  if (typeof body.label !== 'string') throw new AppError('ValidationError', 'Expected { label }')
  let expiresAt: Date | null = null
  if (body.expires_at != null) {
    expiresAt = new Date(body.expires_at)
    if (Number.isNaN(expiresAt.getTime()))
      throw new AppError('ValidationError', 'expires_at must be an ISO date-time')
  }
  return c.json(await issueAccessToken(owner, body.label, expiresAt), 201)
})

app.get('/api/access_tokens', async (c) => {
  // System Managers see every token (the admin screen); everyone else their own.
  const all = (await getRoles(who(c))).includes('System Manager')
  return c.json({ tokens: await listAccessTokens(all ? undefined : who(c)) })
})

app.delete('/api/access_tokens/:id', async (c) => {
  const token = await getAccessToken(c.req.param('id'))
  if (token.owner !== who(c)) await assertSystemManager(who(c))
  await revokeAccessToken(token.id)
  return c.json({ ok: true })
})

// #131: service accounts — System Manager territory end to end.
app.post('/api/service_accounts', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; roles?: string[] }
  if (typeof body.name !== 'string') throw new AppError('ValidationError', 'Expected { name }')
  const roles = Array.isArray(body.roles) ? body.roles.filter((r) => typeof r === 'string') : []
  return c.json(await createServiceAccount(body.name, roles, who(c)), 201)
})

app.get('/api/service_accounts', async (c) => {
  await assertSystemManager(who(c))
  return c.json({ service_accounts: await listServiceAccounts() })
})

app.patch('/api/service_accounts/:name', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean }
  if (typeof body.enabled !== 'boolean') throw new AppError('ValidationError', 'Expected { enabled }')
  return c.json(await setServiceAccountEnabled(c.req.param('name'), body.enabled, who(c)))
})

// #74: `system` marks tables created by the migration chain. It is set only
// by migrations/seeds (through createTable directly) — a table created or
// updated over the API can never claim it.
function rejectSystemClaim(body: Record<string, unknown>) {
  if (body.system)
    throw new AppError('ValidationError', 'Invalid Table definition', {
      system: 'system is reserved for platform tables and cannot be set over the API',
    })
}

app.post('/api/doctype', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as Record<string, unknown>
  rejectSystemClaim(body)
  const meta = await createTable(body)
  // #80: a table you build never vanishes from navigation — its module's
  // home page is created on demand and the table's link appended.
  if (meta.kind !== 'sub_table') await ensureHomePageForTable(meta.name, meta.module)
  return c.json(meta, 201)
})

// NAM-001: change how a Table names new rows, without resending its schema.
app.put('/api/doctype/:name/id_pattern', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as { id_pattern?: unknown }
  if (typeof body.id_pattern !== 'string')
    throw new AppError('ValidationError', 'Expected { id_pattern }')
  return c.json(await setIdPattern(c.req.param('name'), body.id_pattern))
})

// DEL-R1/R2 (docs/specs/0003-table-deletion.md): delete a Table outright.
app.delete('/api/doctype/:name', async (c) => {
  await assertSystemManager(who(c))
  await deleteTable(c.req.param('name'), who(c))
  return c.json({ ok: true })
})

app.put('/api/doctype/:name', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as Record<string, unknown> & { drop_columns?: boolean }
  rejectSystemClaim(body)
  const { drop_columns, ...def } = body
  return c.json(await updateTable(c.req.param('name'), def, { drop_columns }))
})

app.post('/api/save_doc', async (c) => {
  const body = (await c.req.json()) as { doctype?: string; doc?: Record<string, unknown> }
  if (!body.doctype || typeof body.doc !== 'object' || body.doc === null)
    throw new AppError('ValidationError', 'Expected { doctype, doc }')
  const hadName = Boolean(body.doc.name)
  const saved = await saveDoc(body.doctype, body.doc, who(c))
  publishDocEvent(body.doctype, String(saved.row_id), hadName ? 'updated' : 'created')
  return c.json(saved, 201)
})

// PRN-003: server-side PDF of any document / print format.
app.get('/api/print/:doctype/:name', async (c) => {
  const format = c.req.query('format')
  const letterHead = c.req.query('letter_head')
  const doctype = c.req.param('doctype')
  const name = c.req.param('name')
  const html = await renderPrintHtml(doctype, name, who(c), format, letterHead)
  const pdf = await renderPdf(html)
  // PLAT-007: record the print/access.
  await logAccess(who(c), 'print', { table: doctype, name, method: 'pdf' })
  return c.body(new Uint8Array(pdf), 200, {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${name.replace(/[^\w.-]/g, '_')}.pdf"`,
  })
})

// PLAT-007: the client records a data export here (CSV/XLSX are built in the
// browser, so the log is client-notified). Read permission is required on the
// exported DocType — you can only log an export of data you could read.
app.post('/api/access_log', async (c) => {
  const { doctype, method } = (await c.req.json().catch(() => ({}))) as {
    doctype?: string
    method?: string
  }
  if (!doctype) throw new AppError('ValidationError', 'Expected { doctype }')
  await assertPermission(who(c), doctype, 'read')
  await logAccess(who(c), 'export', { table: doctype, method: method ?? 'csv' })
  return c.json({ ok: true })
})

// FILE-001: multipart upload — writes the storage object, then creates the
// File doc through the normal save lifecycle (permissions included).
app.post('/api/upload_file', async (c) => {
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File))
    throw new AppError('ValidationError', 'Expected multipart form data with a "file" part')
  const isPrivate = body.is_private === '1' || body.is_private === 'true'
  // FILE-001: attaching binds this file to something, so the caller must be
  // able to READ that thing — otherwise an upload is a write into someone
  // else's record, and (once attached) a signed-URL key to it. Checked BEFORE
  // the storage object exists, so a refused upload leaves nothing behind.
  // Read, not write: own_rows_only portals grant create without write, and
  // their users legitimately attach to their own rows.
  const refTable = typeof body.ref_doctype === 'string' && body.ref_doctype ? body.ref_doctype : null
  const refName = typeof body.ref_name === 'string' && body.ref_name ? body.ref_name : null
  // A ref_doctype with no ref_name attaches to the TABLE rather than to any
  // one row (DEL-R7 registers such files so deleting the Table sweeps them),
  // so the Table's own read grant is what there is to check.
  if (refTable && refName) await getDoc(refTable, refName, who(c))
  else if (refTable) await assertPermission(who(c), refTable, 'read')
  const content = Buffer.from(await file.arrayBuffer())
  const stored = await saveUpload(content, file.name, isPrivate)
  const mimeType = file.type || 'application/octet-stream'
  // FILE-004: for raster images, generate a small inline thumbnail the UI can
  // show without fetching the full-size original. Best-effort — a failure to
  // decode never blocks the upload.
  const thumbnail_url = isThumbnable(mimeType)
    ? await makeThumbnailDataUrl(content, mimeType).catch(() => null)
    : null
  const doc = await saveDoc(
    'File',
    {
      file_name: file.name,
      file_url: stored.file_url,
      mime_type: mimeType,
      file_size: file.size,
      is_private: isPrivate,
      ...(refTable ? { ref_table: refTable } : {}),
      ...(refName ? { ref_name: refName } : {}),
    },
    who(c),
  )
  // thumbnail_url is a read_only, system-managed field, so it's set with a
  // direct write (the save lifecycle ignores client values for read_only
  // fields) and reflected on the returned doc.
  if (thumbnail_url) {
    await sql`update file set thumbnail_url = ${thumbnail_url} where row_id = ${String(doc.row_id)}`
    doc.thumbnail_url = thumbnail_url
  }
  return c.json(doc, 201)
})

// FILE-003: mint a short-lived signed URL for a private file, but only after
// confirming the caller can read the document it is attached to. The returned
// URL then serves without a session (usable in an <img>/<a>). Public files
// need no signature and are returned as-is.
app.get('/api/signed_url', async (c) => {
  const fileUrl = c.req.query('file_url')
  if (!fileUrl) throw new AppError('ValidationError', 'Expected file_url')
  const [row] = await sql`
    select row_id, ref_table, ref_name from file where file_url = ${fileUrl}`
  if (!row) throw new AppError('NotFoundError', `File not found: ${fileUrl}`)
  const user = who(c)
  if (fileUrl.startsWith('/private/files/')) {
    if (row.ref_table && row.ref_name)
      await getDoc(row.ref_table as string, row.ref_name as string, user)
    else await getDoc('File', row.row_id as string, user)
    return c.json({ signed_url: signFileUrl(fileUrl) })
  }
  return c.json({ signed_url: fileUrl })
})

// UI-026: dashboard widgets. A number card is a permission-scoped count; a
// chart is permission-scoped grouped counts. Both reuse the list query's
// scoping so a dashboard can never show data the user couldn't list.
app.post('/api/dashboard/count', async (c) => {
  const { doctype, filters } = (await c.req.json().catch(() => ({}))) as {
    doctype?: string
    filters?: [string, string, unknown][]
  }
  if (!doctype) throw new AppError('ValidationError', 'Expected { doctype }')
  return c.json({ count: await countDocs(doctype, filters ?? [], who(c)) })
})

app.post('/api/dashboard/chart', async (c) => {
  const { doctype, group_by, filters } = (await c.req.json().catch(() => ({}))) as {
    doctype?: string
    group_by?: string
    filters?: [string, string, unknown][]
  }
  if (!doctype || !group_by) throw new AppError('ValidationError', 'Expected { doctype, group_by }')
  return c.json({ data: await groupCount(doctype, group_by, filters ?? [], who(c)) })
})

// RPT-006: a chart series derived from a saved report's rows (permission-scoped
// through the report). Used for both the report-page preview and the pinned
// dashboard widget.
app.post('/api/report_chart', async (c) => {
  const spec = (await c.req.json().catch(() => ({}))) as {
    report?: string
    label_field?: string
    value_field?: string
    group_by?: string
  }
  return c.json(await runReportChart({ report: spec.report ?? '', label_field: spec.label_field, value_field: spec.value_field, group_by: spec.group_by }, who(c)))
})

// RPT-006: pin a report chart onto a Dashboard (write permission on Dashboard
// enforced by the save).
app.post('/api/pin_chart_to_dashboard', async (c) => {
  const { dashboard, chart } = (await c.req.json().catch(() => ({}))) as {
    dashboard?: string
    chart?: { label: string; report: string; label_field?: string; value_field?: string; group_by?: string }
  }
  if (!dashboard || !chart) throw new AppError('ValidationError', 'Expected { dashboard, chart }')
  return c.json(await pinChartToDashboard(dashboard, chart, who(c)))
})

// SET-003: role & permission manager. Reads/writes the Permission matrix for
// a Table at tier 'basic'. Editing permissions is System-Manager-only.
// Writes go through the normal save lifecycle, and permissionScope reads
// Permission live, so a change takes effect on the very next request.
const PERM_FLAGS = ['can_read', 'can_write', 'can_create', 'can_delete', 'can_submit', 'can_cancel', 'can_amend'] as const

app.get('/api/permissions/:doctype', async (c) => {
  await assertSystemManager(who(c))
  const doctype = c.req.param('doctype')
  const roles = (await sql`select row_id from role order by row_id`).map((r) => r.row_id as string)
  const perms = await sql`
    select row_id, role, ${sql(PERM_FLAGS as unknown as string[])}
    from permission where ref_table = ${doctype} and tier = 'basic' order by role`
  return c.json({ doctype, roles, perms })
})

app.post('/api/permissions/:doctype', async (c) => {
  const user = who(c)
  await assertSystemManager(user)
  const doctype = c.req.param('doctype')
  const body = (await c.req.json().catch(() => ({}))) as { role?: string } & Record<string, unknown>
  if (!body.role) throw new AppError('ValidationError', 'Expected { role }')
  const flags = Object.fromEntries(PERM_FLAGS.map((f) => [f, Boolean(body[f])]))
  const [existing] = await sql`
    select row_id, updated_at from permission
    where ref_table = ${doctype} and role = ${body.role} and tier = 'basic'`
  if (existing)
    await saveDoc(
      'Permission',
      { name: existing.row_id as string, updated_at: existing.updated_at, ...flags },
      user,
    )
  else await saveDoc('Permission', { ref_table: doctype, role: body.role, tier: 'basic', ...flags }, user)
  return c.json({ ok: true })
})

// RPT-004: Query Report metadata (filter names parsed from its SQL) — the raw
// query is intentionally NOT returned here, so running a report never exposes
// its SQL to the client. Read permission on the Report is enforced by getDoc.
app.get('/api/query_report/:name', async (c) => {
  const report = await getDoc('Report', c.req.param('name'), who(c))
  if (report.report_type !== 'Query Report')
    throw new AppError('ValidationError', `${report.row_id} is not a Query Report`)
  return c.json({
    row_id: report.row_id,
    ref_doctype: report.ref_table ?? null,
    filters: parseFilters(typeof report.query === 'string' ? report.query : ''),
  })
})

// RPT-004: run a query report with bound filter params (read-only execution).
app.post('/api/run_query_report', async (c) => {
  const { report, filters } = (await c.req.json().catch(() => ({}))) as {
    report?: string
    filters?: Record<string, unknown>
  }
  if (!report) throw new AppError('ValidationError', 'Expected { report }')
  return c.json(await runQueryReport(report, filters ?? {}, who(c)))
})

// PLAT-008: multi-tenancy. Provisioning is System-Manager-only; the data
// endpoints resolve the target site from the request Host header, and every
// query runs on that site's isolated schema — data never crosses sites.
app.post('/api/tenancy/sites', async (c) => {
  await assertSystemManager(who(c))
  const { site, host } = (await c.req.json().catch(() => ({}))) as { site?: string; host?: string }
  if (!site) throw new AppError('ValidationError', 'Expected { site }')
  return c.json(await createSite(site, host), 201)
})
app.get('/api/tenancy/sites', async (c) => {
  await assertSystemManager(who(c))
  return c.json({ sites: await listSites() })
})
app.post('/api/tenancy/doctype', async (c) => {
  await assertSystemManager(who(c))
  const site = await resolveSite(c.req.header('host'))
  const { name, columns } = (await c.req.json().catch(() => ({}))) as { name?: string; columns?: { column_name: string; column_type: string }[] }
  if (!name) throw new AppError('ValidationError', 'Expected { name }')
  return c.json(await siteCreateDoctype(site, name, columns ?? []), 201)
})
app.get('/api/tenancy/doctypes', async (c) => {
  await assertSystemManager(who(c))
  const site = await resolveSite(c.req.header('host'))
  return c.json({ site, doctypes: await siteListDoctypes(site) })
})
app.post('/api/tenancy/user', async (c) => {
  await assertSystemManager(who(c))
  const site = await resolveSite(c.req.header('host'))
  const { email, full_name } = (await c.req.json().catch(() => ({}))) as { email?: string; full_name?: string }
  if (!email) throw new AppError('ValidationError', 'Expected { email }')
  return c.json(await siteCreateUser(site, email, full_name), 201)
})
app.get('/api/tenancy/users', async (c) => {
  await assertSystemManager(who(c))
  const site = await resolveSite(c.req.header('host'))
  return c.json({ site, users: await siteListUsers(site) })
})

// PLAT-001: app management (System Manager only). Apps are code-defined; these
// install/uninstall their DocTypes + doc_events and report installed state.
app.get('/api/apps', async (c) => {
  await assertSystemManager(who(c))
  return c.json({ available: getAvailableApps(), installed: await listInstalledApps() })
})
// Accepts { name } for a code-registered app, or { manifest } — a declarative
// manifest of DocTypes, roles and permissions installed as pure data (#55).
// System Manager only, and deliberately so: { manifest } lets the caller
// define schema, so this endpoint is a create-arbitrary-tables surface.
app.post('/api/install_app', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; manifest?: unknown }
  if (body.manifest !== undefined) return c.json(await installAppFromManifest(body.manifest), 201)
  if (!body.name) throw new AppError('ValidationError', 'Expected { name } or { manifest }')
  return c.json(await installApp(body.name), 201)
})
app.post('/api/uninstall_app', async (c) => {
  await assertSystemManager(who(c))
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string }
  if (!name) throw new AppError('ValidationError', 'Expected { name }')
  return c.json(await uninstallApp(name))
})

// EML-007: trigger an Auto Email Report immediately (the "run now" a scheduler
// would otherwise do on cadence). System Manager only — it emails on behalf of
// the configured report.
app.post('/api/run_auto_email_report', async (c) => {
  await assertSystemManager(who(c))
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string }
  if (!name) throw new AppError('ValidationError', 'Expected { name }')
  return c.json(await deliverAutoEmailReport(name, who(c)))
})

// RPT-005: script report metadata (declared filter controls) + run.
app.get('/api/script_report/:name', async (c) => {
  return c.json(await scriptReportMeta(c.req.param('name'), who(c)))
})

app.post('/api/run_script_report', async (c) => {
  const { report, filters } = (await c.req.json().catch(() => ({}))) as {
    report?: string
    filters?: Record<string, unknown>
  }
  if (!report) throw new AppError('ValidationError', 'Expected { report }')
  return c.json(await runScriptReport(report, filters ?? {}, who(c)))
})

// CUST-005: export/import a DocType's customizations (Custom Fields +
// Property Setters) as JSON. System-Manager-only.
app.get('/api/export_customizations/:doctype', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await exportCustomizations(c.req.param('doctype')))
})

app.post('/api/import_customizations', async (c) => {
  await assertSystemManager(who(c))
  const bundle = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  return c.json(await importCustomizations(bundle, who(c)))
})

// CUST-004: invoke an API-type Server Script by its method name.
app.post('/api/server_script/:method', async (c) => {
  const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  return c.json({ result: await runApiScript(c.req.param('method'), args) })
})

// WF-002: the transitions available to the current user for a document,
// plus its current state — drives the form's action buttons.
app.get('/api/workflow/:doctype/:name', async (c) => {
  const doctype = c.req.param('doctype')
  const wf = await getActiveWorkflow(doctype)
  if (!wf) return c.json({ workflow: null })
  const doc = await getDoc(doctype, c.req.param('name'), who(c))
  const state = currentState(wf, doc)
  const roles = await getRoles(who(c))
  return c.json({
    workflow: wf.row_id,
    state,
    actions: availableActions(wf, state, roles, doc).map((t) => ({ action: t.action, next_state: t.next_state })),
  })
})

// UI-013: per-user list/view settings. Stored per (user, doctype) and only
// ever readable/writable by that user.
app.get('/api/user_settings/:doctype', async (c) => {
  const [row] = await sql`
    select settings from user_settings
    where "user" = ${who(c)} and table_name = ${c.req.param('doctype')}`
  return c.json({ settings: row?.settings ?? null })
})

app.put('/api/user_settings/:doctype', async (c) => {
  const settings = (await c.req.json()) as Record<string, unknown>
  await sql`
    insert into user_settings ("user", table_name, settings, updated_at)
    values (${who(c)}, ${c.req.param('doctype')}, ${settings as unknown as string}, now())
    on conflict ("user", table_name) do update set settings = excluded.settings, updated_at = now()`
  return c.json({ ok: true })
})

// EML-006 / UI-017: assign a document to a user. Creates a ToDo in their
// task list and notifies them (Notification Log + realtime user event).
app.post('/api/assign', async (c) => {
  const { doctype, row_id: name, assign_to, description } = (await c.req.json()) as {
    doctype?: string
    row_id?: string
    assign_to?: string
    description?: string
  }
  if (!doctype || !name || !assign_to)
    throw new AppError('ValidationError', 'Expected { doctype, row_id, assign_to }')
  // The assigner must be able to read the document.
  await getDoc(doctype, name, who(c))
  const [target] = await sql`select row_id from "user" where row_id = ${assign_to}`
  if (!target) throw new AppError('NotFoundError', `User ${assign_to} not found`)

  const todo = await createAssignment(doctype, name, assign_to, who(c), description)
  return c.json({ todo }, 201)
})

// UI-017: free-form document tags. Readable/writable by anyone who can read
// the document.
app.get('/api/tags/:doctype/:name', async (c) => {
  await getDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  const rows = await sql`
    select tag from tag_link
    where ref_table = ${c.req.param('doctype')} and ref_name = ${c.req.param('name')}
    order by tag`
  return c.json({ tags: rows.map((r) => r.tag as string) })
})

app.post('/api/tags', async (c) => {
  const { doctype, row_id: name, tag } = (await c.req.json()) as {
    doctype?: string
    row_id?: string
    tag?: string
  }
  if (!doctype || !name || !tag?.trim())
    throw new AppError('ValidationError', 'Expected { doctype, row_id, tag }')
  await getDoc(doctype, name, who(c))
  await sql`
    insert into tag_link ${sql({ ref_table: doctype, ref_name: name, tag: tag.trim(), created_by: who(c) })}
    on conflict do nothing`
  return c.json({ ok: true }, 201)
})

app.delete('/api/tags/:doctype/:name/:tag', async (c) => {
  await getDoc(c.req.param('doctype'), c.req.param('name'), who(c))
  await sql`
    delete from tag_link where ref_table = ${c.req.param('doctype')}
      and ref_name = ${c.req.param('name')} and tag = ${c.req.param('tag')}`
  return c.json({ ok: true })
})

// EML-001: send a test email from the configured account (delivered to the
// dev sink). EML-002: queue an email for background delivery.
app.post('/api/send_test_email', async (c) => {
  await assertSystemManager(who(c))
  const { to } = (await c.req.json()) as { to?: string }
  if (!to) throw new AppError('ValidationError', 'Expected { to }')
  await sendTestEmail(to)
  return c.json({ ok: true })
})

app.post('/api/queue_email', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as {
    to?: string
    subject?: string
    body?: string
    reference_doctype?: string
    reference_name?: string
    render?: boolean
    attach_pdf?: boolean
    print_format?: string
  }
  if (!body.to) throw new AppError('ValidationError', 'Expected { to }')
  const name = await queueEmail({
    to: body.to,
    subject: body.subject ?? '',
    body: body.body ?? '',
    ref_table: body.reference_doctype,
    reference_name: body.reference_name,
    render: body.render,
    attach_pdf: body.attach_pdf,
    print_format: body.print_format,
  })
  return c.json({ name }, 201)
})

// JOB-001: enqueue a background job. System Manager only (jobs run server
// code). Returns the job id so callers can poll its Background Job doc.
app.post('/api/enqueue_job', async (c) => {
  await assertSystemManager(who(c))
  const { method, payload, max_attempts, repeat_every } = (await c.req.json()) as {
    method?: string
    payload?: Record<string, unknown>
    max_attempts?: number
    repeat_every?: number
  }
  if (!method) throw new AppError('ValidationError', 'Expected { method }')
  const name = await enqueue(method, payload ?? {}, {
    maxAttempts: max_attempts,
    repeatEvery: repeat_every,
  })
  return c.json({ name }, 201)
})

// JOB-004: retry a failed job from the Admin.
app.post('/api/retry_job', async (c) => {
  await assertSystemManager(who(c))
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string }
  if (!name) throw new AppError('ValidationError', 'Expected { name }')
  const retried = await retryJob(name)
  if (!retried) throw new AppError('ValidationError', `Job ${name} is not in a failed state`)
  return c.json({ ok: true })
})

// CUST-001: re-apply all custom fields (used after a core fixture re-seed).
app.post('/api/reapply_custom_fields', async (c) => {
  await assertSystemManager(who(c))
  const count = await reapplyCustomFields()
  return c.json({ ok: true, count })
})

function listArgsFromQuery(q: Record<string, string>) {
  const parse = (key: string) => {
    if (q[key] == null) return undefined
    try {
      return JSON.parse(q[key])
    } catch {
      throw new AppError('ValidationError', `${key} must be valid JSON`)
    }
  }
  // API-006: malformed pagination is a client error, not a 500 — NaN must
  // never reach the SQL layer.
  const num = (key: string) => {
    if (q[key] == null || q[key] === '') return undefined
    const n = Number(q[key])
    if (!Number.isFinite(n))
      throw new AppError('BadRequestError', `${key} must be a number`)
    return n
  }
  return {
    filters: parse('filters'),
    fields: parse('fields'),
    order_by: q.order_by,
    limit_start: num('limit_start'),
    limit_page_length: num('limit_page_length'),
  }
}

// UI-014: awesomebar global search across readable DocTypes.
app.get('/api/search', async (c) => {
  const q = c.req.query('q') ?? ''
  return c.json({ results: await globalSearch(q, who(c)) })
})

// #80: the caller's visible Home Pages with their permission-filtered card
// links — the ONLY source the Admin sidebar consumes. Role visibility is
// presentation scoping (computed server-side), not a security boundary;
// table access is still enforced by Permission rows on every read.
app.get('/api/home_pages', async (c) => {
  return c.json({ pages: await getVisibleHomePages(who(c)) })
})

// NAV-001 (#102 review): the tables the caller may actually read, for
// navigation pickers like Explore's root select. Reading the metadata
// `Table` table requires its own permission most users don't have — this
// filters by each candidate table's read permission instead, the same
// posture as the Home Pages endpoint.
app.get('/api/navigable_tables', async (c) => {
  const user = who(c)
  const rows = await sql<{ name: string }[]>`
    select name from table_def where kind = 'table' order by name`
  const tables: string[] = []
  for (const r of rows)
    if ((await permissionScope(user, r.name, 'read')) !== 'none') tables.push(r.name)
  return c.json({ tables })
})

// RT-003: the caller's unread notification count.
app.get('/api/unread_count', async (c) => {
  const [row] = await sql`
    select count(*)::int as c from notification_log
    where for_user = ${who(c)} and read = false`
  return c.json({ count: (row?.c as number) ?? 0 })
})

// API surface design (#61): one Table-scoped surface replaces the three
// routes that used to reach the same getList/getDoc/deleteDoc engine calls
// by three different URLs (/api/resource, /api/doc, /api/list — the exact
// "drift" the design set out to ban). :table accepts a slug spelling (#56):
// report-feedback and report_feedback reach "Report Feedback"; the exact
// (possibly %20-encoded) name always wins.
//
// Generated case: GET/POST /api/table/:table, GET/PATCH/DELETE
// /api/table/:table/:name — PATCH, not PUT, because Tables gain columns at
// runtime via Custom Field and a PUT from a client that read a row before a
// column existed would silently null it on write.
//
// The :table and :name segments may carry a colon suffix (:count, :meta,
// :actions, or a registered collection/row action) — see actions.ts for why
// colon, not a slash sub-path.

app.get('/api/table/:table', async (c) => {
  const raw = c.req.param('table')
  const { base, suffix } = splitSuffix(raw, isKnownCollectionSuffix)
  const table = await resolveTableName(base)
  const user = c.get('user')

  if (suffix === 'actions') return c.json(listActions())
  if (suffix === 'meta') {
    const meta = await getMeta(table)
    await assertPermission(user.row_id, meta.name, 'read')
    return c.json(meta)
  }
  if (suffix === 'count') {
    const filters = c.req.query('filters')
    let parsed: unknown[] = []
    if (filters) {
      try {
        parsed = JSON.parse(filters)
      } catch {
        throw new AppError('BadRequestError', 'filters must be valid JSON')
      }
    }
    return c.json({ count: await countDocs(table, parsed as never, user.row_id) })
  }
  if (suffix) {
    const action = getCollectionAction(suffix)
    if (!action || action.effect !== 'read')
      throw new AppError('NotFoundError', `No readable collection action ":${suffix}"`)
    return c.json(await action.handler({ table, args: c.req.query(), user }))
  }
  return c.json(await getList(table, listArgsFromQuery(c.req.query()), user.row_id))
})

// POST with no suffix is create-only: a client-sent name is honored for
// prompt-named Tables but an existing name conflicts instead of silently
// updating. A suffix must name a registered write-effect collection action.
app.post('/api/table/:table', async (c) => {
  const raw = c.req.param('table')
  const { base, suffix } = splitSuffix(raw, isKnownCollectionSuffix)
  const table = await resolveTableName(base)
  const user = c.get('user')

  if (suffix) {
    const action = getCollectionAction(suffix)
    if (!action || action.effect !== 'write')
      throw new AppError('NotFoundError', `No writable collection action ":${suffix}"`)
    const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    return c.json(await action.handler({ table, args, user }), 201)
  }
  const doc = (await c.req.json()) as Record<string, unknown>
  const saved = await saveDoc(table, doc, user.row_id, 'insert')
  publishDocEvent(table, String(saved.row_id), 'created')
  return c.json(saved, 201)
})

app.get('/api/table/:table/:name', async (c) => {
  const table = await resolveTableName(c.req.param('table'))
  const raw = c.req.param('name')
  const { base: name, suffix } = splitSuffix(raw, isKnownRowSuffix)
  const user = c.get('user')

  if (suffix) {
    const action = getRowAction(suffix)
    if (!action || action.effect !== 'read')
      throw new AppError('NotFoundError', `No readable row action ":${suffix}"`)
    return c.json(await action.handler({ table, name, args: c.req.query(), user }))
  }
  return c.json(await getDoc(table, name, user.row_id))
})

// A suffix here must name a registered write-effect row action — plain
// create-with-explicit-name lives at POST /api/table/:table (name in body).
app.post('/api/table/:table/:name', async (c) => {
  const table = await resolveTableName(c.req.param('table'))
  const raw = c.req.param('name')
  const { base: name, suffix } = splitSuffix(raw, isKnownRowSuffix)
  const user = c.get('user')
  if (!suffix) throw new AppError('NotFoundError', 'Expected a row action, e.g. :submit')

  const action = getRowAction(suffix)
  if (!action || action.effect !== 'write')
    throw new AppError('NotFoundError', `No writable row action ":${suffix}"`)
  const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const result = await action.handler({ table, name, args, user })
  publishDocEvent(table, name, 'updated')
  return c.json(result)
})

app.patch('/api/table/:table/:name', async (c) => {
  const table = await resolveTableName(c.req.param('table'))
  const name = c.req.param('name')
  const user = c.get('user')
  const doc = (await c.req.json()) as Record<string, unknown>
  doc.row_id = name
  const saved = await saveDoc(table, doc, user.row_id)
  publishDocEvent(table, String(saved.row_id), 'updated')
  return c.json(saved)
})

app.delete('/api/table/:table/:name', async (c) => {
  const table = await resolveTableName(c.req.param('table'))
  const name = c.req.param('name')
  const user = c.get('user')
  // Optional optimistic echo (?updated_at=...): on source-bound rows the
  // delete conflicts when the store changed after the client loaded —
  // essential for csv-folder rows, whose identity is positional.
  await deleteDoc(table, name, user.row_id, {
    expectUpdatedAt: c.req.query('updated_at') ?? null,
  })
  publishDocEvent(table, name, 'deleted')
  return c.json({ ok: true })
})

// Single-origin production serving (#57): when the SPA has been built into
// the image (apps/web/dist exists — the Dockerfile's web-build stage), this
// process serves it too, so one container answers both / and /api on one
// origin. Dev is untouched: a plain checkout has no dist directory, and the
// vite dev server on :5173 keeps proxying /api here.
// (import.meta.url is handed to fileURLToPath as a STRING, and only when it
// carries the file: scheme — the web test environment loads this module with
// a realm-foreign URL that fileURLToPath rejects as an object, and such
// environments never serve the SPA anyway.)
const webDist = import.meta.url.startsWith('file:')
  ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  : ''
if (webDist && existsSync(webDist)) {
  // serveStatic resolves `root` against process.cwd() (apps/server under
  // `pnpm --filter server start`), so the path must be expressed relative
  // to that, not absolute.
  const webRoot = path.relative(process.cwd(), webDist)
  app.use('*', serveStatic({ root: webRoot }))
  // SPA fallback: any GET the API and asset handlers didn't claim gets
  // index.html so client-side routes deep-link. Server-owned prefixes pass
  // through and keep their JSON 404 envelope (API-006).
  const serverOwned = /^\/(api|files|private\/files|web|ws)(\/|$)/
  app.get('*', (c, next) => {
    if (serverOwned.test(c.req.path)) return next()
    return serveStatic({ root: webRoot, path: 'index.html' })(c, next)
  })
}

if (process.env.NODE_ENV !== 'test') {
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`server listening on :${info.port}`)
  })
  // RT-001/002/003: attach the realtime WebSocket server to the HTTP server.
  attachRealtime(server as unknown as import('node:http').Server)
  // JOB-001: run the background worker in-process (tests drive the queue
  // directly via runOneJob/drainJobs, so the worker stays off under test).
  startWorker()
  // EML-007: ensure the daily Auto Email Report scheduler is queued exactly
  // once (it re-enqueues itself thereafter). Guarded so restarts don't stack
  // duplicate recurring jobs.
  {
    const [pending] = await sql`
      select 1 from background_job
      where method = 'auto_email_reports' and job_status in ('queued', 'running') limit 1`
    if (!pending) await enqueue('auto_email_reports', {}, { repeatEvery: 24 * 60 * 60 })
  }
  // SLA: the recurring escalation sweep (see src/jobs/sla-escalation.ts).
  {
    const [pending] = await sql`
      select 1 from background_job
      where method = 'check_sla' and job_status in ('queued', 'running') limit 1`
    if (!pending) await enqueue('check_sla', {}, { repeatEvery: 60 })
  }
}
