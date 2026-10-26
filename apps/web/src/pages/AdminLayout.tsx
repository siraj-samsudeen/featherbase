import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FEATHERBASE_HOME_DESTINATION } from 'shared'
import { ApiError, SIGN_OUT_INCOMPLETE, api, clearSession, getSessionUser, listResource, signOut } from '../lib/api'
import {
  actionForLocation,
  ago,
  connectEventSink,
  flushPendingEvents,
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
import { THEMES, THEME_LABEL, useTheme } from '../lib/theme'
import { useI18n } from '../lib/i18n'
import { searchHitKind } from '../lib/search-hit'
import { Logo } from '../components/Logo'
import { PeekProvider } from '../components/Peek'
import { isOpaqueId } from '../lib/people'
import { EntryLabel } from '../lib/row-titles'
import { KindIcon } from '../lib/kind-icons'
import { NoAccessPage, PreviewBanner, REPORT_PATH, ReportOnlyShell, SIGN_IN_METHODS_PATH, Waiting } from './RestrictedShell'
import { WAITING_COUNT_QUERY_KEY } from './WaitingForAccess'
import { Select, StatusPill, buttonClasses, cardClasses, iconButtonClasses, inputClasses, labelClasses, useMediaQuery } from '../components/ui'
import { Bell, Clock, Compass, Database, History, Key, LogIn, Menu, ShieldLock, Table, UserRoundSearch, type LucideIcon } from '../components/ui/icons'
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
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (kind === 'loading') return <Waiting label="Checking your access" />
  if (kind === 'failed')
    return (
      <Waiting>
        We could not check what you have access to. <button type="button" className="underline" onClick={() => window.location.reload()}>Try again</button>
      </Waiting>
    )
  if (kind === 'no-access') return <NoAccessPage />
  if (kind === 'report-only') {
    // The one Admin page a report reader keeps is their own sign-in methods.
    if (pathname.replace(/\/$/, '') !== SIGN_IN_METHODS_PATH) return <Navigate to={REPORT_PATH} replace />
    return <ReportOnlyShell />
  }
  return <AdminShell />
}

