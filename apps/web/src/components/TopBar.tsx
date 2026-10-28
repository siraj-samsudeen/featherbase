import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ACCOUNT_SIGN_IN_METHODS_PATH, FEATHERBASE_ADMIN_DESTINATION, INTERIM_APPS, appHref, appTabLinks, type AppTabIcon, type AppTabLink } from 'shared'
import { SIGN_OUT_INCOMPLETE, api, clearSession, getSessionUser, signOut } from '../lib/api'
import { flushPendingEvents } from '../lib/recents'
import { useBarAddress } from '../lib/bar-address'
import { useIsPreview, useWhoAmI, type Capabilities, type OpenableApp } from '../lib/session'
import { THEMES, THEME_LABEL, type Theme } from '../lib/theme'
import { useThemeChoice } from '../lib/theme-choice'
import { useI18n } from '../lib/i18n'
import { BarControls } from './BarControls'
import { Logo } from './Logo'
import { TabBar, buttonClasses, cardClasses, iconButtonClasses, labelClasses, useMediaQuery } from './ui'
import { CalendarDays, ChartColumn, House, Inbox, List, ListChecks, Monitor, Moon, Sun, Target, UserRound, type LucideIcon } from './ui/icons'

// #489 (design D3, "One top bar on every address"): one bar, drawn by the
// platform, on every address and every shell — the Admin screens, an app's
// pages, the Portal, the no-access page and the account pages.
//
//   left    the Featherbase mark and the name: "Featherbase Admin" on the
//           Admin address, the app's title on an app's address. The browser
//           tab carries the same name.
//   middle  the Admin menus, on the Admin screens only (passed in)
//   right   "Open Admin" (app addresses only, people who can use Admin), the
//           theme toggle, the Account menu
//
// #501: a page is named for where the person belongs, and the bar never
// offers to go where the person already is.
//
//   bottom  on a phone, on an app's pages, the tabs the app declares (#380
//           task 4.4), drawn as the Shop Floor TabBar. An app that declares
//           none gets none; the Admin screens have their own menu.
//
// The address picks the contents (/api/brand `opens`). A host the list does
// not name (development, test) holds everything, so there the page says
// which it belongs to (`home`).

/** Below Tailwind's `sm`: one row has room for the name and the avatar only. */
export const PHONE_QUERY = '(max-width: 639.98px)'

export const ADMIN_NAME = FEATHERBASE_ADMIN_DESTINATION.label
/** The platform's own name, for a page of someone who can open nothing. */
const PLATFORM_NAME = 'Featherbase'
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

/** What this bar stands for: `admin` or an app's name. A page that belongs to
 *  an app is that app's on every address, so app content never shows under
 *  the Admin name (verifier, round 2 on #495); any other page takes the
 *  address's side. Undefined only while the address is still being asked and
 *  the page has no home of its own. */
function useBarContext(home: string | undefined): { context?: string; brand?: Brand } {
  const brand = useBrand()
  if (home && home !== ADMIN) return { context: home, brand: brand.data }
  if (brand.data) return { context: brand.data.opens ?? home ?? ADMIN, brand: brand.data }
  if (brand.isError) return { context: home ?? ADMIN }
  return { context: home }
}

function nameOf(context: string, brand: Brand | undefined): string {
  if (context === ADMIN) return ADMIN_NAME
  if (brand?.opens === context) return brand.app_name
  return INTERIM_APPS[context]?.title ?? context
}

/** The one app a person can belong to without a Table grant of their own:
 *  Feather Dash, the report page until an app is installed under its name. */
const DASH = 'feather_dash'

/** #501 item 3: on the Admin side, a page of the person's own (the account
 *  page) is named for where they belong — the Admin if they can use it, else
 *  Feather Dash if they can open it, else the platform. Undefined until
 *  whoami answers.
 *
 *  Other installed apps never name the page: one every person can open
 *  (Tasker grants All) is no one's in particular. Since #659 a reader of
 *  another app with pages of its own alone is not an Admin user either (such
 *  an app's Tables do not open the Admin), so their page carries the
 *  platform's name. */
function personalName(caps: Capabilities | undefined, apps: OpenableApp[] = [], installed: string[] = []): string | undefined {
  if (!caps) return undefined
  if (caps.admin) return ADMIN_NAME
  // #671: once an app is installed under Feather Dash's name, its readers
  // belong to it; until then, the report role does (design D8).
  if (installed.includes(DASH)) {
    const opened = apps.find((entry) => entry.name === DASH)
    if (opened) return opened.title
  } else if (caps.report) return INTERIM_APPS[DASH].title
  return PLATFORM_NAME
}

/** Where the bar's name leads. An app installed under an interim name
 *  replaces its interim page (#671): the interim root stands in only while
 *  no app of that name is installed. */
function homeHref(context: string, installed: boolean): string {
  if (context === ADMIN) return FEATHERBASE_ADMIN_DESTINATION.href
  if (installed) return appHref(context)
  return INTERIM_APPS[context]?.root ?? appHref(context)
}

const TAB_ICON: Record<AppTabIcon, LucideIcon> = {
  home: House, report: ChartColumn, target: Target, list: List,
  checklist: ListChecks, calendar: CalendarDays, inbox: Inbox, person: UserRound,
}

/** The tabs the app behind this bar declares: an interim app's from shared,
 *  an installed app's from the catalog (only apps the person can open). */
function useAppTabs(context: string | undefined, installed: boolean, enabled: boolean): AppTabLink[] {
  // An app installed under an interim name replaces its interim page (#671).
  const interim = context && !installed ? INTERIM_APPS[context] : undefined
  const catalog = useQuery({
    queryKey: ['app-catalog'],
    queryFn: () => api.get<{ name: string; title: string; href: string; tabs?: AppTabLink[] }[]>('/api/app_catalog'),
    enabled: enabled && Boolean(context && context !== ADMIN && !interim),
  })
  if (!context || context === ADMIN) return []
  if (interim) return appTabLinks(interim.root, interim.tabs ?? [])
  return catalog.data?.find((app) => app.name === context)?.tabs ?? []
}

