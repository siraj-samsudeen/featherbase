import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FEATHERBASE_ADMIN_DESTINATION, JOBS_PATH, adminPageNeedsManage, ownFramePolicyPage, type CommandDestinations, type CommandPageDestination } from 'shared'
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
  recordAction,
  type RecentEntry,
  type ServerRecentEntry,
} from '../lib/recents'
import { useHomePages } from '../lib/home-pages'
import { useCapabilities, useShellKind } from '../lib/session'
import { useRealtime } from '../lib/realtime'
import { ThemeChoiceProvider, useThemeChoice } from '../lib/theme-choice'
import { searchHitKind } from '../lib/search-hit'
import { AppSwitcher } from '../components/AppSwitcher'
import { PHONE_QUERY, TopBar } from '../components/TopBar'
import { isOpaqueId } from '../lib/people'
import { EntryLabel, useLiveDestinations } from '../lib/row-titles'
import { metaQuery, type TableMeta } from '../lib/meta'
import { useI18n } from '../lib/i18n'
import { SIDEBAR_SHORTCUT, isEditingText, useSidebarCollapsed } from '../lib/sidebar-collapsed'
import { KindIcon } from '../lib/kind-icons'
import { DataSourcesSidebar } from '../components/DataSourcesSidebar'
import { NoAccessPage, REPORT_PATH, Waiting } from './RestrictedShell'
import { WAITING_COUNT_QUERY_KEY } from './WaitingForAccess'
import { HealthBanner, INSTANCE_HEALTH_PATH, SETUP_PERSON_LABEL, SETUP_PERSON_PATH, SetupBanner, useSetupNeeded } from './InstanceHealth'
import { GLOSSARY_PATH } from '../lib/glossary'
import { useSetupOffer } from './FirstRunSetup'
import { StatusPill, buttonClasses, cardClasses, iconButtonClasses, inputClasses, touchRowClasses, useMediaQuery } from '@featherbase/shop-floor'
import { Bell, BookOpen, CalendarClock, Clock, Compass, Database, History, Key, ListChecks, Menu, PanelLeftClose, PanelLeftOpen, ShieldLock, Table, UserRoundSearch, type LucideIcon } from '@featherbase/shop-floor'
import { fmtCount } from '@featherbase/shop-floor'

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
export function AdminLayout({ wide, fullWidth = false }: { wide: boolean; fullWidth?: boolean }) {
  // #489: the signed-in person's theme choice outlives every toggle on the page.
  return (
    <ThemeChoiceProvider>
      <AdminLayoutForKind wide={wide} fullWidth={fullWidth} />
    </ThemeChoiceProvider>
  )
}

function AdminLayoutForKind({ wide, fullWidth }: { wide: boolean; fullWidth: boolean }) {
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
  return <AdminShell wide={wide} fullWidth={fullWidth} />
}

