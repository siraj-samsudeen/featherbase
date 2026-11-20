import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { needsEmail, rowHref, tableHref, type CommandDestinations, type CommandPageDestination } from 'shared'
import { PersonLabel, Search, inputClasses, raisedClasses } from '@featherbase/shop-floor'
import { RAIL_ROW, ROW_IDLE, TableTile } from './SidebarRail'
import { RecentSub } from './RecentSub'
import { useSignOut } from './TopBar'
import { api, getSessionUser } from '../lib/api'
import { ago, displayEntry, frequentActions, recentActions, recentSearches, recordAction, uniqueByDisplay, type RecentEntry } from '../lib/recents'
import { useNavigationHistory } from '../lib/navigation-history'
import { useCapabilities } from '../lib/session'
import { useThemeChoice } from '../lib/theme-choice'
import { useStreamedSearch, type SearchHit } from '../lib/search-stream'
import { EntryLabel, useLiveDestinations } from '../lib/row-titles'
import { KindIcon } from '../lib/kind-icons'
import { COMMAND_SHORTCUT } from '../lib/sidebar-collapsed'
import { COMMAND_SHORTCUT_DEF, noteShortcutUse, shortcutControl, useShortcut } from '../lib/shortcuts'

/** #1265: the most record rows the bar shows. */
const RECORD_CAP = 15

/** #1253: the field at the sidebar's top that opens the command bar; in the
 *  rail, a magnifier named by its tooltip. */
export function CommandField({ rail, onOpen }: { rail: boolean; onOpen: () => void }) {
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
        ? `${RAIL_ROW} ${ROW_IDLE} focus-visible:outline-[1.5px] focus-visible:outline-focus`
        : 'flex min-h-[34px] w-full min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-control bg-border/60 px-3 text-[13px] text-ink-subtle hover:bg-border focus-visible:outline-[1.5px] focus-visible:outline-focus'}
    >
      <Search aria-hidden size={rail ? 18 : 14} className="shrink-0" />
      {!rail && <span className="min-w-0 flex-1 truncate text-left">Search or Command</span>}
      {!rail && <kbd className="shrink-0 font-sans text-xs text-ink-subtle">{COMMAND_SHORTCUT}</kbd>}
    </button>
  )
}

/** #1253: the command bar (⌘K / Ctrl+K), a wide box in the middle of the
 *  screen while `open`. The field above opens it; so do the shortcut and the
 *  "Last search" tile's prefill event.
 *
 *  #1385: the shared top bar draws it on every page with a sidebar, the
 *  Admin's and every app's. It goes everywhere by address, through the page's
 *  router: the Admin's moves within the Admin; an app page's bar router loads
 *  each address in full (bar/mount.tsx). It offers only what the viewer can
 *  open: without the Admin, no records, Tables or Admin commands. */
