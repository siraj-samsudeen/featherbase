import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { GROUP_TONE, RAIL_ROW, ROW_IDLE, ROW_SELECTED, RailFold, RailMenuItem, RailRule, SIDEBAR_HEADING, SidebarRailContext, TableTile, useSidebarRail, type GroupTone } from '../components/SidebarRail'
import { attachRailTips, railMark, sidebarWords } from '../lib/sidebar-rail'
import { Link, Navigate, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ACCOUNT_CONNECTED_APPS_PATH, ACCOUNT_SIGN_IN_METHODS_PATH, FEATHERBASE_ADMIN_DESTINATION, JOBS_PATH, adminPageNeedsManage, ownFramePolicyPage, tableHref, type CommandDestinations, type CommandPageDestination } from 'shared'
import { SIDEBAR_VIEWS_KEY, useNavigationSettings } from '../lib/nav-settings'
import { pathHref } from '../lib/navigation'
import { encodePath, type NavPath } from '../lib/nav-path'
import { useSidebarWalkLabels } from '../components/NavPathBar'
import { RecentSub } from '../components/RecentSub'
import { Route } from 'lucide-react'
import { ApiError, api, getSessionUser } from '../lib/api'
import {
  actionForLocation,
  ago,
  connectEventSink,
  frequentActions,
  replaceServerEntries,
  displayEntry,
  recentActions,
  recentSearches,
  uniqueByDisplay,
  sharedNames,
  recordAction,
  type RecentEntry,
  type ServerRecentEntry,
} from '../lib/recents'
import { useHomePages } from '../lib/home-pages'
import { useCapabilities, useShellKind } from '../lib/session'
import { useRealtime } from '../lib/realtime'
import { ThemeChoiceProvider, useThemeChoice } from '../lib/theme-choice'
import { useStreamedSearch, type SearchHit } from '../lib/search-stream'
import { ActionDisclosure } from '../components/ActionDisclosure'
import { TopBar } from '../components/TopBar'
import { EntryLabel, useLiveDestinations } from '../lib/row-titles'
import { metaQuery, tableLabel, useMeta, type TableMeta } from '../lib/meta'
import { useI18n } from '../lib/i18n'
import { COMMAND_SHORTCUT, SIDEBAR_DRAWER_QUERY, SIDEBAR_SHORTCUT, offerSidebarSlots, useRegisterSidebar, useSidebar } from '../lib/sidebar-collapsed'
import { KindIcon } from '../lib/kind-icons'
import { DataSourcesSidebar } from '../components/DataSourcesSidebar'
import { NoAccessPage, REPORT_PATH, Waiting } from './RestrictedShell'
import { WAITING_COUNT_QUERY_KEY } from './WaitingForAccess'
import { HealthBanner, INSTANCE_HEALTH_PATH, SETUP_PERSON_LABEL, SETUP_PERSON_PATH, SetupBanner, useSetupNeeded } from './InstanceHealth'
import { GLOSSARY_PATH } from '../lib/glossary'
import { useSetupOffer } from './FirstRunSetup'
import { StatusPill, buttonClasses, cardClasses, iconButtonClasses, inputClasses, touchRowClasses, useMediaQuery } from '@featherbase/shop-floor'
import { Bell, BookOpen, Bookmark, Cable, CalendarClock, ChevronsLeft, ChevronsRight, Clock, Plus, Search, Upload, Compass, Eye, History, Key, ListChecks, LogIn, Table, UserRoundSearch, type LucideIcon } from '@featherbase/shop-floor'
import { fmtCount } from '@featherbase/shop-floor'
import { ADMIN_HOME_SHORTCUT_DEF, COMMAND_SHORTCUT_DEF, NEW_ROW_SHORTCUT_DEF, noteShortcutUse, shortcutControl, useShortcut } from '../lib/shortcuts'



/** #1265: the most record rows the bar shows. */
const RECORD_CAP = 15

// #101 Phase 3: recorded actions also stream to the server's user_event log
// (batched; a beacon carries the final batch through unload). The sink is
// injected here so lib/recents stays network-free for unit tests. Auth rides
// the bearer token for fetches and the sid cookie for beacons — sendBeacon
// cannot set headers.
connectEventSink({
  // The queue fail-closes on this identity: only events recorded FOR this
  // user are ever posted with this user's credentials.
  currentUser: () => getSessionUser()?.row_id ?? null,
  post: (events, recorded) => {
    void api.post<{ timestamps: number[] }>('/api/events', { events }).then(
      ({ timestamps }) => {
        recorded(timestamps)
        window.dispatchEvent(new Event('navigation-history-updated'))
      },
    ).catch(
      () => {},
    )
  },
  beacon: (events) => {
    try {
      navigator.sendBeacon('/api/events', new Blob([JSON.stringify({ events })], { type: 'application/json' }))
    } catch {
      /* best-effort */
    }
  },
})

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
  // A report reader has no Admin page left: their sign-in methods are an
  // account page now (#489), so every Admin address sends them to the report.
  if (kind === 'report-only') return <Navigate to={REPORT_PATH} replace />
  return <AdminShell fillHeight={fillHeight} />
}

