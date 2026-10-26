import { useEffect, useState } from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { APP_ROOT_PATTERN } from 'shared'
import { ApiError, api, landingPath, login, loginDelegated, signUp, type BrandSignInMethod, type SessionUser } from '../lib/api'
import { Button, Field, Notice, TextInput, buttonClasses, cardClasses, inputClasses, labelClasses } from '../components/ui'
import { Logo } from '../components/Logo'

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

// A refused browser sign-in (the Google callback) comes back as
// `?error=<code>`. Only these codes are explained; anything else reads as the
// generic failure, and the query text itself is never shown.
const REFUSALS: Record<string, (p: { appName: string; google: string; service: string | null }) => string> = {
  not_provisioned: ({ appName, google, service }) =>
    `This ${google} account isn't set up for ${appName}. Ask your manager or IT to invite you${service ? `, or sign in with ${service}.` : '.'}`,
  not_allowed: ({ google }) => `This account can't sign in with ${google}. Ask your manager or IT for help.`,
  address_in_use: ({ google }) => `Another account already uses this ${google} account's email address. Ask your manager or IT to link it for you.`,
  google_off: ({ google }) => `${google} sign-in isn't available right now. Use another way to sign in.`,
  expired: () => 'The sign-in took too long or was started in another window. Please try again.',
  google_failed: ({ google }) => `${google} sign-in didn't finish. Please try again.`,
}

// #474: "Try another Google account" restarts Google sign-in with the account
// picker forced, so the account just refused is never silently reused.
export const GOOGLE_RETRY_HREF = '/api/oauth/google/login?prompt=select_account'

const SIGN_IN_FAILED = 'Sign-in failed. Please try again.'
// Server messages a person may read as they are: refusals the server already
// words for people (a wrong password, an outage, someone who has left).
const SHOWN_AS_SENT = new Set(['AuthenticationError', 'PermissionError', 'ServiceUnavailableError', 'ConflictError', 'RateLimitError'])

/** What the page says about a failed sign-in. A validation message from the
 *  server is a request shape ("Expected { usr, pwd }"), never shown on the
 *  sign-in forms; sign-up's validation messages are worded for people. */