function AdminShell() {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const user = getSessionUser()
  const { theme, set: setTheme } = useTheme()
  // No language picker until a translation ships (#380); i18n stays wired.
  const { t } = useI18n()
  // SET-004: the instance brand (System Settings → app_name) names the
  // navbar and the browser tab — "Frappe Clone" is only the default.
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
    if (action) recordAction(user.row_id, action)
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
  // A phone's header has no room for "Featherbase Home" (141px of text in
  // 119px at 375px wide), so there the app-name prefix is dropped.
  const isPhone = useMediaQuery(PHONE_QUERY)

  // #72: the avatar opens an account menu (Change password, Log out).
  const [accountOpen, setAccountOpen] = useState(false)
  const [pwModalOpen, setPwModalOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!accountOpen) return
    function onDown(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [accountOpen])

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

  async function logout() {
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
    // Leave the admin screen BEFORE dropping the cache: clearing while the
    // layout's queries are still mounted makes every observer refetch
    // token-less — 401s that api.ts answers with a hard redirect. Once
    // /login has rendered there are no observers left, and the clear (PR #92
    // review) empties the cache for whoever signs in next.
    await navigate({ to: '/featherbase/login' })
    queryClient.clear()
  }

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

  // person-rename: a person's id is opaque (`psn_…`); never draw initials from it.
  const initials = (user?.full_name || user?.email || user?.row_id || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

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

  return (
    <PeekProvider>
    <div className="flex h-full flex-col">
      <PreviewBanner />
      {/* Navbar */}
      {/* md+: the left zone is exactly the sidebar's width (w-60) with the
          sidebar's content padding, so the selector lines up with the column
          below; the command bar then fills what is left up to the bell. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1 border-b border-border bg-surface px-2 py-1 sm:flex-nowrap sm:gap-4 sm:px-4 md:pl-0" data-testid="admin-navbar">
        <div className="order-1 flex min-w-0 flex-1 items-center gap-1 sm:order-none sm:flex-none md:w-60 md:shrink-0 md:px-3" data-testid="navbar-left-zone">
          <Link to={FEATHERBASE_HOME_DESTINATION.href} aria-label={FEATHERBASE_HOME_DESTINATION.label} title={app_name} className={iconButtonClasses('shrink-0 max-sm:min-h-11 max-sm:min-w-11')}>
            <Logo className="h-7 w-7" />
          </Link>
          <label className="sr-only" htmlFor="admin-app-switcher">Switch application</label>
          <Select
            id="admin-app-switcher"
            aria-label="Switch application"
            value={FEATHERBASE_HOME_DESTINATION.href}
            onChange={(event) => { window.location.assign(event.target.value) }}
            wrapperClassName="min-w-0 flex-1 sm:w-52 sm:flex-none md:w-auto md:flex-1"
            className="truncate pl-2.5 pr-8 font-medium max-sm:min-h-11"
          >
            <option value={FEATHERBASE_HOME_DESTINATION.href}>{isPhone ? shortHomeLabel(FEATHERBASE_HOME_DESTINATION.label) : FEATHERBASE_HOME_DESTINATION.label}</option>
            {(appCatalog.data ?? []).map((entry) => <option key={entry.name} value={entry.href}>{entry.title}</option>)}
          </Select>
        </div>
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          data-testid="sidebar-toggle"
          aria-label="Toggle menu"
          aria-expanded={sidebarOpen}
          className={iconButtonClasses('order-3 sm:order-none md:hidden')}
        >
          <Menu aria-hidden size={20} />
        </button>

        <form onSubmit={runSearch} className="relative order-5 w-full basis-full sm:order-none sm:min-w-0 sm:flex-1 sm:basis-auto min-[1600px]:mx-auto min-[1600px]:max-w-4xl" data-testid="awesomebar">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              setBarFocused(true)
              setRecentSel(0)
            }}
            onBlur={() => setBarFocused(false)}
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

        <div className="order-4 ml-auto flex shrink-0 items-center gap-1 sm:order-none sm:ml-0 sm:gap-2" data-testid="navbar-right-zone">
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
          {/* #72: the avatar is the account menu — theme, password, sign-in methods, log out. */}
          <div className="relative" ref={accountRef}>
            <button
              onClick={() => setAccountOpen((o) => !o)}
              data-testid="session-user"
              title={user?.full_name || user?.email || user?.row_id}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              className={iconButtonClasses('rounded-full hover:bg-transparent')}
            >
              <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-action text-xs font-semibold text-action-ink">
                {initials}
              </span>
              <span className="sr-only">{user?.full_name || user?.email || user?.row_id}</span>
            </button>
            {accountOpen && (
              <div
                className={cardClasses('absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden py-1')}
                data-testid="account-menu"
                role="menu"
              >
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink">
                    {user?.full_name || user?.row_id}
                  </p>
                  {user?.email && (
                    <p className="truncate text-xs text-ink-subtle">{user.email}</p>
                  )}
                </div>
                {/* #380: one theme choice — light, dark, or follow the device. */}
                <div className="border-b border-border px-3 py-2" role="group" aria-labelledby="account-theme-label">
                  <p id="account-theme-label" className={labelClasses()}>{t('Theme')}</p>
                  <div className="grid grid-cols-3 gap-1" data-testid="theme-choice">
                    {THEMES.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        role="menuitemradio"
                        aria-checked={theme === choice}
                        onClick={() => setTheme(choice)}
                        data-testid={`theme-${choice}`}
                        className={buttonClasses({
                          variant: theme === choice ? 'primary' : 'secondary',
                          className: 'px-1 text-xs',
                        })}
                      >
                        {t(THEME_LABEL[choice])}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false)
                    setPwModalOpen(true)
                  }}
                  data-testid="account-change-password"
                  className="flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint"
                >
                  {t('Change password')}
                </button>
                <Link
                  role="menuitem"
                  to="/featherbase/admin/sign-in-methods"
                  onClick={() => setAccountOpen(false)}
                  data-testid="account-sign-in-methods"
                  className="flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint"
                >
                  {t('Sign-in methods')}
                </Link>
                <button
                  role="menuitem"
                  onClick={logout}
                  data-testid="logout"
                  className="flex min-h-control w-full items-center px-3 text-left text-sm text-ink hover:bg-action-tint"
                >
                  {t('Log out')}
                </button>
              </div>
            )}
          </div>
        </div>
        {pwModalOpen && <ChangePasswordModal onClose={() => setPwModalOpen(false)} />}
      </header>

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
              { to: '/featherbase/admin/sign-in-methods', label: 'Sign-in methods', icon: LogIn, testid: 'sign-in-methods-link' },
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
/** Below Tailwind's `sm`: the header shares one row with the logo, menu, bell and avatar. */
export const PHONE_QUERY = '(max-width: 639.98px)'

/** "Featherbase Home" → "Home": the app's own name is the logo beside it. */
export function shortHomeLabel(label: string): string {
  return label.replace(/^Featherbase\s+/, '')
}

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

// #72: change the session user's own password. Posts { password } to
// /api/set_password (the endpoint scopes to the caller when no user is given).
// Mirrors the ResetPassword page's form: card, label and input recipes, a
// client-side confirm check, then a success state.
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

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
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