export function AdminShell({ fillHeight, account = false }: { fillHeight: boolean; account?: boolean }) {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const user = getSessionUser()
  // The command bar's theme commands; the bar's own toggle is in TopBar.
  const { set: setTheme } = useThemeChoice()
  // #501 item 1: the browser tab says "Featherbase Admin", as the bar does;
  // TopBar sets it from the bar's name.
  const [search, setSearch] = useState('')

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
  const [barFocused, setBarFocused] = useState(false)
  const [selection, setSelection] = useState<{ query: string; id: string } | null>(null)
  const [, refreshHistory] = useState(0)
  useEffect(() => {
    const refresh = () => refreshHistory((version) => version + 1)
    window.addEventListener('navigation-history-updated', refresh)
    return () => window.removeEventListener('navigation-history-updated', refresh)
  }, [])

  // Cached destinations are not offered until the initial summary settles.
  // A failed request unlocks the untouched cache as a best-effort fallback.
  const [historyReadyFor, setHistoryReadyFor] = useState<string | null>(null)
  useEffect(() => {
    if (!user) return
    let active = true
    setHistoryReadyFor(null)
    api
      .get<{ entries: ServerRecentEntry[] }>('/api/events/summary')
      .then((res) => {
        if (active) replaceServerEntries(user.row_id, res.entries)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setHistoryReadyFor(user.row_id)
      })
    return () => { active = false }
  }, [user?.row_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const historyReady = Boolean(user && historyReadyFor === user.row_id)
  // UI-025: on narrow (mobile) widths the sidebar collapses into a drawer
  // toggled from the navbar; on md+ it is always shown. #1018: on md+ it can
  // be collapsed to give the page its width; a phone keeps its drawer,
  // whatever was chosen on a wider window. #1227: the state, the controls and
  // Ctrl/Cmd+B are the shared ones every app's sidebar uses (TopBar).
  const { collapsed: collapsedChoice, setDrawerOpen: setSidebarOpen } = useSidebar(user?.row_id)
  // #1248: collapsed (md+), the sidebar is an icon rail; each group draws its rail form.
  const drawerWidth = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const rail = collapsedChoice && !drawerWidth

  // RT-003: unread notification count, live-updated when a realtime
  // 'notification' event arrives for this user.
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<{ count: number }>('/api/unread_count'),
  })
  useRealtime(user ? [`user:${user.row_id}`] : [], (e) => {
    if (e.event === 'notification')
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] })
  })

  const destinations = useQuery({
    queryKey: ['command-destinations', user?.row_id],
    queryFn: () => api.get<CommandDestinations>('/api/command_destinations'),
    enabled: barFocused,
  })
  const inventory = destinations.isError ? undefined : destinations.data
  const tables = inventory?.tables
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

  // ⌘K / Ctrl+K focuses the command bar (PR-2-style command palette entry).
  const searchRef = useRef<HTMLInputElement>(null)
  useShortcut(COMMAND_SHORTCUT_DEF) // #1251
  useShortcut(ADMIN_HOME_SHORTCUT_DEF)
  // G then N makes a row of the Table on screen: listed only where there is one.
  const onTable = useRouterState({ select: (s) => s.matches.some((m) => 'table' in m.params) })
  useShortcut(NEW_ROW_SHORTCUT_DEF, onTable)
  const commandFormRef = useRef<HTMLFormElement>(null)
  // #1253: the command bar is a box in the middle of the screen, drawn while
  // open; its input takes the focus once it is drawn.
  useLayoutEffect(() => {
    if (barFocused) searchRef.current?.focus()
  }, [barFocused])
  function openCommandBar() {
    setBarFocused(true)
    setSelection(null)
  }

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!commandFormRef.current?.contains(event.target as Node)) {
        setBarFocused(false)
        setSelection(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  // UI-015: global keyboard shortcuts.
  //   Ctrl/Cmd+K  focus the command bar (command palette)
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

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBarFocused(true)
        setSelection(null)
        searchRef.current?.focus()
        searchRef.current?.select()
        noteShortcutUse('command', 'key')
        return
      }
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

  // #101 Phase 5: the "Last search" resume tile hands its query to the
  // command bar — prefilled and focused, ready to re-run.
  useEffect(() => {
    function onPrefill(e: Event) {
      const q = (e as CustomEvent<string>).detail
      if (typeof q === 'string') setSearch(q)
      setBarFocused(true)
      setSelection(null)
      searchRef.current?.focus()
    }
    window.addEventListener('fc:prefill-search', onPrefill)
    return () => window.removeEventListener('fc:prefill-search', onPrefill)
  }, [])

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


  // UI-014: row hits from the server, debounced.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 150)
    return () => clearTimeout(t)
  }, [search])
  // #1265: the record search streams group by group; a newer query aborts the older.
  const streamed = useStreamedSearch(debounced)

  // #101: with the bar focused and empty, the dropdown shows Recent (pure
  // recency) and Frequent (frecency) groups; while typing it offers matching
  // past searches. All three read the per-user localStorage buffer.
  const trimmed = search.trim()
  // A resolved previous query remains cached during the typing debounce;
  // it is not a result of the text currently in the input.
  const current = trimmed !== '' && trimmed === debounced && streamed.query === trimmed
  // At most RECORD_CAP rows, taken in group order (ordinary Tables before
  // registries), whatever order the groups answered in.
  let room = RECORD_CAP
  const recordGroups = (current ? streamed.groups : []).map((g) => {
    if (!g.hits) return g
    const hits = g.hits.slice(0, room)
    room -= hits.length
    return { ...g, hits }
  })
  const recordHits: (SearchHit & { label: string })[] = recordGroups.flatMap((g) => (g.hits ?? []).map((h) => ({ ...h, label: g.label })))
  // Searching from the first keystroke until every group has answered.
  const searching = trimmed !== '' && !(current && streamed.done)
  const pendingGroups = recordGroups.filter((g) => g.hits === undefined)
  // #1265: after 1.5s the wait is named, group by group.
  const [slowFor, setSlowFor] = useState('')
  useEffect(() => {
    if (!searching) return
    const timer = setTimeout(() => setSlowFor(trimmed), 1500)
    return () => clearTimeout(timer)
  }, [searching, trimmed])
  const slow = searching && slowFor === trimmed
  const showRecents = Boolean(barFocused && trimmed === '' && historyReady)
  // #898: the command bar and the sidebar offer only rows that still exist.
  const remembered = historyReady && user ? [...recentActions(user.row_id, 20), ...frequentActions(user.row_id, 12)] : []
  const live = useLiveDestinations(remembered)
  const offered = (entries: RecentEntry[]) => entries.filter((e) => live?.has(e.key))
  const recentItems = showRecents && user ? uniqueByDisplay(offered(recentActions(user.row_id, 12))).slice(0, 6) : []
  const frequentItems =
    showRecents && user
      ? uniqueByDisplay([...recentItems, ...offered(frequentActions(user.row_id, 8))]).slice(recentItems.length, recentItems.length + 4)
      : []
  const pick = [...recentItems, ...frequentItems]
  const searchChips = historyReady && user && trimmed ? recentSearches(user.row_id, trimmed, 3) : []
  const selectedId = barFocused
    ? selection?.query === search ? selection.id : showRecents && pick[0] ? `command-recent-${encodeURIComponent(pick[0].key)}` : undefined
    : undefined

  function resultProps(key: string) {
    const id = `command-${encodeURIComponent(key)}`
    return { id, role: 'option' as const, 'aria-selected': id === selectedId }
  }

  function resultElements() {
    return Array.from(searchRef.current?.form?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
  }

  // #101 Phase 2: the sidebar's zero-keystroke recall — destinations only
  // (searches stay in the command bar, where they can be re-run).
  const sidebarCandidates = historyReady && user
    ? uniqueByDisplay(offered(recentActions(user.row_id, 20)).filter((e) => e.kind !== 'search')).slice(0, SIDEBAR_RECENT_CAP)
    : []
  const recentSlots = sidebarCandidates.slice(0, SIDEBAR_RECENT_CAP)
  const sidebarFrequent = historyReady && user
    ? uniqueByDisplay([...recentSlots, ...offered(frequentActions(user.row_id, 12))]).slice(recentSlots.length, recentSlots.length + 2)
    : []
  const sidebarEntries = sidebarFrequent.length ? recentSlots : sidebarCandidates
  // #1288: a remembered walk is one entry among the recent pages and records, in time order, in the same slots.
  const navSettings = useNavigationSettings()
  const walkLabels = useSidebarWalkLabels(navSettings.walks.map((w) => w.path))
  const sidebarRecent: SidebarRecentItem[] = (historyReady && user
    ? [
        ...sidebarEntries.map((entry) => ({ kind: 'entry' as const, entry, at: entry.visits[entry.visits.length - 1] ?? 0 })),
        ...navSettings.walks.map((walk, i) => ({ kind: 'walk' as const, path: walk.path, label: walkLabels[i], at: walk.at })),
      ].sort((a, b) => b.at - a.at).slice(0, sidebarFrequent.length ? recentSlots.length : SIDEBAR_RECENT_CAP)
    : [])
  const openWalk = (path: NavPath) => router.history.push(pathHref(path))
  // Two rows of one name (a list under two filters) each say what sets them apart.
  const sharedRecentNames = sharedNames([...sidebarEntries, ...sidebarFrequent])

  function recordSearch(q: string) {
    if (user && q) recordAction(user.row_id, { kind: 'search', key: `search:${q.toLowerCase()}`, label: q, path: '' })
  }

  function dismissSearch() {
    setSearch('')
    // Clear row matches immediately, not after the typing debounce.
    setDebounced('')
    setBarFocused(false)
    setSelection(null)
    searchRef.current?.blur()
  }

  function openRecent(entry: RecentEntry) {
    if (entry.kind === 'search') {
      setSelection(null)
      setSearch(entry.label)
      searchRef.current?.focus()
      return
    }
    dismissSearch()
    router.history.push(entry.path)
  }

  function openDoc(hit: SearchHit) {
    recordSearch(search.trim())
    dismissSearch()
    navigate({ to: '/featherbase/admin/table/$table/row/$name', params: { table: hit.table, name: hit.row_id }, search: { prefill: undefined } })
  }

  function openPage(page: CommandPageDestination) {
    recordSearch(search.trim())
    dismissSearch()
    // Runtime apps and pages with their own frame policy need a full load.
    if (page.kind === 'App' || page.kind === 'App tab' || ownFramePolicyPage(page.href)) window.location.assign(page.href)
    else router.history.push(page.href)
  }

  // Explicit selection uses the same activation as a pointer or Tab/Enter.
  // Without it, preserve the exact-Table/first-record Enter defaults.
  function runSearch(e: React.FormEvent) {
    e.preventDefault()
    const selected = resultElements().find((el) => el.id === selectedId)
    if (selected) {
      selected.click()
      return
    }
    const q = search.trim()
    if (!q) return
    recordSearch(q)
    const dtHit = tables?.find((d) => d.row_id.toLowerCase() === q.toLowerCase())
      ?? tables?.find((d) => d.label.toLowerCase() === q.toLowerCase())
    if (dtHit) {
      dismissSearch()
      navigate({ to: '/featherbase/admin/table/$table', params: { table: dtHit.row_id }, search: { filters: undefined } })
      return
    }
    const doc = recordHits[0]
    if (doc) {
      openDoc(doc)
      return
    }
    const page = pageHits.find((page) => [page.label, ...(page.aliases ?? [])].some((label) => label.toLowerCase() === q.toLowerCase())) ?? pageHits[0]
    if (page) openPage(page)
    else if (suggestions[0]) {
      dismissSearch()
      navigate({ to: '/featherbase/admin/table/$table', params: { table: suggestions[0].row_id }, search: { filters: undefined } })
    } else {
      dismissSearch()
      navigate({ to: '/featherbase/admin/table/$table', params: { table: q }, search: { filters: undefined } })
    }
  }

  // User tables surface before system tables in suggestions (stable sort
  // keeps the alphabetical order within each group).
  const suggestions =
    search.trim().length > 0
      ? (tables ?? [])
          .filter((d) => [d.row_id, d.label].some((label) => label.toLowerCase().includes(trimmed.toLowerCase())))
          .sort((a, b) => Number(a.system) - Number(b.system))
      : []
  // #432: a Table whose rows only the platform writes is never offered as "New".
  const creatableSuggestions = suggestions.filter((d) => d.can_create)
  const pageHits = trimmed
    ? (inventory?.pages ?? []).filter((page) => [page.label, ...(page.aliases ?? [])].some((label) => label.toLowerCase().includes(trimmed.toLowerCase())))
    : []

  // Command actions surfaced through the command bar (the ⌘K palette).
  const commands = [
    ...(canManage ? [{ id: 'new-table', label: 'New Table', run: () => navigate({ to: '/featherbase/admin/new-table' }) }] : []),
    { id: 'theme-light', label: 'Theme: light', run: () => setTheme('light') },
    { id: 'theme-dark', label: 'Theme: dark (dark mode)', run: () => setTheme('dark') },
    { id: 'theme-device', label: 'Theme: same as device', run: () => setTheme('device') },
    { id: 'home', label: 'Go to Admin home', run: () => navigate({ to: '/featherbase/admin' }) },
  ]
  const commandHits =
    search.trim().length > 1
      ? commands.filter((c) => c.label.toLowerCase().includes(search.trim().toLowerCase()))
      : []
  // #1265: once every group has answered and nothing anywhere matched, say so.
  const noMatch = current && streamed.done && !streamed.failed && recordHits.length === 0 &&
    pageHits.length === 0 && commandHits.length === 0 && suggestions.length === 0

  // #1253: the command bar, opened from the sidebar's field or ⌘K as a wide box
  // in the middle of the screen.
  const commandBar = (
        <form
          ref={commandFormRef}
          onSubmit={runSearch}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            if (e.target instanceof HTMLElement) e.target.blur()
            setBarFocused(false)
            setSelection(null)
          }}
          // #489 item 11: the recents close only when focus leaves the whole
          // command bar, so Tab from the input reaches them (visual order).
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setBarFocused(false)
              setSelection(null)
            }
          }}
          className="relative w-full"
          data-testid="awesomebar"
        >
          <div className="relative">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => {
              setSelection(null)
              setSearch(e.target.value)
            }}
            onFocus={() => {
              setBarFocused(true)
              setSelection(null)
            }}
            onClick={() => setBarFocused(true)}
            onKeyDown={(e) => {
              // Modified arrows belong to the input's native text editing.
              if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.nativeEvent.isComposing) return
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              const results = resultElements()
              if (!results.length) return
              e.preventDefault()
              const at = results.findIndex((el) => el.id === selectedId)
              const next = e.key === 'ArrowDown'
                ? (at + 1) % results.length
                : (at < 0 ? results.length - 1 : (at - 1 + results.length) % results.length)
              setSelection({ query: search, id: results[next].id })
              results[next].scrollIntoView?.({ block: 'nearest' })
            }}
            placeholder="Search or type a command…"
            aria-label="Search or type a command"
            aria-controls={barFocused ? 'command-results' : undefined}
            aria-activedescendant={selectedId}
            aria-autocomplete="list"
            className={inputClasses('pr-12')}
          />
          <kbd
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1 text-xs text-ink-subtle"
            aria-hidden="true"
          >
            {COMMAND_SHORTCUT}
          </kbd>
          </div>
          {barFocused && (suggestions.length > 0 ||
            pageHits.length > 0 ||
            commandHits.length > 0 ||
            recordHits.length > 0 ||
            searching || noMatch || (current && streamed.failed) ||
            (showRecents && pick.length > 0) ||
            searchChips.length > 0) && (
            <div
              id="command-results"
              role="listbox"
              aria-label="Search results"
              className="mt-2 max-h-[min(60vh,32rem)] w-full overflow-y-auto py-1 [&_[aria-selected=true]]:bg-action-tint"
              data-testid="awesomebar-results"
              onMouseDown={(e) => e.preventDefault()}
            >
              {/* #1265: the search shows its work: a line that runs while it
                  searches (a still label under reduced motion), and what it
                  is waiting for once that takes a while. */}
              {searching && (
                <div className="px-3 pb-1 pt-0.5" data-testid="search-progress" role="status">
                  <div aria-hidden className="relative mb-1 h-0.5 overflow-hidden rounded-full bg-border motion-reduce:hidden">
                    <span className="search-progress-run absolute inset-y-0 left-0 w-1/3 rounded-full bg-action" />
                  </div>
                  <p className="text-xs text-ink-muted" data-testid="search-progress-text">
                    {slow && pendingGroups.length
                      ? `Still searching ${pendingGroups.slice(0, 3).map((g) => g.label).join(', ')}${pendingGroups.length > 3 ? ` and ${pendingGroups.length - 3} more` : ''}…`
                      : 'Searching people, records and tables…'}
                  </p>
                </div>
              )}
              {noMatch && (
                <div className="px-3 py-2 text-sm" data-testid="search-no-match">
                  <p className="text-ink">No matches for “{trimmed}”</p>
                  <p className="text-xs text-ink-muted">Try part of the name, or a code.</p>
                </div>
              )}
              {current && streamed.failed && !noMatch && (
                <p className="px-3 py-2 text-xs text-negative" data-testid="search-failed">The search stopped before it finished. Type again to retry.</p>
              )}
              {/* #101: empty-bar recents — mousedown is swallowed so the
                  input keeps focus until the click lands. */}
              {showRecents && pick.length > 0 && (
                <div data-testid="awesomebar-recents" onMouseDown={(e) => e.preventDefault()}>
                  <div className="px-3 pb-0.5 pt-1 text-xs font-semibold text-ink-subtle">
                    Recently opened
                  </div>
                  {recentItems.map((r) => (
                    <RecentRow key={r.key} entry={r} optionProps={resultProps(`recent-${r.key}`)} onOpen={openRecent} />
                  ))}
                  {frequentItems.length > 0 && (
                    <div className="px-3 pb-0.5 pt-1.5 text-xs font-semibold text-ink-subtle">
                      Frequent
                    </div>
                  )}
                  {frequentItems.map((r) => (
                    <RecentRow
                      key={r.key}
                      entry={r}
                      optionProps={resultProps(`recent-${r.key}`)}
                      onOpen={openRecent}
                    />
                  ))}
                </div>
              )}
              {/* #101: matching past searches while typing — click refills the bar. */}
              {searchChips.map((s) => (
                <button
                  key={s.key}
                  {...resultProps(`search-${s.key}`)}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openRecent(s)}
                  data-testid="awesomebar-recent-search"
                  className="flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint"
                >
                  <span className="text-ink-subtle">↻</span> {s.label}
                  <span className="ml-2 text-xs text-ink-subtle">recent search</span>
                </button>
              ))}
              {commandHits.length > 0 && (
                <h2 data-testid="awesomebar-commands-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Commands</h2>
              )}
              {commandHits.map((cmd) => (
                <button
                  key={cmd.id}
                  {...resultProps(`action-${cmd.id}`)}
                  type="button"
                  onClick={() => {
                    dismissSearch()
                    cmd.run()
                  }}
                  data-testid={`awesomebar-cmd-${cmd.id}`}
                  className="flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint"
                >
                  <span className="text-action">›</span> {cmd.label}
                </button>
              ))}
              {pageHits.length > 0 && (
                <h2 data-testid="awesomebar-pages-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Pages</h2>
              )}
              {pageHits.map((page) => (
                <a
                  key={page.href}
                  {...resultProps(`page-${page.href}`)}
                  href={page.href}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                    e.preventDefault()
                    openPage(page)
                  }}
                  data-testid="awesomebar-page"
                  className="block px-3 py-1.5 text-sm text-ink hover:bg-action-tint"
                >
                  {page.label}
                  <span className="ml-2 text-xs text-ink-muted">{page.kind}</span>
                </a>
              ))}
              {suggestions.length > 0 && (
                <h2 data-testid="awesomebar-tables-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Tables</h2>
              )}
              {suggestions.map((d) => (
                <Link
                  key={d.row_id}
                  {...resultProps(`table-${d.row_id}`)}
                  to="/featherbase/admin/table/$table"
                  params={{ table: d.row_id }}
                  search={{ filters: undefined }}
                  onClick={dismissSearch}
                  data-testid="awesomebar-table"
                  className="block px-3 py-1.5 text-sm text-ink hover:bg-action-tint"
                >
                  {d.label}
                  <span className="ml-2 text-xs text-ink-muted">{d.module} module · {d.kind === 'settings' ? 'settings' : 'open list'}</span>
                </Link>
              ))}
              {/* UI-014: "new X" action for matched Tables */}
              {creatableSuggestions.length > 0 && (
                <h2 data-testid="awesomebar-create-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Create rows</h2>
              )}
              {creatableSuggestions.slice(0, 2).map((d) => (
                <Link
                  key={`new-${d.row_id}`}
                  {...resultProps(`new-${d.row_id}`)}
                  to="/featherbase/admin/table/$table/new"
                  search={{ prefill: undefined }}
                  params={{ table: d.row_id }}
                  onClick={dismissSearch}
                  data-testid="awesomebar-new"
                  className="block px-3 py-1.5 text-sm text-ink hover:bg-action-tint"
                >
                  <span className="text-action">+</span> New {d.label} row
                </Link>
              ))}
              {/* UI-014: row hits. #1265: by group as each Table answers; a group
                  still on its way shows two quiet rows (the first three only),
                  one with nothing found is gone. The name, then the Table. */}
              {(recordHits.length > 0 || pendingGroups.length > 0) && (
                <h2 data-testid="awesomebar-records-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Records</h2>
              )}
              {recordGroups.map((g) => g.hits === undefined
                ? pendingGroups.indexOf(g) < 3 && (
                  <div key={`pending-${g.table}`} aria-hidden data-testid="search-group-pending" className="space-y-1.5 px-3 py-1.5">
                    <div className="h-3 w-2/3 rounded bg-border/70" />
                    <div className="h-3 w-1/2 rounded bg-border/50" />
                  </div>
                )
                : g.hits.map((h) => (
                  <button
                    key={`${h.table}/${h.row_id}`}
                    {...resultProps(`record-${h.table}/${h.row_id}`)}
                    type="button"
                    onClick={() => openDoc(h)}
                    data-testid="awesomebar-doc"
                    className="flex min-h-control w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-action-tint"
                  >
                    <TableTile name={g.label} />
                    <span className="min-w-0 flex-1 truncate">{h.title}</span>
                    <span className="shrink-0 text-xs text-ink-muted" data-testid="awesomebar-doc-table">{h.kind_label ?? g.label}</span>
                  </button>
                )))}
            </div>
          )}
        </form>
  )

  return (
    <>
    <div className="flex h-full flex-col bg-canvas">
      {/* #465 D8: System Managers only, while a health check fails; above the
          top bar, beside the preview banner. */}
      <HealthBanner enabled={canManage} />
      <SetupBanner enabled={canManage} />
      {/* #1253: no top bar. The shared bar draws the Admin's switcher, the
          notification bell and the "Search or Command" field at the top of
          the sidebar, and the account at its foot; a phone keeps a slim
          header with the menu button. */}
      <TopBar
        home="admin"
        command={<CommandField rail={rail} onOpen={openCommandBar} />}
        beforeRight={
          <div className="relative shrink-0" title="Notifications">
            {/* An indicator, not a control, so it needs no thumb-sized hit area. */}
            <span className="flex size-8 items-center justify-center text-ink-muted" data-testid="notif-bell">
              <Bell aria-hidden size={16} />
              <span className="sr-only">Notifications</span>
            </span>
            {(unread.data?.count ?? 0) > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-negative px-1 text-xs font-semibold text-action-ink"
                data-testid="unread-count"
              >
                {unread.data?.count}
              </span>
            )}
          </div>
        }
      />
      <div
        className={barFocused ? 'fixed inset-0 z-50 flex items-start justify-center bg-scrim/30 px-4 pt-[12vh]' : 'hidden'}
        data-testid="command-palette"
      >
        {/* A dialog only while open: closed, it is not one on the page. */}
        <div role={barFocused ? 'dialog' : undefined} aria-label={barFocused ? 'Search or Command' : undefined} className={cardClasses('w-full max-w-2xl p-2 shadow-lg')}>
          {commandBar}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <SidebarAside testid="admin-sidebar" user={user?.row_id}>
          {/* #1235 item 7: on the account pages, the Account group leads the sidebar. */}
          {account && <AccountSidebarGroup />}
          {/* #80: the sidebar is Home Pages only. Every
              table stays reachable through the All tables entry below —
              grouping and curation moved there, nothing is hidden. */}
          {/* The sidebar scrolls as ONE column: the Home Pages keep their full
              height whatever sits below them. */}
          <nav className={`shrink-0 px-2 ${rail ? 'py-1' : 'pt-1'}`} data-testid="home-page-nav" aria-label="Modules">
            {/* #1242 (admin-lists 8): headed and drawn like every other group. */}
            {rail ? <RailRule heading="Modules" /> : (
            <h2 className={SIDEBAR_HEADING} data-testid="sidebar-group-heading">Modules</h2>
            )}
            {homePages.isLoading && (
              <p className="px-2 py-1 text-xs text-ink-subtle">Loading…</p>
            )}
            {(homePages.data?.pages ?? []).map((p) => {
              const marked = p.row_id === openModulePage
              const label = p.label || p.row_id
              // #1248: a module with no emoji of its own shows its initials in the rail.
              const mark = p.icon ? undefined : railMark(label)
              return (
                <Link
                  key={p.row_id}
                  to="/featherbase/admin/home/$name"
                  params={{ name: p.row_id }}
                  data-testid={`home-page-link-${p.row_id}`}
                  data-rail-mark={mark}
                  aria-current={marked ? 'page' : undefined}
                  className={`${rail ? RAIL_ROW : touchRowClasses('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm')}${marked ? ` ${SIDEBAR_ROW_SELECTED}` : ''}`}
                  inactiveProps={{ className: marked ? '' : SIDEBAR_ROW_IDLE }}
                  activeProps={{ className: SIDEBAR_ROW_SELECTED, 'aria-current': 'page' }}
                >
                  {/* The page's own emoji takes the icon's place, unread. */}
                  {/* #1253: a module with no emoji shows its initials, tinted in the group's hue. */}
                  {rail
                    ? (p.icon
                        ? <span aria-hidden className="text-base leading-none">{p.icon}</span>
                        : <span aria-hidden data-testid="rail-mark" className={`grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-current/15 text-xs font-bold leading-none ${GROUP_TONE.blue}`}>{mark}</span>)
                    : p.icon
                      ? <span aria-hidden data-testid="sidebar-item-icon" className={`flex w-5 shrink-0 justify-center text-sm leading-none ${GROUP_TONE.blue}`}>{p.icon}</span>
                      : <span aria-hidden data-testid="sidebar-item-icon" className={`grid h-5 w-5 shrink-0 place-items-center rounded-md bg-current/15 text-xs font-bold leading-none ${GROUP_TONE.blue}`}>{railMark(label)}</span>}
                  <span className={rail ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{label}</span>
                </Link>
              )
            })}
          </nav>
          {/* #101 Phase 2: recall without a keystroke — the same per-user
              buffer the command bar reads. */}
          {rail && (sidebarRecent.length > 0 || sidebarFrequent.length > 0) && (
            <RailFold label="Recently Opened" icon={Clock} testid="sidebar-recents" tone="slate">
              {(close) => [...sidebarRecent, ...sidebarFrequent.map((entry) => ({ kind: 'entry' as const, entry, at: 0 }))].map((item) => item.kind === 'walk' ? (
                <RailMenuItem key={`walk:${encodePath(item.path)}`} close={close} onSelect={() => openWalk(item.path)}>
                  <span className="truncate" data-testid="sidebar-walk">{item.label}</span>
                </RailMenuItem>
              ) : (
                <RailMenuItem key={item.entry.key} close={close} onSelect={() => openRecent(item.entry)}>
                  <span className="truncate"><EntryLabel entry={item.entry} /><RecentDiffers entry={item.entry} shared={sharedRecentNames} /></span>
                </RailMenuItem>
              ))}
            </RailFold>
          )}
          {!rail && (sidebarRecent.length > 0 || sidebarFrequent.length > 0) && (
            <div className="px-2 pt-3" data-testid="sidebar-recents">
              {/* A heading, not a link: small, grey, regular weight (#1253). */}
              <h2 className={SIDEBAR_HEADING} data-testid="sidebar-recents-heading">Recently Opened</h2>
              {sidebarRecent.map((item) => item.kind === 'walk' ? (
                <SidebarWalkRow key={`walk:${encodePath(item.path)}`} label={item.label} at={item.at} href={pathHref(item.path)} onOpen={() => { setSidebarOpen(false); openWalk(item.path) }} />
              ) : (
                <SidebarRecentRow key={item.entry.key} entry={item.entry} shared={sharedRecentNames} onOpen={(e) => { setSidebarOpen(false); openRecent(e) }} />
              ))}
              {sidebarFrequent.length > 0 && (
                <h2 className="px-2 pb-0.5 pt-2 text-xs text-ink-subtle">
                  Frequent
                </h2>
              )}
              {sidebarFrequent.map((r) => (
                <SidebarRecentRow key={r.key} entry={r} shared={sharedRecentNames} frequent onOpen={(e) => { setSidebarOpen(false); openRecent(e) }} />
              ))}
            </div>
          )}
          {/* #1229: the person's saved views, own and starred, one click each. */}
          <SidebarSavedViews onOpen={(href) => { setSidebarOpen(false); router.history.push(href) }} />
          {/* Two labelled groups under the Home Pages and the recents, headed
              like "Recently opened". Visibility per item is unchanged; a group
              with nothing visible for this person drops its heading too. */}
          <SidebarGroup
            heading="Data"
            tone="teal"
            testid="sidebar-group-data"
            items={[
              { to: '/featherbase/admin/all-tables', label: 'All tables', icon: Table, testid: 'all-tables-link' },
              // The owner's review (17-Nov): New table and Import data are two links here, not a "+ New" menu.
              ...(canManage ? [
                { to: '/featherbase/admin/new-table', label: 'New table', icon: Plus, testid: 'new-table-link' },
                { to: '/featherbase/admin/import', search: { table: undefined }, label: 'Import data', icon: Upload, testid: 'import-data-link' },
              ] : []),
              // #629: everyone signed in reads the glossary.
              { to: GLOSSARY_PATH, label: 'Glossary', icon: BookOpen, testid: 'glossary-link' },
              // #206: an import is a thing you did, not just rows that appeared —
              // so it has a place to be found again.
              ...(canManage ? [{ to: '/featherbase/admin/imports', label: 'Past imports', icon: History, testid: 'past-imports-link' }] : []),
            ]}
          />
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
                  { to: '/featherbase/admin/leavers-who-can-sign-in', label: 'Leavers who can still sign in', icon: LogIn, testid: 'leavers-link' }]
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
                  { to: INSTANCE_HEALTH_PATH, label: 'Instance health', icon: ListChecks, testid: 'instance-health-link' },
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