export function signInErrorText(err: unknown, opts: { blank: string; showValidation?: boolean }): string {
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

export function takeLoginNext(): string | undefined {
  try {
    const stored = sessionStorage.getItem(LOGIN_NEXT_KEY)
    sessionStorage.removeItem(LOGIN_NEXT_KEY)
    return safeLoginNext(stored ?? undefined)
  } catch {
    return undefined
  }
}

/** Go to a checked return path: a Featherbase page inside the SPA, anything
 *  else (a runtime app) by a full page load. */
export function openReturnPath(path: string, push: (path: string) => void): void {
  if (path.startsWith('/featherbase/')) push(path)
  else window.location.assign(path)
}

export function LoginPage() {
  const router = useRouter()
  // From the router, not window.location: the route guard's redirect sets it.
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const next = new URLSearchParams(searchStr).get('next') ?? undefined
  const navigate = useNavigate()
  // SET-004: instance brand from the public /api/brand — plain fetch, not
  // api.get, so the pre-auth page never trips the 401 redirect machinery.
  const [appName, setAppName] = useState('Featherbase')
  // person-identities: the ways in an administrator has turned on (password,
  // Google, a connected service such as StyleHR), and whether sign-up is open.
  const [methods, setMethods] = useState<BrandSignInMethod[] | null>(null)
  const [signUpOpen, setSignUpOpen] = useState(false)
  const [mode, setMode] = useState<'password' | 'delegated' | 'signup'>('password')
  const [delegatedKey, setDelegatedKey] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { app_name?: string; sign_in_methods?: BrandSignInMethod[]; sign_up_open?: boolean } | null) => {
        if (b?.app_name) {
          setAppName(b.app_name)
          document.title = b.app_name
        }
        setMethods(Array.isArray(b?.sign_in_methods) ? b.sign_in_methods : null)
        setSignUpOpen(b?.sign_up_open === true)
      })
      .catch(() => {})
  }, [])
  const delegatedMethods = (methods ?? []).filter((m) => m.kind === 'delegated_password')
  const delegated = delegatedMethods.find((m) => m.key === delegatedKey) ?? null
  const delegatedLabel = delegated?.label ?? null
  // If the brand cannot be read, offer Google as before; the server decides.
  const google = methods === null ? { key: 'google', label: 'Google' } : methods.find((m) => m.kind === 'google')
  // Until the brand answers, and if it cannot, the password form stays.
  const passwordOn = methods === null || methods.some((m) => m.kind === 'password')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  // #474: after a refused Google sign-in the card shows a panel of next steps,
  // and no inputs, until the person picks one.
  const [refusalAnswered, setRefusalAnswered] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function onForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await api.post('/api/reset_password_request', { usr: String(form.get('usr')) })
    setResetSent(true)
  }

  // Both sign-in forms end here: back to a safe deep link, else the landing.
  async function signIn(attempt: () => Promise<SessionUser>, blank: string, showValidation = false) {
    setError(null)
    setBusy(true)
    try {
      const user = await attempt()
      const returnTo = safeLoginNext(next)
      if (returnTo) {
        openReturnPath(returnTo, (path) => router.history.push(path))
        return
      }
      navigate({ to: landingPath(user) })
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
    // Read from the form, not from React state, so values the browser's
    // autofill wrote into the boxes are what is sent.
    const form = new FormData(e.currentTarget)
    const usr = String(form.get('email') ?? '').trim()
    const pwd = String(form.get('password') ?? '')
    const blank = 'Enter your email or username and your password.'
    if (!usr || !pwd) {
      setError(blank)
      return
    }
    await signIn(() => login(usr, pwd), blank)
  }

  async function onDelegatedSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const id = String(form.get('delegated_id') ?? '').trim()
    const password = String(form.get('delegated_password') ?? '')
    // Nothing typed is the person's slip, not an API validation failure (#406).
    // Test mode asks the same: the page never advertises it.
    const blank = `Enter your ${delegatedLabel} ID and password.`
    if (!id || !password) {
      setError(blank)
      return
    }
    await signIn(() => loginDelegated(id, password, delegated!.key), blank)
  }

  async function onSignUpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await signIn(() => signUp(String(form.get('username')).trim(), String(form.get('password'))), 'Choose a username and a password.', true)
  }

  function switchMode(next: 'password' | 'delegated' | 'signup', key: string | null = null) {
    setError(null)
    setDelegatedKey(key)
    setMode(next)
    if (refusal && !refusalAnswered) {
      // Once the person has chosen, a reload must not bring the panel back:
      // drop `error` from the address bar, keeping everything else (#474).
      const url = new URL(window.location.href)
      url.searchParams.delete('error')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
    setRefusalAnswered(true)
  }

  // person-rename: after an upgrade every session ends once; say so plainly
  // instead of showing an unexplained sign-in page.
  const sessionEnded = new URLSearchParams(searchStr).get('ended') === '1'
  const refusalCode = useRouterState({ select: (s) => new URLSearchParams(s.location.searchStr).get('error') })
  const refusalText = (service: string | null) =>
    refusalCode
      ? (Object.hasOwn(REFUSALS, refusalCode) ? REFUSALS[refusalCode] : REFUSALS.google_failed)({
          appName,
          google: google?.label ?? 'Google',
          service,
        })
      : null
  // The notice names the connected service as a way in; the panel does not,
  // because its own button already says "Sign in with <service>".
  const refusal = refusalText(delegatedMethods[0]?.label ?? null)
  const panelRefusal = refusalText(null)
  const panelShowing = Boolean(refusal) && !refusalAnswered

  const errorLine = error && (
    <p className="text-sm text-negative" data-testid="login-error">
      {error}
    </p>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo className="h-11 w-11 rounded-xl shadow-sm" />
          <h1 className="text-lg font-semibold text-ink">{appName}</h1>
          {/* The refusal panel's own heading takes the subtitle's place. */}
          {!panelShowing && <p className="text-sm text-ink-muted" data-testid="login-subtitle">
            {mode === 'delegated' && delegatedLabel ? `Sign in with ${delegatedLabel}` : mode === 'signup' ? 'Create an account' : 'Sign in to your account'}
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
        <div className={cardClasses('p-6')}>
          {panelShowing ? (
            <div className="space-y-5" data-testid="sign-in-refused-panel">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-ink">We couldn't sign you in</h2>
                <p className="text-sm text-ink-muted" data-testid="sign-in-refused">{panelRefusal}</p>
              </div>
              <div className="space-y-3">
                {delegatedMethods[0] && (
                  <button
                    type="button"
                    data-testid="refused-delegated"
                    className={buttonClasses({ variant: 'primary', className: 'w-full justify-center py-2' })}
                    onClick={() => switchMode('delegated', delegatedMethods[0].key)}
                  >
                    Sign in with {delegatedMethods[0].label}
                  </button>
                )}
                {/* A full-page navigation, as the ordinary Google button is. */}
                {google && (
                  <a
                    href={GOOGLE_RETRY_HREF}
                    data-testid="refused-google-retry"
                    className={buttonClasses({ variant: delegatedMethods[0] ? 'secondary' : 'primary', className: 'w-full justify-center py-2' })}
                  >
                    Try another {google.label} account
                  </a>
                )}
              </div>
              <button
                type="button"
                data-testid="refused-other-ways"
                className="inline-flex min-h-10 items-center text-sm text-action hover:underline"
                onClick={() => switchMode('password')}
              >
                Other ways to sign in
              </button>
            </div>
          ) : mode === 'delegated' && delegatedLabel ? (
            <>
              <form className="space-y-4" data-testid="delegated-login-form" onSubmit={onDelegatedSubmit}>
                <p className="text-sm text-ink-muted">
                  Use the same ID and password you use for {delegatedLabel}.
                </p>
                <div>
                  <label className={labelClasses()} htmlFor="delegated-id">{`${delegatedLabel} ID`}</label>
                  <input
                    id="delegated-id"
                    type="text"
                    name="delegated_id"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={inputClasses()}
                  />
                </div>
                <div>
                  <label className={labelClasses()} htmlFor="delegated-password">Password</label>
                  <input
                    id="delegated-password"
                    type="password"
                    name="delegated_password"
                    autoComplete="current-password"
                    className={inputClasses()}
                  />
                </div>
                {errorLine}
                <button
                  type="submit"
                  disabled={busy}
                  data-testid="delegated-login-submit"
                  className={buttonClasses({ variant: 'primary', className: 'w-full justify-center py-2' })}
                >
                  {busy ? 'Signing in…' : `Sign in with ${delegatedLabel}`}
                </button>
              </form>
              {passwordOn && (
                <button
                  type="button"
                  data-testid="password-login-toggle"
                  className="mt-4 text-sm text-action hover:underline"
                  onClick={() => switchMode('password')}
                >
                  Use email and password instead
                </button>
              )}
            </>
          ) : mode === 'signup' && signUpOpen ? (
            <>
              <form className="space-y-4" data-testid="sign-up-form" onSubmit={onSignUpSubmit}>
                <Field label="Username">
                  <TextInput id="signup-username" name="username" autoComplete="username"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                </Field>
                <Field label="Password">
                  <TextInput id="signup-password" type="password" name="password" autoComplete="new-password" />
                </Field>
                {errorLine}
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
            <div>
              <label className={labelClasses()} htmlFor="login-email">Email or username</label>
              <input
                id="login-email"
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
            {errorLine}
            <button type="submit" disabled={busy} data-testid="login-submit" className={buttonClasses({ variant: 'primary', className: 'w-full justify-center py-2' })}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          )}
          {/* PLAT-006: social login. A full-page navigation (not fetch) so the
              server's OAuth redirects drive the browser. Offered only when
              the Google sign-in method is on. */}
          {google && (
            <a
              href="/api/oauth/google/login"
              onClick={() => rememberLoginNext(next)}
              data-testid="google-login"
              className={buttonClasses({ className: 'mt-3 flex w-full justify-center py-2' })}
            >
              Sign in with {google.label}
            </a>
          )}
          {/* Delegated sign-in: one button per connected service (a Sign In
              Method row of kind delegated_password). */}
          {delegatedMethods.map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={delegatedMethods.length === 1 ? 'delegated-login-toggle' : `delegated-login-toggle-${m.key}`}
              className={buttonClasses({ className: 'mt-3 flex w-full justify-center py-2' })}
              onClick={() => switchMode('delegated', m.key)}
            >
              Sign in with {m.label}
            </button>
          ))}
          {signUpOpen && (
            <Button variant="quiet" className="mt-3" data-testid="sign-up-toggle" onClick={() => switchMode('signup')}>
              Create an account
            </Button>
          )}
          <div className="mt-4 border-t border-border pt-4">
            {!forgot ? (
              <button
                type="button"
                className="text-sm text-action hover:underline"
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
        </div>
      </div>
    </div>
  )
}
