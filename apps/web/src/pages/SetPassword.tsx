import { useState } from 'react'
import { Link, useRouter, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, rememberLogin, type SessionUser } from '../lib/api'
import { buttonClasses, inputClasses, labelClasses, panelClasses } from '@featherbase/shop-floor'
import { openLanding } from './Login'

// #1257: the target of a password invite. Names the account the link is for,
// sets its first password, and signs the person in.

const INVALID = 'This invitation link is invalid or has expired.'

type SignInAnswer = { token: string; user: SessionUser; landing?: string; handoff?: string; apps?: string[] }

export function SetPasswordPage() {
  const { key } = useSearch({ from: '/featherbase/set-password' }) as { key?: string }
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const invite = useQuery({
    queryKey: ['password-invite', key],
    enabled: Boolean(key),
    retry: false,
    queryFn: () => api.post<{ email: string; expires_at: string }>('/api/password_invite/check', { key }),
  })

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const pw = String(form.get('password'))
    if (pw !== String(form.get('confirm'))) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const user = rememberLogin(await api.post<SignInAnswer>('/api/password_invite/accept', { key, new_password: pw }))
      if (user.handoff) {
        window.location.assign(user.handoff)
        return
      }
      openLanding(user, (path) => router.history.push(path))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the password')
    } finally {
      setBusy(false)
    }
  }

  const refused = !key || invite.isError
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-action text-lg font-bold text-action-ink shadow-sm">
            F
          </span>
          <h1 className="text-lg font-semibold text-ink">Set your password</h1>
        </div>
        <div className={panelClasses('p-6')}>
          {refused ? (
            <div className="space-y-4" data-testid="set-password-invalid">
              <p className="text-sm text-ink">{INVALID} Ask the person who invited you to send a new one.</p>
              <Link to="/featherbase/login" className={buttonClasses({ variant: 'secondary', className: 'inline-flex w-full justify-center py-2' })}>
                Go to sign-in
              </Link>
            </div>
          ) : !invite.data ? (
            <p className="text-sm text-ink-muted">Checking the link…</p>
          ) : (
            <form className="space-y-4" data-testid="set-password-form" onSubmit={onSubmit}>
              <div>
                <label className={labelClasses()} htmlFor="set-password-email">Email</label>
                {/* Read-only, so a password manager saves the password under this address. */}
                <input id="set-password-email" name="username" type="email" autoComplete="username" readOnly value={invite.data.email} className={inputClasses('bg-canvas text-ink-muted')} />
                <p className="mt-1 text-sm text-ink-muted">You will sign in with this address.</p>
              </div>
              <div>
                <label className={labelClasses()} htmlFor="set-password-new">New password</label>
                <input id="set-password-new" type="password" name="password" autoComplete="new-password" required className={inputClasses()} />
              </div>
              <div>
                <label className={labelClasses()} htmlFor="set-password-confirm">Confirm password</label>
                <input id="set-password-confirm" type="password" name="confirm" autoComplete="new-password" required className={inputClasses()} />
              </div>
              {error && (
                <p className="text-sm text-negative" role="alert" data-testid="set-password-error">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className={buttonClasses({ variant: 'primary', className: 'w-full justify-center py-2' })}>
                {busy ? 'Saving…' : 'Set password and sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
