import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { config } from './config'
import { sql, withTransaction } from './db'
import { assertRowsWritable } from './system-written'
import { assertNotView, storedTable } from './views'
import { AppError, errorResponse } from './errors'
import { runInSession } from './session-context'
import { ROW_KEY, getMeta, resolveTableName } from './meta'
import { tableStorageIdentity } from './table-engine'
import { deleteDoc, getDoc, revokeGrant, rowCapabilities, saveDoc } from './document'
import { rowForCaller } from './row-readers'
import { countDocs, getList, groupCount } from './query'
import { hasMandatoryRowAccess, mandatoryReferencesWhere } from './mandatory-access'
import { loadControllers } from './controllers'
import { assertCanChangeAccess, assertFreshForLinking, resolveToken, setUserPassword, issueSession, revokeSession, sessionToRevoke, type SessionOptions, type SessionUser } from './auth'
import { GOOGLE_OFF, LINK_DOMAIN_NOT_ALLOWED, completeSignIn, linkVerifiedToSelf, passwordSignIn, signInRefusal } from './sign-in'
import { announcePreviewLogin, previewKeyMatches, previewLogin } from './preview'
import { resolvePreviewPerson } from './preview-person'
import { personByEmail } from './people-directory'
import { countWaitingForAccess, noAccessYetPage, requestAccess } from './waiting-for-access'
import { announceDelegatedTestMode, checkWithProvider, delegatedLoginConfig, delegatedMethods, delegatedTestMode, linkedUser, noLinkCarries, recordToName } from './delegated-login'
import { hold, rosterFirstSignIn } from './roster-first-sign-in'
import { claimedPurpose, googleAuthorizeUrl, mockConsentHtml, mockApproveRedirect, exchangeCode, googleAvailable, newLoginChallenge, codeChallengeFor, verifyState, oauthClientId, assertSignInAvailable, assertMockProviderAllowed, mintHandoffCode, redeemHandoffCode, bindHandoffTicket, newHandoffNonce, nonceHash, ticketForTarget } from './oauth'
import { ADMIN, addressRedirect, interimApp, linkAddress, matchAddress, requestHost } from './instance-addresses'
import { USERNAME_RE, methodOfKind } from './identities'
import { assertPermission, assertSystemManager, getRoles, includesColumn, permissionScope, permittedColumns, tableAccessFor } from './permissions'
import { getVisibleHomePages } from './home-pages'
import { EMBED_ORIGIN, VIEWER_ROLE, salesTargetRoutes } from './sales-target'
import { landingAfterSignIn, openAdminFor } from './landing'
import { saveUpload, signFileUrl } from './storage'
import { isThumbnable, makeThumbnailDataUrl } from './thumbnails'
import { globalSearch } from './search'
import { commandDestinations } from './command-destinations'
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
import './actions/collection-import-revert'
import './actions/source-actions'
import './actions/motherduck-actions'
import './actions/copy-refresh-actions'
import './actions/master-sync-actions'
import './actions/row-connections'
import './actions/collection-aggregate'
import './actions/collection-summary'
import './actions/collection-purge'
import './actions/collection-bulk'
import { renderPdf, renderPrintHtml } from './print'
import { availableActions, currentState, getActiveWorkflow } from './workflow'
import { reapplyCustomFields } from './custom-fields'
import { enqueue, loadJobs, retryJob, startWorker, stopWorker, syncScheduledJobs } from './jobs'
import { attachRealtime, closeSessionSockets, publishDocEvent, publishUserEvent } from './realtime'
import { createAssignment } from './assign'
import { queueEmail, sendTestEmail } from './email'
import { getSystemSettings } from './settings'
import { MIN_PASSWORD_LENGTH, requestPasswordReset, resetPassword } from './password-reset'
import { renderWebPage } from './website'
import { getWebFormConfig, submitWebForm } from './webform'
import { logAccess } from './audit'
import { recordAppAccessRefusal } from './app-access'
import { eventSummary, listKeyHasFilter, whoLabels, recordEvents, routineSuggestion, validateEventBatch } from './events'
import { rowTitles, validateRowTitleRequest } from './row-titles'
import { createSavedView, deleteSavedView, listSavedViews, setSavedViewShared } from './saved-views'
import { runApiScript } from './server-scripts'
import { exportCustomizations, importCustomizations } from './customizations'
import { getCatalog } from './i18n'
import { rateLimit } from './rate-limit'
import { mcpHandler, mcpMethodNotAllowed } from './mcp'
import { clientAddress, publicLimit, passwordAttempt, forgive } from './pre-auth-rate-limit'
import { deliverAutoEmailReport } from './auto-email-report'
import { runReportChart, pinChartToDashboard } from './report-chart'
import { registerApp, loadInstalledApps, isInstalled, installedAppNames } from './apps'
import { packageTitle, appCatalog, appAsset } from './runtime-packages'
import { discoverAppLibrary } from './app-library'
import { documentActivity } from './document-activity'
import { ACCOUNT_SIGN_IN_METHODS_PATH, APP_ROOT_PATTERN, LEGACY_HUMAN_ROOT_PATTERN, adminPathTitle, appHref, ownFramePolicyPage, rowHref } from 'shared'
import { appOperation, withAppClientVersion } from './app-lifecycle'
import { composeRuntimeShell } from './runtime-shell'
import { privacyNoticePage } from './privacy-notice'
import { assertServerStart, readVariable } from './env'
import helpdesk from './sample-apps/helpdesk'
import checklists from './sample-apps/checklists'
import { loadScriptReports, runScriptReport, scriptReportMeta } from './script-report'
import { readGlossary, takeAppWording } from './glossary'
import { who, type Env } from './route-context'
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, authCredential, clearLoginChallengeCookies, externalOrigin, oauthRedirectUri, setLoginChallengeCookies, setSidCookie } from './session-cookies'
import { mimeEssence, serveFile } from './file-serving'
import { peopleRoutes } from './people-routes'
import { tableDefRoutes } from './table-def-routes'
import { appRoutes } from './app-routes'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

await loadControllers()
await loadJobs()
await loadScriptReports()
// PLAT-001: register the apps this build ships, then re-wire the doc_events of
// any that are already installed (their Tables persist in the DB).
// Registered, NOT installed: a fresh deployment has zero helpdesk tables
// until POST /api/install_app { name: 'helpdesk' } (PLAT-006, #78).
registerApp(helpdesk)
// Same discipline: checklist tables exist only after
// POST /api/install_app { name: 'checklists' }.
registerApp(checklists)
await discoverAppLibrary(JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[])
await loadInstalledApps()
// Custom fields may target app-owned Tables, so activation precedes replay.
await reapplyCustomFields()

export const app = new Hono<Env>()

app.onError((err, c) => errorResponse(c, err))

// API-006: even unknown routes answer with the error envelope.
app.notFound((c) =>
  c.json({ error: { type: 'NotFoundError', message: `Route not found: ${c.req.method} ${c.req.path}` } }, 404),
)

// API-008: CORS restricted to the Admin origin(s) + standard security
// headers. Runs before auth so preflight OPTIONS (which carries no
// Authorization header) is answered here.
// #642 (E4): the frame policy is decided per response. A page frames its own
// origin, plus the outside sites the app whose page it is declared; there is
// no instance-wide outside origin.
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('Content-Security-Policy', ["frame-src 'self'", ...(c.get('frameOrigins') ?? [])].join(' '))
})
app.use('*', secureHeaders())
// #3755: until the report moves into its app (B9), its page frames
// MotherDuck's embed sandbox: that page alone, not the instance, with or
// without a trailing slash (Codex round 2 on #643).
app.use('*', async (c, next) => {
  if (ownFramePolicyPage(c.req.path)) c.set('frameOrigins', [EMBED_ORIGIN])
  await next()
})
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
  const [row] = await sql`select
    1 as ok,
    inet_server_addr() is null
      or inet_server_addr() <<= inet '127.0.0.0/8'
      or inet_server_addr() = inet '::1' as server_local`
  return c.json({
    message: 'pong',
    db: row.ok === 1,
    environment: config.environment,
    database_server_local: row.server_local === true,
  })
})

