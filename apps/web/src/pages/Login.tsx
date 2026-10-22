import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { APP_ROOT_PATTERN } from 'shared'
import { ApiError, api, landingPath, login, loginDelegated, signUp, type BrandSignInMethod, type SessionUser } from '../lib/api'
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

export function LoginPage() {
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
  // Test mode (#3783): the server skips the provider, so there is no password to ask for.
  const delegatedTestMode = delegated?.test_mode === true
  // If the brand cannot be read, offer Google as before; the server decides.
  const google = methods === null ? { key: 'google', label: 'Google' } : methods.find((m) => m.kind === 'google')
  // Until the brand answers, and if it cannot, the password form stays.
  const passwordOn = methods === null || methods.some((m) => m.kind === 'password')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function onForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await api.post('/api/reset_password_request', { usr: String(form.get('usr')) })
    setResetSent(true)
  }

  // Both sign-in forms end here: back to a safe deep link, else the landing.
  async function signIn(attempt: () => Promise<SessionUser>) {
    setError(null)
    setBusy(true)
    try {
      const user = await attempt()
      const returnTo = safeLoginNext(new URLSearchParams(window.location.search).get('next') ?? undefined)
      if (returnTo) {
        window.location.assign(returnTo)
        return
      }
      navigate({ to: landingPath(user) })
    } catch (err) {
      // The server's message already tells a wrong password, an unavailable
      // service and a person who has left apart.
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await signIn(() => login(String(form.get('email')), String(form.get('password'))))
  }

  async function onDelegatedSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await signIn(() =>
      loginDelegated(
        String(form.get('delegated_id')),
        String(form.get('delegated_password') ?? ''),
        delegatedMethods.length > 1 ? delegated?.key : undefined,
      ),
    )
  }

  async function onSignUpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await signIn(() =>
      signUp(String(form.get('username')).trim(), String(form.get('password')), String(form.get('full_name') ?? '').trim() || undefined),
    )
  }

  function switchMode(next: 'password' | 'delegated' | 'signup', key: string | null = null) {
    setError(null)
    setDelegatedKey(key)
    setMode(next)
  }

  const errorLine = error && (
    <p className="text-sm text-[var(--color-danger)]" data-testid="login-error">
      {error}
    </p>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo className="h-11 w-11 rounded-xl shadow-sm" />
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">{appName}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {mode === 'delegated' && delegatedLabel ? `Sign in with ${delegatedLabel}` : mode === 'signup' ? 'Create an account' : 'Sign in to your account'}
          </p>
        </div>
        <div className="fc-card p-6">
          {mode === 'delegated' && delegatedLabel ? (
            <>
              <form className="space-y-4" data-testid="delegated-login-form" onSubmit={onDelegatedSubmit}>
                {delegatedTestMode ? (
                  <p role="status" data-testid="delegated-test-mode"
                    className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Test mode: {delegatedLabel} is not asked. Enter an employee code (e.g. RR-6761) to open that person's view — no password needed.
                  </p>
                ) : (
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    Use the same ID and password you use for {delegatedLabel}.
                  </p>
                )}
                <div>
                  <label className="fc-label" htmlFor="delegated-id">{delegatedTestMode ? 'Employee code' : `${delegatedLabel} ID`}</label>
                  <input
                    id="delegated-id"
                    type="text"
                    name="delegated_id"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="fc-input"
                  />
                </div>
                {!delegatedTestMode && <div>
                  <label className="fc-label" htmlFor="delegated-password">Password</label>
                  <input
                    id="delegated-password"
                    type="password"
                    name="delegated_password"
                    autoComplete="current-password"
                    className="fc-input"
                  />
                </div>}
                {errorLine}
                <button
                  type="submit"
                  disabled={busy}
                  data-testid="delegated-login-submit"
                  className="fc-btn-primary w-full justify-center py-2"
                >
                  {busy ? 'Signing in…' : `Sign in with ${delegatedLabel}`}
                </button>
              </form>
              {passwordOn && (
                <button
                  type="button"
                  data-testid="password-login-toggle"
                  className="mt-4 text-sm text-[var(--color-brand)] hover:underline"
                  onClick={() => switchMode('password')}
                >
                  Use email and password instead
                </button>
              )}
            </>
          ) : mode === 'signup' && signUpOpen ? (
            <>
              <form className="space-y-4" data-testid="sign-up-form" onSubmit={onSignUpSubmit}>
                <div>
                  <label className="fc-label" htmlFor="signup-username">Username</label>
                  <input id="signup-username" type="text" name="username" autoComplete="username"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false} className="fc-input" />
                </div>
                <div>
                  <label className="fc-label" htmlFor="signup-full-name">Your name</label>
                  <input id="signup-full-name" type="text" name="full_name" autoComplete="name" className="fc-input" />
                </div>
                <div>
                  <label className="fc-label" htmlFor="signup-password">Password</label>
                  <input id="signup-password" type="password" name="password" autoComplete="new-password" className="fc-input" />
                </div>
                {errorLine}
                <button type="submit" disabled={busy} data-testid="sign-up-submit" className="fc-btn-primary w-full justify-center py-2">
                  {busy ? 'Creating…' : 'Create account'}
                </button>
              </form>
              <button type="button" className="mt-4 text-sm text-[var(--color-brand)] hover:underline" onClick={() => switchMode('password')}>
                I already have an account
              </button>
            </>
          ) : (
          <>
          {passwordOn && (
          <form className="space-y-4" data-testid="login-form" onSubmit={onSubmit}>
            <div>
              <label className="fc-label" htmlFor="login-email">Email or username</label>
              <input
                id="login-email"
                type="text"
                name="email"
                autoComplete="username"
                placeholder="Administrator"
                className="fc-input"
              />
            </div>
            <div>
              <label className="fc-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="fc-input"
              />
            </div>
            {errorLine}
            <button type="submit" disabled={busy} className="fc-btn-primary w-full justify-center py-2">
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
              data-testid="google-login"
              className="fc-btn mt-3 flex w-full justify-center py-2"
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
              className="fc-btn mt-3 flex w-full justify-center py-2"
              onClick={() => switchMode('delegated', m.key)}
            >
              Sign in with {m.label}
            </button>
          ))}
          {signUpOpen && (
            <button
              type="button"
              data-testid="sign-up-toggle"
              className="mt-3 text-sm text-[var(--color-brand)] hover:underline"
              onClick={() => switchMode('signup')}
            >
              Create an account
            </button>
          )}
          <div className="mt-4 border-t border-[var(--color-border)] pt-4">
            {!forgot ? (
              <button
                type="button"
                className="text-sm text-[var(--color-brand)] hover:underline"
                data-testid="forgot-password"
                onClick={() => setForgot(true)}
              >
                Forgot password?
              </button>
            ) : resetSent ? (
              <p className="text-sm text-[var(--color-ink-muted)]" data-testid="reset-sent">
                If that account exists, a reset link has been emailed.
              </p>
            ) : (
              <form className="space-y-3" data-testid="forgot-form" onSubmit={onForgot}>
                {delegatedMethods.length > 0 && (
                  <p className="text-xs text-[var(--color-ink-muted)]" data-testid="forgot-delegated-hint">
                    {delegatedMethods.map((m) => `${m.label} users reset their password in ${m.label}.`).join(' ')}
                  </p>
                )}
                <label className="fc-label">Email or username</label>
                <input type="text" name="usr" className="fc-input" data-testid="forgot-usr" />
                <button type="submit" className="fc-btn w-full justify-center py-2" data-testid="forgot-submit">
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
