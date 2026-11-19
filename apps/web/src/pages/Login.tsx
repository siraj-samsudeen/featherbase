import { useEffect, useReducer, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { APP_ROOT_PATTERN } from 'shared'
import { markSetupOffer } from './FirstRunSetup'
import { ApiError, api, landingPath, login, loginDelegated, signUp, type BrandSignInMethod, type SessionUser, type SignedIn } from '../lib/api'
import { Button, Field, Notice, TextInput, buttonClasses, inputClasses, labelClasses, panelClasses } from '@featherbase/shop-floor'
import { Logo } from '../components/Logo'
import { AccountChooser, useBrowserAccounts } from '../components/AccountChooser'
import { pageLoad } from '../lib/page-load'
import { SignInPanel, hasOtherWays } from '../components/SignInPanel'
import type { BrowserAccount } from '../lib/api'

export function safeLoginNext(
  next: string | undefined,
  inheritedHash = window.location.hash,
): string | undefined {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return undefined
  try {
    if (decodeURIComponent(next).includes('\\')) return undefined
    const parsed = new URL(next, window.location.origin)
    if (parsed.origin !== window.location.origin) return undefined
    const canonicalFeatherbase = parsed.pathname.startsWith('/featherbase/')
      && !/^\/featherbase\/login(?:\/|$)/.test(parsed.pathname)
    const runtimeApp = new RegExp(APP_ROOT_PATTERN).test(parsed.pathname)
    if (!canonicalFeatherbase && !runtimeApp) return undefined
    const hash = parsed.hash || (inheritedHash.startsWith('#') ? inheritedHash : '')
    return `${parsed.pathname}${parsed.search}${hash}`
  } catch {
    return undefined
  }
}

// A refused browser sign-in (the Google or Microsoft callback) comes back as
// `?error=<code>`, with `&via=microsoft` when Microsoft's. Only these codes
// are explained; anything else reads as the generic failure, and the query
// text itself is never shown. `provider` is the refusing method's label.
const REFUSALS: Record<string, (p: { appName: string; provider: string; service: string | null }) => string> = {
  not_provisioned: ({ appName, provider, service }) =>
    `This ${provider} account isn't set up for ${appName}. Ask your manager or IT to invite you${service ? `, or sign in with ${service}.` : '.'}`,
  not_allowed: ({ provider }) => `This account can't sign in with ${provider}. Ask your manager or IT for help.`,
  address_in_use: ({ provider }) => `Another account already uses this ${provider} account's email address. Ask your manager or IT to link it for you.`,
  google_off: ({ provider }) => `${provider} sign-in isn't available right now. Use another way to sign in.`,
  microsoft_off: ({ provider }) => `${provider} sign-in isn't available right now. Use another way to sign in.`,
  expired: () => 'The sign-in took too long or was started in another window. Please try again.',
  google_failed: ({ provider }) => `${provider} sign-in didn't finish. Please try again.`,
  microsoft_failed: ({ provider }) => `${provider} sign-in didn't finish. Please try again.`,
}

// #474: "Try another Google account" restarts Google sign-in with the account
// picker forced, so the account just refused is never silently reused. Each
// redirect sign-in already asks Microsoft to show its account picker too.

const SIGN_IN_FAILED = 'Sign-in failed. Please try again.'
// Server messages a person may read as they are: refusals the server already
// words for people (a wrong password, an outage, someone who has left).
const SHOWN_AS_SENT = new Set(['AuthenticationError', 'PermissionError', 'ServiceUnavailableError', 'ConflictError', 'RateLimitError'])

/** What the page says about a failed sign-in. A validation message from the
 *  server is a request shape ("Expected { usr, pwd }"), never shown on the
 *  sign-in forms; sign-up's validation messages are worded for people. */
function signInErrorText(err: unknown, opts: { blank: string; showValidation?: boolean }): string {
  if (!(err instanceof ApiError)) return SIGN_IN_FAILED
  if (err.type === 'ValidationError') return opts.showValidation ? err.message : opts.blank
  return SHOWN_AS_SENT.has(err.type) ? err.message : SIGN_IN_FAILED
}

// The Google sign-in leaves the page for the provider and comes back on the
// OAuth callback, so a destination in this URL would be lost on the way. It
// rides in this tab's sessionStorage instead — safe-checked going in and
// coming out, and good for one use.
const LOGIN_NEXT_KEY = 'fc-login-next'

export function rememberLoginNext(next: string | undefined): void {
  const safe = safeLoginNext(next)
  try {
    if (safe) sessionStorage.setItem(LOGIN_NEXT_KEY, safe)
    else sessionStorage.removeItem(LOGIN_NEXT_KEY)
  } catch {
    // Storage blocked: the person lands on their landing page instead.
  }
}

/** The saved destination, left in place (a refused Google sign-in comes back
 *  to the sign-in page without `next`, and a later sign-in still needs it). */
function peekLoginNext(): string | undefined {
  try {
    return safeLoginNext(sessionStorage.getItem(LOGIN_NEXT_KEY) ?? undefined)
  } catch {
    return undefined
  }
}

export function takeLoginNext(): string | undefined {
  try {
    const stored = sessionStorage.getItem(LOGIN_NEXT_KEY)
    sessionStorage.removeItem(LOGIN_NEXT_KEY)
    return safeLoginNext(stored ?? undefined)
  } catch {
    return undefined
  }
}

// #1226: the last ID that signed in with a connected service, per service, so
// staff type only their password. Only the ID: a password never goes to storage.
const delegatedIdKey = (service: string) => `fc-delegated-id:${service}`

function rememberedDelegatedId(service: string): string {
  try {
    return localStorage.getItem(delegatedIdKey(service)) ?? ''
  } catch {
    return '' // Storage blocked: the form starts empty, as before.
  }
}

function setRememberedDelegatedId(service: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(delegatedIdKey(service), id)
    else localStorage.removeItem(delegatedIdKey(service))
  } catch {
    // Storage blocked: nothing is remembered.
  }
}