// SET-004: the instance's display name, public so the login page (pre-auth)
// can brand itself. app_name and the logo only — everything else in System
// Settings stays behind the session like /api/settings.
const PUBLIC_FILE = /^\/files\/[^/\\?#]+$/

app.get('/api/brand', async (c) => {
  const s = await getSystemSettings()
  // person-identities: the login page renders the enabled sign-in methods.
  const delegated = await delegatedMethods()
  const google = await googleAvailable()
  const password = await methodOfKind('password')
  const testMode = delegatedTestMode()
  const methods = [
    ...(password?.enabled ? [{ key: password.key, kind: password.kind, label: password.label || 'Password', test_mode: false }] : []),
    ...(google ? [{ key: google.key, kind: google.kind, label: google.label || 'Google', test_mode: false }] : []),
    ...delegated.map((d) => ({ key: d.key, kind: 'delegated_password', label: d.label, test_mode: testMode })),
  ]
  // #488: on an address that opens an app, the sign-in page and the document
  // title carry the app's name; elsewhere the instance's.
  const opened = matchAddress(config.instanceAddresses, requestHost(c.req.url))?.opens
  const appTitle = opened && opened !== ADMIN ? (interimApp(opened, await isInstalled(opened))?.title ?? packageTitle(opened)) : undefined
  return c.json({
    app_name: appTitle ?? s.app_name,
    // #380: named only when it is a public file this instance serves; a
    // private file, or any other address, would not load before sign-in.
    logo: s.logo && PUBLIC_FILE.test(s.logo) ? s.logo : null,
    // #489: what this address opens — `admin`, an app's name, or null for a
    // host the list does not name — so the shared top bar can name itself.
    opens: opened ?? null,
    sign_in_methods: methods,
    sign_up_open: Boolean(password?.enabled && password.new_person === 'create'),
    // The roster sync checks this before writing linked identities (design D11).
    identity_links: true,
  })
})

// #488: every sign-in answers with the session plus where to go next — a path
// on this address, or a hand-off URL to another (landing.ts).
async function withLanding(c: Context, session: { token: string; user: SessionUser }, opts?: { handOff?: boolean }) {
  return { ...session, ...(await landingAfterSignIn(session, requestHost(c.req.url), opts)) }
}

app.post('/api/login', publicLimit('LOGIN'), async (c) => {
  const { usr, pwd } = (await c.req.json()) as { usr?: string; pwd?: string }
  if (typeof usr !== 'string' || typeof pwd !== 'string' || !usr || !pwd) throw new AppError('ValidationError', 'Expected { usr, pwd }')
  const attempt = await passwordAttempt(c, usr)
  if (attempt.refusal) return attempt.refusal
  const issued = await passwordSignIn(usr, pwd, clientAddress(c))
  const session = { token: issued.token, user: issued.user }
  await forgive(attempt.ticket)
  setSidCookie(c, session.token, issued.maxAgeSeconds)
  // #488: where this person can do something (landing.ts).
  return c.json(await withLanding(c, session))
})

// Delegated password sign-in (OpenSpec change `delegated-password-login`):
// the configured provider (System Settings delegated_login_*) checks the
// ID and password; the session is then issued exactly like /api/login's.
// Off answers like any unknown route, so the route does not advertise itself.
app.post('/api/login/delegated', publicLimit('LOGIN'), async (c) => {
  // Nothing connected: answer as an unknown route, whatever the body, so the
  // route does not advertise itself.
  if (!(await delegatedMethods()).length) return c.notFound()
  const { usr, pwd, method } = (await c.req.json().catch(() => ({}))) as { usr?: string; pwd?: string; method?: string }
  // Every sign-in names its method; there is no single-service default.
  if (typeof method !== 'string' || !method || typeof usr !== 'string' || typeof pwd !== 'string' || !usr.trim() || (!pwd && !delegatedTestMode()))
    throw new AppError('ValidationError', 'Expected { usr, pwd, method }')
  const cfg = await delegatedLoginConfig(method)
  if (!cfg) return c.notFound()
  const attempt = await passwordAttempt(c, usr, 'delegated')
  if (attempt.refusal) return attempt.refusal
  // Before the provider call: never forward a password that cannot be bound.
  const id = usr.trim()
  let issued
  // #970: nobody linked to this ID, so only the method's roster rule can admit
  // it. Test mode skips the provider, so it never makes anyone.
  if (!delegatedTestMode() && (await noLinkCarries(cfg, id))) {
    issued = await rosterFirstSignIn(cfg, id, pwd, clientAddress(c))
  } else {
    const account = await linkedUser(cfg, id)
    // The shared pipeline (sign-in.ts) does the rest: an outage never falls
    // back to another way in, and a leaver is disabled everywhere.
    const status = await checkWithProvider(cfg, id, pwd, await recordToName(cfg, account.identity))
    if (status === 'another_record') await hold(cfg.key, String(account.identity), 'service_named_another_record')
    issued = await completeSignIn(cfg.method, { status: status === 'another_record' ? 'rejected' : status }, account, { testMode: delegatedTestMode(), ipAddress: clientAddress(c) })
  }
  const session = { token: issued.token, user: issued.user }
  await forgive(attempt.ticket)
  setSidCookie(c, session.token, issued.maxAgeSeconds)
  return c.json(await withLanding(c, session))
})

// person-identities D10: direct sign-up with a username and password, open
// only when the password method's rule for unknown people is `create`. No
// email in v1, so nobody can squat an address. Public, behind its own bucket.
app.post('/api/signup', publicLimit('SIGNUP'), async (c) => {
  const method = await methodOfKind('password')
  if (!method?.enabled || method.new_person !== 'create') return c.notFound()
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  // A username and a password, nothing else (spec; Codex P2 on #371).
  const extra = Object.keys(body).filter((k) => k !== 'username' && k !== 'password')
  if (extra.length)
    throw new AppError('ValidationError', 'Sign-up takes only a username and a password', Object.fromEntries(extra.map((k) => [k, 'not accepted'])))
  // Usernames are lower case; a capital typed by habit is folded, not refused.
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!USERNAME_RE.test(username) || ['administrator', 'guest'].includes(username))
    throw new AppError('ValidationError', 'Choose a username of 3–64 lowercase letters, digits, dots, dashes or underscores', { username: 'invalid' })
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new AppError('ValidationError', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, { password: 'too short' })
  const [taken] = await sql`select 1 from person where lower(row_id) = ${username} or lower(username) = ${username} or lower(email) = ${username}`
  if (taken) throw new AppError('ConflictError', 'That username is taken')
  // The person's id is opaque and permanent (minted `psn_…`); the username is
  // how they sign in.
  const personId = await withTransaction(async () => {
    const created = await saveDoc('Person', { username, full_name: username, enabled: true, roles: [] }, 'Administrator', 'insert')
    await setUserPassword(String(created.row_id), password)
    return String(created.row_id)
  })
  // The same tail as every other sign-in (sign-in.ts).
  const issued = await completeSignIn(method, { status: 'verified' }, { user: personId, identity: null }, { ipAddress: clientAddress(c) })
  const session = { token: issued.token, user: issued.user }
  setSidCookie(c, session.token, issued.maxAgeSeconds)
  return c.json(await withLanding(c, session), 201)
})

// The SPA's sign-out. Public — it must clear the sid cookie even when the
// bearer token is already gone or expired, otherwise the cookie survives as
// a live credential and any token-less request after logout re-authenticates
// as the departed user (found via #101: a post-logout whoami refetch answered
// as the previous user and poisoned the cache for the next account).
//
// #411: it also ends the session(s) it was called with — the bearer header
// and the sid cookie, which can name different sessions. Expired ones too:
// their realtime sockets are closed regardless. Each revocation stands alone,
// and if any write fails the answer is a 503 — the cookie is still cleared,
// but the caller must not be told the session ended when it did not.
app.post('/api/logout', async (c) => {
  const sid = getCookie(c, 'sid')
  deleteCookie(c, 'sid', { path: '/', secure: externalOrigin(c).protocol === 'https:' })
  let incomplete = false
  for (const credential of new Set([c.req.header('authorization'), sid ? `Bearer ${sid}` : undefined])) {
    const session = await sessionToRevoke(credential)
    if (!session) continue
    closeSessionSockets(session.jti)
    try {
      await revokeSession(session)
    } catch (err) {
      console.error('sign-out: revoking a session failed', err)
      incomplete = true
    }
  }
  if (incomplete)
    return c.json({ error: { type: 'ServiceUnavailableError', message: 'Sign-out did not complete. Try again.' } }, 503)
  return c.json({ ok: true })
})

