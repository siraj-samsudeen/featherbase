import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ACCOUNT_CONNECTED_APPS_PATH, ACCOUNT_SIGN_IN_METHODS_PATH, FEATHERBASE_ADMIN_DESTINATION, appHref, type AppTabLink } from 'shared'
import { SIGN_OUT_INCOMPLETE, api, clearSession, getSessionUser, landingPath, signOut } from '../lib/api'
import { flushPendingEvents } from '../lib/recents'
import { pageLoad } from '../lib/page-load'
import { AccountSwitcherSection } from './AccountSwitcherSection'
import { useBarAddress } from '../lib/bar-address'
import { useIsPreview, useWhoAmI, type Capabilities, type OpenableApp } from '../lib/session'
import { THEMES, THEME_LABEL, type Theme } from '../lib/theme'
import { useThemeChoice } from '../lib/theme-choice'
import { useI18n } from '../lib/i18n'
import { BarControls, useBarControls } from './BarControls'
import { AppSwitcher, useOpenAdmin } from './AppSwitcher'
import { Logo } from './Logo'
import { KeyboardShortcutsItem, ShortcutTeachingHost } from './ShortcutTeaching'
import { ViewAsBanner, ViewAsButton } from './ViewAs'
import { RecordLink, TabBar, buttonClasses, iconButtonClasses, labelClasses, menuItemClasses, touchRowClasses, useMediaQuery, raisedClasses , useTopLayer } from '@featherbase/shop-floor'
import { CircleHelp, List, Menu, Monitor, Moon, Sun, type LucideIcon } from '@featherbase/shop-floor'
import { COMMAND_SHORTCUT, SIDEBAR_DRAWER_QUERY, SIDEBAR_SHORTCUT, listenForSidebarKeys, offerPickerSlot, usePickerSlot, useSidebar, useSidebarSlots } from '../lib/sidebar-collapsed'
import { APP_ICON } from '../lib/app-icons'
import { useCurrentPageTitle } from '../lib/page-title'
import { CommandField, CommandPalette } from './CommandPalette'
import { NotificationBell, SidebarRecall, SidebarSavedViews } from './SidebarDefaults'
import { SidebarRailContext } from './SidebarRail'
import { AppSidebarSections } from './AppSidebarSections'

// #489 (design D3, "One top bar on every address"): one bar, drawn by the
// platform, on every address and every shell — the Admin screens, an app's
// pages, the Portal, the no-access page and the account pages.
//
//   left    the Featherbase mark and the name. Admin screens and installed
//           app pages share the native application dropdown (#759).
//   middle  the Admin menus, on the Admin screens only (passed in)
//   right   the theme toggle and Account menu. Featherbase pages on an app's
//           address still offer Open Admin; installed apps use the dropdown instead.
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
  /** #1328: on an address that opens an app, the Admin's own origin. */
  home?: string | null
}