export function CommandPalette({ open: barFocused, onOpenChange: setBarFocused }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const signOut = useSignOut()
  const router = useRouter()
  const user = getSessionUser()
  // The command bar's theme commands; the bar's own toggle is in TopBar.
  const { set: setTheme } = useThemeChoice()
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<{ query: string; id: string } | null>(null)
  // Opened or closed, the bar starts with nothing chosen.
  const [wasOpen, setWasOpen] = useState(barFocused)
  if (wasOpen !== barFocused) {
    setWasOpen(barFocused)
    setSelection(null)
  }
  const historyReady = useNavigationHistory(user?.row_id)

  const destinations = useQuery({
    queryKey: ['command-destinations', user?.row_id],
    queryFn: () => api.get<CommandDestinations>('/api/command_destinations'),
    enabled: barFocused,
  })
  const inventory = destinations.isError ? undefined : destinations.data
  const caps = useCapabilities()
  const canManage = caps?.manage === true
  // #1385: someone who cannot use the Admin is offered no Table and no record.
  const canUseAdmin = caps?.admin === true
  const tables = canUseAdmin ? inventory?.tables : undefined
  const go = (href: string) => router.history.push(href)

  // ⌘K / Ctrl+K focuses the command bar (PR-2-style command palette entry).
  const searchRef = useRef<HTMLInputElement>(null)
  useShortcut(COMMAND_SHORTCUT_DEF) // #1251
  const commandFormRef = useRef<HTMLFormElement>(null)
  // #1253: the command bar is a box in the middle of the screen, drawn while
  // open; its input takes the focus once it is drawn.
  useLayoutEffect(() => {
    if (barFocused) searchRef.current?.focus()
  }, [barFocused])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      // In an app's page the bar is in a shadow root: the document sees its host as the target.
      if (!event.composedPath().includes(commandFormRef.current!)) {
        setBarFocused(false)
        setSelection(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [setBarFocused])

  // UI-015: Ctrl/Cmd+K opens the command bar (command palette).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl/⌘+Shift+K is View as's (ViewAsButton), not this bar's.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBarFocused(true)
        setSelection(null)
        searchRef.current?.focus()
        searchRef.current?.select()
        noteShortcutUse('command', 'key')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setBarFocused])

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
  }, [setBarFocused])

  // UI-014: row hits from the server, debounced.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 150)
    return () => clearTimeout(t)
  }, [search])
  // #1265: the record search streams group by group; a newer query aborts the older.
  const streamed = useStreamedSearch(canUseAdmin ? debounced : '')

  // #101: with the bar focused and empty, the dropdown shows Recent (pure
  // recency) and Frequent (frecency) groups; while typing it offers matching
  // past searches. All three read the per-user localStorage buffer.
  const trimmed = search.trim()
  // A resolved previous query remains cached during the typing debounce;
  // it is not a result of the text currently in the input.
  const current = trimmed !== '' && trimmed === debounced && (!canUseAdmin || streamed.query === trimmed)
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
  // #1345: people who would still read the same (name and words) add their email.
  const sameReading = needsEmail(recordGroups.find((g) => g.table === 'Person')?.hits ?? [])
  // Searching from the first keystroke until every group has answered.
  const searching = canUseAdmin && trimmed !== '' && !(current && streamed.done)
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
    go(entry.path)
  }

  /** A record result, opened here: the link's own address (#1345: results are links). */
  function openDoc(href: string) {
    recordSearch(search.trim())
    dismissSearch()
    go(href)
  }

  function openPage(page: CommandPageDestination) {
    recordSearch(search.trim())
    dismissSearch()
    // Runtime apps need a full load.
    if (page.kind === 'App' || page.kind === 'App tab') window.location.assign(page.href)
    else go(page.href)
  }

  /** A Table or new-row result: a link, so it opens in a new tab too; a plain click opens it here. */
  function openLink(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    dismissSearch()
    go(e.currentTarget.getAttribute('href')!)
  }

  // Explicit selection uses the same activation as a pointer or Tab/Enter.
  // #1325 (audit F39): without it, a name typed exactly (a Table, a page, a
  // command) wins, else the first result shown; never a guessed address.
  function runSearch(e: React.FormEvent) {
    e.preventDefault()
    const selected = resultElements().find((el) => el.id === selectedId)
    if (selected) {
      selected.click()
      return
    }
    const q = search.trim()
    if (!q) return
    // Pressed before anything is listed: wait for the results still arriving.
    if (!openTopResult(q) && searching) setEnterPending(q)
  }

  function openTopResult(q: string): boolean {
    const lower = q.toLowerCase()
    const exactTable = tables?.find((d) => d.row_id.toLowerCase() === lower) ?? tables?.find((d) => d.label.toLowerCase() === lower)
    if (exactTable) {
      recordSearch(q)
      dismissSearch()
      go(tableHref(exactTable.row_id))
      return true
    }
    const exactPage = pageHits.find((page) => [page.label, ...(page.aliases ?? [])].some((label) => label.toLowerCase() === lower))
    if (exactPage) {
      openPage(exactPage)
      return true
    }
    // The list's own order: Commands, Pages, Tables, Create rows, Records. A past search is not a destination.
    const first = resultElements().find((el) => !el.id.startsWith('command-search-'))
    first?.click()
    return Boolean(first)
  }

  const [enterPending, setEnterPending] = useState<string | null>(null)

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
    ...(canManage ? [{ id: 'new-table', label: 'New Table', run: () => go('/featherbase/admin/new-table') }] : []),
    { id: 'theme-light', label: 'Theme: light', run: () => setTheme('light') },
    { id: 'theme-dark', label: 'Theme: dark (dark mode)', run: () => setTheme('dark') },
    { id: 'theme-device', label: 'Theme: same as device', run: () => setTheme('device') },
    ...(canUseAdmin ? [{ id: 'home', label: 'Go to Admin home', run: () => go('/featherbase/admin') }] : []),
    { id: 'logout', label: 'Log out', run: () => void signOut() },
  ]
  const commandHits =
    search.trim().length > 1
      ? commands.filter((c) => c.label.toLowerCase().includes(search.trim().toLowerCase()))
      : []
  // #1325: an Enter that came before the results opens the first once they are listed, or gives up when none came.
  useEffect(() => {
    if (enterPending === null) return
    if (enterPending !== trimmed) setEnterPending(null)
    else if (resultElements().some((el) => !el.id.startsWith('command-search-'))) {
      setEnterPending(null)
      openTopResult(enterPending)
    } else if (!searching) setEnterPending(null)
  })

  // #1265: once every group has answered and nothing anywhere matched, say so.
  const noMatch = current && (!canUseAdmin || (streamed.done && !streamed.failed)) && recordHits.length === 0 &&
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
                <a
                  key={d.row_id}
                  {...resultProps(`table-${d.row_id}`)}
                  href={tableHref(d.row_id)}
                  onClick={openLink}
                  data-testid="awesomebar-table"
                  className="block px-3 py-1.5 text-sm text-ink hover:bg-action-tint"
                >
                  {d.label}
                  <span className="ml-2 text-xs text-ink-muted">{d.module} module · {d.kind === 'settings' ? 'settings' : 'open list'}</span>
                </a>
              ))}
              {/* UI-014: "new X" action for matched Tables */}
              {creatableSuggestions.length > 0 && (
                <h2 data-testid="awesomebar-create-heading" className="px-3 pt-2 text-xs font-semibold text-ink-muted">Create rows</h2>
              )}
              {creatableSuggestions.slice(0, 2).map((d) => (
                <a
                  key={`new-${d.row_id}`}
                  {...resultProps(`new-${d.row_id}`)}
                  href={`${tableHref(d.row_id)}/new`}
                  onClick={openLink}
                  data-testid="awesomebar-new"
                  className="block px-3 py-1.5 text-sm text-ink hover:bg-action-tint"
                >
                  <span className="text-action">+</span> New {d.label} row
                </a>
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
                  // #1345 (audit F16/F17/F19): a result is a link, so it opens in a new tab too; a plain click opens it here.
                  <a
                    key={`${h.table}/${h.row_id}`}
                    {...resultProps(`record-${h.table}/${h.row_id}`)}
                    href={rowHref(h.table, h.row_id)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                      e.preventDefault()
                      openDoc(e.currentTarget.getAttribute('href')!)
                    }}
                    data-testid="awesomebar-doc"
                    className="flex min-h-control w-full items-center gap-2 px-3 py-1 text-left text-sm text-ink hover:bg-action-tint"
                  >
                    <TableTile name={g.label} />
                    {/* #1345: a person reads who they are, so two who share a name are told apart. */}
                    {h.table === 'Person'
                      ? <PersonLabel rowId={h.row_id} name={h.title} label={h.person} inLink withEmail={sameReading.has(h)} className="flex-1" />
                      : <span className="min-w-0 flex-1 truncate">{h.title}</span>}
                    <span className="shrink-0 text-xs text-ink-muted" data-testid="awesomebar-doc-table">{h.kind_label ?? g.label}</span>
                  </a>
                )))}
            </div>
          )}
        </form>
  )

  return (
    <div
      className={barFocused ? 'fixed inset-0 z-50 flex items-start justify-center bg-scrim/30 px-4 pt-[12vh]' : 'hidden'}
      data-testid="command-palette"
    >
      {/* A dialog only while open: closed, it is not one on the page. */}
      <div role={barFocused ? 'dialog' : undefined} aria-label={barFocused ? 'Search or Command' : undefined} className={raisedClasses('w-full max-w-2xl p-2')}>
        {commandBar}
      </div>
    </div>
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