/** A sidebar row's colours (#1253, Quiet Canvas): the open page is a white tile
 *  with a soft shadow on the grey canvas; a hover is a soft grey fill. */
const SIDEBAR_ROW_IDLE = ROW_IDLE
const SIDEBAR_ROW_SELECTED = ROW_SELECTED
/** #1253: the page is one white panel on the canvas, set off by a soft shadow,
 *  8px from the window's edges; a phone shows it edge to edge. */
export const PAGE_PANEL = 'min-w-0 flex-1 overflow-auto bg-surface p-3 sm:px-5 sm:py-4 md:my-2 md:mr-2 md:rounded-xl md:shadow-sm'

interface SidebarItem {
  to: string
  search?: Record<string, undefined>
  label: string
  icon: LucideIcon
  testid: string
  badge?: React.ReactNode
}

/** A labelled group of sidebar links: a muted sentence-case heading with a
 *  small icon (a heading, not a link), then each link with its grey icon.
 *  Renders nothing — heading included — when no item is visible. */
/** #1253 (style A): a one-line sidebar item: its tile, its name, its detail on the right. */
const SIDEBAR_LINE = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm'

/** Recently opened holds at most this many items, Frequent included. */
const SIDEBAR_RECENT_CAP = 5

/** #1288: Recently Opened holds recent pages and records, and the person's remembered walks. */
type SidebarRecentItem =
  | { kind: 'entry'; entry: RecentEntry; at: number }
  | { kind: 'walk'; path: NavPath; label: string; at: number }