/** The instance's public brand: the same for everyone on this address. */
export function useBrand() {
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

/** #1006: is this address an app's own, as far as is known yet. Admin's pages
 *  aren't served to someone there, so their account pages keep the plain bar. */
export function useOnAppAddress(): boolean | undefined {
  const brand = useBrand()
  if (brand.isError) return false
  return brand.data ? Boolean(brand.data.opens && brand.data.opens !== ADMIN) : undefined
}

function nameOf(context: string, brand: Brand | undefined): string {
  if (context === ADMIN) return ADMIN_NAME
  return brand?.opens === context ? brand.app_name : context
}

/** The one app a person's own pages are named for: Feather Dash. */
const DASH = 'dash'

/** #501 item 3: on the Admin side, a page of the person's own (the account
 *  page) is named for where they belong — Feather Dash if they can open it,
 *  else the platform. Undefined until whoami answers. Someone who can use the
 *  Admin reads their own pages in the Admin's frame (#1006, AccountLayout),
 *  never under this bar.
 *
 *  Other installed apps never name the page: one every person can open
 *  (Tasker grants All) is no one's in particular. Since #659 a reader of
 *  another app with pages of its own alone is not an Admin user either (such
 *  an app's Tables do not open the Admin), so their page carries the
 *  platform's name. */
function personalName(caps: Capabilities | undefined, apps: OpenableApp[] = [], installed: string[] = []): string | undefined {
  if (!caps) return undefined
  // #671: the readers of an app installed under Feather Dash's name belong to it.
  if (installed.includes(DASH)) {
    const opened = apps.find((entry) => entry.name === DASH)
    if (opened) return opened.title
  }
  return PLATFORM_NAME
}

/** Where the bar's name leads: the Admin, or the app's own root. */
function homeHref(context: string): string {
  return context === ADMIN ? FEATHERBASE_ADMIN_DESTINATION.href : appHref(context)
}


/** The tabs the app behind this bar declares, from the catalog (only apps
 *  the person can open). */
function useAppTabs(context: string | undefined, enabled: boolean): AppTabLink[] {
  const catalog = useQuery({
    queryKey: ['app-catalog'],
    queryFn: () => api.get<{ name: string; title: string; href: string; tabs?: AppTabLink[] }[]>('/api/app_catalog'),
    enabled: enabled && Boolean(context && context !== ADMIN),
  })
  if (!context || context === ADMIN) return []
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
}) {
  const address = useBarContext(app ? app.name : home)
  const { brand } = address
  const context = app ? app.name : address.context
  const whoami = useWhoAmI().data
  const caps = whoami?.capabilities
  const apps = whoami?.apps
  const name = app ? app.title : !context ? undefined : context === ADMIN && forPerson ? personalName(caps, apps, whoami?.installed_apps) : nameOf(context, brand)
  // The browser tab carries the bar's name: an app's on its pages and
  // address, "Featherbase Admin" on the Admin screens (#501 item 1), and the
  // person's own on account/no-access pages (item 3, #552). The Portal on the
  // Admin side keeps the tab it was opened with, and an app's own page
  // keeps the title its document gives it (#650).
  const page = useCurrentPageTitle()
  const titlesTab = !app && (context !== ADMIN || home === ADMIN || forPerson)
  useEffect(() => {
    if (name && titlesTab) document.title = page ? `${page} · ${name}` : name
  }, [name, titlesTab, page])
  const isPhone = useMediaQuery(PHONE_QUERY)
  const canUseAdmin = Boolean(caps && (caps.admin))
  // #501 item 2: only on an app's address. The Admin address, and a host the
  // list does not name (which holds the Admin), are where Admin already is.
  // An app's own page is never in the Admin, on any address (#650).
  const onAppAddress = Boolean(brand?.opens && brand.opens !== ADMIN)
  const offerAdmin = !app && onAppAddress && canUseAdmin
  // The app whose declared controls the bar draws (#642): the page's own app,
  // else the app this address opens.
  const controlsOf = app?.name ?? (onAppAddress ? brand?.opens : undefined)
  // #983: beside an app's pickers a phone has no room for the app's name, so
  // the switcher keeps its logo and a chevron that still opens the list.
  const hasControls = useBarControls(caps && controlsOf ? controlsOf : undefined).length > 0
  const compactSwitcher = Boolean(app) && hasControls
  const tabs = useAppTabs(context, isPhone && Boolean(caps))
  // #1227: the page's sidebar, wherever it is drawn (the Admin's own, or an
  // app's <featherbase-sidebar>), is worked from here, the same on every page.
  const sidebar = useSidebar(getSessionUser()?.row_id)
  useEffect(() => listenForSidebarKeys(() => getSessionUser()?.row_id), [])
  // #1227: the switcher on every signed-in page, named for the page's app; a
  // page of the person's own is named for where they belong (#501).
  const switcherApp = app ?? (context && name
    ? switcherAppFor(context, name, Boolean(forPerson || !caps?.admin), homeHref)
    : undefined)
  // Over an app's own page the bar's router is a private one, so the open tab
  // follows the document's own address (#650).
  const barAddress = useBarAddress()
  const routerPath = useRouterState({ select: (state) => state.location.pathname })
  const open = currentTab(tabs, app && barAddress?.pathname ? barAddress.pathname : routerPath)
  // #1253: a page with a sidebar has no top bar. The sidebar holds the switcher,
  // the bell and the command field at its top, and the account, help and theme
  // at its foot; on a phone a slim header keeps only the menu button.
  const slots = useSidebarSlots()
  const pickerSlot = usePickerSlot()
  const drawer = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const rail = sidebar.collapsed && !drawer
  // #1385: Search or Command is the platform's: every page with a sidebar, the
  // Admin's and every app's, draws the same field and command bar (⌘K).
  const [commandOpen, setCommandOpen] = useState(false)
  const switcher = left ?? (caps && context && name
    ? <AppSwitcher app={switcherApp} place={rail ? 'rail' : 'sidebar'} />
    : context && name && <BarName href={homeHref(context)} name={name} />)
  const phoneTabs = isPhone && caps && name && tabs.length > 0 && (
    <TabBar
      label={name}
      tabs={tabs.map((tab) => ({ label: tab.label, icon: APP_ICON[tab.icon] ?? List, href: tab.href, current: tab.href === open }))}
    />
  )

  if (slots) {
    // An app's declared pickers (#642) sit inside the white panel, at its top
    // and right-aligned (Siraj, 17-Nov); with no slot, in the strip above it.
    const pickers = Boolean(caps && controlsOf && hasControls)
    const inPanel = pickers && pickerSlot
    return (
      <>
        <PreviewBanner />
        {/* #1222: who is being viewed, on every page, while a tester views as someone. */}
        <ViewAsBanner />
        {/* The menu button is for the phone drawer only (md:hidden); with no
            pickers the whole strip is gone from a wide window. The bar is
            sticky over a scrolling page, so the strip has the page's own
            background: text scrolls under the button, never behind it. */}
        <header
          className={`${pickers && !inPanel ? 'relative ' : 'md:hidden '}flex shrink-0 items-center gap-x-1 bg-canvas px-2 py-1 sm:gap-4 md:px-3`}
          data-testid="page-header"
        >
          <SidebarControls sidebar={sidebar} />
          {pickers && !inPanel && <BarControls app={controlsOf!} />}
        </header>
        {inPanel && createPortal(
          <div className="relative flex justify-end" data-testid="page-pickers"><BarControls app={controlsOf!} /></div>,
          pickerSlot,
        )}
        {/* #1385: the bell is the platform's, for someone who can use the Admin (its notifications are there). */}
        {createPortal(
          <div className={rail ? 'flex flex-col items-center gap-1 px-2 pb-2 pt-3' : 'flex flex-col gap-2 px-2 pb-2 pt-3'} data-testid="sidebar-top">
            <div className={rail ? 'contents' : 'flex min-w-0 items-center gap-1'}>
              <div className={rail ? 'contents' : 'min-w-0 flex-1'}>{switcher}</div>
              {/* #1222: View as, an action, at the top beside the bell (Ctrl+Shift+K everywhere). */}
              {caps && <ViewAsButton compact place={rail ? 'rail' : 'sidebar'} />}
              {!rail && canUseAdmin && <NotificationBell />}
            </div>
            {caps && <CommandField rail={rail} onOpen={() => setCommandOpen(true)} />}
          </div>,
          slots.top,
        )}
        {/* #1385 (slice 4): an app's own sections, which it declares as data and never draws. */}
        {caps && app && slots.sections && createPortal(
          <SidebarRailContext.Provider value={rail}>
            <AppSidebarSections app={app.name} />
          </SidebarRailContext.Provider>,
          slots.sections,
        )}
        {/* #1385 (slice 2): below an app's own rows, the platform's recall, as in the Admin.
            They list Admin destinations: only someone who can use the Admin gets them.
            Settled on #1385: an app may not hide Recently Opened, Frequent or Saved Views; to let it,
            gate these two on a `hide` list in the app's sidebar declaration, here. */}
        {canUseAdmin && slots.defaults && createPortal(
          <SidebarRailContext.Provider value={rail}>
            <SidebarRecall />
            <SidebarSavedViews />
          </SidebarRailContext.Provider>,
          slots.defaults,
        )}
        {caps && createPortal(
          // The foot's menus (Help, Theme) anchor to this row's left edge, so they open upward and stay on screen.
          <div className={rail ? 'relative flex flex-col items-center gap-1' : 'relative flex min-w-0 items-center gap-0.5'} data-testid="sidebar-account">
            <AccountMenu inSidebar={{ rail, offerAdmin }} />
            {!rail && <HelpMenu />}
            {!rail && <ThemeMenu />}
          </div>,
          slots.foot,
        )}
        {/* #1385: the command bar, in the bar's own tree (an app's bar draws in its own shadow root). */}
        {caps && <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />}
        {/* #1251: the shortcut teaching, once per page (Admin and apps alike). */}
        {caps && <ShortcutTeachingHost />}
        {phoneTabs}
      </>
    )
  }

  return (
    <>
      <PreviewBanner />
      {/* #1222: who is being viewed, on every page, while a tester views as someone. */}
      <ViewAsBanner />
      <header
        // Where the bar draws an app's controls (on the app's address, or over
        // the app's own page) it frames the phone list of a declared control.
        className={`${controlsOf ? 'relative ' : ''}flex shrink-0 items-center gap-x-1 bg-surface px-2 py-1 sm:gap-4 sm:px-4 md:pl-0`}
        data-testid="top-bar"
      >
        {/* The shared name dropdown lines up with the sidebar. App-declared
            controls follow it; content keeps its own document and state. */}
        <div
          className={`flex min-w-0 items-center gap-1 md:px-3 ${controlsOf && !app ? 'md:shrink-0' : compactSwitcher ? 'max-sm:shrink-0 sm:flex-none md:w-60 md:shrink-0' : 'flex-1 sm:flex-none md:w-60 md:shrink-0'}`}
          data-testid="top-bar-left"
        >
          {left ?? (caps && context && name
            ? <AppSwitcher app={switcherApp} compact={compactSwitcher} />
            : context && name && <BarName href={homeHref(context)} name={name} />)}
        </div>
        {sidebar.present > 0 && <SidebarControls sidebar={sidebar} />}
        {caps && controlsOf && <BarControls app={controlsOf} />}
        {children ?? <div className="hidden flex-1 sm:block" aria-hidden="true" />}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-2" data-testid="top-bar-right">
          {caps && (
            <>
              {offerAdmin && !isPhone && <OpenAdminButton />}
              <ViewAsButton compact={isPhone} />
              {!isPhone && <ThemeToggle />}
              <AccountMenu inMenu={isPhone ? { offerAdmin } : undefined} />
            </>
          )}
        </div>
      </header>
      {/* #1251: ? and the shortcut teaching on pages without a sidebar too. */}
      {caps && <ShortcutTeachingHost />}
      {phoneTabs}
    </>
  )
}

