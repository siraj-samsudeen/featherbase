// #1255: the Account menu's accounts (Siraj's pick A, 17-Nov-2026): the other
// accounts signed in on this browser under "Switch to", one click each;
// "+ Add another account"; "Sign out of all accounts" when there are several.
import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { browserAccounts, clearSession, landingPath, type BrowserAccount } from '../lib/api'
import { pageLoad } from '../lib/page-load'
import { flushPendingEvents } from '../lib/recents'
import { returnOrLanding } from '../pages/Login'
import { AccountAvatar, accountWayIn, useBrowserAccounts } from './AccountChooser'

const MENU_ITEM = 'flex min-h-control w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-action-tint disabled:opacity-60'

/** Where the page goes as another account: this page if they can open it, else their landing. */
function here(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function AccountSwitcherSection({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [loaded, setList] = useBrowserAccounts()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The Add row is there at once; the other accounts join when the list answers.
  const list = loaded ?? { accounts: [], full: false }
  const others = list.accounts.filter((a) => !a.active)

  async function switchTo(account: BrowserAccount) {
    setError(null)
    setBusy(true)
    try {
      // The departing account's pending page visits ride its own session.
      flushPendingEvents()
      const user = await browserAccounts.switchTo(account.session)
      onDone()
      pageLoad.assign(user.handoff ?? (here().startsWith('/featherbase/') ? returnOrLanding(here(), user) : landingPath(user)))
    } catch (err) {
      setError((err as Error).message)
      setList(await browserAccounts.list().catch(() => list))
    } finally {
      setBusy(false)
    }
  }

  async function signOutAll() {
    setBusy(true)
    flushPendingEvents()
    try {
      await browserAccounts.signOutAll()
    } catch {
      setError(t('Sign-out did not complete. Check your connection and try again.'))
      setBusy(false)
      return
    }
    clearSession()
    onDone()
    pageLoad.assign('/featherbase/login')
  }

  return (
    <div className="py-1.5" data-testid="account-switcher">
      {others.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{t('Switch to')}</p>
          {/* #1253: the menu opens near the window's foot; a long list scrolls on its own. */}
          <div className="max-h-[min(14rem,30vh)] overflow-y-auto">
          {others.map((account) => {
            const live = account.state === 'live'
            return (
              <button
                key={account.session}
                role="menuitem"
                type="button"
                disabled={busy}
                onClick={() => (live ? void switchTo(account) : (onDone(), pageLoad.assign('/featherbase/login?add=1')))}
                className={`${MENU_ITEM} py-1`}
              >
                <AccountAvatar account={account} size="size-6" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words">{account.name ?? account.sign_in_id}</span>
                  <span className="block break-words text-xs text-ink-muted">{live ? accountWayIn(account) : account.reason_text}</span>
                </span>
              </button>
            )
          })}
          </div>
        </>
      )}
      {error && <p className="px-3 py-1 text-xs text-negative" role="alert">{error}</p>}
      {list.full ? (
        <p className="px-3 py-1 text-xs text-ink-muted" data-testid="accounts-full">{t('This browser holds 5 accounts, the most it can.')}</p>
      ) : (
        <button
          role="menuitem"
          type="button"
          disabled={busy}
          data-testid="add-account"
          onClick={() => { onDone(); pageLoad.assign(`/featherbase/login?add=1&next=${encodeURIComponent(here())}`) }}
          className={`${MENU_ITEM} text-action`}
        >
          {t('+ Add another account')}
        </button>
      )}
      {others.length > 0 && (
        <button role="menuitem" type="button" disabled={busy} onClick={() => void signOutAll()} className={MENU_ITEM} data-testid="sign-out-all">
          {t('Sign out of all accounts')} ({list.accounts.length})
        </button>
      )}
    </div>
  )
}