/** #1288: a remembered walk in Recently Opened: a path mark in the sidebar's muted tone, the walk by its steps'
 *  names, and when it was taken. It opens the whole walk, its path bar and every step with it. */
function SidebarWalkRow({ label, at, href, onOpen }: { label: string; at: number; href: string; onOpen: () => void }) {
  const when = at ? ago(at) : ''
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        onOpen()
      }}
      data-testid="sidebar-walk"
      title={`${label} · opens the whole walk`}
      className={touchRowClasses(`${SIDEBAR_LINE} text-ink hover:bg-border/50`)}
    >
      <span aria-hidden data-testid="walk-tile" className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-current/15 ${GROUP_TONE.slate}`}>
        <Route size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {when && <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{when}</span>}
    </a>
  )
}

export function SidebarGroup({ heading, testid, items, first = false, tone = 'slate' }: {
  heading: string
  testid: string
  items: SidebarItem[]
  /** The group's hue for its icons (owner's review, 17-Nov). */
  tone?: GroupTone
  /** The sidebar's first group: no rule above it. */
  first?: boolean
}) {
  const rail = useSidebarRail()
  if (items.length === 0) return null
  const base = rail ? RAIL_ROW : touchRowClasses('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm')
  return (
    <div className={rail ? 'px-2 py-1' : `px-2 ${first ? 'pt-1' : 'pt-3'}`} data-testid={testid}>
      {rail ? (!first && <RailRule heading={sidebarWords(heading)} />) : (
      <h2 className={SIDEBAR_HEADING} data-testid="sidebar-group-heading">{sidebarWords(heading)}</h2>
      )}
      {items.map(({ to, search, label, icon: Icon, testid: id, badge }) => (
        <Link
          key={id}
          to={to}
          search={search as never}
          data-testid={id}
          // TanStack adds activeProps to className rather than replacing it, so
          // the unselected colours live in inactiveProps: never both at once.
          className={base}
          inactiveProps={{ className: SIDEBAR_ROW_IDLE }}
          activeProps={{ className: SIDEBAR_ROW_SELECTED, 'aria-current': 'page' }}
        >
          <Icon aria-hidden size={rail ? 18 : 14} className={`shrink-0 ${GROUP_TONE[tone]}`} data-testid="sidebar-item-icon" />
          <span className={rail ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{sidebarWords(label)}</span>
          {/* #1248: in the rail a count that asks for action is a badge on the icon. */}
          {badge && <span data-sidebar-count className={rail ? 'absolute -right-1.5 -top-1.5 [&>*]:px-1 [&>*]:py-0 [&>*]:text-xs' : 'contents'}>{badge}</span>}
        </Link>
      ))}
    </div>
  )
}

/**
 * #1227: the one sidebar frame, for the Admin and the account pages alike: 240px
 * beside the page, a 256px drawer with a backdrop under 48rem, hidden when
 * collapsed; the bar's controls and Cmd/Ctrl+B work it (lib/sidebar-collapsed).
 * Following any link inside it closes the drawer.
 *
 * #1253 (Quiet Canvas): no fill and no border of its own, on the grey canvas.
 * Its top and foot are slots the shared bar draws into (the switcher, the bell
 * and the command field; the account, help and theme), and only the links
 * between them scroll, so the menus that open from the top and foot are never
 * clipped.
 */
export function SidebarAside({ testid, user, children }: { testid: string; user: string | undefined; children: ReactNode }) {
  useRegisterSidebar(user)
  const { collapsed: choice, drawerOpen, setDrawerOpen, toggleCollapsed } = useSidebar(user)
  const isDrawer = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const collapsed = choice && !isDrawer
  // #1248: in the rail each row is named at once by a tooltip beside it.
  const aside = useRef<HTMLElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const railRef = useRef(collapsed)
  railRef.current = collapsed
  useEffect(() => {
    // The aside is always drawn by the time this runs.
    const root = aside.current!
    return attachRailTips({
      root, layer: document.body,
      active: () => railRef.current,
      // A row of an open menu (the switcher's, the account's) needs no tooltip.
      rowOf: (target) => (target instanceof Element && !target.closest('[role="menu"]') ? target.closest<HTMLElement>('a, button') : null) ?? null,
    })
  }, [])
  // Offered before the first paint, so the page never shows a top bar first.
  useLayoutEffect(() => offerSidebarSlots({ top: top.current!, foot: foot.current! }), [])
  const words = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <SidebarRailContext.Provider value={collapsed}>
      {/* UI-025: on mobile, a backdrop closes the drawer. */}
      {drawerOpen && (
        <div
          className="absolute inset-0 z-20 bg-scrim/30 md:hidden"
          data-testid="sidebar-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <aside
        ref={aside}
        data-testid={testid}
        data-collapsed={collapsed ? true : undefined}
        inert={isDrawer && !drawerOpen ? true : undefined}
        aria-hidden={isDrawer && !drawerOpen ? true : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setDrawerOpen(false)
        }}
        className={`${collapsed ? 'md:w-14' : 'md:w-60'} absolute inset-y-0 left-0 z-30 flex w-64 flex-col bg-canvas transition-transform md:static md:shrink-0 md:translate-x-0 md:bg-transparent md:transition-[width] md:duration-200 md:ease-linear motion-reduce:transition-none ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div ref={top} className="shrink-0" data-testid="sidebar-slot-top" />
        <div className={`min-h-0 flex-1 overflow-y-auto${collapsed ? ' md:overflow-x-hidden' : ''}`} data-testid="sidebar-links">
          {children}
        </div>
        <div className="shrink-0 p-2">
          <div ref={foot} data-testid="sidebar-slot-foot" />
          {/* #1248: the control is the sidebar's own: its footer row, and its edge. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            data-testid="sidebar-collapse"
            // #1251's keyboard-shortcut list finds the control by these.
            data-shortcut-id="sidebar"
            data-shortcut-key={SIDEBAR_SHORTCUT}
            aria-label={words}
            aria-keyshortcuts="Meta+B Control+B"
            title={`${words.replace('sidebar', 'Sidebar')} · ${SIDEBAR_SHORTCUT}`}
            className={`max-md:hidden ${collapsed ? `${RAIL_ROW} ${ROW_IDLE}` : touchRowClasses(`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm ${ROW_IDLE}`)}`}
          >
            {collapsed ? <ChevronsRight aria-hidden size={18} className="text-ink-muted" /> : <ChevronsLeft aria-hidden size={16} className="shrink-0 text-ink-muted" />}
            {!collapsed && <span className="flex-1 text-left text-ink-muted">Collapse</span>}
            {!collapsed && <kbd className="font-mono text-xs text-ink-subtle">{SIDEBAR_SHORTCUT}</kbd>}
          </button>
        </div>
      </aside>
      <div
        aria-hidden
        data-testid="sidebar-edge"
        onClick={toggleCollapsed}
        className="group relative z-30 -mx-1.5 w-3 shrink-0 cursor-col-resize max-md:hidden"
      >
        <span className="absolute inset-y-0 left-[5px] w-0.5 bg-transparent transition-colors group-hover:bg-action" />
      </div>
    </SidebarRailContext.Provider>
  )
}

/** #1253: the field at the sidebar's top that opens the command bar; in the
 *  rail, a magnifier named by its tooltip. */
function CommandField({ rail, onOpen }: { rail: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        noteShortcutUse(COMMAND_SHORTCUT_DEF.id, 'mouse', e.currentTarget) // #1251: counts towards the ⌘K tip
        onOpen()
      }}
      data-testid="command-field"
      aria-label="Search or Command"
      aria-keyshortcuts="Meta+K Control+K"
      {...shortcutControl(COMMAND_SHORTCUT_DEF, COMMAND_SHORTCUT_DEF.label)}
      className={rail
        ? `${RAIL_ROW} ${ROW_IDLE} focus-visible:outline-2 focus-visible:outline-focus`
        : 'flex min-h-8 w-full min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md bg-border/60 px-2.5 text-sm text-ink-muted hover:bg-border focus-visible:outline-2 focus-visible:outline-focus'}
    >
      <Search aria-hidden size={rail ? 18 : 14} className="shrink-0" />
      {!rail && <span className="min-w-0 flex-1 truncate text-left">Search or Command</span>}
      {!rail && <kbd className="shrink-0 font-sans text-xs text-ink-subtle">{COMMAND_SHORTCUT}</kbd>}
    </button>
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
        { to: ACCOUNT_SIGN_IN_METHODS_PATH, label: 'Sign-in methods', icon: LogIn, testid: 'sidebar-sign-in-methods' },
        { to: ACCOUNT_CONNECTED_APPS_PATH, label: 'Connected apps', icon: Cable, testid: 'sidebar-connected-apps' },
        ...(user ? [{ to: `/featherbase/account/access/${encodeURIComponent(user.row_id)}`, label: 'What you can see', icon: Eye, testid: 'sidebar-access-explanation' }] : []),
      ]}
    />
  )
}