// SET-002: password reset (public — the caller is logged out). The request
// always returns ok so it can't be used to probe which accounts exist.
app.post('/api/reset_password_request', async (c) => {
  const { usr } = (await c.req.json().catch(() => ({}))) as { usr?: string }
  if (!usr) throw new AppError('ValidationError', 'Expected { usr }')
  await requestPasswordReset(usr, externalOrigin(c).origin)
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

app.get('/files/:stored', (c) => serveFile(c, `/files/${c.req.param('stored')}`, false))
app.get('/private/files/:stored', (c) =>
  serveFile(c, `/private/files/${c.req.param('stored')}`, true),
)

// WEB-002: public web-form config + submit (no session — anonymous forms).
// Registered before the auth middleware. Only whitelisted fields of the
// configured Table are accepted; server validation still runs.
app.get('/api/web_form/:route', async (c) => {
  return c.json(await getWebFormConfig(c.req.param('route')))
})

app.post('/api/web_form/:route', publicLimit('FORM'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { values?: Record<string, unknown> }
  // The route is public, but a logged-in submitter (Bearer token or sid
  // cookie) gets the document created in their name — that's what makes
  // their if_owner portal show it. An invalid/absent credential is anonymous.
  const sessionUser = await resolveToken(authCredential(c))
    .then((u) => u.row_id)
    .catch(() => undefined)
  return c.json(await submitWebForm(c.req.param('route')!, body.values ?? {}, sessionUser), 201)
})

// WEB-001: public, server-rendered Web Pages. No session required; only
// published pages render (others 404). Path may contain slashes.
app.get('/web/:route{.+}', async (c) => {
  const page = await renderWebPage(c.req.param('route'))
  return c.html(page.html, page.found ? 200 : 404)
})

// A browser navigation (the address bar, a redirect) asks for a page;
// fetch/XHR does not. A refused navigation sign-in goes back to the sign-in
// page with a short reason code instead of showing raw JSON; an API caller
// keeps the JSON error.
function isPageNavigation(c: Context): boolean {
  return c.req.header('sec-fetch-mode') === 'navigate' || (c.req.header('accept') ?? '').includes('text/html')
}

function refusedToLoginPage(c: Context, err: unknown) {
  // Unexpected faults are still worth a server-side line; refusals are not.
  if (!(err instanceof AppError)) console.error('[sign-in] google callback failed', err)
  return c.redirect(`/featherbase/login?error=${signInRefusal(err)}`)
}

// #488: with a list set, a host it does not name gets the admin address's
// redirect_uri, so the callback would land on another host than the state
// records. Start over on the admin address instead, before any challenge or
// cookie is minted here (and before this host's budget is charged).
function startGoogleOnAdmin(c: Context, next: () => Promise<void>) {
  const list = config.instanceAddresses
  if (!list || matchAddress(list, requestHost(c.req.url))) return next()
  const url = new URL(c.req.url)
  return c.redirect(`${linkAddress(list, url.hostname.toLowerCase()).address}${url.pathname}${url.search}`)
}

app.get('/api/oauth/google/login', startGoogleOnAdmin, publicLimit('OAUTH_LOGIN'), async (c) => {
  if (!(await googleAvailable())) {
    const off = new AppError('AuthenticationError', GOOGLE_OFF)
    if (isPageNavigation(c)) return refusedToLoginPage(c, off)
    throw off
  }
  const clientId = await oauthClientId()
  assertSignInAvailable(clientId)
  const redirectUri = oauthRedirectUri(c, clientId)
  const { state, verifier } = newLoginChallenge(requestHost(c.req.url))
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
  return c.html(mockConsentHtml(state, redirectUri, email, name, c.req.query('subject') ?? '', c.req.query('hd')))
})

app.get('/api/oauth/mock/approve', async (c) => {
  assertMockProviderAllowed(await oauthClientId())
  const state = c.req.query('state') ?? ''
  const redirectUri = c.req.query('redirect_uri') ?? ''
  verifyState(state, getCookie(c, OAUTH_STATE_COOKIE), requestHost(c.req.url))
  const email = c.req.query('email') ?? ''
  const name = c.req.query('name') ?? ''
  return c.redirect(mockApproveRedirect(state, redirectUri, email, name, c.req.query('subject') ?? '', c.req.query('hd')))
})

app.get('/api/oauth/google/callback', publicLimit('OAUTH_CALLBACK'), async (c) => {
  try {
    return await googleCallback(c)
  } catch (err) {
    // A link attempt that fails before its state is verified (expired, another
    // browser, Google turned off) still lands on a page that explains it,
    // never raw JSON. A refused sign-in does the same for a browser, on the
    // sign-in page; an API caller keeps the JSON error and its status.
    if (claimedPurpose(c.req.query('state')) !== 'link') {
      if (!isPageNavigation(c)) throw err
      clearLoginChallengeCookies(c)
      return refusedToLoginPage(c, err)
    }
    clearLoginChallengeCookies(c)
    const code = err instanceof AppError && /state|token|expired|signature/i.test(err.message) ? 'expired' : 'google_failed'
    return c.redirect(`${ACCOUNT_SIGN_IN_METHODS_PATH}?link=${code}`)
  }
})

async function googleCallback(c: Context) {
  const google = await googleAvailable()
  if (!google) throw new AppError('AuthenticationError', GOOGLE_OFF)
  const clientId = google.client_id
  assertSignInAvailable(clientId)
  // The state must match the cookie this browser got at login. Without that
  // binding an attacker could complete consent with their own account and
  // hand the victim the callback URL, planting the attacker's session.
  const state = verifyState(c.req.query('state'), getCookie(c, OAUTH_STATE_COOKIE), requestHost(c.req.url))
  const verifier = getCookie(c, OAUTH_VERIFIER_COOKIE)
  // One challenge, one use — clear it whether or not the exchange succeeds.
  clearLoginChallengeCookies(c)
  if (state.purpose === 'link') {
    // person-identities D6: the signed-in person who started this flow links
    // the Google account they just proved. Every outcome, including a failed
    // exchange, travels back to the methods page as a code it can explain.
    const back = (result: string) => c.redirect(`${ACCOUNT_SIGN_IN_METHODS_PATH}?link=${encodeURIComponent(result)}`)
    try {
      const verified = await exchangeCode(c.req.query('code'), oauthRedirectUri(c, clientId), clientId, verifier)
      const me = await resolveToken(authCredential(c))
      if (me.row_id !== state.uid) return back('wrong_session')
      assertFreshForLinking(me)
      if (!google.self_link) return back('not_allowed')
      await linkVerifiedToSelf(google, me.row_id, verified)
      return back('linked')
    } catch (err) {
      if (!(err instanceof AppError)) return back('failed')
      if (err.type === 'ConflictError') return back(err.message.includes('reserved') ? 'reserved' : 'taken')
      if (err.type === 'PermissionError') return back(err.message === LINK_DOMAIN_NOT_ALLOWED ? 'domain_not_allowed' : 'not_allowed')
      return back(err.message.startsWith('Sign in again') || err.message.includes('session') ? 'sign_in_again' : 'google_failed')
    }
  }
  const verified = await exchangeCode(c.req.query('code'), oauthRedirectUri(c, clientId), clientId, verifier)
  const issued = await completeSignIn(google, verified, null, { ipAddress: clientAddress(c) })
  const session = { token: issued.token, user: issued.user }
  // The cookie matters here too: beacons (e.g. the unload-time event batch,
  // #101) cannot carry a bearer token, so an OAuth session without the sid
  // cookie would silently drop them (PR #104 review).
  setSidCookie(c, session.token, issued.maxAgeSeconds)
  // #150: the session token itself never travels in this URL — a long-lived
  // credential in a query string lands in browser history, in the Referer of
  // anything that page fetches next, and in every proxy log on the way. The
  // SPA gets a one-time, one-minute handoff code and POSTs it back below.
  return c.redirect(`/featherbase/oauth-callback?code=${encodeURIComponent(mintHandoffCode(session))}`)
}

// #150: the other half of the handoff. Public — the code IS the credential,
// alongside the sid cookie set by the callback that minted it, and the session
// this returns is the thing being established. Redeeming burns the code.
//
// #488: a code handed over from another address of this instance is redeemed
// here too: on its target host only, by the browser holding the nonce cookie
// that host set (oauth.ts, step 4), and only while the source session is still
// live. It carries no session: a new one is minted for this address, with the
// source session's sign-in facts and its own host-only sid cookie.
app.post('/api/oauth/session', async (c) => {
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string }
  const host = requestHost(c.req.url)
  const redeemed = redeemHandoffCode(code, getCookie(c, 'sid'), host, getCookie(c, HANDOFF_NONCE_COOKIE))
  if (redeemed.kind === 'session') return c.json(await withLanding(c, redeemed.session))
  deleteCookie(c, HANDOFF_NONCE_COOKIE, { path: '/' })
  // Signed out, expired, or ended by a password reset since: no hand-off.
  const source = await resolveToken(`Bearer ${redeemed.sourceToken}`)
  const issued = await issueSession(source.row_id, { ...sessionOptionsOf(source), ipAddress: clientAddress(c) })
  const session = { token: issued.token, user: issued.user }
  setSidCookie(c, session.token, issued.maxAgeSeconds)
  return c.json(await withLanding(c, session, { handOff: false }))
})

// #488: the two legs of the hand-off round trip (oauth.ts). Public: the
// browser carries a ticket, and the source leg also needs its sid cookie.
const HANDOFF_NONCE_COOKIE = 'handoff_nonce'

/** How a handed-over session was opened: the source session's own facts. */
// The source is always a browser session: Open Admin refuses an access token
// (#1124), so a ticket never carries one, and a session always has sign-in claims.
function sessionOptionsOf(user: SessionUser): SessionOptions {
  const claims = user.sign_in!
  return {
    ...(claims.method ? { method: claims.method } : {}),
    ...(claims.identity ? { identity: claims.identity } : {}),
    ...(claims.test_mode ? { testMode: true } : {}),
    ...(claims.preview ? { preview: true } : {}),
    // The source's sign-in time travels with it (Codex round 1 on #495).
    authenticatedAt: claims.authenticated_at,
    // ...and its expiry, verified on the source token (Codex round 2 on #495).
    expiresAt: claims.expires_at,
  }
}

/** A listed address by host; the hand-off only ever runs between listed ones. */
function listedAddress(host: string) {
  const entry = matchAddress(config.instanceAddresses, host)
  if (!entry) throw new AppError('AuthenticationError', 'Invalid or expired sign-in code')
  return entry
}

// Step 2, on the target: this browser gets the nonce cookie, and goes back to
// the source with only its hash.
app.get('/api/handoff/start', publicLimit('HANDOFF'), (c) => {
  const id = c.req.query('ticket')
  const ticket = ticketForTarget(id, requestHost(c.req.url))
  const source = listedAddress(ticket.sourceHost)
  const nonce = newHandoffNonce()
  setCookie(c, HANDOFF_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 120,
    secure: externalOrigin(c).protocol === 'https:',
  })
  const back = new URLSearchParams({ ticket: id ?? '', nonce: nonceHash(nonce) })
  return c.redirect(`${source.address}/api/handoff/bind?${back}`)
})