/** The open tab: the one whose address the page is at or under, the longest
 *  such when one tab's address holds another's (the app's root holds all). */
function currentTab(tabs: AppTabLink[], pathname: string): string | undefined {
  const under = (href: string) => pathname === href || pathname.startsWith(href.endsWith('/') ? href : `${href}/`)
  return tabs.filter((tab) => under(tab.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href
}

export function TopBar({
  app,
  home,
  forPerson,
  left,
  children,
  beforeRight,
  below,
}: {
  /** #650: the bar over an installed app's own page (the bar bundle): the app
   *  the page belongs to, on whatever address it is opened. The app's page
   *  keeps its own document title. */
  app?: { name: string; title: string }
  /** The page's own side when the host is unlisted: `admin` (default) or an app. */
  home?: string
  /** On the Admin side, name the bar for where the person belongs (#501). */
  forPerson?: boolean
  /** Replaces the name (the Admin screens draw their app switcher there). */
  left?: ReactNode
  /** The Admin menus, between the name and the right side. */
  children?: ReactNode
  /** Admin-only indicators that lead the right side (the notification bell). */
  beforeRight?: ReactNode
  /** A second row under the bar's own (the Admin command bar on a phone). */
  below?: ReactNode
}) {
  const address = useBarContext(app ? app.name : home)
  const { brand } = address
  const context = app ? app.name : address.context
  const whoami = useWhoAmI().data
  const caps = whoami?.capabilities
  const apps = whoami?.apps
  // An app's own page is an installed app's (#650). Elsewhere the link follows
  // the installation, as the server's address routing does (#671): a disabled
  // app's root says it is unavailable, never the interim page.
  const installed = Boolean(app) || Boolean(context && whoami?.installed_apps?.includes(context))
  const name = app ? app.title : !context ? undefined : context === ADMIN && forPerson ? personalName(caps, apps, whoami?.installed_apps) : nameOf(context, brand)
  // The browser tab carries the bar's name: an app's on its pages and
  // address, "Featherbase Admin" on the Admin screens (#501 item 1), and the
  // account page's own (item 3). The Portal and the no-access page on the
  // Admin side keep the tab they were opened with, and an app's own page
  // keeps the title its document gives it (#650).
  const titlesTab = !app && (context !== ADMIN || home === ADMIN || forPerson)
  useEffect(() => {
    if (name && titlesTab) document.title = name
  }, [name, titlesTab])
  const isPhone = useMediaQuery(PHONE_QUERY)
  const canUseAdmin = Boolean(caps && (caps.admin))
  // #501 item 2: only on an app's address. The Admin address, and a host the
  // list does not name (which holds the Admin), are where Admin already is.
  // An app's own page is never in the Admin, on any address (#650).
  const onAppAddress = Boolean(brand?.opens && brand.opens !== ADMIN)
  const offerAdmin = (onAppAddress || Boolean(app)) && canUseAdmin
  // The app whose declared controls the bar draws (#642): the page's own app,
  // else the app this address opens.
  const controlsOf = app?.name ?? (onAppAddress ? brand?.opens : undefined)
  const tabs = useAppTabs(context, installed, isPhone && Boolean(caps))
  // Over an app's own page the bar's router is a private one, so the open tab
  // follows the document's own address (#650).
  const barAddress = useBarAddress()
  const routerPath = useRouterState({ select: (state) => state.location.pathname })
  const open = currentTab(tabs, app && barAddress?.pathname ? barAddress.pathname : routerPath)

  return (
    <>
      <PreviewBanner />
      <header
        // Where the bar draws an app's controls (on the app's address, or over
        // the app's own page) it frames the phone list of a declared control.
        className={`${controlsOf ? 'relative ' : ''}flex shrink-0 items-center gap-x-1 border-b border-border bg-surface px-2 py-1 sm:gap-4 sm:px-4 md:pl-0`}
        data-testid="top-bar"
      >
        {/* The name's block lines up with the Admin sidebar and, on a phone,
            fills the row. An app's address or page has no sidebar, so there it keeps
            to the name's width and the declared controls follow it, with the
            free space after them (#642). */}
        <div
          className={`flex min-w-0 items-center gap-1 md:px-3 ${controlsOf ? 'md:shrink-0' : 'flex-1 sm:flex-none md:w-60 md:shrink-0'}`}
          data-testid="top-bar-left"
        >
          {left ?? (context && name && <BarName href={homeHref(context, installed)} name={name} />)}
        </div>
        {caps && controlsOf && <BarControls app={controlsOf} />}
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
      {isPhone && caps && name && tabs.length > 0 && (
        <TabBar
          label={name}
          tabs={tabs.map((tab) => ({ label: tab.label, icon: TAB_ICON[tab.icon] ?? List, href: tab.href, current: tab.href === open }))}
        />
      )}
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
function BarName({ href, name }: { href: string; name: string }) {
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
              // The phone menu's words must fit one line at 375px: "Device" is
              // shown, "Same as device" stays the name (verifier, round 2).
              aria-label={labelled && choice !== 'device' ? undefined : label}
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
              {labelled ? (choice === 'device' ? t('Device') : label) : <Icon aria-hidden size={18} />}
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
      // The event's path, not its target: over an app's page the bar is in a
      // shadow root, where a document listener sees only the host (#650).
      if (wrapper.current && !e.composedPath().includes(wrapper.current)) setOpen(false)
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
