import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { buttonClasses, cardClasses, inputClasses, labelClasses } from './ui'

// #72: change the signed-in person's own password. Posts { password } to
// /api/set_password (the endpoint scopes to the caller when no user is given).
// Mirrors the ResetPassword page's form: card, label and input recipes, a
// client-side confirm check, then a success state. #489: opened from the
// Sign-in methods page, where a person manages how they sign in.
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const pw = String(form.get('password') ?? '')
    const confirm = String(form.get('confirm') ?? '')
    if (!pw) {
      setError('Password is required')
      return
    }
    if (pw !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/set_password', { password: pw })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/40 px-4"
      data-testid="change-password-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={cardClasses('w-full max-w-sm p-6')} role="dialog" aria-modal="true" aria-label="Change password">
        <h2 className="mb-4 text-base font-semibold text-ink">Change password</h2>
        {done ? (
          <div className="space-y-4" data-testid="change-password-done">
            <p className="text-sm text-ink">Your password has been updated.</p>
            <button
              type="button"
              onClick={onClose}
              className={buttonClasses({ variant: 'primary', className: 'w-full justify-center py-2' })}
              data-testid="change-password-close"
            >
              Done
            </button>
          </div>
        ) : (
          <form className="space-y-4" data-testid="change-password-form" onSubmit={onSubmit}>
            <div>
              <label className={labelClasses()} htmlFor="account-new-password">
                New password
              </label>
              <input
                id="account-new-password"
                type="password"
                name="password"
                autoComplete="new-password"
                autoFocus
                className={inputClasses()}
                data-testid="change-password-new"
              />
            </div>
            <div>
              <label className={labelClasses()} htmlFor="account-confirm-password">
                Confirm password
              </label>
              <input
                id="account-confirm-password"
                type="password"
                name="confirm"
                autoComplete="new-password"
                className={inputClasses()}
                data-testid="change-password-confirm"
              />
            </div>
            {error && (
              <p className="text-sm text-negative" data-testid="change-password-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={buttonClasses()} data-testid="change-password-cancel">
                Cancel
              </button>
              <button type="submit" disabled={busy} className={buttonClasses({ variant: 'primary' })} data-testid="change-password-submit">
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