// Step 3, on the source: only the browser holding the ticket's own session
// gets a code, bound to the nonce the target gave it.
app.get('/api/handoff/bind', publicLimit('HANDOFF'), async (c) => {
  const sid = getCookie(c, 'sid')
  const { code, targetHost } = bindHandoffTicket(c.req.query('ticket'), sid, requestHost(c.req.url), c.req.query('nonce'))
  await resolveToken(`Bearer ${sid}`) // the source session must still be live
  return c.redirect(`${listedAddress(targetHost).address}/featherbase/oauth-callback?code=${encodeURIComponent(code)}`)
})

// A dev-preview deployment's click-through sign-in (see preview.ts). Public
// by nature — the key IS the credential — and 404 when previews are off or
// the key is wrong, so the route neither advertises itself nor tells a
// guesser they were close.
//
// The session token does not travel in this redirect. #150 removed long-lived
// JWTs from URLs (they land in history, in the Referer of the next request,
// and in every proxy log); this reuses the same one-time handoff code and the
// SPA's existing /oauth-callback page, so there is no second way in and no
// new client code.
app.get('/preview', async (c) => {
  const config = previewLogin()
  if (!config || !previewKeyMatches(c.req.query('key'), config.key)) return c.notFound()
  // person-rename: PREVIEW_LOGIN_USER is an email or username; the session
  // is issued to that person's minted id.
  const person = await resolvePreviewPerson(config.user)
  if (!person) return c.notFound()
  // Marked, so the click-through cannot add lasting access (review B-M2).
  const issued = await issueSession(person, { preview: true, ipAddress: clientAddress(c) })
  const session = { token: issued.token, user: issued.user }
  setSidCookie(c, session.token, issued.maxAgeSeconds)
  return c.redirect(`/featherbase/oauth-callback?code=${encodeURIComponent(mintHandoffCode(session))}`)
})

// ---- API-004: everything below requires a valid session --------------------

app.use('/api/*', async (c, next) => {
  const user = await resolveToken(authCredential(c))
  c.set('user', user)
  // #473: a test-mode or preview session cannot add a lasting way in, even
  // through the generic save path (document.ts).
  await runInSession(user.sign_in, () => next())
})

// API-007: throttle authenticated requests per user (runs after auth so it can
// key by the resolved user and read their budget).
app.use('/api/*', rateLimit)

/** A request that reaches only the copy actions, whichever way its path is
 *  encoded (a colon may arrive as %3A): any other suffix or verb takes the lock. */
function isCopyRequest(method: string, path: string): boolean {
  if (method !== 'POST' || !path.startsWith('/api/table/')) return false
  try { return /:copy_(?:again|create)$/.test(decodeURIComponent(path)) }
  catch { return false }
}

// Lock the complete request, including internal SQL and post-commit work.
// Lifecycle endpoints take the exclusive counterpart inside their handlers
// (the upgrade preview too since #651: it runs the steps to count losses).
app.use('/api/*', async (c, next) => {
  if (['/api/apps/prepare-install', '/api/install_app', '/api/uninstall_app', '/api/set_app_enabled', '/api/preview_app_upgrade', '/api/upgrade_app', '/api/activate_app_upgrade'].includes(c.req.path))
    return next()
  try {
    // Do not await here: only synchronous identity parsing failures belong to
    // this refusal path, not admitted asynchronous business-handler errors.
    // #625 (E5): an app read takes the lifecycle lock itself, only while it
    // authorizes (and, unless outbound, runs), so an outbound handler waiting
    // on an outside call holds no lifecycle connection.
    // #642: the top bar's options are app reads too (Codex round 1 on #643).
    const appRead = c.req.path.startsWith('/api/app_reads/') || c.req.path.startsWith('/api/app_bar/')
    // #971: a copy reads its source with no lifecycle lock and takes it to apply.
    return withAppClientVersion(c.req.header('X-Featherbase-App-Version') ?? '', () => appRead || isCopyRequest(c.req.method, c.req.path) ? next() : appOperation(next))
  } catch (error) {
    const protectedOperation = /^\/api\/app_(?:reads|actions)\/([^/]+)\/([^/]+)(?:\/access)?$/.exec(c.req.path)
    if (protectedOperation) return recordAppAccessRefusal(who(c), protectedOperation[1], protectedOperation[2], 'identity')
    throw error
  }
})

// #1083: the Model Context Protocol for agents (mcp.ts). Outside /api/*, so
// it takes no lock and no rate budget of its own: each tool call is an inner
// /api request that does. Ahead of the GET catch-alls below, so no redirect
// or app address ever answers for it.
app.post('/mcp', mcpHandler(app))
app.on(['GET', 'DELETE'], '/mcp', mcpMethodNotAllowed)

// #401: public (Google's consent screen fetches it anonymously), ahead of the
// legacy redirect below, which would otherwise answer /privacy with a 308.
app.get('/privacy', async (c) => {
  const { status, html } = await privacyNoticePage()
  c.header('Cache-Control', 'public, max-age=300')
  return c.html(html, status)
})
app.get('/privacy/', (c) => c.redirect('/privacy', 301))

// Old bookmarks remain meaningful, but all Featherbase-owned human pages have
// one canonical namespace. Runtime app roots and technical /api paths never
// pass through this redirect.
const legacyHumanRoot = new RegExp(LEGACY_HUMAN_ROOT_PATTERN)
app.get('*', (c, next) => {
  const url = new URL(c.req.url)
  if (!legacyHumanRoot.test(url.pathname)) return next()
  return c.redirect(`/featherbase${url.pathname}${url.search}`, 308)
})

// #488: an address that opens an app shows that app and the sign-in pages it
// needs, nothing else. `/`, every other Featherbase page and every other app's
// root go to the app's root. An address is presentation, never a security
// boundary: every API call is authorized on its own merits on every address.
app.get('*', async (c, next) => {
  const entry = matchAddress(config.instanceAddresses, requestHost(c.req.url))
  if (!entry || entry.opens === ADMIN) return next()
  // #671: by the installation every process shares, never this process's
  // serving state, so replicas agree and a disabled app keeps its root.
  const target = addressRedirect(entry, c.req.path, await isInstalled(entry.opens))
  return target ? c.redirect(target, 302) : next()
})

