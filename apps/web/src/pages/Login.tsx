import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ApiError, api, login } from '../lib/api'
import { Logo } from '../components/Logo'

export function LoginPage() {
  const navigate = useNavigate()
  // SET-004: instance brand from the public /api/brand — plain fetch, not
  // api.get, so the pre-auth page never trips the 401 redirect machinery.
  const [appName, setAppName] = useState('Featherbase')
  useEffect(() => {
    fetch('/api/brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { app_name?: string } | null) => {
        if (b?.app_name) {
          setAppName(b.app_name)
          document.title = b.app_name
        }
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const form = new FormData(e.currentTarget)
    try {
      await login(String(form.get('email')), String(form.get('password')))
      navigate({ to: '/admin' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo className="h-11 w-11 rounded-xl shadow-sm" />
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">{appName}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">Sign in to your account</p>
        </div>
        <div className="fc-card p-6">
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
            {error && (
              <p className="text-sm text-[var(--color-danger)]" data-testid="login-error">
                {error}
              </p>
            )}
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
        </div>
      </div>
    </div>
  )
}