// #101 Phase 2: one sidebar recall row — label over sub-label, truncated to
// the rail's width, ★-marked when it comes from the Frequent ranking.
//
// It is an anchor, not a button, and that is a correctness fix rather than a
// style choice (#228). Every sidebar row is a *destination* — the searches
// that merely refill the command bar are filtered out before they get here —
// so `link` is the honest role, and it buys real href behaviour
// (middle-click, open-in-new-tab) for free. As a button it also sat in the
// same role/name space as the page's own buttons, and its name is whatever
// row the operator last visited: a chip reading "Checklist Run — checklist"
// collided with the import wizard's Check button and broke an unrelated
// journey depending only on which spec had run before it. A link cannot
// collide with a button however the trail is worded.
interface SidebarView {
  row_id: string
  table: string
  label: string
  filters: unknown
  mine: boolean
  /** #1259: the view it was saved in. */
  layout?: string
}

/** #1229: "Saved views" — the person's own views on every Table and the shared
 *  ones they starred, each opening its Table's list with the view's filters. A
 *  person with none sees no group. */
function SidebarSavedViews({ onOpen }: { onOpen: (href: string) => void }) {
  const views = useQuery({
    queryKey: SIDEBAR_VIEWS_KEY,
    queryFn: () => api.get<{ views: SidebarView[] }>('/api/saved_views/sidebar'),
  })
  const list = views.data?.views ?? []
  const rail = useSidebarRail()
  if (list.length === 0) return null
  const hrefOf = (view: SidebarView) => `${tableHref(view.table)}?filters=${encodeURIComponent(JSON.stringify(view.filters))}${view.layout ? `&layout=${view.layout}` : ''}`
  if (rail) return (
    <RailFold label="Saved Views" icon={Bookmark} testid="sidebar-saved-views" tone="amber">
      {(close) => list.map((view) => (
        <RailMenuItem key={view.row_id} close={close} onSelect={() => onOpen(hrefOf(view))}>
          <span className="truncate">{view.label}</span>
          <span className="truncate text-xs text-ink-subtle">{view.table}{view.mine ? '' : ' · shared'}</span>
        </RailMenuItem>
      ))}
    </RailFold>
  )
  return (
    <div className="px-2 pt-3" data-testid="sidebar-saved-views">
      <h2 className={SIDEBAR_HEADING}>Saved Views</h2>
      {list.map((view) => {
        const href = hrefOf(view)
        return (
          <a
            key={view.row_id}
            href={href}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              e.preventDefault()
              onOpen(href)
            }}
            data-testid="sidebar-saved-view"
            // #1253 (style A): one line; the table and who it is shared with live in the tooltip.
            title={`${view.table} table${view.mine ? '' : ' · Shared with you'}`}
            className={touchRowClasses(`${SIDEBAR_LINE} text-ink hover:bg-border/50`)}
          >
            <TableTile name={view.table} />
            <span className="min-w-0 flex-1 truncate">{view.label}</span>
          </a>
        )
      })}
    </div>
  )
}