app.get('*', async (c, next) => {
  if (!new RegExp(APP_ROOT_PATTERN).test(c.req.path)) return next()
  const url = new URL(c.req.url)
  const name = c.req.path.split('/')[1]
  if (c.req.path === `/${name}`) return c.redirect(`${appHref(name)}${url.search}`, 308)
  return appOperation(async () => {
    let asset: string
    try {
      asset = decodeURIComponent(url.pathname.slice(appHref(name).length))
    } catch {
      return c.notFound()
    }
    let resource
    let user: SessionUser | undefined
    try {
      user = await resolveToken(authCredential(c))
      resource = await appAsset(name, asset, user.row_id, c.req.header('accept')?.includes('text/html'))
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      const navigation = !asset || c.req.header('accept')?.includes('text/html')
      if (navigation && error.type === 'AuthenticationError')
        return c.redirect(
          `/featherbase/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
        )
      if (!navigation || path.extname(asset)) throw error
      // #955: a served app this person cannot open: opening it is the request.
      const asked = user && (await requestAccess(user.row_id, name))
      if (asked && asked.state === 'waiting')
        return c.html(noAccessYetPage(asked.title), 403)
      return c.html(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application unavailable</title></head>
      <body style="font:16px system-ui;background:#f4f5f6;color:#1c2126;margin:0;padding:8vw"><main style="max-width:36rem;margin:auto;background:white;border:1px solid #ebeef0;border-radius:8px;padding:2rem">
      <h1>Application unavailable</h1><p>This application may be disabled, its package may be missing or incompatible, or your account may not have access.</p>
      <p>Disabling an application preserves its data. Ask your system manager to restore access.</p>
      <p><a href="/featherbase/admin">Back to Featherbase</a> · <a href="/featherbase/login">Sign in</a></p></main></body></html>`,
        404,
      )
    }
    const { file, bytes, catalog, clientEntry, frameOrigins, accent } = resource
    if (path.extname(file) === '.html') c.set('frameOrigins', frameOrigins)
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    }
    const html = bytes.toString('utf8')
    const shellOf = (entry: (typeof catalog)[number]) => ({ name, title: entry.title, tabs: Boolean(entry.tabs?.length), accent })
    const body = path.extname(file) !== '.html' || !clientEntry ? new Uint8Array(bytes)
      : new TextEncoder().encode(composeRuntimeShell(html, shellOf(catalog.find((entry) => entry.name === name)!)))
    return new Response(body, {
      headers: {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
})

// #3755: personalised sales-target report (identity + embed-session minting).
app.route('/api/sales_target', salesTargetRoutes)

app.get('/api/whoami', async (c) => {
  const user = c.get('user')
  const [row] = await sql`select theme, language from person where row_id = ${user.row_id}`
  const roles = await getRoles(user.row_id)
  // #410: what the shell may draw. Computed here, from current roles and
  // grants, never from role names the browser holds; display only — every
  // route still enforces its own check. A System Manager's Tables come from the
  // Table list itself, so none are sent here.
  const manage = user.row_id === 'Administrator' || roles.includes('System Manager')
  const access = manage
    ? { readable: [] as string[], creatable: [] as string[], ownGrant: true, admin: true }
    : await tableAccessFor(user.row_id, roles)
  // #905: archived Tables the person can read, so the shell lists them apart
  // and keeps them out of the pickers.
  const archived = (await sql`select name from table_def where archived_at is not null order by name`)
    .map((r) => String(r.name))
    .filter((name) => manage || access.readable.includes(name))
  return c.json({
    ...user,
    roles,
    capabilities: { manage, report: roles.includes(VIEWER_ROLE), admin: access.admin, own_grant: access.ownGrant, tables: access.readable, creatable: access.creatable, archived },
    // #671: the installed apps this person can open, so the shared top bar can
    // lead to and name them without asking an Admin endpoint.
    apps: (await appCatalog(user.row_id)).map(({ name, title }) => ({ name, title })),
    // Every installed app, open or not (disabled, pending): where the bar's
    // name leads follows the installation, as the address routing does.
    installed_apps: await installedAppNames(),
    theme: (row?.theme as string) || 'device',
    language: (row?.language as string) || 'en',
    // A preview deployment says so in the UI: anyone handed the link should
    // know the data is disposable and that they are signed in as someone.
    preview: previewLogin() !== null,
  })
})

// #489: the shared top bar's "Open Admin". A POST, because it mints a
// one-time hand-off ticket: on an app's address the answer is #488's hand-off
// URL to the Admin address, never a URL guessed from the browser's host. The
// ticket is bound to the credential this request authenticated with (header
// first, as the auth middleware reads it), so a stray sid cookie of another
// session can never be the one handed over: the bind step requires this
// browser's sid to BE that credential, and fails closed otherwise.
app.post('/api/open_admin', async (c) => {
  // Parsed exactly as resolveToken parsed it for the auth middleware above.
  const token = authCredential(c)?.match(/^Bearer (.+)$/)?.[1] ?? ''
  // Only a browser session is handed over. An access token carries no sign-in:
  // handed over, it would become a session that outlives its revocation.
  if (!c.get('user').sign_in) throw new AppError('PermissionError', 'An access token cannot open the Admin screens')
  const opened = await openAdminFor({ token, user: c.get('user') }, requestHost(c.req.url))
  if (!opened) throw new AppError('PermissionError', 'You cannot use the Admin screens')
  return c.json(opened)
})

// #101 Phase 3: batched capture of the caller's read-side intent (rows
// visited, lists filtered, searches run). The user always comes from the
// session — a client cannot write anyone else's trail — and reads are
// scoped to the caller for the same reason.
app.post('/api/events', async (c) => {
  const events = validateEventBatch(await c.req.json().catch(() => null))
  const timestamps = await recordEvents(who(c), events)
  // Nudge the poster's own "Mine" feed on their personal channel (PR #104
  // review — the 'feed' channel is System Manager-only).
  publishUserEvent(who(c), 'feed_mine')
  return c.json({ inserted: timestamps.length, timestamps })
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
// gated to System Manager. Back-to-back repeats of one action on one target
// are collapsed into a single row with a count, BEFORE the limit (home
// cleanup), and rows are titled for the viewer (title_column or a readable
// stand-in), never shown as a bare internal id.
//
// The collapse is gaps-and-islands in SQL over the whole ordered trail: a row
// starts a run when it differs from the row before it, a running sum numbers
// the runs, and a page is the first `limit` runs with their full counts. A
// fixed scan window would cut a long run short and hide what came before it.

/** The viewer's titles for the rows a feed page references, by "table\0id". */
async function feedRowTitles(user: string, refs: Array<{ table?: string; row_id?: string }>) {
  const wanted = refs.filter((r): r is { table: string; row_id: string } => Boolean(r.table && r.row_id))
  const titles = new Map<string, string>()
  for (const t of await rowTitles(user, wanted.slice(0, 100))) titles.set(`${t.table}\0${t.row_id}`, t.title)
  return (table?: string, rowId?: string) => (table && rowId ? titles.get(`${table}\0${rowId}`) : undefined)
}

app.get('/api/activity_feed', async (c) => {
  const user = who(c)
  const scope = c.req.query('scope') === 'team' ? 'team' : 'mine'
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 30, 1), 100)

  if (scope === 'mine') {
    const rows = await sql`
      with marked as (
        select kind, ref_key, label, sub_label, path, occurred_at, row_id,
               case when lag(kind) over w = kind and lag(ref_key) over w is not distinct from ref_key
                    then 0 else 1 end as starts
        from user_event where created_by = ${user}
        window w as (order by occurred_at desc, row_id desc)
      ), runs as (
        select *, sum(starts) over (order by occurred_at desc, row_id desc rows unbounded preceding) as run
        from marked
      )
      select r.kind, r.ref_key, r.label, r.sub_label, r.path, r.occurred_at, n.count
      from runs r
      join (select run, count(*)::int as count from runs where run <= ${limit} group by run) n using (run)
      where r.starts = 1
      order by r.run`
    const me = (await whoLabels([user])).get(user)
    const whoName = me?.name ?? user
    const items = rows.map((r) => ({
      kind: r.kind as string,
      ref_key: (r.ref_key as string | null) ?? '',
      label: (r.label as string | null) ?? (r.ref_key as string | null) ?? '',
      sub: (r.sub_label as string | null) ?? undefined,
      path: (r.path as string | null) ?? '',
      at: new Date(r.occurred_at as string).toISOString(),
      count: Number(r.count),
    }))
    // A row event is keyed `row:<Table>/<id>` and carries the Table as sub.
    const rowRef = (i: (typeof items)[number]) =>
      i.kind === 'row' && i.sub && i.ref_key === `row:${i.sub}/${i.label}` ? { table: i.sub, row_id: i.label } : {}
    const titleOf = await feedRowTitles(user, items.map(rowRef))
    return c.json({
      items: items.map(({ ref_key, ...i }) => {
        const base = { who_name: whoName, ...(me?.role ? { who_role: me.role } : {}), path: i.path, at: i.at, count: i.count }
        // #440: a fixed admin page is a page, titled — not a slug-named list.
        const pageTitle = adminPathTitle(i.path)
        if (pageTitle && (i.kind === 'list' || i.kind === 'page')) return { ...base, kind: 'page', label: pageTitle }
        const ref = rowRef({ ...i, ref_key })
        const title = titleOf(ref.table, ref.row_id)
        return {
          ...base,
          kind: i.kind,
          label: i.label,
          ...(title ? { title } : {}),
          sub: i.sub,
          ...(i.kind === 'list' ? { filtered: listKeyHasFilter(ref_key) } : {}),
        }
      }),
    })
  }

  const roles = await getRoles(user)
  if (!roles.includes('System Manager'))
    throw new AppError('PermissionError', 'The team feed requires the System Manager role')
  // Changes and sign-ins as one ordered stream; a run is one person doing the
  // same kind of thing to the same target back to back.
  const privateChanges = await mandatoryReferencesWhere(user, 'ref_table', 'ref_name')
  const rows = await sql`
    with stream as (
      select created_by as who, 'change'::text as kind, ref_table as sub, ref_name as label, created_at as at, row_id::text as id
      from version where ${privateChanges.frag}
      union all
      select "user", 'login', null, null, created_at, row_id::text
      from activity_log where operation = 'login'
    ), marked as (
      select *,
             case when lag(kind) over w = kind and lag(who) over w is not distinct from who
                   and lag(sub) over w is not distinct from sub and lag(label) over w is not distinct from label
                  then 0 else 1 end as starts
      from stream
      window w as (order by at desc, id desc)
    ), runs as (
      select *, sum(starts) over (order by at desc, id desc rows unbounded preceding) as run
      from marked
    )
    select r.who, r.kind, r.sub, r.label, r.at, n.count
    from runs r
    join (select run, count(*)::int as count from runs where run <= ${limit} group by run) n using (run)
    where r.starts = 1
    order by r.run`
  const items = rows.map((r) => {
    const sub = (r.sub as string | null) ?? undefined
    const label = (r.label as string | null) ?? ''
    return r.kind === 'login'
      ? {
          who: r.who as string,
          kind: 'login',
          label: '', // the row already names the person; a sign-in has no object
          sub: undefined, // the verb ("signed in") is the web's, like every other kind
          path: '',
          at: new Date(r.at as string).toISOString(),
          count: Number(r.count),
        }
      : {
          who: r.who as string,
          kind: 'change',
          label,
          sub,
          path: sub && label ? rowHref(sub, label) : '',
          at: new Date(r.at as string).toISOString(),
          count: Number(r.count),
        }
  })
  const names = await whoLabels(items.map((i) => i.who))
  const titleOf = await feedRowTitles(user, items.map((i) => (i.kind === 'change' ? { table: i.sub, row_id: i.label } : {})))
  return c.json({
    items: items.map(({ who: id, ...i }) => {
      const title = i.kind === 'change' ? titleOf(i.sub, i.label) : undefined
      return {
        who_name: names.get(id)?.name ?? id,
        who_role: names.get(id)?.role,
        ...i,
        ...(title ? { title } : {}),
      }
    }),
  })
})

// Home cleanup: display titles for referenced rows (Home tiles, Recent).
app.post('/api/row_titles', async (c) => {
  const refs = validateRowTitleRequest(await c.req.json().catch(() => null))
  return c.json({ titles: await rowTitles(who(c), refs) })
})

// UI-024 / #380: persist the caller's theme — light, dark, or follow the device.
const THEMES = ['light', 'dark', 'device'] as const
app.post('/api/set_theme', async (c) => {
  const { theme } = (await c.req.json().catch(() => ({}))) as { theme?: string }
  if (!THEMES.includes(theme as (typeof THEMES)[number]))
    throw new AppError('ValidationError', `theme must be one of ${THEMES.join(', ')}`)
  await sql`update person set theme = ${theme!} where row_id = ${who(c)}`
  return c.json({ ok: true, theme })
})

// I18N-001/002: per-user language + the translation catalog for a language.
app.post('/api/set_language', async (c) => {
  const { language } = (await c.req.json().catch(() => ({}))) as { language?: string }
  if (!language || !/^[a-z]{2}(-[a-z]{2})?$/i.test(language))
    throw new AppError('ValidationError', 'Expected a language code like "en" or "fr"')
  await sql`update person set language = ${language} where row_id = ${who(c)}`
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
  // A test-mode, preview or pre-upgrade session must not leave a lasting way
  // in behind (review B1, A-M1, B-M2).
  assertCanChangeAccess(c.get('user'))
  const { user, password } = (await c.req.json()) as { user?: string; password?: string }
  const target = user ?? who(c)
  if (!password) throw new AppError('ValidationError', 'Expected { password }')
  if (target !== who(c)) await assertSystemManager(who(c))
  else {
    // Adding a password where there was none is adding a way in: it needs a
    // recent sign-in, like linking (review minor 4). Changing one does not.
    const [mine] = await sql`select password_hash is not null as has from person where row_id = ${target}`
    if (!mine?.has) assertFreshForLinking(c.get('user'))
  }
  // #131: a service account must never become password-login-able; the write
  // itself refuses anything that is not a person.
  await setUserPassword(target, password)
  return c.json({ ok: true })
})

// Instance settings as code (#465, D3): the instance repository's workflow
// sends its settings file here with a System Manager token, on merge and on
// demand. `dry_run` previews; `files` carries what the file names with
// { file }. The export is the same shape and never holds a secret.
app.post('/api/instance-settings/apply', async (c) => {
  await assertSystemManager(who(c))
  // It writes sign-in methods, so it is access work (auth.ts).
  assertCanChangeAccess(c.get('user'))
  const { applyRequestSchema, applyInstanceSettings } = await import('./instance-settings')
  const parsed = applyRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'body'] = issue.message
    throw new AppError('ValidationError', `Expected { file, environment?, dry_run?, source?, files?, env? }: ${Object.entries(fields).map(([k, v]) => `${k} ${v}`).join('; ')}`, fields)
  }
  const body = parsed.data
  return c.json(await applyInstanceSettings(body.file, {
    by: who(c), environment: body.environment, dryRun: body.dry_run === true, source: body.source, files: body.files, env: body.env,
  }))
})

app.get('/api/instance-settings/export', async (c) => {
  await assertSystemManager(who(c))
  const { exportInstanceSettings } = await import('./instance-settings')
  return c.json(await exportInstanceSettings())
})

// D10: the variable report the environment comparison reads. The caller
// sends a new random key each run; the answer says which declared variables
// are set and fingerprints only the secrets with a cross-environment rule.
app.post('/api/instance-settings/variables', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => null)) as { key?: unknown } | null
  const { variableReport } = await import('./environment-comparison')
  const report = await variableReport(body?.key)
  c.header('Cache-Control', 'no-store')
  return c.json(report)
})

