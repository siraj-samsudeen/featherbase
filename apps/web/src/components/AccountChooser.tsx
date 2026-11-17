// #1255: "Choose an account" — the sign-in page's list of the accounts signed
// in on this browser (Siraj's pick A, 17-Nov-2026). One click continues as a
// live one; an ended one says why and offers Sign in with its ID filled in.
import { useEffect, useState } from 'react'
import { Notice, buttonClasses } from '@featherbase/shop-floor'
import { browserAccounts, type BrowserAccount, type BrowserAccounts, type SignedIn } from '../lib/api'

/** "2 hours ago", from seconds since the epoch. */
export function lastUsedText(seconds: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now / 1000 - seconds) / 60))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** Initials from a person's name or ID, never from the opaque `psn_…` id. */
export function accountInitials(account: Pick<BrowserAccount, 'name' | 'sign_in_id'>): string {
  return (account.name || account.sign_in_id || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
}

/** How the account signed in, as a person reads it: "StyleHR · EMP0412". */
export function accountWayIn(account: BrowserAccount): string {
  return [account.method_label, account.sign_in_id].filter(Boolean).join(' · ')
}

export function AccountAvatar({ account, size = 'size-8' }: { account: BrowserAccount; size?: string }) {
  return (
    <span aria-hidden="true" className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-action text-xs font-semibold text-action-ink`}>
      {accountInitials(account)}
    </span>
  )
}

export function useBrowserAccounts() {
  const [list, setList] = useState<BrowserAccounts | null>(null)
  useEffect(() => {
    let live = true
    browserAccounts.list().then((l) => { if (live) setList(l) }, () => { if (live) setList({ accounts: [], full: false }) })
    return () => { live = false }
  }, [])
  return [list, setList] as const
}

export function AccountChooser({ list, onList, onSignedIn, onSignInAgain, onUseAnother }: {
  list: BrowserAccounts
  onList: (list: BrowserAccounts) => void
  onSignedIn: (user: SignedIn) => void
  onSignInAgain: (account: BrowserAccount) => void
  onUseAnother: () => void
}) {
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastUsed = list.accounts.find((a) => a.state === 'live')?.session

  async function choose(account: BrowserAccount) {
    setError(null)
    setBusy(account.session)
    try {
      onSignedIn(await browserAccounts.switchTo(account.session))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't continue as that account. Try again.")
      onList(await browserAccounts.list().catch(() => list))
    } finally {
      setBusy(null)
    }
  }

  async function remove(account: BrowserAccount) {
    setError(null)
    setBusy(account.session)
    try {
      const next = await browserAccounts.remove(account.session)
      onList(next)
      if (!next.accounts.length) onUseAnother()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that account. Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4" data-testid="account-chooser">
      <div>
        <h2 className="text-base font-semibold text-ink">Choose an account</h2>
        <p className="text-sm text-ink-muted">Signed in on this browser</p>
      </div>
      {error && <Notice tone="negative">{error}</Notice>}
      <ul className="space-y-2">
        {list.accounts.map((account) => {
          const way = accountWayIn(account)
          const live = account.state === 'live'
          const details = (
            <>
              <AccountAvatar account={account} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">
                  <span className="truncate">{account.name ?? account.sign_in_id}</span>
                  {account.session === lastUsed && (
                    <span className="rounded-full bg-positive-tint px-2 text-[11px] font-semibold text-positive">Last used</span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {live ? [way, lastUsedText(account.last_used)].filter(Boolean).join(' · ') : account.reason_text}
                </span>
              </span>
            </>
          )
          return (
            <li key={account.session} data-testid="account-choice" className="flex items-center gap-2">
              {live && !removing ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void choose(account)}
                  aria-label={`${account.name ?? account.sign_in_id}${way ? `, ${way}` : ''}: continue`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:border-action hover:bg-action-tint focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {details}
                  <span className="text-xs font-semibold text-action">Continue</span>
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border px-3 py-2">
                  {details}
                  {!removing && (
                    <button type="button" onClick={() => onSignInAgain(account)} className="text-xs font-semibold text-action hover:underline">
                      Sign in
                    </button>
                  )}
                </div>
              )}
              {removing && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void remove(account)}
                  aria-label={`Remove ${account.name ?? account.sign_in_id}`}
                  className={buttonClasses({ variant: 'secondary', className: 'shrink-0' })}
                >
                  Remove
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {list.full && (
        <p className="text-xs text-ink-muted" data-testid="accounts-full">
          This browser holds 5 accounts, the most it can. Remove one to add another.
        </p>
      )}
      <button
        type="button"
        data-testid="use-another-account"
        disabled={list.full}
        onClick={onUseAnother}
        className={buttonClasses({ variant: 'secondary', className: 'w-full justify-center py-2' })}
      >
        Use another account
      </button>
      <button
        type="button"
        data-testid="remove-accounts"
        onClick={() => setRemoving((r) => !r)}
        className="block text-sm text-action hover:underline"
      >
        {removing ? 'Done removing' : 'Remove an account from this list'}
      </button>
    </div>
  )
}
