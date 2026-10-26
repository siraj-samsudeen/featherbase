import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ACCOUNT_SIGN_IN_METHODS_PATH, FEATHERBASE_ADMIN_DESTINATION, INTERIM_APPS, appHref } from 'shared'
import { SIGN_OUT_INCOMPLETE, api, clearSession, getSessionUser, signOut } from '../lib/api'
import { flushPendingEvents } from '../lib/recents'
import { useIsPreview, useWhoAmI } from '../lib/session'
import { THEMES, THEME_LABEL, type Theme } from '../lib/theme'
import { useThemeChoice } from '../lib/theme-choice'
import { useI18n } from '../lib/i18n'
import { Logo } from './Logo'
import { buttonClasses, cardClasses, iconButtonClasses, labelClasses, useMediaQuery } from './ui'
import { Monitor, Moon, Sun, type LucideIcon } from './ui/icons'

// #489 (design D3, "One top bar on every address"): one bar, drawn by the
// platform, on every address and every shell — the Admin screens, an app's
// pages, the Portal, the no-access page and the account pages.
//
//   left    the Featherbase mark and the name: "Featherbase Admin" on the
//           Admin address, the app's title on an app's address
//   middle  the Admin menus, on the Admin screens only (passed in)
//   right   "Open Admin" (app addresses, people who can use Admin), the theme
//           toggle, the Account menu
//
// The address picks the contents (/api/brand `opens`). A host the list does
// not name (development, test) holds everything, so there the page says
// which it belongs to (`home`).

/** Below Tailwind's `sm`: one row has room for the name and the avatar only. */
export const PHONE_QUERY = '(max-width: 639.98px)'

export const ADMIN_NAME = FEATHERBASE_ADMIN_DESTINATION.label
const ADMIN = 'admin'

interface Brand {
  app_name: string
  opens: string | null
}

function useBrand() {
  // Public, and the same for everyone on this address: a plain fetch, so a
  // signed-out moment never sends a stale token with it.
  return useQuery({
    queryKey: ['brand'],
    queryFn: async () => {
      const res = await fetch('/api/brand')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as Brand
    },
    staleTime: Infinity,
  })
}

/** What this bar stands for: `admin` or an app's name. Undefined only while
 *  the address is still being asked and the page has no home of its own. */
function useBarContext(home: string | undefined): { context?: string; brand?: Brand } {
  const brand = useBrand()
  if (brand.data) return { context: brand.data.opens ?? home ?? ADMIN, brand: brand.data }
  if (brand.isError) return { context: home ?? ADMIN }
  return { context: home }
}

function nameOf(context: string, brand: Brand | undefined): string {
  if (context === ADMIN) return ADMIN_NAME
  if (brand?.opens === context) return brand.app_name
  return INTERIM_APPS[context]?.title ?? context
}

function homeHref(context: string): string {
  if (context === ADMIN) return FEATHERBASE_ADMIN_DESTINATION.href
  return INTERIM_APPS[context]?.root ?? appHref(context)
}