// D5: which fields of one row the last apply set, so the form shows them
// read-only. Only someone who can read the row learns which are locked.
app.get('/api/instance-settings/managed/:table/:name', async (c) => {
  const table = await resolveTableName(c.req.param('table'))
  const name = c.req.param('name')
  await getDoc(table, name, who(c))
  const { managedFieldsOf } = await import('./managed-settings')
  const { MANAGED_FIELD_HINT } = await import('shared')
  return c.json({ fields: await managedFieldsOf(table, name), hint: MANAGED_FIELD_HINT })
})

// Instance health (#465 D8): every check with its state, why it matters, how
// to fix it and its history. System Manager only. Reading it also records any
// check whose state changed, so the history matches what the banner showed.
app.get('/api/instance-health', async (c) => {
  await assertSystemManager(who(c))
  const { instanceHealth } = await import('./instance-health')
  return c.json(await instanceHealth())
})

// First-run setup (#465 D9): the built-in Administrator names the people who
// look after the instance; each becomes a System Manager and is invited.
app.post('/api/setup/system-managers', async (c) => {
  assertCanChangeAccess(c.get('user'))
  const { setUpSystemManagers } = await import('./first-run-setup')
  return c.json(await setUpSystemManagers(await c.req.json().catch(() => null), who(c), externalOrigin(c).origin))
})

// #955: how many access requests are waiting, for the menu badge. System
// Manager only. The list itself is the standard Access Request list.
app.get('/api/people/waiting_for_access/count', async (c) => {
  await assertSystemManager(who(c))
  return c.json({ count: await countWaitingForAccess() })
})

// #955: a page that found the person has no access to it (Featherbase's
// no-access page, Dash's) says so here; opening it is the request.
app.post('/api/access_request', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { app?: unknown }
  const answer = typeof body.app === 'string' ? await requestAccess(who(c), body.app) : null
  if (!answer) throw new AppError('ValidationError', 'No such app to ask for')
  return c.json(answer)
})

app.route('/', peopleRoutes)

app.route('/', tableDefRoutes)

app.post('/api/save_row', async (c) => {
  const body = (await c.req.json()) as { table?: string; row?: Record<string, unknown> }
  if (!body.table || typeof body.row !== 'object' || body.row === null)
    throw new AppError('ValidationError', 'Expected { table, row }')
  const hadRowId = Boolean(body.row[ROW_KEY])
  const saved = await saveDoc(body.table, body.row, who(c))
  publishDocEvent(body.table, String(saved.row_id), hadRowId ? 'updated' : 'created')
  return c.json(await rowForCaller(body.table, saved, who(c)), 201)
})

// PRN-003: server-side PDF of any document / print format.
app.get('/api/print/:table/:name', async (c) => {
  const format = c.req.query('format')
  const letterHead = c.req.query('letter_head')
  const table = c.req.param('table')
  const name = c.req.param('name')
  const html = await renderPrintHtml(table, name, who(c), format, letterHead)
  const pdf = await renderPdf(html)
  // PLAT-007: record the print/access.
  await logAccess(who(c), 'print', { table: table, row_id: name, method: 'pdf' })
  return c.body(new Uint8Array(pdf), 200, {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${name.replace(/[^\w.-]/g, '_')}.pdf"`,
  })
})

