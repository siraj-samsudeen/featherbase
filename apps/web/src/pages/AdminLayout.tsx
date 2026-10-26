import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FEATHERBASE_HOME_DESTINATION } from 'shared'
import { api, getSessionUser } from '../lib/api'
import {
  actionForLocation,
  ago,
  connectEventSink,
  frequentActions,
  mergeServerEntries,
  displayEntry,
  recentActions,
  recentSearches,
  uniqueByDisplay,
  recordAction,
  type RecentEntry,
  type ServerRecentEntry,
} from '../lib/recents'
import { useHomePages } from '../lib/home-pages'
import { useCapabilities, useShellKind, useShellTables } from '../lib/session'
import { useRealtime } from '../lib/realtime'
import { useSettings } from '../lib/settings'
import { useTheme } from '../lib/theme'
import { searchHitKind } from '../lib/search-hit'
import { Logo } from '../components/Logo'
import { ADMIN_NAME, PHONE_QUERY, TopBar } from '../components/TopBar'
import { PeekProvider } from '../components/Peek'
import { isOpaqueId } from '../lib/people'
import { EntryLabel } from '../lib/row-titles'
import { metaQuery } from '../lib/meta'
import { KindIcon } from '../lib/kind-icons'
import { NoAccessPage, REPORT_PATH, Waiting } from './RestrictedShell'
import { WAITING_COUNT_QUERY_KEY } from './WaitingForAccess'
import { Select, StatusPill, buttonClasses, cardClasses, iconButtonClasses, inputClasses, useMediaQuery } from '../components/ui'
import { Bell, Clock, Compass, Database, History, Key, Menu, ShieldLock, Table, UserRoundSearch, type LucideIcon } from '../components/ui/icons'
import { fmtCount } from '../lib/inr'

interface SearchHit {
  table: string
  row_id: string
  title: string
  kind_label?: string
}

const MOBILE_SIDEBAR_QUERY = '(width < 48rem)'

// #101 Phase 3: recorded actions also stream to the server's user_event log
// (batched; a beacon carries the final batch through unload). The sink is
// injected here so lib/recents stays network-free for unit tests. Auth rides
// the bearer token for fetches and the sid cookie for beacons — sendBeacon
// cannot set headers.
connectEventSink({
  // The queue fail-closes on this identity: only events recorded FOR this
  // user are ever posted with this user's credentials.
  currentUser: () => getSessionUser()?.row_id ?? null,
  post: (events) => {
    void api.post('/api/events', { events }).catch(() => {})
  },
  beacon: (events) => {
    try {
      navigator.sendBeacon('/api/events', new Blob([JSON.stringify({ events })], { type: 'application/json' }))
    } catch {
      /* best-effort */
    }
  },
})

// Frappe-style Admin shell: top navbar (brand + command bar + avatar) and a
// home page sidebar. All Tables render inside <Outlet/>.
// #410: pick the layout from the server-computed capabilities BEFORE mounting
// the Admin shell, so a person who cannot use it never fires its API calls.
export function AdminLayout() {
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
  return <AdminShell />
}