/** Go to a checked return path: a Featherbase page inside the SPA, anything
 *  else (a runtime app) by a full page load. */
export function openReturnPath(
  path: string,
  push: (path: string) => void,
  load: (path: string) => void = (p) => window.location.assign(p),
): void {
  if (path.startsWith('/featherbase/')) push(path)
  else load(path)
}

/**
 * Found on staging (10-Nov-2026): a return path the person can't open sent them to a no-access page
 * that emailed the admins. Someone who lands in an app goes there instead when the path is the
 * Admin, or an app the sign-in didn't list. Anyone who lands in the Admin keeps the path: what they
 * can't open says so there.
 */
export function returnOrLanding(path: string, user: Pick<SessionUser, 'landing' | 'apps'>): string {
  const { landing, apps } = user
  if (!landing) return path
  if (path.startsWith('/featherbase/admin')) return landing
  if (path.startsWith('/featherbase/')) return path
  // A safe return path starts with '/', so its first segment is the app.
  return apps && !apps.includes(path.split('/')[1]) ? landing : path
}

/** Go to where a signed-in person lands (#488): a Featherbase page inside the
 *  SPA, an app's root (on an app's own address) by a full page load. */
export function openLanding(
  user: SessionUser,
  push: (path: string) => void,
  load: (path: string) => void = (p) => window.location.assign(p),
): void {
  openReturnPath(landingPath(user), push, load)
}