// PLAT-007: the client records a data export here (CSV/XLSX are built in the
// browser, so the log is client-notified). Read permission is required on the
// exported Table — you can only log an export of data you could read.
app.post('/api/access_log', async (c) => {
  const { table, method } = (await c.req.json().catch(() => ({}))) as {
    table?: string
    method?: string
  }
  if (!table) throw new AppError('ValidationError', 'Expected { table }')
  await assertPermission(who(c), table, 'read')
  await logAccess(who(c), 'export', { table: table, method: method ?? 'csv' })
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
  const refTable = typeof body.ref_table === 'string' && body.ref_table ? body.ref_table : null
  const refName = typeof body.ref_name === 'string' && body.ref_name ? body.ref_name : null
  // A ref_table with no ref_name attaches to the TABLE rather than to any
  // one row (DEL-R7 registers such files so deleting the Table sweeps them),
  // so the Table's own read grant is what there is to check.
  // Changing a row includes attaching a file to it: someone who may write
  // the row (its grants, Data Scopes, shares and the app's own row rules,
  // exactly as an edit would be judged) needs no grant on File. Anyone else
  // needs create on File, as for a file on a whole table or on nothing.
  // rowCapabilities reads the row first, so an unreadable row is refused.
  let attachedRowWritable = false
  if (refTable && refName) attachedRowWritable = (await rowCapabilities(refTable, refName, who(c))).write
  else if (refTable) await assertPermission(who(c), refTable, 'read')
  if (!attachedRowWritable) await assertPermission(who(c), 'File', 'create')
  const content = Buffer.from(await file.arrayBuffer())
  const stored = await saveUpload(content, file.name, isPrivate)
  const mimeType = mimeEssence(file.type)
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
    'insert',
    { uploadedFileUrl: stored.file_url, attachedRowWritable },
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
  if (row.ref_table && row.ref_name && await hasMandatoryRowAccess(String(row.ref_table), String(row.ref_name))) {
    await getDoc(String(row.ref_table), String(row.ref_name), user)
    return c.json({ signed_url: fileUrl })
  }
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
  const { table, filters } = (await c.req.json().catch(() => ({}))) as {
    table?: string
    filters?: [string, string, unknown][]
  }
  if (!table) throw new AppError('ValidationError', 'Expected { table }')
  return c.json({ count: await countDocs(table, filters ?? [], who(c)) })
})

app.post('/api/dashboard/chart', async (c) => {
  const { table, group_by, filters } = (await c.req.json().catch(() => ({}))) as {
    table?: string
    group_by?: string
    filters?: [string, string, unknown][]
  }
  if (!table || !group_by) throw new AppError('ValidationError', 'Expected { table, group_by }')
  return c.json({ data: await groupCount(table, group_by, filters ?? [], who(c)) })
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

// The existing simple matrix is a presentation of operation contributions.
// Granular selections and scoped contributions are edited as Permission Rows;
// this coarse editor must never replace them with broader permissions.
const MATRIX_OPERATIONS = {
  can_read: 'read', can_write: 'update', can_create: 'create', can_delete: 'delete',
  can_submit: 'submit', can_cancel: 'cancel', can_amend: 'amend',
} as const

app.get('/api/permissions/:table', async (c) => {
  await assertSystemManager(who(c))
  const table = c.req.param('table')
  const roles = (await sql`select row_id from role order by row_id`).map((r) => r.row_id as string)
  // The basic Rows the matrix edits; a contribution that depends on another
  // grant is not a tick of its own.
  const rows = await sql`select role, operation from permission where ref_table = ${table}
    and parent_permission is null and requires_permission is null`
  const perms = roles.map((role) => ({ role, ...Object.fromEntries(Object.entries(MATRIX_OPERATIONS)
    .map(([flag, operation]) => [flag, rows.some((row) => row.role === role && row.operation === operation)])) }))
  return c.json({ table, roles, perms })
})

app.post('/api/permissions/:table', async (c) => {
  const user = who(c)
  await assertSystemManager(user)
  const table = c.req.param('table')
  const body = (await c.req.json().catch(() => ({}))) as { role?: string } & Record<string, unknown>
  if (!body.role) throw new AppError('ValidationError', 'Expected { role }')
  await withTransaction(async () => {
    // The matrix is the basic-level Rows of one role, as its one flag Row was:
    // added operations keep that Row's creator restriction and app ownership.
    const existing = await sql`select * from permission where ref_table = ${table} and role = ${body.role!}
      and parent_permission is null and requires_permission is null for update`
    const shapes = new Set(existing.map((row) => `${String(row.scope_mode)} ${String(row.owner_app ?? '')}`))
    if (existing.some((row) => row.column_rule !== 'basic') || shapes.size > 1)
      throw new AppError('ValidationError', 'Edit the individual Permission Rows to preserve their scopes and Column selections')
    const [shape] = existing
    // Clearing the last tick would forget the creator restriction or app
    // ownership, and ticking again would grant wider than the role ever held.
    if (shape && (shape.scope_mode !== 'all' || shape.owner_app) && !Object.keys(MATRIX_OPERATIONS).some((flag) => body[flag]))
      throw new AppError('ValidationError', 'Edit the individual Permission Rows to preserve their scopes and app ownership')
    for (const [flag, operation] of Object.entries(MATRIX_OPERATIONS)) {
      const contributions = existing.filter((row) => row.operation === operation)
      if (!body[flag]) {
        for (const row of contributions) {
          // A deeper grant that needs this one would be gone for good, where
          // clearing the old flag left it to work again when ticked back.
          const dependents = await sql`select distinct role from permission
            where requires_permission = ${String(row.row_id)} or parent_permission = ${String(row.row_id)} order by role`
          if (dependents.length)
            throw new AppError('ValidationError', `Deeper access of ${dependents.map((d) => String(d.role)).join(', ')} needs this grant: edit the individual Permission Rows`)
          await revokeGrant(String(row.row_id), user)
        }
      } else if (!contributions.length) {
        const saved = await saveDoc('Permission', {
          ref_table: table, role: body.role, operation, scope_mode: shape?.scope_mode ?? 'all', column_rule: 'basic',
        }, user)
        if (shape?.owner_app) {
          await sql`update permission set owner_app = ${String(shape.owner_app)} where row_id = ${String(saved.row_id)}`
          // On the install ledger, so uninstalling the app removes it too.
          await sql`update installed_app set perms = coalesce(perms, '[]'::jsonb) || ${sql.json([String(saved.row_id)])} where name = ${String(shape.owner_app)}`
        }
      }
    }
  })
  return c.json({ ok: true })
})

app.route('/', appRoutes)
// #629: the glossary everyone signed in reads, and an editor's way back to an
// app's own wording of a term the instance reworded.
app.get('/api/glossary', async (c) => c.json(await readGlossary(who(c))))
app.post('/api/glossary/take_app_wording', async (c) => {
  const { id } = (await c.req.json().catch(() => ({}))) as { id?: unknown }
  if (typeof id !== 'string') throw new AppError('ValidationError', 'Expected { id }')
  await takeAppWording(id, who(c))
  return c.json({ ok: true })
})

// EML-007: trigger an Auto Email Report immediately (the "run now" a scheduler
// would otherwise do on cadence). System Manager only — it emails on behalf of
// the configured report.
app.post('/api/run_auto_email_report', async (c) => {
  await assertSystemManager(who(c))
  const { row_id: name } = (await c.req.json().catch(() => ({}))) as { row_id?: string }
  if (!name) throw new AppError('ValidationError', 'Expected { row_id }')
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

// CUST-005: export/import a Table's customizations (Custom Fields +
// Property Setters) as JSON. System-Manager-only.
app.get('/api/export_customizations/:table', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await exportCustomizations(c.req.param('table')))
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
app.get('/api/workflow/:table/:name', async (c) => {
  const table = c.req.param('table')
  const wf = await getActiveWorkflow(table)
  if (!wf) return c.json({ workflow: null })
  const doc = await getDoc(table, c.req.param('name'), who(c))
  const state = currentState(wf, doc)
  const roles = await getRoles(who(c))
  return c.json({
    workflow: wf.row_id,
    state,
    actions: availableActions(wf, state, roles, doc).map((t) => ({ action: t.action, next_state: t.next_state })),
  })
})

// UI-013: per-user list/view settings. Stored per (user, table) and only
// ever readable/writable by that user.
// A save merges its top-level keys into what is stored, so the list's
// arrangement and the form's (`form`, #795) share one record without one
// screen's save dropping the other's.
app.get('/api/user_settings/:table', async (c) => {
  const [row] = await sql`
    select settings from user_settings
    where "user" = ${who(c)} and table_name = ${c.req.param('table')}`
  return c.json({ settings: row?.settings ?? null })
})

app.put('/api/user_settings/:table', async (c) => {
  const settings = (await c.req.json()) as Record<string, unknown>
  await sql`
    insert into user_settings ("user", table_name, settings, updated_at)
    values (${who(c)}, ${c.req.param('table')}, ${settings as unknown as string}, now())
    on conflict ("user", table_name) do update set settings = user_settings.settings || excluded.settings, updated_at = now()`
  return c.json({ ok: true })
})

// A document's activity follows access to that document, not broad read
// permission on the platform-wide Comment and Version tables.
app.get('/api/activity/:table/:name', async (c) => {
  const table = c.req.param('table')
  const name = c.req.param('name')
  return c.json(await documentActivity(table, name, who(c)))
})

// EML-006 / UI-017: assign a document to a user. Creates a ToDo in their
// task list and notifies them (Notification Log + realtime user event).
app.post('/api/assign', async (c) => {
  const { table, row_id: name, assign_to, description } = (await c.req.json()) as {
    table?: string
    row_id?: string
    assign_to?: string
    description?: string
  }
  if (!table || !name || typeof assign_to !== 'string' || !assign_to.trim())
    throw new AppError('ValidationError', 'Expected { table, row_id, assign_to }')
  // #1021: assigned through its base row, never through a view.
  assertNotView(await getMeta(table), 'assigned')
  // The assigner must be able to read the document.
  await getDoc(table, name, who(c))
  // Assignments go to people; a service account is not offered (person-rename).
  // The assign box invites an email address (#512), so a person is found by
  // their id or, failing that, by an email the assigner may read.
  const asked = assign_to.trim()
  const [byId] = await sql`select row_id from person where row_id = ${asked}`
  const target = byId ? String(byId.row_id) : await personByEmail(asked, who(c))
  if (!target) throw new AppError('NotFoundError', `Person ${asked} not found`)

  const todo = await createAssignment(table, name, target, who(c), description)
  return c.json({ todo }, 201)
})

// UI-017: free-form document tags. Readable/writable by anyone who can read
// the document.
app.get('/api/tags/:table/:name', async (c) => {
  await getDoc(c.req.param('table'), c.req.param('name'), who(c))
  const rows = await sql`
    select tag from tag_link
    where ref_table = ${c.req.param('table')} and ref_name = ${c.req.param('name')}
    order by tag`
  return c.json({ tags: rows.map((r) => r.tag as string) })
})

app.post('/api/tags', async (c) => {
  const { table, row_id: name, tag } = (await c.req.json()) as {
    table?: string
    row_id?: string
    tag?: string
  }
  if (!table || !name || !tag?.trim())
    throw new AppError('ValidationError', 'Expected { table, row_id, tag }')
  // #1021: tagged through its base row, never through a view.
  assertNotView(await getMeta(table), 'tagged')
  await getDoc(table, name, who(c))
  await sql`
    insert into tag_link ${sql({ ref_table: table, ref_name: name, tag: tag.trim(), created_by: who(c) })}
    on conflict do nothing`
  return c.json({ ok: true }, 201)
})

app.delete('/api/tags/:table/:name/:tag', async (c) => {
  await getDoc(c.req.param('table'), c.req.param('name'), who(c))
  await sql`
    delete from tag_link where ref_table = ${c.req.param('table')}
      and ref_name = ${c.req.param('name')} and tag = ${c.req.param('tag')}`
  return c.json({ ok: true })
})

// EML-001: send a test email from the configured account (through SMTP when
// SMTP_HOST is set, otherwise the Email Sink). EML-002: queue an email for background delivery.
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
    reference_table?: string
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
    ref_table: body.reference_table,
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
    trigger: 'manual',
  })
  return c.json({ name }, 201)
})