function AdminShell() {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const user = getSessionUser()
  // The command bar's theme commands; the bar's own toggle is in TopBar.
  const { set: setTheme } = useTheme()
  // SET-004: the instance brand (System Settings → app_name) names the
  // browser tab — "Frappe Clone" is only the default.
  const { app_name } = useSettings()
  useEffect(() => {
    document.title = app_name
  }, [app_name])
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
    const action = actionForLocation(location.pathname, location.search as Record<string, unknown>)
    if (!action) return
    // A list or row names a Table; it is remembered only once that Table's
    // metadata has loaded. A path that is not a Table (`/admin/people`) 404s
    // and is never offered back.
    const table = action.kind === 'list' ? action.label : action.kind === 'row' ? action.sub : undefined
    if (!table) {
      recordAction(user.row_id, action)
      return
    }
    const owner = user.row_id
    queryClient.fetchQuery(metaQuery(table)).then(
      () => recordAction(owner, action),
      () => {},
    )
  }, [user?.row_id, location.href, navigationKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [barFocused, setBarFocused] = useState(false)
  const [recentSel, setRecentSel] = useState(0)

  // #101 Phase 3: once per signed-in user, pull the server's per-key
  // aggregates and union them into the local buffer — recents follow the
  // user across devices; the merge is idempotent.
  const syncedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!user || syncedFor.current === user.row_id) return
    syncedFor.current = user.row_id
    api
      .get<{ entries: ServerRecentEntry[] }>('/api/events/summary')
      .then((res) => mergeServerEntries(user.row_id, res.entries))
      .catch(() => {})
  }, [user?.row_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // UI-025: on narrow (mobile) widths the sidebar collapses into a drawer
  // toggled from the navbar; on md+ it is always shown.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isMobileSidebar = useMediaQuery(MOBILE_SIDEBAR_QUERY)
  // #489: on a phone the command bar takes its own row under the bar, so Tab
  // still follows what the eye reads: the bar's row first, then the search.
  const isPhone = useMediaQuery(PHONE_QUERY)

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

  const tables = useShellTables()
  const caps = useCapabilities()
  const canManage = caps?.manage === true
  // #429: the count beside "Waiting for access"; asked only by a System Manager.
  const waiting = useQuery({
    queryKey: WAITING_COUNT_QUERY_KEY,
    queryFn: () => api.get<{ count: number }>('/api/people/waiting_for_access/count'),
    enabled: canManage,
  })

  // ⌘K / Ctrl+K focuses the command bar (PR-2-style command palette entry).
  const searchRef = useRef<HTMLInputElement>(null)

  // UI-015: global keyboard shortcuts.
  //   Ctrl/Cmd+K  focus the command bar (command palette)
  //   Ctrl/Cmd+S  save the current form
  //   Ctrl/Cmd+B  new row of the current Table
  //   g then d    go to the Admin home
  useEffect(() => {
    let leader = 0 // timestamp of a recent 'g' press
    function currentTable(): string | null {
      const m = /^\/featherbase\/admin\/([^/]+)/.exec(window.location.pathname)
      return m ? decodeURIComponent(m[1]) : null
    }
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('[data-testid=form-save]')?.click()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const dt = currentTable()
        if (dt && dt !== 'new-table') navigate({ to: '/featherbase/admin/$table/$name', params: { table: dt, name: 'new' }, search: { prefill: undefined } })
        return
      }
      // Leader-key navigation only when not typing into a field.
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const now = Date.now()
      if (e.key.toLowerCase() === 'g') {
        leader = now
      } else if (e.key.toLowerCase() === 'd' && now - leader < 1000) {
        leader = 0
        navigate({ to: '/featherbase/admin' })
      } else {
        leader = 0
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  // #101 Phase 5: the "Last search" resume tile hands its query to the
  // command bar — prefilled and focused, ready to re-run.
  useEffect(() => {
    function onPrefill(e: Event) {
      const q = (e as CustomEvent<string>).detail
      if (typeof q === 'string') setSearch(q)
      searchRef.current?.focus()
    }
    window.addEventListener('fc:prefill-search', onPrefill)
    return () => window.removeEventListener('fc:prefill-search', onPrefill)
  }, [])

  // UI-027 / #80: the sidebar lists the caller's visible Home Pages — the
  // dedicated endpoint is its only source (role visibility and link
  // permission-filtering are computed server-side).
  const homePages = useHomePages()
  const appCatalog = useQuery({
    queryKey: ['app-catalog'],
    queryFn: () => api.get<{ name: string; title: string; href: string }[]>('/api/app_catalog'),
  })


  // UI-014: row hits from the server, debounced.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 150)
    return () => clearTimeout(t)
  }, [search])
  const docHits = useQuery({
    queryKey: ['awesomebar', debounced],
    enabled: debounced.length > 0,
    queryFn: () =>
      api.get<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(debounced)}`),
  })

  // #101: with the bar focused and empty, the dropdown shows Recent (pure
  // recency) and Frequent (frecency) groups; while typing it offers matching
  // past searches. All three read the per-user localStorage buffer.
  const trimmed = search.trim()
  const showRecents = Boolean(barFocused && trimmed === '' && user)
  const recentItems = showRecents && user ? uniqueByDisplay(recentActions(user.row_id, 12)).slice(0, 6) : []
  const frequentItems =
    showRecents && user
      ? uniqueByDisplay([...recentItems, ...frequentActions(user.row_id, 8)]).slice(recentItems.length, recentItems.length + 4)
      : []
  const pick = [...recentItems, ...frequentItems]
  const searchChips = user && trimmed ? recentSearches(user.row_id, trimmed, 3) : []

  // #101 Phase 2: the sidebar's zero-keystroke recall — destinations only
  // (searches stay in the command bar, where they can be re-run).
  const sidebarRecent = user
    ? uniqueByDisplay(recentActions(user.row_id, 20).filter((e) => e.kind !== 'search')).slice(0, SIDEBAR_RECENT_CAP)
    : []
  const sidebarFrequent = user
    ? uniqueByDisplay([...sidebarRecent, ...frequentActions(user.row_id, 12)]).slice(sidebarRecent.length, SIDEBAR_RECENT_CAP)
    : []

  function recordSearch(q: string) {
    if (user && q) recordAction(user.row_id, { kind: 'search', key: `search:${q.toLowerCase()}`, label: q, path: '' })
  }

  function openRecent(entry: RecentEntry) {
    if (entry.kind === 'search') {
      setSearch(entry.label)
      return
    }
    setSearch('')
    setBarFocused(false)
    searchRef.current?.blur()
    router.history.push(entry.path)
  }

  function openDoc(hit: SearchHit) {
    recordSearch(search.trim())
    setSearch('')
    navigate({ to: '/featherbase/admin/$table/$name', params: { table: hit.table, name: hit.row_id }, search: { prefill: undefined } })
  }

  // Enter opens the top match: an exactly-named Table's list first,
  // otherwise the first row hit. With an empty bar, Enter replays the
  // selected recent instead (#101).
  function runSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = search.trim()
    if (!q) {
      const entry = pick[Math.min(recentSel, pick.length - 1)]
      if (entry) openRecent(entry)
      return
    }
    recordSearch(q)
    const dtHit = tables?.find((d) => d.row_id.toLowerCase() === q.toLowerCase())
    if (dtHit) {
      setSearch('')
      navigate({ to: '/featherbase/admin/$table', params: { table: dtHit.row_id }, search: { filters: undefined } })
      return
    }
    const doc = docHits.data?.results[0]
    if (doc) {
      openDoc(doc)
      return
    }
    navigate({ to: '/featherbase/admin/$table', params: { table: q }, search: { filters: undefined } })
  }

  // User tables surface before system tables in suggestions (stable sort
  // keeps the alphabetical order within each group).
  const suggestions =
    search.trim().length > 0
      ? (tables ?? [])
          .filter((d) => d.row_id.toLowerCase().includes(search.trim().toLowerCase()))
          .sort((a, b) => Number(a.system) - Number(b.system))
          .slice(0, 7)
      : []
  // #432: a Table whose rows only the platform writes is never offered as "New".
  const creatableSuggestions = suggestions.filter((d) => !d.system_written)

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

  // The command bar: inline in the top bar from sm up, its own row on a phone.
  const commandBar = (
        <form
          onSubmit={runSearch}
          // #489 item 11: the recents close only when focus leaves the whole
          // command bar, so Tab from the input reaches them (visual order).
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setBarFocused(false)
          }}
          className="relative w-full sm:min-w-0 sm:flex-1 sm:mx-auto sm:max-w-4xl"
          data-testid="awesomebar"
        >
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              setBarFocused(true)
              setRecentSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.currentTarget.blur()
                return
              }
              if (!showRecents || pick.length === 0) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setRecentSel((s) => (s + 1) % pick.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setRecentSel((s) => (s - 1 + pick.length) % pick.length)
              }
            }}
            placeholder="Search or type a command…"
            aria-label="Search or type a command"
            className={inputClasses('bg-canvas pr-12 focus:bg-surface')}
          />
          <kbd
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1 text-xs text-ink-subtle"
            aria-hidden="true"
          >
            ⌘K
          </kbd>
          {(suggestions.length > 0 ||
            commandHits.length > 0 ||
            (docHits.data?.results.length ?? 0) > 0 ||
            (showRecents && pick.length > 0) ||
            searchChips.length > 0) && (
            <div className={cardClasses('absolute z-20 mt-1 w-full overflow-hidden py-1')} data-testid="awesomebar-results">
              {/* #101: empty-bar recents — mousedown is swallowed so the
                  input keeps focus until the click lands. */}
              {showRecents && pick.length > 0 && (
                <div data-testid="awesomebar-recents" onMouseDown={(e) => e.preventDefault()}>
                  <div className="px-3 pb-0.5 pt-1 text-xs font-semibold text-ink-subtle">
                    Recently opened
                  </div>
                  {recentItems.map((r, i) => (
                    <RecentRow key={r.key} entry={r} selected={i === Math.min(recentSel, pick.length - 1)} onOpen={openRecent} />
                  ))}
                  {frequentItems.length > 0 && (
                    <div className="px-3 pb-0.5 pt-1.5 text-xs font-semibold text-ink-subtle">
                      Frequent
                    </div>
                  )}
                  {frequentItems.map((r, i) => (
                    <RecentRow
                      key={r.key}
                      entry={r}
                      selected={recentItems.length + i === Math.min(recentSel, pick.length - 1)}
                      onOpen={openRecent}
                    />
                  ))}
                </div>
              )}
              {/* #101: matching past searches while typing — click refills the bar. */}
              {searchChips.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setSearch(s.label)}
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
                  type="button"
                  onClick={() => {
                    setSearch('')
                    cmd.run()
                  }}
                  data-testid={`awesomebar-cmd-${cmd.id}`}
                  className="flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint"
                >
                  <span className="text-action">›</span> {cmd.label}
                </button>
              ))}
              {suggestions.length > 0 && (
                <h2 data-testid="awesomebar-tables-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Tables</h2>
              )}
              {suggestions.map((d) => (
                <Link
                  key={d.row_id}
                  to="/featherbase/admin/$table"
                  params={{ table: d.row_id }}
                  search={{ filters: undefined }}
                  onClick={() => setSearch('')}
                  data-testid="awesomebar-table"
                  className="block px-3 py-1.5 text-sm text-ink hover:bg-action-tint"
                >
                  {d.row_id}
                  <span className="ml-2 text-xs text-ink-muted">{d.module} module · open list</span>
                </Link>
              ))}
              {/* UI-014: "new X" action for matched Tables */}
              {creatableSuggestions.length > 0 && (
                <h2 data-testid="awesomebar-create-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Create rows</h2>
              )}
              {creatableSuggestions.slice(0, 2).map((d) => (
                <Link
                  key={`new-${d.row_id}`}
                  to="/featherbase/admin/$table/$name"
                  search={{ prefill: undefined }}
                  params={{ table: d.row_id, name: 'new' }}
                  onClick={() => setSearch('')}
                  data-testid="awesomebar-new"
                  className="block px-3 py-1.5 text-sm text-ink hover:bg-action-tint"
                >
                  <span className="text-action">+</span> New {d.row_id} row
                </Link>
              ))}
              {/* UI-014: row hits */}
              {(docHits.data?.results.length ?? 0) > 0 && (
                <h2 data-testid="awesomebar-records-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Records</h2>
              )}
              {docHits.data?.results.map((h) => (
                <button
                  key={`${h.table}/${h.row_id}`}
                  type="button"
                  onClick={() => openDoc(h)}
                  data-testid="awesomebar-doc"
                  className="flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint"
                >
                  {h.title}
                  {h.title !== h.row_id && (
                    <span className="ml-2 text-xs text-ink-subtle">{h.row_id}</span>
                  )}
                  <span className="ml-2 text-xs text-ink-muted">{searchHitKind(h)}</span>
                </button>
              ))}
            </div>
          )}
        </form>
  )

  return (
    <PeekProvider>
    <div className="flex h-full flex-col">
      {/* #489: the shared top bar, with the Admin menus inside it: the app
          switcher in the name's place, the sidebar toggle, the command bar
          and the notification bell. md+: the left zone is exactly the
          sidebar's width (w-60, TopBar) so the selector lines up with the
          column below; the command bar then fills what is left up to the bell. */}
      <TopBar
        home="admin"
        left={
          <>
            <Link to={FEATHERBASE_HOME_DESTINATION.href} aria-label={FEATHERBASE_HOME_DESTINATION.label} title={app_name} className={iconButtonClasses('shrink-0 max-sm:min-h-11 max-sm:min-w-11')}>
              <Logo className="h-7 w-7" />
            </Link>
            <label className="sr-only" htmlFor="admin-app-switcher">Switch application</label>
            {/* The switcher's current entry is the bar's name, "Featherbase Admin"
                (#489 item 2); on a phone it is cut with an ellipsis (item 9). */}
            <Select
              id="admin-app-switcher"
              aria-label="Switch application"
              value={FEATHERBASE_HOME_DESTINATION.href}
              onChange={(event) => { window.location.assign(event.target.value) }}
              wrapperClassName="min-w-0 flex-1 sm:w-52 sm:flex-none md:w-auto md:flex-1"
              className="truncate pl-2.5 pr-8 font-semibold max-sm:min-h-11"
              data-testid="top-bar-name"
            >
              <option value={FEATHERBASE_HOME_DESTINATION.href}>{ADMIN_NAME}</option>
              {(appCatalog.data ?? []).map((entry) => <option key={entry.name} value={entry.href}>{entry.title}</option>)}
            </Select>
          </>
        }
        beforeRight={
          <div className="relative" title="Notifications">
            {/* An indicator, not a control, so it needs no thumb-sized hit area. */}
            <span className="flex size-9 items-center justify-center text-ink-muted" data-testid="notif-bell">
              <Bell aria-hidden size={20} />
              <span className="sr-only">Notifications</span>
            </span>
            {(unread.data?.count ?? 0) > 0 && (
              <span
                className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-negative px-1 text-xs font-semibold text-action-ink"
                data-testid="unread-count"
              >
                {unread.data?.count}
              </span>
            )}
          </div>
        }
        below={isPhone && <div className="shrink-0 border-b border-border bg-surface px-2 pb-1 pt-1" data-testid="awesomebar-row">{commandBar}</div>}
      >
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          data-testid="sidebar-toggle"
          aria-label="Toggle menu"
          aria-expanded={sidebarOpen}
          className={iconButtonClasses('md:hidden')}
        >
          <Menu aria-hidden size={20} />
        </button>
        {!isPhone && commandBar}
      </TopBar>

      <div className="relative flex min-h-0 flex-1">
        {/* UI-025: on mobile, a backdrop closes the drawer. */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-20 bg-scrim/30 md:hidden"
            data-testid="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Sidebar — static on md+, a slide-in drawer on mobile. Clicking any
            link inside closes the drawer. */}
        <aside
          data-testid="admin-sidebar"
          inert={isMobileSidebar && !sidebarOpen ? true : undefined}
          aria-hidden={isMobileSidebar && !sidebarOpen ? true : undefined}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) setSidebarOpen(false)
          }}
          className={`absolute inset-y-0 left-0 z-30 flex w-64 flex-col overflow-y-auto border-r border-border bg-surface transition-transform md:static md:w-60 md:shrink-0 md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {canManage && (
          <div className="px-3 pt-4">
            <Link
              to="/featherbase/admin/new-table"
              data-testid="new-table-link"
              className={buttonClasses({ variant: 'primary', className: 'w-full justify-center' })}
            >
              + New Table
            </Link>
            <Link
              to="/featherbase/admin/import"
              search={{ table: undefined }}
              data-testid="import-data-link"
              className={buttonClasses({ className: 'mt-2 w-full justify-center' })}
            >
              Import Data
            </Link>
          </div>
          )}
          {/* #80: the sidebar is Home Pages only (Frappe parity). Every
              table stays reachable through the All tables entry below —
              grouping and curation moved there, nothing is hidden. */}
          {/* The sidebar scrolls as ONE column: the Home Pages keep their full
              height whatever sits below them. */}
          <nav className="shrink-0 px-2 pb-4 pt-3" data-testid="home-page-nav">
            {homePages.isLoading && (
              <p className="px-2 py-1 text-xs text-ink-subtle">Loading…</p>
            )}
            {(homePages.data?.pages ?? []).map((p) => (
              <Link
                key={p.row_id}
                to="/featherbase/admin/home/$name"
                params={{ name: p.row_id }}
                data-testid={`home-page-link-${p.row_id}`}
                className="block rounded-md px-2 py-1.5 text-sm text-ink hover:bg-subtle"
                activeProps={{
                  className:
                    'block rounded-md px-2 py-1.5 text-sm font-medium text-action bg-action-tint',
                }}
              >
                {p.icon ? `${p.icon} ` : ''}
                {p.label || p.row_id}
              </Link>
            ))}
          </nav>
          {/* #101 Phase 2: recall without a keystroke — the same per-user
              buffer the command bar reads. */}
          {(sidebarRecent.length > 0 || sidebarFrequent.length > 0) && (
            <div className="border-t border-border px-2 py-2" data-testid="sidebar-recents">
              {/* A heading, not a link: muted, sentence case, with a clock. */}
              <h2 className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-xs font-medium text-ink-subtle" data-testid="sidebar-recents-heading">
                <Clock aria-hidden size={12} />
                Recently opened
              </h2>
              {sidebarRecent.map((r) => (
                <SidebarRecentRow key={r.key} entry={r} onOpen={(e) => { setSidebarOpen(false); openRecent(e) }} />
              ))}
              {sidebarFrequent.length > 0 && (
                <h2 className="px-2 pb-0.5 pt-2 text-xs font-medium text-ink-subtle">
                  Frequent
                </h2>
              )}
              {sidebarFrequent.map((r) => (
                <SidebarRecentRow key={r.key} entry={r} frequent onOpen={(e) => { setSidebarOpen(false); openRecent(e) }} />
              ))}
            </div>
          )}
          {/* Two labelled groups under the Home Pages and the recents, headed
              like "Recently opened". Visibility per item is unchanged; a group
              with nothing visible for this person drops its heading too. */}
          <SidebarGroup
            heading="Data"
            icon={Database}
            testid="sidebar-group-data"
            items={[
              // #100 pattern 4: the cross-filter Explore surface.
              { to: '/featherbase/admin/explore', search: { root: undefined, chain: undefined, select: undefined }, label: 'Explore', icon: Compass, testid: 'explore-link' },
              { to: '/featherbase/admin/all-tables', label: 'All tables', icon: Table, testid: 'all-tables-link' },
              // #206: an import is a thing you did, not just rows that appeared —
              // so it has a place to be found again.
              ...(canManage ? [{ to: '/featherbase/admin/imports', label: 'Past imports', icon: History, testid: 'past-imports-link' }] : []),
            ]}
          />
          <SidebarGroup
            heading="People and access"
            icon={ShieldLock}
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
                  }]
                : []),
            ]}
          />
        </aside>

        {/* Page canvas */}
        <main className="min-w-0 flex-1 overflow-auto bg-canvas p-4 sm:p-6">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </PeekProvider>
  )
}

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
/** Recently opened holds at most this many items, Frequent included. */
export const SIDEBAR_RECENT_CAP = 5

