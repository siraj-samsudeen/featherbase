import { useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { ApiError, api } from '../lib/api'

// SET-002: the target of the emailed reset link. Reads ?key= and sets a new
// password for the associated account.
export function ResetPasswordPage() {
  const { key } = useSearch({ from: '/reset-password' }) as { key?: string }
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const pw = String(form.get('password'))
    const confirm = String(form.get('confirm'))
    if (pw !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/reset_password', { key, new_password: pw })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password')
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
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">Reset password</h1>
        </div>
        <div className="fc-card p-6">
          {done ? (
            <div className="space-y-4 text-center" data-testid="reset-done">
              <p className="text-sm text-[var(--color-ink)]">Your password has been reset.</p>
              <Link to="/login" className="fc-btn-primary inline-flex w-full justify-center py-2" data-testid="reset-to-login">
                Sign in
              </Link>
            </div>
          ) : !key ? (
            <p className="text-sm text-[var(--color-danger)]" data-testid="reset-error">
              This reset link is missing its key.
            </p>
          ) : (
            <form className="space-y-4" data-testid="reset-form" onSubmit={onSubmit}>
              <div>
                <label className="fc-label">New password</label>
                <input type="password" name="password" autoComplete="new-password" className="fc-input" data-testid="reset-password" />
              </div>
              <div>
                <label className="fc-label">Confirm password</label>
                <input type="password" name="confirm" autoComplete="new-password" className="fc-input" data-testid="reset-confirm" />
              </div>
              {error && (
                <p className="text-sm text-[var(--color-danger)]" data-testid="reset-error">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className="fc-btn-primary w-full justify-center py-2" data-testid="reset-submit">
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