// JOB-004: retry a failed job from the Admin.
app.post('/api/retry_job', async (c) => {
  await assertSystemManager(who(c))
  const { row_id: name } = (await c.req.json().catch(() => ({}))) as { row_id?: string }
  if (!name) throw new AppError('ValidationError', 'Expected { row_id }')
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
    with_retired: q.with_retired === 'true',
  }
}

// UI-014: awesomebar global search across readable Tables.
app.get('/api/search', async (c) => {
  const q = c.req.query('q') ?? ''
  return c.json({ results: await globalSearch(q, who(c)) })
})

app.get('/api/command_destinations', async (c) => {
  return c.json(await commandDestinations(who(c)))
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
    select name from table_def where kind = 'table' and archived_at is null order by name`
  const tables: string[] = []
  for (const r of rows)
    if ((await permissionScope(user, r.name, 'read')) !== 'none') tables.push(r.name)
  return c.json({ tables })
})

// RT-003: the caller's unread notification count.
app.get('/api/unread_count', async (c) => {
  // An aggregate with no group by always returns exactly one row.
  const [row] = await sql`
    select count(*)::int as c from notification_log
    where for_user = ${who(c)} and read = false`
  return c.json({ count: row.c as number })
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
    // #1021: a view's meta answers to its base's read grant and levels.
    const stored = await storedTable(meta.name)
    await assertPermission(user.row_id, stored, 'read')
    // #738: the caller's readable levels ride beside the cached meta, never
    // inside it — the meta object is shared by every caller.
    const readable = await permittedColumns(user.row_id, stored, 'read')
    return c.json({ ...meta, readable_columns: meta.columns.filter((column) => includesColumn(readable, column)).map((column) => column.column_name), storage_identity: await tableStorageIdentity(meta) })
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
    return c.json({ count: await countDocs(table, parsed as never, user.row_id, { withRetired: c.req.query('with_retired') === 'true' }) })
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
    // #432: one gate for every write action, present and future (import,
    // import-revert, …) — a system-written Table takes none of them.
    assertRowsWritable(await getMeta(table), 'changed')
    const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    return c.json(await action.handler({ table, args, user }), 201)
  }
  const doc = (await c.req.json()) as Record<string, unknown>
  const saved = await saveDoc(table, doc, user.row_id, 'insert')
  publishDocEvent(table, String(saved.row_id), 'created')
  return c.json(await rowForCaller(table, saved, user.row_id), 201)
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
  // #432: submit, cancel, amend, rename, workflow actions and any later one.
  assertRowsWritable(await getMeta(table), 'changed')
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
  return c.json(await rowForCaller(table, saved, user.row_id))
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
// (The '' arm is the web suite's, which imports this module under jsdom.)
const webDist = import.meta.url.startsWith('file:') ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist') : ''

/** Serve a built web app from `dir` on `target`, when the directory exists:
 *  its files as they are, and index.html for any other GET a server-owned
 *  prefix does not claim. Answers whether it mounted anything. */
export function serveWebDist(target: Hono<Env>, dir: string): boolean {
  if (!dir || !existsSync(dir)) return false
  // serveStatic resolves `root` against process.cwd() (apps/server under
  // `pnpm --filter server start`), so the path must be expressed relative
  // to that, not absolute.
  const webRoot = path.relative(process.cwd(), dir)
  target.use('*', serveStatic({ root: webRoot }))
  // SPA fallback: any GET the API and asset handlers didn't claim gets
  // index.html so client-side routes deep-link. Server-owned prefixes pass
  // through and keep their JSON 404 envelope (API-006).
  const serverOwned = /^\/(api|apps|files|mcp|private\/files|web|ws)(\/|$)/
  target.get('*', (c, next) => {
    if (serverOwned.test(c.req.path)) return next()
    return serveStatic({ root: webRoot, path: 'index.html' })(c, next)
  })
  return true
}
serveWebDist(app, webDist)

/** Boot this process as the server: refuse a bad configuration, listen on
 *  `port`, attach realtime, run the job worker and sync the recurring jobs.
 *  Resolves once it listens, with the port and a way to stop it again. */
export async function startServer(port: number = config.port): Promise<{ port: number; stop: () => Promise<void> }> {
  // Refuse to boot on a missing required variable, or with a switch on that
  // production must never have (instance-settings D7; test mode is one, D5).
  const { installedAppsAtStart, settingsRequirements } = await import('./release-preflight')
  for (const line of assertServerStart(undefined, await settingsRequirements())) if (line.startsWith('WARNING')) console.warn(line)
  // #642 (E7): never serve without an installed, enabled app's exact version
  // (a developer's server warns instead).
  for (const line of await installedAppsAtStart()) console.warn(line)
  const { server, listening } = await new Promise<{ server: ReturnType<typeof serve>; listening: number }>((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`server listening on :${info.port}`)
      resolve({ server, listening: info.port })
    })
  })
  // An auth bypass nobody noticed being enabled is the failure mode worth a
  // log line: say once whether preview sign-in is live, or why it was refused.
  announcePreviewLogin()
  announceDelegatedTestMode()
  // RT-001/002/003: attach the realtime WebSocket server to the HTTP server.
  attachRealtime(server as unknown as import('node:http').Server)
  // JOB-001: run the background worker in-process (tests drive the queue
  // directly via runOneJob/drainJobs, so the worker stays off under test).
  startWorker()
  // Every recurring job (auto_email_reports, check_sla, refresh_datasets, and
  // whatever an app or an administrator adds) is a Scheduled Job row; the
  // sync makes the queue agree with the rows. Idempotent, so a restart never
  // stacks a duplicate recurrence.
  await syncScheduledJobs()
  return {
    port: listening,
    stop: async () => {
      stopWorker()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/* v8 ignore next -- entry-point guard: the process boots unless Vitest imported it; startServer() itself is driven in-process by test/server-start.test.ts */
if (readVariable('NODE_ENV') !== 'test') await startServer()