/** Whether this entry shares its name with another and has something of its own to say. */
function differs(entry: RecentEntry, shared: Set<string>): boolean {
  const shown = displayEntry(entry)
  return !shown.row && Boolean(shown.sub) && shared.has(shown.label)
}

/** " · Site = Head Office" after a recent entry whose name another one shares
 *  (the rail's menu, which has no tile to name the Table). */
function RecentDiffers({ entry, shared }: { entry: RecentEntry; shared: Set<string> }) {
  if (!differs(entry, shared)) return null
  return <span className="text-ink-subtle" data-testid="recent-differs">{'\u00a0· '}<RecentSub entry={entry} /></span>
}

function SidebarRecentRow({
  entry,
  shared,
  frequent,
  onOpen,
}: {
  entry: RecentEntry
  shared: Set<string>
  frequent?: boolean
  onOpen: (entry: RecentEntry) => void
}) {
  const shown = displayEntry(entry)
  // #1253 (Siraj's style A): one line. The table's tile and the row's name; the
  // time (Recently Opened) or the count (Frequent) on the right; the table in the tooltip.
  // A row's Table comes from its key (row:<Table>/<id>); a list or a page is its own name.
  const tableName = shown.row?.table ?? (entry.key.startsWith('row:') ? entry.key.slice(4, entry.key.indexOf('/')) : shown.label)
  // #1241: a row's or a list's Table by its label (a page is its own title).
  const ofTable = Boolean(shown.row) || entry.key.startsWith('row:') || shown.kind === 'list'
  const table = tableLabel(tableName, useMeta(tableName, ofTable).data)
  // A filtered list says its filter in the tooltip (the second line it had before).
  const what = !shown.row && shown.sub ? `${table} · ${shown.sub}` : table
  const last = entry.visits[entry.visits.length - 1] ?? 0
  const when = ago(last)
  const meta = frequent ? `${entry.visits.length}×` : when
  const title = frequent
    ? `${what} · opened ${entry.visits.length} times`
    : `${what} · opened ${when === 'now' ? 'just now' : `${when} ago`}`
  return (
    <a
      href={entry.path}
      onClick={(e) => {
        // Let the browser handle the modified clicks it handles better.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        onOpen(entry)
      }}
      data-testid={frequent ? 'sidebar-frequent' : 'sidebar-recent'}
      title={title}
      className={touchRowClasses(`${SIDEBAR_LINE} text-ink hover:bg-border/50`)}
    >
      <TableTile name={table} />
      {/* A row whose name another shares reads as what sets it apart (one-app-chrome, 17-Nov):
          the tile names the Table, the tooltip says it all. */}
      <span className="min-w-0 flex-1 truncate">
        {differs(entry, shared)
          ? <span data-testid="recent-differs"><RecentSub entry={entry} /></span>
          : <EntryLabel entry={entry} />}
      </span>
      {frequent && <span aria-hidden className={`text-xs ${GROUP_TONE.amber}`}>★</span>}
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{meta}</span>
    </a>
  )
}

// #101: one row of the command bar's Recent/Frequent groups.

function RecentRow({
  entry,
  optionProps,
  onOpen,
}: {
  entry: RecentEntry
  optionProps: React.HTMLAttributes<HTMLElement>
  onOpen: (entry: RecentEntry) => void
}) {
  const last = entry.visits[entry.visits.length - 1] ?? 0
  const shown = displayEntry(entry)
  return (
    <button
      {...optionProps}
      type="button"
      onClick={() => onOpen(entry)}
      data-testid="awesomebar-recent"
      aria-current={optionProps['aria-selected'] || undefined}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-action-tint"
    >
      <KindIcon kind={shown.kind} tone="grey" />
      <span className="min-w-0 flex-1 truncate">
        <EntryLabel entry={entry} />
        {shown.sub && <span className="ml-2 text-xs text-ink-subtle"><RecentSub entry={entry} /></span>}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{ago(last)}</span>
    </button>
  )
}
