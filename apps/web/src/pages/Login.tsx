import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ApiError, login } from '../lib/api'

export function LoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const form = new FormData(e.currentTarget)
    try {
      await login(String(form.get('email')), String(form.get('password')))
      navigate({ to: '/desk' })
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
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-brand)] text-lg font-bold text-white shadow-sm">
            F
          </span>
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">Frappe Clone</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">Sign in to your account</p>
        </div>
        <div className="fc-card p-6">
          <form className="space-y-4" data-testid="login-form" onSubmit={onSubmit}>
            <div>
              <label className="fc-label">Email or username</label>
              <input
                type="text"
                name="email"
                autoComplete="username"
                placeholder="Administrator"
                className="fc-input"
              />
            </div>
            <div>
              <label className="fc-label">Password</label>
              <input
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
        </div>
      </div>
    </div>
  )
}
