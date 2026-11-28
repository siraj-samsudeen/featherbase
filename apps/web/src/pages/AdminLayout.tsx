import { useEffect, useRef } from 'react'
import { type GroupTone } from '../components/SidebarRail'
import { SidebarSections, type ShownSection } from '../components/SidebarSections'
import { SidebarAside } from '../components/SidebarAside'
import { sidebarWords } from '../lib/sidebar-rail'
import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ACCOUNT_CONNECTED_APPS_PATH, ACCOUNT_SIGN_IN_METHODS_PATH, JOBS_PATH, adminPageNeedsManage } from 'shared'
import { ApiError, api, getSessionUser } from '../lib/api'
import { actionForLocation, recordAction } from '../lib/recents'
import { useHomePages } from '../lib/home-pages'
import { useCapabilities, useShellKind } from '../lib/session'
import { ThemeChoiceProvider } from '../lib/theme-choice'
import { ActionDisclosure } from '../components/ActionDisclosure'
import { TopBar } from '../components/TopBar'
import { SidebarRecall, SidebarSavedViews } from '../components/SidebarDefaults'
import { metaQuery, type TableMeta } from '../lib/meta'
import { useI18n } from '../lib/i18n'
import { DataSourcesSidebar } from '../components/DataSourcesSidebar'
import { NoAccessPage, Waiting } from './RestrictedShell'
import { WAITING_COUNT_QUERY_KEY } from './WaitingForAccess'
import { HealthBanner, INSTANCE_HEALTH_PATH, SETUP_PERSON_LABEL, SETUP_PERSON_PATH, SetupBanner, useSetupNeeded } from './InstanceHealth'
import { GLOSSARY_PATH } from '../lib/glossary'
import { useSetupOffer } from './FirstRunSetup'
import { StatusPill } from '@featherbase/shop-floor'
import { BookOpen, Cable, CalendarClock, Plus, Search, Upload, Compass, Eye, History, Key, Link2, ListChecks, LogIn, Table, UserRoundSearch, type LucideIcon } from '@featherbase/shop-floor'
import { fmtCount } from '@featherbase/shop-floor'
import { ADMIN_HOME_SHORTCUT_DEF, NEW_ROW_SHORTCUT_DEF, noteShortcutUse, useShortcut } from '../lib/shortcuts'




// Admin shell: top navbar (brand + command bar + avatar) and a
// home page sidebar. All Tables render inside <Outlet/>.
// #410: pick the layout from the server-computed capabilities BEFORE mounting
// the Admin shell, so a person who cannot use it never fires its API calls.
export function AdminLayout({ fillHeight }: { fillHeight: boolean }) {
  // #489: the signed-in person's theme choice outlives every toggle on the page.
  return (
    <ThemeChoiceProvider>
      <AdminLayoutForKind fillHeight={fillHeight} />
    </ThemeChoiceProvider>
  )
}

function AdminLayoutForKind({ fillHeight }: { fillHeight: boolean }) {
  const kind = useShellKind()
  // #489 item 10: while whoami loads, the bar's frame and name are drawn and
  // its right side stays empty — no flash of the wrong items.
  if (kind === 'loading' || kind === 'failed')
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <TopBar home="admin" />
        {kind === 'loading' ? (
          <Waiting label="Checking your access" />
        ) : (
          <Waiting>
            We could not check what you have access to. <button type="button" className="underline" onClick={() => window.location.reload()}>Try again</button>
          </Waiting>
        )}
      </div>
    )
  if (kind === 'no-access') return <NoAccessPage />
  return <AdminShell fillHeight={fillHeight} />
}

