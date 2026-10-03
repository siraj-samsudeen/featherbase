import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { APP_ROOT_PATTERN } from 'shared'
import { ApiError, api, landingPath, login, loginDelegated, type SessionUser } from '../lib/api'
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
  // Delegated sign-in: the outside service's name (e.g. StyleHR) when an
  // administrator connected one, else null and the option is not offered.
  const [delegatedLabel, setDelegatedLabel] = useState<string | null>(null)
  const [mode, setMode] = useState<'password' | 'delegated'>('password')
  // Test mode (#3783): the server skips the provider, so there is no password to ask for.
  const [delegatedTestMode, setDelegatedTestMode] = useState(false)
  useEffect(() => {
    fetch('/api/brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { app_name?: string; delegated_login_label?: string | null; delegated_login_test_mode?: boolean } | null) => {
        if (b?.app_name) {
          setAppName(b.app_name)
          document.title = b.app_name
        }
        setDelegatedLabel(b?.delegated_login_label || null)
        setDelegatedTestMode(b?.delegated_login_test_mode === true)
      })
      .catch(() => {})
  }, [])
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
    await signIn(() => loginDelegated(String(form.get('delegated_id')), String(form.get('delegated_password') ?? '')))
  }

  function switchMode(next: 'password' | 'delegated') {
    setError(null)
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
            {mode === 'delegated' && delegatedLabel ? `Sign in with ${delegatedLabel}` : 'Sign in to your account'}
          </p>
        </div>
        <div className="fc-card p-6">
          {mode === 'delegated' && delegatedLabel ? (
            <>
              <form className="space-y-4" data-testid="delegated-login-form" onSubmit={onDelegatedSubmit}>
                {delegatedTestMode ? (
                  <p role="status" data-testid="delegated-test-mode"
                    className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Test mode: {delegatedLabel} is not asked. Enter a {delegatedLabel} ID to open that person's view — no password needed.
                  </p>
                ) : (
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    Use the same ID and password you use for {delegatedLabel}.
                  </p>
                )}
                <div>
                  <label className="fc-label" htmlFor="delegated-id">{delegatedLabel} ID</label>
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
              <button
                type="button"
                data-testid="password-login-toggle"
                className="mt-4 text-sm text-[var(--color-brand)] hover:underline"
                onClick={() => switchMode('password')}
              >
                Use email and password instead
              </button>
            </>
          ) : (
          <>
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
          {/* PLAT-006: social login. A full-page navigation (not fetch) so the
              server's OAuth redirects drive the browser. */}
          <a
            href="/api/oauth/google/login"
            data-testid="google-login"
            className="fc-btn mt-3 flex w-full justify-center py-2"
          >
            Sign in with Google
          </a>
          {/* Delegated sign-in: offered only when an administrator connected
              an outside service (System Settings delegated_login_*). */}
          {delegatedLabel && (
            <button
              type="button"
              data-testid="delegated-login-toggle"
              className="fc-btn mt-3 flex w-full justify-center py-2"
              onClick={() => switchMode('delegated')}
            >
              Sign in with {delegatedLabel}
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