export function AdminShell({ wide, fullWidth = false }: { wide: boolean; fullWidth?: boolean }) {
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
  // toggled from the navbar; on md+ it is always shown.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isMobileSidebar = useMediaQuery(MOBILE_SIDEBAR_QUERY)
  // #1018: on md+ the sidebar can be collapsed to give the page its width. A
  // phone keeps its drawer, whatever was chosen on a wider window.
  const [collapsedChoice, toggleSidebarCollapsed] = useSidebarCollapsed(user?.row_id)
  const sidebarCollapsed = collapsedChoice && !isMobileSidebar
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
  const commandFormRef = useRef<HTMLFormElement>(null)

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
  //   Ctrl/Cmd+B  collapse or reopen the sidebar (#1018)
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
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('[data-testid=form-save]')?.click()
        return
      }
      // With Shift it is the browser's bookmarks bar; in a field it is bold or
      // the browser's own; a phone has its drawer instead.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        if (isEditingText(e.target) || isMobileSidebar) return
        e.preventDefault()
        if (!e.repeat) toggleSidebarCollapsed()
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
      } else if (e.key.toLowerCase() === 'n' && now - leader < 1000) {
        leader = 0
        const dt = currentTable()
        if (dt) navigate({ to: '/featherbase/admin/table/$table/new', params: { table: dt }, search: { prefill: undefined } })
      } else {
        leader = 0
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate, router, queryClient, isMobileSidebar, toggleSidebarCollapsed])

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
  // A resolved previous query remains cached during the typing debounce;
  // it is not a result of the text currently in the input.
  const recordHits = trimmed === debounced ? docHits.data?.results ?? [] : []
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
  const recentSlots = sidebarCandidates.slice(0, 3)
  const sidebarFrequent = historyReady && user
    ? uniqueByDisplay([...recentSlots, ...offered(frequentActions(user.row_id, 12))]).slice(recentSlots.length, recentSlots.length + 2)
    : []
  const sidebarRecent = sidebarFrequent.length ? recentSlots : sidebarCandidates

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

  // The command bar: inline in the top bar from sm up, its own row on a phone.
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
          className="relative w-full sm:min-w-0 sm:flex-1 sm:mx-auto sm:max-w-4xl"
          data-testid="awesomebar"
        >
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
            className={inputClasses('bg-canvas pr-12 focus:bg-surface')}
          />
          <kbd
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1 text-xs text-ink-subtle"
            aria-hidden="true"
          >
            ⌘K
          </kbd>
          {barFocused && (suggestions.length > 0 ||
            pageHits.length > 0 ||
            commandHits.length > 0 ||
            recordHits.length > 0 ||
            (showRecents && pick.length > 0) ||
            searchChips.length > 0) && (
            <div
              id="command-results"
              role="listbox"
              aria-label="Search results"
              className={cardClasses('absolute z-20 mt-1 max-h-[min(70vh,32rem)] w-full overflow-y-auto py-1 [&_[aria-selected=true]]:bg-action-tint')}
              data-testid="awesomebar-results"
              onMouseDown={(e) => e.preventDefault()}
            >
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
              {/* UI-014: row hits */}
              {recordHits.length > 0 && (
                <h2 data-testid="awesomebar-records-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Records</h2>
              )}
              {recordHits.map((h) => (
                <button
                  key={`${h.table}/${h.row_id}`}
                  {...resultProps(`record-${h.table}/${h.row_id}`)}
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
    <>
    <div className="flex h-full flex-col">
      {/* #465 D8: System Managers only, while a health check fails; above the
          top bar, beside the preview banner. */}
      <HealthBanner enabled={canManage} />
      <SetupBanner enabled={canManage} />
      {/* #489: the shared top bar, with the Admin menus inside it: the app
          switcher in the name's place, the sidebar toggle, the command bar
          and the notification bell. md+: the left zone is exactly the
          sidebar's width (w-60, TopBar) so the selector lines up with the
          column below; the command bar then fills what is left up to the bell. */}
      <TopBar
        home="admin"
        left={<AppSwitcher />}
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
        {/* #1018: stays put in the bar, so the way back is where the way out was. */}
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          data-testid="sidebar-collapse"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-keyshortcuts="Meta+B Control+B"
          title={`${sidebarCollapsed ? 'Expand' : 'Collapse'} sidebar (${SIDEBAR_SHORTCUT})`}
          className={iconButtonClasses('hidden md:inline-flex')}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden size={20} /> : <PanelLeftClose aria-hidden size={20} />}
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
          data-collapsed={sidebarCollapsed ? true : undefined}
          inert={isMobileSidebar && !sidebarOpen ? true : undefined}
          aria-hidden={isMobileSidebar && !sidebarOpen ? true : undefined}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) setSidebarOpen(false)
          }}
          className={`absolute inset-y-0 left-0 z-30 flex w-64 flex-col overflow-y-auto border-r border-border bg-surface transition-transform md:static md:w-60 md:shrink-0 md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }${sidebarCollapsed ? ' md:hidden' : ''}`}
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
          {/* #80: the sidebar is Home Pages only. Every
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
                className={touchRowClasses('flex items-center rounded-md px-2 py-1.5 text-sm text-ink hover:bg-subtle')}
                activeProps={{
                  className: touchRowClasses('flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-action bg-action-tint'),
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
          <SidebarGroup
            heading="This instance"
            icon={ListChecks}
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
        </aside>

        {/* Page canvas */}
        <main className={`min-w-0 flex-1 overflow-auto bg-canvas p-4 sm:p-6${wide ? ' flex flex-col' : ''}`}>
          <div className={wide ? 'flex min-h-0 w-full flex-1 flex-col' : fullWidth ? 'w-full' : 'mx-auto max-w-5xl has-data-[pane=right]:max-w-none'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </>
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
const SIDEBAR_RECENT_CAP = 5

export function SidebarGroup({ heading, icon: HeadingIcon, testid, items }: {
  heading: string
  icon: LucideIcon
  testid: string
  items: SidebarItem[]
}) {
  if (items.length === 0) return null
  const base = touchRowClasses('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm')
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
      className={touchRowClasses('flex w-full flex-col justify-center rounded-md px-2 py-1 text-left hover:bg-subtle')}
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
        {shown.sub && <span className="ml-2 text-xs text-ink-subtle">{shown.sub}</span>}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{ago(last)}</span>
    </button>
  )
}