export function AdminShell({ fillHeight, account = false }: { fillHeight: boolean; account?: boolean }) {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const user = getSessionUser()
  // #501 item 1: the browser tab says "Featherbase Admin", as the bar does;
  // TopBar sets it from the bar's name.

  // Recent actions (#101 Phase 1): every admin navigation is remembered in a
  // per-user localStorage buffer; the command bar's empty state replays it.
  // One navigation is one visit: StrictMode (dev) runs this effect twice for
  // the same navigation, so it is keyed by the history entry's own key — a
  // repeat run of the same entry records nothing, a new navigation does.
  const location = useRouterState({ select: (s) => s.location })
  const navigationKey = (location.state as { __TSR_key?: string; key?: string } | undefined)?.__TSR_key
    ?? (location.state as { key?: string } | undefined)?.key
    ?? location.href
  const recordedNavigation = useRef<string | null>(null)
  useEffect(() => {
    if (!user) return
    const id = `${user.row_id}\u0000${navigationKey}`
    if (recordedNavigation.current === id) return
    recordedNavigation.current = id
    const search = location.search as Record<string, unknown>
    const action = actionForLocation(location.pathname, search)
    // A list or row names a Table; it is remembered only once that Table's
    // metadata has loaded. A path that is not a Table (`/admin/people`) 404s
    // and is never offered back.
    // The same rule for a page only a System Manager can open: anyone else is
    // sent home, so the page is never offered back to them (#476).
    if (action?.kind === 'page' && adminPageNeedsManage(action.key.slice('page:'.length)) && !canManage) return
    const tableSegment = /^\/featherbase\/admin\/table\/([^/]+)/.exec(location.pathname)?.[1]
    if (!tableSegment) {
      if (action) recordAction(user.row_id, action)
      return
    }
    const owner = user.row_id
    queryClient.fetchQuery(metaQuery(decodeURIComponent(tableSegment))).then(
      (meta) => {
        const resolved = actionForLocation(location.pathname, search, meta.name, location.href, meta.columns, t)
        if (resolved) recordAction(owner, resolved)
      },
      () => {},
    )
  }, [user?.row_id, location.href, navigationKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const caps = useCapabilities()
  const canManage = caps?.manage === true
  // #429: the count beside "Waiting for access"; asked only by a System Manager.
  const waiting = useQuery({
    queryKey: WAITING_COUNT_QUERY_KEY,
    queryFn: () => api.get<{ count: number }>('/api/people/waiting_for_access/count'),
    enabled: canManage,
  })

  // #465 D9: right after the Administrator signs in, ask who looks after the
  // instance while no System Manager has an email address.
  useSetupOffer(canManage)
  const setupNeeded = useSetupNeeded(canManage) !== null

  useShortcut(ADMIN_HOME_SHORTCUT_DEF)
  // G then N makes a row of the Table on screen: listed only where there is one.
  const onTable = useRouterState({ select: (s) => s.matches.some((m) => 'table' in m.params) })
  useShortcut(NEW_ROW_SHORTCUT_DEF, onTable)

  // UI-015: global keyboard shortcuts.
  //   Ctrl/Cmd+K  the command bar (components/CommandPalette)
  //   Ctrl/Cmd+S  save the current form
  //   Ctrl/Cmd+B  collapse or reopen the sidebar (#1018; lib/sidebar-collapsed)
  //   g then d    go to the Admin home
  //   g then n    new row of the current Table
  useEffect(() => {
    let leader = 0 // timestamp of a recent 'g' press
    // The metadata boundary and the shell share this QueryClient. A URL
    // spelling alone is never a canonical identity; fixed pages have none.
    function currentTable(): string | null {
      const match = router.state.matches.find((m) => 'table' in m.params && m.status === 'success')
      const table = (match?.params as { table?: string } | undefined)?.table
      if (!table) return null
      const state = queryClient.getQueryState<TableMeta>(metaQuery(table).queryKey)
      if (state?.error instanceof ApiError && state.error.status < 500) return null
      return state?.data?.name ?? null
    }
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('[data-testid=form-save]')?.click()
        return
      }
      // Leader-key navigation only when not typing into a field.
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const now = Date.now()
      if (e.key.toLowerCase() === 'g') {
        leader = now
      } else if (e.key.toLowerCase() === 'd' && now - leader < 1000) {
        leader = 0
        noteShortcutUse(ADMIN_HOME_SHORTCUT_DEF.id, 'key')
        navigate({ to: '/featherbase/admin' })
      } else if (e.key.toLowerCase() === 'n' && now - leader < 1000) {
        leader = 0
        const dt = currentTable()
        if (dt) noteShortcutUse(NEW_ROW_SHORTCUT_DEF.id, 'key')
        if (dt) navigate({ to: '/featherbase/admin/table/$table/new', params: { table: dt }, search: { prefill: undefined } })
      } else {
        leader = 0
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate, router, queryClient])

  // UI-027 / #80: the sidebar lists the caller's visible Home Pages — the
  // dedicated endpoint is its only source (role visibility and link
  // permission-filtering are computed server-side).
  const homePages = useHomePages()
  // #1242 (admin-lists 8): the module of the Table open now is marked in the
  // sidebar: the Home Page that lists it (every Table is linked from its module's
  // page when made; System's are listed on System though their module is Core,
  // the default), else its module's page.
  const openTable = useRouterState({ select: (state) => (state.matches.find((match) => 'table' in match.params)?.params as { table?: string } | undefined)?.table })
  const openMeta = useQuery({ ...metaQuery(openTable ?? ''), enabled: Boolean(openTable) })
  const openModulePage = (() => {
    const meta = openTable ? openMeta.data : undefined
    if (!meta) return undefined
    const pages = homePages.data?.pages ?? []
    return (pages.find((page) => page.cards.some((card) => card.links.some((link) => link.link_to === meta.name)))
      ?? pages.find((page) => page.module && page.module === meta.module))?.row_id
  })()


  // #1385 (slice 4): the Admin's own sections, declared as data the way an app declares its own.
  // #80: the sidebar is Home Pages only; every table stays reachable through All tables below.
  const modules: ShownSection = {
    id: 'modules',
    title: 'Modules',
    tone: 'blue',
    testid: 'sidebar-section-modules',
    first: !account,
    items: (homePages.data?.pages ?? []).map((p) => ({
      label: p.label || p.row_id,
      address: `/featherbase/admin/home/${encodeURIComponent(p.row_id)}`,
      // The page's own emoji takes the icon's place; one with none shows its initials (#1248, #1253).
      ...(p.icon && { glyph: p.icon }),
      testid: `home-page-link-${p.row_id}`,
      // #1242: the module of the Table open now is marked.
      ...(p.row_id === openModulePage && { current: true }),
    })),
  }
  // Under the Home Pages and the recents, headed like "Recently Opened". Visibility per item is unchanged.
  const data: ShownSection = {
    id: 'data',
    title: sidebarWords('Data'),
    tone: 'teal',
    testid: 'sidebar-group-data',
    items: [
      { address: '/featherbase/admin/all-tables', label: 'All tables', icon: Table, testid: 'all-tables-link' },
      // The owner's review (17-Nov): New table and Import data are two links here, not a "+ New" menu.
      ...(canManage ? [
        { address: '/featherbase/admin/new-table', label: 'New table', icon: Plus, testid: 'new-table-link' },
        { address: '/featherbase/admin/import', label: 'Import data', icon: Upload, testid: 'import-data-link' },
      ] : []),
      // #629: everyone signed in reads the glossary.
      { address: GLOSSARY_PATH, label: 'Glossary', icon: BookOpen, testid: 'glossary-link' },
      // #206: an import is a thing you did, not just rows that appeared — so it has a place to be found again.
      ...(canManage ? [{ address: '/featherbase/admin/imports', label: 'Past imports', icon: History, testid: 'past-imports-link' }] : []),
    ].map((item) => ({ ...item, label: sidebarWords(item.label) })),
  }

  return (
    <>
    <div className="flex h-full flex-col bg-canvas">
      {/* #465 D8: System Managers only, while a health check fails; above the
          top bar, beside the preview banner. */}
      <HealthBanner enabled={canManage} />
      <SetupBanner enabled={canManage} />
      {/* #1253: no top bar. The shared bar draws the Admin's switcher, the
          notification bell (#1385: the platform's, on every page) and the "Search or Command" field at the top of
          the sidebar, and the account at its foot; a phone keeps a slim
          header with the menu button. */}
      <TopBar home="admin" />
      <div className="relative flex min-h-0 flex-1">
        <SidebarAside testid="admin-sidebar" user={user?.row_id}>
          {/* #1235 item 7: on the account pages, the Account group leads the sidebar. */}
          {account && <AccountSidebarGroup />}
          {/* #80: the sidebar is Home Pages only. Every
              table stays reachable through the All tables entry below —
              grouping and curation moved there, nothing is hidden. */}
          {/* The sidebar scrolls as ONE column: the Home Pages keep their full
              height whatever sits below them. */}
          {/* #1385 (slice 4): Modules is the Admin's declared section, drawn as every app's sections are. */}
          <nav className="shrink-0" data-testid="home-page-nav" aria-label="Modules">
            <SidebarSections links="router" sections={[modules]} />
            {homePages.isLoading && <p className="px-4 py-1 text-xs text-ink-subtle">Loading…</p>}
          </nav>
          {/* #101 Phase 2: recall without a keystroke — the same per-user
              buffer the command bar reads. */}
          <SidebarRecall />
          {/* #1229: the person's saved views, own and starred, one click each. */}
          <SidebarSavedViews />
          {/* Two labelled groups under the Home Pages and the recents, headed
              like "Recently opened". Visibility per item is unchanged; a group
              with nothing visible for this person drops its heading too. */}
          {/* #1385 (slice 4): Data is the Admin's declared section too. */}
          <SidebarSections links="router" sections={[data]} />
          {/* #772: each data source and the databases it reads; System Managers only. */}
          {canManage && <DataSourcesSidebar />}
          <SidebarGroup
            heading="People and access"
            tone="rose"
            testid="sidebar-group-access"
            items={[
              // #131: automation credentials are self-service (the endpoint is
              // owner-scoped), so the link shows for everyone in the Admin.
              { to: '/featherbase/admin/access-tokens', label: 'Access tokens', icon: Key, testid: 'access-tokens-link' },
              ...(canManage
                ? [{
                    to: '/featherbase/admin/waiting-for-access',
                    label: 'Waiting for access',
                    icon: UserRoundSearch,
                    testid: 'waiting-for-access-link',
                    badge: (waiting.data?.count ?? 0) > 0 && (
                      <StatusPill tone="caution">
                        <span data-testid="waiting-for-access-count" aria-label={`${waiting.data!.count} waiting`}>
                          {fmtCount(waiting.data!.count)}
                        </span>
                      </StatusPill>
                    ),
                  },
                  // #1271: who has left, or is not an employee, and can still sign in.
                  { to: '/featherbase/admin/leavers-who-can-sign-in', label: 'Leavers who can still sign in', icon: LogIn, testid: 'leavers-link' },
                  // #1396: MotherDuck accounts still to link to a person.
                  { to: '/featherbase/admin/link-motherduck-accounts', label: 'Link MotherDuck accounts', icon: Link2, testid: 'link-motherduck-link' }]
                : []),
            ]}
          />
          <SidebarGroup
            heading="This instance"
            tone="green"
            testid="sidebar-group-instance"
            items={canManage
              ? [
                  { to: '/featherbase/admin/setup', label: 'Welcome', icon: ListChecks, testid: 'welcome-link' },
                  ...(setupNeeded ? [{ to: SETUP_PERSON_PATH, label: SETUP_PERSON_LABEL, icon: ListChecks, testid: 'setup-administrators-link' }] : []),
                  { to: '/featherbase/admin/apps', label: 'Apps', icon: Compass, testid: 'apps-link' },
                  { to: JOBS_PATH, label: 'Jobs', icon: CalendarClock, testid: 'jobs-link' },
                  { to: INSTANCE_HEALTH_PATH, label: 'Instance Health', icon: ListChecks, testid: 'instance-health-link' },
                ]
              : []}
          />
        </SidebarAside>

        {/* Page canvas */}
        {/* #1253 (Siraj, 17-Nov): the shell sets the page's width, and every page fills
            the white panel; no page caps itself. Running text keeps its own measure. */}
        <main className={`${PAGE_PANEL}${fillHeight ? ' flex flex-col' : ''}`} data-testid="page-panel">
          <div className={fillHeight ? 'flex min-h-0 w-full flex-1 flex-col' : 'w-full'} data-testid="page-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </>
  )
}

/** #1253: the page is one white panel on the canvas, set off by a soft shadow,
 *  8px from the window's edges; a phone shows it edge to edge. #1348: radius 14,
 *  padding 24/28, and a 16px gutter on a phone. */
export const PAGE_PANEL = 'min-w-0 flex-1 overflow-auto bg-surface p-4 sm:px-7 sm:py-6 md:my-2 md:mr-2 md:rounded-card md:shadow-panel'

interface SidebarItem {
  to: string
  label: string
  icon: LucideIcon
  testid: string
  badge?: React.ReactNode
}

/** A labelled group of sidebar links: a muted Title Case heading (a heading, not a link), then each link with
 *  its icon in the group's hue. #1385 (slice 4): a declared section, drawn as an app's are. Renders nothing,
 *  heading included, when no item is visible. */
export function SidebarGroup({ heading, testid, items, first = false, tone = 'slate' }: {
  heading: string
  testid: string
  items: SidebarItem[]
  /** The group's hue for its icons (owner's review, 17-Nov). */
  tone?: GroupTone
  /** The sidebar's first group: no rule above it. */
  first?: boolean
}) {
  return (
    <SidebarSections
      links="router"
      sections={[{
        id: testid, title: sidebarWords(heading), tone, testid, first,
        items: items.map(({ to, label, icon, testid: id, badge }) => ({ address: to, label: sidebarWords(label), icon, testid: id, badge })),
      }]}
    />
  )
}

/** #1235 item 7 (UI standard §4): the person's own pages, at the top of the
 *  sidebar on every account page. */
export function AccountSidebarGroup() {
  const user = getSessionUser()
  return (
    <SidebarGroup
      first
      heading="Account"
      tone="indigo"
      testid="sidebar-group-account"
      items={[
        { to: ACCOUNT_SIGN_IN_METHODS_PATH, label: 'Sign-In Methods', icon: LogIn, testid: 'sidebar-sign-in-methods' },
        { to: ACCOUNT_CONNECTED_APPS_PATH, label: 'Connected Apps', icon: Cable, testid: 'sidebar-connected-apps' },
        ...(user ? [{ to: `/featherbase/account/access/${encodeURIComponent(user.row_id)}`, label: 'What You Can See', icon: Eye, testid: 'sidebar-access-explanation' }] : []),
      ]}
    />
  )
}