export function TopBar({
  home,
  left,
  children,
  beforeRight,
  below,
}: {
  /** The page's own side when the host is unlisted: `admin` (default) or an app. */
  home?: string
  /** Replaces the name (the Admin screens draw their app switcher there). */
  left?: ReactNode
  /** The Admin menus, between the name and the right side. */
  children?: ReactNode
  /** Admin-only indicators that lead the right side (the notification bell). */
  beforeRight?: ReactNode
  /** A second row under the bar's own (the Admin command bar on a phone). */
  below?: ReactNode
}) {
  const { context, brand } = useBarContext(home)
  const name = context ? nameOf(context, brand) : undefined
  const caps = useWhoAmI().data?.capabilities
  const isPhone = useMediaQuery(PHONE_QUERY)
  const canUseAdmin = Boolean(caps && (caps.manage || caps.table_access))
  const offerAdmin = Boolean(context && context !== ADMIN && canUseAdmin)

  return (
    <>
      <PreviewBanner />
      <header
        className="flex shrink-0 items-center gap-x-1 border-b border-border bg-surface px-2 py-1 sm:gap-4 sm:px-4 md:pl-0"
        data-testid="top-bar"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none md:w-60 md:shrink-0 md:px-3" data-testid="top-bar-left">
          {left ?? (context && <BarName context={context} name={name ?? ''} />)}
        </div>
        {children ?? <div className="hidden flex-1 sm:block" aria-hidden="true" />}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-2" data-testid="top-bar-right">
          {caps && (
            <>
              {beforeRight}
              {offerAdmin && !isPhone && <OpenAdminButton />}
              {!isPhone && <ThemeToggle />}
              <AccountMenu inMenu={isPhone ? { offerAdmin } : undefined} />
            </>
          )}
        </div>
      </header>
      {below}
    </>
  )
}

// A dev-preview deployment announces itself above the bar. The link is
// shareable and the data is disposable; a visitor who does not know that may
// mistake it for the real thing, or be surprised when it is reset.
function PreviewBanner() {
  if (!useIsPreview()) return null
  return (
    <div
      data-testid="preview-banner"
      className="flex shrink-0 items-center justify-center gap-2 bg-caution-tint px-3 py-1 text-xs font-medium text-caution"
    >
      Preview deployment — data here is disposable and may be reset at any time.
    </div>
  )
}

/** The mark and the name, linking to this address's home. One line; a long
 *  name is cut with an ellipsis rather than wrapped. */
function BarName({ context, name }: { context: string; name: string }) {
  const href = homeHref(context)
  return (
    <a
      href={href}
      className="flex min-h-control min-w-0 items-center gap-2 rounded-control focus-visible:outline-2 focus-visible:outline-focus max-sm:min-h-11"
      data-testid="top-bar-name"
    >
      <Logo className="h-7 w-7 shrink-0" />
      <span className="truncate text-sm font-semibold text-ink">{name}</span>
    </a>
  )
}

/** #489: Admin is reached through the server's hand-off (#488), which signs
 *  the person in on the Admin address — never a URL guessed here. */
function useOpenAdmin() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  async function open() {
    setBusy(true)
    try {
      const to = await api.post<{ handoff?: string; landing?: string }>('/api/open_admin', {})
      if (to.handoff) window.location.assign(to.handoff)
      else await navigate({ to: to.landing ?? FEATHERBASE_ADMIN_DESTINATION.href })
    } catch {
      setBusy(false)
    }
  }
  return { open, busy }
}

function OpenAdminButton({ role }: { role?: 'menuitem' }) {
  const { open, busy } = useOpenAdmin()
  return (
    <button
      type="button"
      role={role}
      onClick={() => void open()}
      disabled={busy}
      data-testid="open-admin"
      className={role ? MENU_ITEM : buttonClasses({ variant: 'secondary' })}
    >
      Open Admin
    </button>
  )
}

const THEME_ICON: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, device: Monitor }

/** #380's one theme choice (light, dark, or follow the device), as a toggle
 *  group: icons in the bar, words in the phone's Account menu. */