export function LoginPage() {
  const router = useRouter()
  // From the router, not window.location: the route guard's redirect sets it.
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const urlParams = new URLSearchParams(searchStr)
  // A refused Google sign-in returns as `?error=…` without `next`; the
  // destination saved before leaving for Google stands in for it.
  const next = urlParams.get('next') ?? (urlParams.get('error') ? peekLoginNext() : undefined)
  useEffect(() => {
    // …and is written back beside the refusal, so a reload keeps it too.
    if (!next || urlParams.get('next')) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('next')) return
    url.searchParams.set('next', next)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [next]) // eslint-disable-line react-hooks/exhaustive-deps
  // SET-004: instance brand from the public /api/brand — plain fetch, not
  // api.get, so the pre-auth page never trips the 401 redirect machinery.
  const [appName, setAppName] = useState('Featherbase')
  // #380 4.2: the instance's own logo (System Settings), else the Featherbase mark.
  const [logo, setLogo] = useState<string | null>(null)
  // person-identities: the ways in an administrator has turned on (password,
  // Google, a connected service such as StyleHR), and whether sign-up is open.
  const [methods, setMethods] = useState<BrandSignInMethod[] | null>(null)
  const [signUpOpen, setSignUpOpen] = useState(false)
  // null until the person picks a way in: the page then opens on a connected
  // service's form when there is one (#380 4.2: store staff know their
  // employee ID), else on the password form.
  const [chosenMode, setMode] = useState<'password' | 'delegated' | 'signup' | null>(null)
  const [chosenKey, setDelegatedKey] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { app_name?: string; logo?: string | null; sign_in_methods?: BrandSignInMethod[]; sign_up_open?: boolean } | null) => {
        if (b?.app_name) {
          setAppName(b.app_name)
          document.title = b.app_name
        }
        setLogo(typeof b?.logo === 'string' && b.logo ? b.logo : null)
        setMethods(Array.isArray(b?.sign_in_methods) ? b.sign_in_methods : null)
        setSignUpOpen(b?.sign_up_open === true)
      })
      .catch(() => {})
  }, [])
  const delegatedMethods = (methods ?? []).filter((m) => m.kind === 'delegated_password')
  const mode = chosenMode ?? (delegatedMethods.length ? 'delegated' : 'password')
  const delegatedKey = chosenMode ? chosenKey : (delegatedMethods[0]?.key ?? null)
  const delegated = delegatedMethods.find((m) => m.key === delegatedKey) ?? null
  const delegatedLabel = delegated?.label ?? null
  // Read on each render, so "Not you?" disappears once the ID is forgotten.
  const [, refreshRemembered] = useReducer((n: number) => n + 1, 0)
  const rememberedId = delegated ? rememberedDelegatedId(delegated.key) : ''
  // If the brand cannot be read, offer Google as before; the server decides.
  const google = methods === null ? { key: 'google', label: 'Google' } : methods.find((m) => m.kind === 'google')
  // Microsoft only when the brand names it: it is offered once it is set up.
  const microsoft = methods?.find((m) => m.kind === 'microsoft')
  // Until the brand answers, and if it cannot, the password form stays.
  const passwordOn = methods === null || methods.some((m) => m.kind === 'password')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  // #474: after a refused Google sign-in the card shows a panel of next steps,
  // and no inputs, until the person picks one.
  const [refusalAnswered, setRefusalAnswered] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  // #1255: the accounts signed in on this browser. "Add another account"
  // (?add=1) and "Use another account" go straight to the form.
  const [accountList, setAccountList] = useBrowserAccounts()
  const [useAnother, setUseAnother] = useState(urlParams.get('add') === '1')
  const [prefillId, setPrefillId] = useState('')

  async function onForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await api.post('/api/reset_password_request', { usr: String(form.get('usr')) })
    setResetSent(true)
  }

  // Both sign-in forms end here: back to a safe deep link, else the landing.
  async function signIn(attempt: () => Promise<SignedIn>, blank: string, showValidation = false) {
    setError(null)
    setBusy(true)
    try {
      const user = await attempt()
      // #488: this person belongs on another address of the instance; the
      // hand-off signs them in there. It wins over a return path on this one.
      if (user.handoff) {
        takeLoginNext()
        window.location.assign(user.handoff)
        return
      }
      const returnTo = safeLoginNext(next)
      takeLoginNext() // signed in: whatever the Google round trip saved is spent
      if (returnTo) {
        openReturnPath(returnOrLanding(returnTo, user), (path) => router.history.push(path))
        return
      }
      // #465 D9: landing without a deep link, the Administrator may be asked
      // who looks after the instance.
      markSetupOffer(user)
      openLanding(user, (path) => router.history.push(path))
    } catch (err) {
      // The server's message already tells a wrong password, an unavailable
      // service and a person who has left apart; nothing raw gets through.
      setError(signInErrorText(err, { blank, showValidation }))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    answerRefusal()
    // Read from the form, not from React state, so values the browser's
    // autofill wrote into the boxes are what is sent.
    const form = new FormData(e.currentTarget)
    const usr = String(form.get('email')).trim()
    const pwd = String(form.get('password'))
    const blank = 'Enter your email or username and your password.'
    if (!usr || !pwd) {
      setError(blank)
      return
    }
    await signIn(() => login(usr, pwd), blank)
  }

  async function onDelegatedSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    answerRefusal()
    const form = new FormData(e.currentTarget)
    const id = String(form.get('delegated_id')).trim()
    const password = String(form.get('delegated_password'))
    // Nothing typed is the person's slip, not an API validation failure (#406).
    // Test mode asks the same: the page never advertises it.
    const blank = `Enter your ${delegatedLabel} ID and password.`
    if (!id || !password) {
      setError(blank)
      return
    }
    const service = delegated!.key
    // Saved only once the sign-in succeeds; a failure keeps what was there.
    await signIn(async () => {
      const user = await loginDelegated(id, password, service)
      setRememberedDelegatedId(service, id)
      return user
    }, blank)
  }

  function forgetDelegatedId() {
    if (delegated) setRememberedDelegatedId(delegated.key, null)
    setError(null)
    // The empty ID box mounts in its place and takes the cursor (autoFocus).
    refreshRemembered()
  }


  async function onSignUpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await signIn(() => signUp(String(form.get('username')).trim(), String(form.get('password'))), 'Choose a username and a password.', true)
  }

  /** The person has answered the refusal: by choosing a way in, or (#1283, as the card now shows the
   *  first page's form) by signing in with the form already open. A reload must not bring the card back:
   *  drop `error` from the address bar, keeping everything else (#474). */
  function answerRefusal() {
    if (refusal && !refusalAnswered) {
      // The card's form stays in view, not the browser's held accounts in its place, so a failed attempt's
      // message and typed values stay too (Codex round 2 on #1283).
      setUseAnother(true)
      const url = new URL(window.location.href)
      url.searchParams.delete('error')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
    setRefusalAnswered(true)
  }

  function switchMode(next: 'password' | 'delegated' | 'signup', key: string | null = null) {
    setError(null)
    setDelegatedKey(key)
    setMode(next)
    answerRefusal()
  }

  // #1255: continuing as a held account loads the page afresh, so nothing of
  // another account's page survives; otherwise as any sign-in.
  function continued(user: SignedIn) {
    const returnTo = safeLoginNext(next)
    takeLoginNext()
    if (user.handoff) return pageLoad.assign(user.handoff)
    if (returnTo) return openReturnPath(returnOrLanding(returnTo, user), pageLoad.assign, pageLoad.assign)
    openLanding(user, pageLoad.assign, pageLoad.assign)
  }

  // #1255: an account whose session ended opens the form it signed in with,
  // its ID filled in.
  function signInAgain(account: BrowserAccount) {
    setUseAnother(true)
    if (account.method_kind === 'delegated_password' && account.method) {
      setRememberedDelegatedId(account.method, account.sign_in_id)
      refreshRemembered()
      switchMode('delegated', account.method)
    } else if (account.method_kind !== 'google' && account.method_kind !== 'microsoft') {
      // Google and Microsoft sign in on their own page: the form shows their buttons.
      setPrefillId(account.sign_in_id ?? '')
      switchMode('password')
    }
  }

  // person-rename: after an upgrade every session ends once; say so plainly
  // instead of showing an unexplained sign-in page.
  const sessionEnded = new URLSearchParams(searchStr).get('ended') === '1'
  const refusalCode = useRouterState({ select: (s) => new URLSearchParams(s.location.searchStr).get('error') })
  // Which redirect sign-in refused: Microsoft's says so; anything else is Google's, as before.
  const refusedByMicrosoft = useRouterState({ select: (s) => new URLSearchParams(s.location.searchStr).get('via') === 'microsoft' })
  const refusalText = (service: string | null) =>
    refusalCode
      ? (Object.hasOwn(REFUSALS, refusalCode) ? REFUSALS[refusalCode] : REFUSALS[refusedByMicrosoft ? 'microsoft_failed' : 'google_failed'])({
          appName,
          provider: refusedByMicrosoft ? (microsoft?.label ?? 'Microsoft') : (google?.label ?? 'Google'),
          service,
        })
      : null
  // The notice names the connected service as a way in; the panel does not,
  // because its own button already says "Sign in with <service>".
  const refusal = refusalText(delegatedMethods[0]?.label ?? null)
  const panelRefusal = refusalText(null)
  const panelShowing = Boolean(refusal) && !refusalAnswered

  // #1235 item 6: a refusal is an alert at the top of the card's form, above
  // the boxes, so it is read before the person retypes anything.
  const errorLine = error && (
    <div data-testid="login-error">
      <Notice tone="negative">{error}</Notice>
    </div>
  )
  // #1235 item 4: one quiet "or" between the form's own button and the other ways in.
  const orDivider = (
    <div className="my-4 flex items-center gap-3 text-[13px] text-ink-muted" aria-hidden data-testid="sign-in-divider">
      <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
    </div>
  )

  // #1283: one panel of ways in for every place a sign-in is offered.
  const panel = (p: { without?: string | null }) => (
    <SignInPanel
      google={google}
      microsoft={microsoft}
      delegated={delegatedMethods}
      password={passwordOn}
      // A sign-in that only took too long refused no account: its buttons read as the first page's.
      failed={panelShowing && refusalCode !== 'expired' ? (refusedByMicrosoft ? 'microsoft' : 'google') : null}
      without={p.without ?? null}
      onRedirect={() => rememberLoginNext(next)}
      onDelegated={(key) => switchMode('delegated', key)}
      onPassword={() => switchMode('password')}
    />
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          {logo ? (
            // Decorative: the name under it already says whose page this is.
            // A logo that will not load (a deleted file) falls back to the mark.
            <img src={logo} alt="" data-testid="login-logo" className="max-h-16 max-w-48 object-contain" onError={() => setLogo(null)} />
          ) : (
            <span data-testid="login-mark">
              <Logo className="h-11 w-11 rounded-xl shadow-sm" />
            </span>
          )}
          <h1 className="text-lg font-semibold text-ink">{appName}</h1>
          {/* The refusal panel's own heading takes the subtitle's place. */}
          {/* #1235 item 2: a connected service's form names itself on its button. */}
          {!panelShowing && !(mode === 'delegated' && delegatedLabel) && <p className="text-sm text-ink-muted" data-testid="login-subtitle">
            {mode === 'signup' ? 'Create an account' : 'Sign in to your account'}
          </p>}
        </div>
        {sessionEnded && (
          <p className="mb-3 text-center text-sm text-ink-muted" data-testid="session-ended">
            Your session has ended. Please sign in again.
          </p>
        )}
        {refusal && refusalAnswered && (
          <div className="mb-3" data-testid="sign-in-refused">
            <Notice tone="caution">{refusal}</Notice>
          </div>
        )}
        <div className={panelClasses('p-6')}>
          {!panelShowing && !useAnother && accountList === null ? (
            <p className="text-sm text-ink-muted" data-testid="accounts-loading">Loading…</p>
          ) : !panelShowing && accountList?.accounts.length && (!useAnother || accountList.full) ? (
            // #1255 D5: a full list is shown even to "add another", removing first.
            <AccountChooser
              startRemoving={useAnother && accountList.full}
              list={accountList}
              onList={setAccountList}
              onSignedIn={continued}
              onSignInAgain={signInAgain}
              onUseAnother={() => setUseAnother(true)}
            />
          ) : (
          <>
          {/* #1283 (UI owner, 18-Nov-2026): the card is its message above exactly the first page: the same form,
              the same "or", the same ways in, the failed one reading "Try another … account". */}
          {panelShowing && (
            <div className="mb-5 space-y-2" data-testid="sign-in-refused-panel">
              <h2 className="text-base font-semibold text-ink">We couldn't sign you in</h2>
              <p className="text-sm text-ink-muted" data-testid="sign-in-refused">{panelRefusal}</p>
            </div>
          )}
          {mode === 'delegated' && delegatedLabel ? (
            <>
              <form className="space-y-4" data-testid="delegated-login-form" onSubmit={onDelegatedSubmit}>
                {errorLine}
                {rememberedId ? (
                  // #1235 item 1: a remembered ID reads as who is signing in, not
                  // as a box to edit. The hidden username box stays in the form so
                  // the browser's password manager files the password under it.
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3" data-testid="delegated-signing-in-as">
                    <p className="text-sm text-ink">
                      Signing in as <strong className="font-semibold">{rememberedId}</strong>
                    </p>
                    <input key={rememberedId} type="text" name="delegated_id" autoComplete="username" defaultValue={rememberedId} readOnly hidden />
                    <button
                      type="button"
                      data-testid="delegated-forget-id"
                      className="inline-flex min-h-control items-center text-sm text-action hover:underline"
                      onClick={forgetDelegatedId}
                    >
                      Not you?
                    </button>
                  </div>
                ) : (
                  <div>
                    <label className={labelClasses()} htmlFor="delegated-id">{`${delegatedLabel} ID`}</label>
                    {/* Keyed by service, so each service's box starts empty for its own ID. */}
                    <input
                      key={delegated?.key}
                      id="delegated-id"
                      type="text"
                      name="delegated_id"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                      aria-describedby="delegated-id-help"
                      className={inputClasses()}
                    />
                    {/* #1235 item 3: help text belongs to the box it explains. */}
                    <p id="delegated-id-help" className="mt-1 text-[13px] text-ink-muted" data-testid="delegated-id-help">
                      Use the same ID and password you use for {delegatedLabel}.
                    </p>
                  </div>
                )}
                <div>
                  <label className={labelClasses()} htmlFor="delegated-password">Password</label>
                  <input
                    key={`${delegated?.key}:${rememberedId ? 'known' : 'typed'}`}
                    id="delegated-password"
                    type="password"
                    name="delegated_password"
                    autoComplete="current-password"
                    autoFocus={Boolean(rememberedId)}
                    className={inputClasses()}
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  data-testid="delegated-login-submit"
                  className={buttonClasses({ variant: 'primary', className: 'w-full justify-center py-2' })}
                >
                  {busy ? 'Signing in…' : `Sign in with ${delegatedLabel}`}
                </button>
              </form>
              {hasOtherWays({ google, microsoft, delegated: delegatedMethods, password: passwordOn, without: delegated?.key }) && orDivider}
              {/* The other ways in, one tap away under the service's form (#1283: the one shared panel). */}
              {panel({ without: delegated?.key ?? null })}
            </>
          ) : mode === 'signup' && signUpOpen ? (
            <>
              <form className="space-y-4" data-testid="sign-up-form" onSubmit={onSignUpSubmit}>
                {errorLine}
                <Field label="Username">
                  <TextInput id="signup-username" name="username" autoComplete="username"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                </Field>
                <Field label="Password">
                  <TextInput id="signup-password" type="password" name="password" autoComplete="new-password" />
                </Field>
                <Button type="submit" variant="primary" block loading={busy} data-testid="sign-up-submit">
                  Create account
                </Button>
              </form>
              <Button variant="quiet" className="mt-4" onClick={() => switchMode('password')}>
                I already have an account
              </Button>
            </>
          ) : (
          <>
          {passwordOn && (
          <form className="space-y-4" data-testid="login-form" onSubmit={onSubmit}>
            {errorLine}
            <div>
              <label className={labelClasses()} htmlFor="login-email">Email or username</label>
              <input
                id="login-email"
                key={prefillId}
                defaultValue={prefillId}
                type="text"
                name="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={inputClasses()}
              />
            </div>
            <div>
              <label className={labelClasses()} htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                className={inputClasses()}
              />
            </div>
            <button type="submit" disabled={busy} data-testid="login-submit" className={buttonClasses({ variant: 'primary', className: 'w-full justify-center py-2' })}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          )}
          {passwordOn && hasOtherWays({ google, microsoft, delegated: delegatedMethods, password: passwordOn, without: 'password' }) && orDivider}
          {/* #1283: the one shared panel of ways in, less the password form shown above it. */}
          {panel({ without: passwordOn ? 'password' : null })}
          {signUpOpen && (
            <Button variant="quiet" className="mt-3" data-testid="sign-up-toggle" onClick={() => switchMode('signup')}>
              Create an account
            </Button>
          )}
          <div className="mt-4 border-t border-border pt-4">
            {!forgot ? (
              <button
                type="button"
                className="inline-flex min-h-control items-center text-sm text-action hover:underline"
                data-testid="forgot-password"
                onClick={() => setForgot(true)}
              >
                Forgot password?
              </button>
            ) : resetSent ? (
              <p className="text-sm text-ink-muted" data-testid="reset-sent">
                If that account exists, a reset link has been emailed.
              </p>
            ) : (
              <form className="space-y-3" data-testid="forgot-form" onSubmit={onForgot}>
                {delegatedMethods.length > 0 && (
                  <p className="text-sm text-ink-muted" data-testid="forgot-delegated-hint">
                    {delegatedMethods.map((m) => `${m.label} users reset their password in ${m.label}.`).join(' ')}
                  </p>
                )}
                <label className={labelClasses()} htmlFor="forgot-usr">Email or username</label>
                <input id="forgot-usr" type="text" name="usr" autoComplete="username" className={inputClasses()} data-testid="forgot-usr" />
                <button type="submit" className={buttonClasses({ className: 'w-full justify-center py-2' })} data-testid="forgot-submit">
                  Send reset link
                </button>
              </form>
            )}
          </div>
          </>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  )
}