/** The app the switcher shows as current. Admin's own screens show the Admin
 *  (none); a page of someone who cannot use the Admin names where they belong,
 *  or the platform's neutral name when that is nowhere. */
function switcherAppFor(
  context: string, name: string, personal: boolean, home: (app: string) => string,
): { name: string; title: string; href: string } | undefined {
  // The entry leads where the bar's name always has (homeHref).
  if (context !== ADMIN) return { name: context, title: name, href: home(context) }
  if (!personal) return undefined
  return name === PLATFORM_NAME ? { name: '', title: PLATFORM_NAME, href: '/' } : { name: DASH, title: name, href: home(DASH) }
}

/** #1018 / #1227: narrower than md the sidebar is a drawer, opened from the
 *  bar's menu button. #1248: from md up the sidebar collapses to a rail by its
 *  own footer row and edge (and Ctrl/Cmd+B), so the bar has no control for it. */
function SidebarControls({ sidebar }: { sidebar: ReturnType<typeof useSidebar> }) {
  return (
    <button
      type="button"
      onClick={() => sidebar.setDrawerOpen(!sidebar.drawerOpen)}
      data-testid="sidebar-toggle"
      aria-label="Toggle menu"
      aria-expanded={sidebar.drawerOpen}
      className={iconButtonClasses('shrink-0 md:hidden')}
    >
      <Menu aria-hidden size={20} />
    </button>
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
      className={labelled ? 'px-3 py-2' : 'flex items-center gap-0.5 rounded-control bg-fill p-0.5'}
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

/** Signing out, the same from every bar (and the command bar's Log out, #1325). */
export function useSignOut() {
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
    const out = await signOut()
    if (!out.ok) {
      window.alert(SIGN_OUT_INCOMPLETE)
      return
    }
    // #1255 D6: another account is held on this browser; the page continues as it.
    if (out.next) {
      pageLoad.assign(out.next.handoff ?? landingPath(out.next))
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

// #1348: the Account menu's and Help's items are the shared menu rows.
const MENU_ITEM = menuItemClasses()

/** #72 / #489: the avatar is the Account menu — the person's name, Sign-in
 *  methods, Log out. On a phone it also carries Open Admin and the theme. */
/** The roles everyone holds say nothing about who someone is. */
const EVERYONE_ROLES = new Set(['All', 'Guest'])

/** Under the name at the sidebar's foot: "System Manager" for whoever manages
 *  the instance, else their first role and how many more. */
export function roleLine(who: { roles: string[]; capabilities: { manage: boolean } }): string {
  if (who.capabilities.manage) return 'System Manager'
  const roles = who.roles.filter((role) => !EVERYONE_ROLES.has(role))
  return [roles[0], roles.length > 1 ? `+${roles.length - 1} more` : null].filter(Boolean).join(' · ')
}

function AccountMenu({ inMenu, inSidebar }: {
  inMenu?: { offerAdmin: boolean }
  /** #1253: the avatar and name at the sidebar's foot (the avatar alone in the
   *  rail); the menu opens above it, or beside the rail. */
  inSidebar?: { rail: boolean; offerAdmin: boolean }
}) {
  const user = getSessionUser()
  const { t } = useI18n()
  const signOutNow = useSignOut()
  const navigate = useNavigate()
  const whoami = useWhoAmI().data
  const caps = whoami?.capabilities
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

  const named = Boolean(inSidebar && !inSidebar.rail)
  // In the rail the theme has no control of its own beside the avatar, so its menu carries it.
  const extras = inMenu ?? (inSidebar ? { offerAdmin: inSidebar.offerAdmin, theme: inSidebar.rail } : undefined)
  const place = !inSidebar
    ? 'right-0 top-full mt-1'
    : inSidebar.rail ? 'bottom-0 left-full ml-2' : 'bottom-full left-0 mb-1'
  // Above the page, an app's panels and iframes included (useTopLayer).
  const menu = useRef<HTMLDivElement>(null)
  useTopLayer(open, menu, wrapper, !inSidebar ? 'below-end' : inSidebar.rail ? 'right-end' : 'above-start')
  return (
    <div className={named ? 'relative min-w-0 flex-1' : 'relative'} ref={wrapper}>
      <button
        ref={avatar}
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="session-user"
        title={shown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={named
          ? touchRowClasses('flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-ink hover:bg-border/50')
          : iconButtonClasses('rounded-full hover:bg-transparent')}
      >
        <span aria-hidden="true" className={`flex ${inSidebar ? 'size-7' : 'size-8'} shrink-0 items-center justify-center rounded-full bg-action text-xs font-semibold text-action-ink`}>
          {initials}
        </span>
        {named && (
          <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate">{shown}</span>
            {/* #1253 mockup: who they are here, small and muted under the name. */}
            {whoami && roleLine(whoami) && <span className="truncate text-xs text-ink-muted" data-testid="session-user-role">{roleLine(whoami)}</span>}
          </span>
        )}
        <span className="sr-only">{t('Account')}: {shown}</span>
      </button>
      {open && (
        <div ref={menu} id={menuId} className={raisedClasses(`absolute ${place} z-40 w-64 overflow-hidden p-1.5`)} data-testid="account-menu" role="menu" aria-label={t('Account')}>
          <div className="px-3 py-2 text-sm" data-testid="account-identity">
            {/* #1227: a record shown is a RecordLink — the person's own Person record, for
                someone who may open it (a System Manager, or a reader of Person). */}
            {user && (
              <RecordLink
                table="Person"
                rowId={user.row_id}
                name={user.full_name || user.email}
                detail={user.full_name ? user.email : undefined}
                layout="two-lines"
                canOpen={Boolean(caps && (caps.manage || caps.tables.includes('Person')))}
                onNavigate={(href) => { setOpen(false); void navigate({ href }) }}
                className="max-w-full"
              />
            )}
          </div>
          <AccountSwitcherSection onDone={() => setOpen(false)} />
          {extras && (
            <>
              {extras.offerAdmin && (
                <div className="py-1">
                  <OpenAdminButton role="menuitem" />
                </div>
              )}
              {(!('theme' in extras) || extras.theme) && <ThemeToggle labelled />}
            </>
          )}
          <Link
            role="menuitem"
            to={ACCOUNT_SIGN_IN_METHODS_PATH}
            onClick={() => setOpen(false)}
            data-testid="account-sign-in-methods"
            className={MENU_ITEM}
          >
            {t('Sign-In Methods')}
          </Link>
          <Link
            role="menuitem"
            to={ACCOUNT_CONNECTED_APPS_PATH}
            onClick={() => setOpen(false)}
            data-testid="account-connected-apps"
            className={MENU_ITEM}
          >
            {t('Connected Apps')}
          </Link>
          {user && (
            <Link
              role="menuitem"
              to="/featherbase/account/access/$person"
              params={{ person: user.row_id }}
              onClick={() => setOpen(false)}
              data-testid="account-access-explanation"
              className={MENU_ITEM}
            >
              {/* #1224's verifier: the menu uses the page's own words. */}
              {t('What You Can See')}
            </Link>
          )}
          <button role="menuitem" type="button" onClick={() => void signOutNow()} data-testid="logout" className={MENU_ITEM}>
            {t('Log Out')}
          </button>
        </div>
      )}
    </div>
  )
}

/** #1253: a small menu at the sidebar's foot, opening above its button. */
function FootMenu({ label, icon: Icon, testid, children }: {
  label: string
  icon: LucideIcon
  testid: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  // Above the page (useTopLayer), anchored as before to the foot row's left edge.
  const menu = useRef<HTMLDivElement>(null)
  const footRow = useCallback(() => wrapper.current?.closest<HTMLElement>('[data-testid=sidebar-account]') ?? wrapper.current, [])
  useTopLayer(open, menu, footRow, 'above-start')
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      // The event's path: over an app's page the sidebar is a shadow root (#650).
      if (wrapper.current && !e.composedPath().includes(wrapper.current)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    // Not positioned itself: the card anchors to the foot row (sidebar-account), from its left edge.
    <div className="shrink-0" ref={wrapper}>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid={testid}
        className={iconButtonClasses('size-8 text-ink-muted hover:bg-border/50 hover:text-ink')}
      >
        <Icon aria-hidden size={16} />
      </button>
      {open && (
        <div ref={menu} id={menuId} className={raisedClasses('absolute bottom-full left-0 z-40 mb-1 w-60 overflow-hidden py-1')} data-testid={`${testid}-menu`}>
          {children}
        </div>
      )}
    </div>
  )
}

/** The theme control at the sidebar's foot: its icon is the theme chosen now. */
function ThemeMenu() {
  const { theme } = useThemeChoice()
  const { t } = useI18n()
  return (
    <FootMenu label={`${t('Theme')}: ${t(THEME_LABEL[theme])}`} icon={THEME_ICON[theme]} testid="theme-button">
      <ThemeToggle labelled />
    </FootMenu>
  )
}

/** Help at the sidebar's foot. #1251: its first item opens the Keyboard
 *  Shortcuts panel, which lists the shortcuts on this page and which ones the
 *  person uses; `?` opens it from anywhere. */
function HelpMenu() {
  return (
    <FootMenu label="Help" icon={CircleHelp} testid="help-button">
      <KeyboardShortcutsItem className={MENU_ITEM} />
    </FootMenu>
  )
}

/** #1253: the top of a platform page's white panel, where an app's declared
 *  pickers sit (an account page on an app's address). Empty, it takes no room. */
export function PagePickerSlot() {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => offerPickerSlot(slot.current!), [])
  return <div ref={slot} className="empty:hidden mb-3" data-testid="page-picker-slot" />
}