export function SidebarGroup({ heading, icon: HeadingIcon, testid, items }: {
  heading: string
  icon: LucideIcon
  testid: string
  items: SidebarItem[]
}) {
  if (items.length === 0) return null
  const base = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm'
  return (
    <div className="border-t border-border px-2 py-2" data-testid={testid}>
      <h2 className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-xs font-medium text-ink-subtle" data-testid="sidebar-group-heading">
        <HeadingIcon aria-hidden size={12} />
        {heading}
      </h2>
      {items.map(({ to, search, label, icon: Icon, testid: id, badge }) => (
        <Link
          key={id}
          to={to}
          search={search as never}
          data-testid={id}
          className={`${base} text-ink-muted hover:bg-subtle hover:text-ink`}
          activeProps={{ className: `${base} font-medium text-action bg-action-tint` }}
        >
          <Icon aria-hidden size={14} className="shrink-0 text-ink-subtle" data-testid="sidebar-item-icon" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge}
        </Link>
      ))}
    </div>
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
function SidebarRecentRow({
  entry,
  frequent,
  onOpen,
}: {
  entry: RecentEntry
  frequent?: boolean
  onOpen: (entry: RecentEntry) => void
}) {
  const shown = displayEntry(entry)
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
      title={shown.row || isOpaqueId(shown.label) ? shown.sub : shown.sub ? `${shown.label} — ${shown.sub}` : shown.label}
      className="block w-full rounded-md px-2 py-1 text-left hover:bg-subtle"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
        <KindIcon kind={shown.kind} tone="grey" />
        {frequent && <span className="text-caution">★</span>}
        <span className="truncate">
          <EntryLabel entry={entry} />
        </span>
      </span>
      {shown.sub && (
        <span className="block truncate pl-5 text-xs text-ink-subtle">{shown.sub}</span>
      )}
    </a>
  )
}

// #101: one row of the command bar's Recent/Frequent groups.

function RecentRow({
  entry,
  selected,
  onOpen,
}: {
  entry: RecentEntry
  selected: boolean
  onOpen: (entry: RecentEntry) => void
}) {
  const last = entry.visits[entry.visits.length - 1] ?? 0
  const shown = displayEntry(entry)
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      data-testid="awesomebar-recent"
      aria-current={selected || undefined}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-action-tint ${
        selected ? 'bg-action-tint' : ''
      }`}
    >
      <KindIcon kind={shown.kind} tone="grey" />
      <span className="min-w-0 flex-1 truncate">
        <EntryLabel entry={entry} />
        {shown.sub && <span className="ml-2 text-xs text-ink-subtle">{shown.sub}</span>}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{ago(last)}</span>
    </button>
  )
}