function ThemeToggle({ labelled = false }: { labelled?: boolean }) {
  const { theme, set } = useThemeChoice()
  const { t } = useI18n()
  const labelId = useId()
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelled ? labelId : undefined}
      aria-label={labelled ? undefined : t('Theme')}
      data-testid="theme-toggle"
      className={labelled ? 'border-b border-border px-3 py-2' : 'flex items-center gap-0.5 rounded-control border border-border p-0.5'}
    >
      {labelled && <p id={labelId} className={labelClasses()}>{t('Theme')}</p>}
      <div className={labelled ? 'grid grid-cols-3 gap-1' : 'contents'} data-testid="theme-choice">
        {THEMES.map((choice) => {
          const Icon = THEME_ICON[choice]
          const label = t(THEME_LABEL[choice])
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={theme === choice}
              aria-label={labelled ? undefined : label}
              title={labelled ? undefined : label}
              onClick={() => set(choice)}
              data-testid={`theme-${choice}`}
              // The chosen one is filled, the others are not: a difference of
              // shape as well as colour (usable-on-any-device).
              className={buttonClasses({
                variant: theme === choice ? 'primary' : labelled ? 'secondary' : 'quiet',
                className: labelled ? 'px-1 text-xs' : 'size-control px-0',
              })}
            >
              {labelled ? label : <Icon aria-hidden size={18} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Signing out, the same from every bar. */
function useSignOut() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return async () => {
    // Drain the pending event batch FIRST, while the departing user's token
    // and cookie still exist — afterwards the queue's owner check would
    // discard it, and it must never ride the next account's session
    // (PR #104 review).
    flushPendingEvents()
    // Invalidate the sid cookie BEFORE dropping local state: while it lives,
    // any token-less request fired in the logout gap re-authenticates as the
    // departing user and re-poisons the cache for the next account in this
    // tab (#101 review). #411: if the server could not end the session, say
    // so and stay signed in rather than pretend it ended.
    if (!(await signOut())) {
      window.alert(SIGN_OUT_INCOMPLETE)
      return
    }
    clearSession()
    // Leave the page BEFORE dropping the cache: clearing while the page's
    // queries are still mounted makes every observer refetch token-less —
    // 401s that api.ts answers with a hard redirect. Once /login has rendered
    // there are no observers left, and the clear (PR #92 review) empties the
    // cache for whoever signs in next.
    await navigate({ to: '/featherbase/login' })
    queryClient.clear()
  }
}

const MENU_ITEM = 'flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint'

/** #72 / #489: the avatar is the Account menu — the person's name, Sign-in
 *  methods, Log out. On a phone it also carries Open Admin and the theme. */
function AccountMenu({ inMenu }: { inMenu?: { offerAdmin: boolean } }) {
  const user = getSessionUser()
  const { t } = useI18n()
  const signOutNow = useSignOut()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const avatar = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      avatar.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // person-rename: a person's id is opaque (`psn_…`); never draw initials from it.
  const shown = user?.full_name || user?.email || user?.row_id || ''
  const initials = (user?.full_name || user?.email || user?.row_id || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  return (
    <div className="relative" ref={wrapper}>
      <button
        ref={avatar}
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="session-user"
        title={shown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={iconButtonClasses('rounded-full hover:bg-transparent')}
      >
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-action text-xs font-semibold text-action-ink">
          {initials}
        </span>
        <span className="sr-only">{t('Account')}: {shown}</span>
      </button>
      {open && (
        <div id={menuId} className={cardClasses('absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden py-1')} data-testid="account-menu" role="menu" aria-label={t('Account')}>
          <div className="border-b border-border px-3 py-2" data-testid="account-identity">
            <p className="truncate text-sm font-medium text-ink">{user?.full_name || user?.email || user?.row_id}</p>
            {user?.email && user.full_name && <p className="truncate text-xs text-ink-subtle">{user.email}</p>}
          </div>
          {inMenu && (
            <>
              {inMenu.offerAdmin && (
                <div className="border-b border-border py-1">
                  <OpenAdminButton role="menuitem" />
                </div>
              )}
              <ThemeToggle labelled />
            </>
          )}
          <Link
            role="menuitem"
            to={ACCOUNT_SIGN_IN_METHODS_PATH}
            onClick={() => setOpen(false)}
            data-testid="account-sign-in-methods"
            className={MENU_ITEM}
          >
            {t('Sign-in methods')}
          </Link>
          <button role="menuitem" type="button" onClick={() => void signOutNow()} data-testid="logout" className={MENU_ITEM}>
            {t('Log out')}
          </button>
        </div>
      )}
    </div>
  )
}
