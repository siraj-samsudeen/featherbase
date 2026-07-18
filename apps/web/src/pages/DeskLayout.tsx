import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, clearSession, getSessionUser, listResource } from '../lib/api'
import { useRealtime } from '../lib/realtime'
import { useTheme } from '../lib/theme'
import { useI18n } from '../lib/i18n'

interface SearchHit {
  doctype: string
  name: string
  title: string
}

// Frappe-style Desk shell: top navbar (brand + awesomebar + avatar) and a
// workspace sidebar. All DocTypes render inside <Outlet/>.
export function DeskLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = getSessionUser()
  const { theme, toggle: toggleTheme } = useTheme()
  const { t, language, setLanguage } = useI18n()
  const [search, setSearch] = useState('')
  // UI-025: on narrow (mobile) widths the sidebar collapses into a drawer
  // toggled from the navbar; on md+ it is always shown.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // RT-003: unread notification count, live-updated when a realtime
  // 'notification' event arrives for this user.
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<{ count: number }>('/api/unread_count'),
  })
  useRealtime(user ? [`user:${user.name}`] : [], (e) => {
    if (e.event === 'notification')
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] })
  })

  const doctypes = useQuery({
    queryKey: ['doctypes'],
    queryFn: () =>
      listResource<{ name: string; module: string }>('DocType', {
        filters: [['istable', '=', false]],
        fields: ['name', 'module'],
        order_by: 'name asc',
        limit_page_length: 200,
      }),
  })

  // ⌘K / Ctrl+K focuses the awesomebar (PR-2-style command palette entry).
  const searchRef = useRef<HTMLInputElement>(null)

  // UI-015: global keyboard shortcuts.
  //   Ctrl/Cmd+K  focus the awesomebar (command palette)
  //   Ctrl/Cmd+S  save the current form
  //   Ctrl/Cmd+B  new document of the current DocType
  //   g then d    go to the Desk home
  useEffect(() => {
    let leader = 0 // timestamp of a recent 'g' press
    function currentDoctype(): string | null {
      const m = /^\/desk\/([^/]+)/.exec(window.location.pathname)
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
        const dt = currentDoctype()
        if (dt && dt !== 'new-doctype') navigate({ to: '/desk/$doctype/$name', params: { doctype: dt, name: 'new' } })
        return
      }
      // Leader-key navigation only when not typing into a field.
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const now = Date.now()
      if (e.key.toLowerCase() === 'g') {
        leader = now
      } else if (e.key.toLowerCase() === 'd' && now - leader < 1000) {
        leader = 0
        navigate({ to: '/desk' })
      } else {
        leader = 0
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  // UI-027: workspaces listed in the sidebar for quick navigation.
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () =>
      listResource<{ name: string; label: string }>('Workspace', {
        fields: ['name', 'label'],
        order_by: 'label asc',
        limit_page_length: 100,
      }),
  })

  function logout() {
    clearSession()
    navigate({ to: '/login' })
  }

  // UI-014: document hits from the server, debounced.
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

  function openDoc(hit: SearchHit) {
    setSearch('')
    navigate({ to: '/desk/$doctype/$name', params: { doctype: hit.doctype, name: hit.name } })
  }

  // Enter opens the top match: an exactly-named DocType's list first,
  // otherwise the first document hit.
  function runSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = search.trim()
    if (!q) return
    const dtHit = doctypes.data?.data.find((d) => d.name.toLowerCase() === q.toLowerCase())
    if (dtHit) {
      setSearch('')
      navigate({ to: '/desk/$doctype', params: { doctype: dtHit.name }, search: { filters: undefined } })
      return
    }
    const doc = docHits.data?.results[0]
    if (doc) {
      openDoc(doc)
      return
    }
    navigate({ to: '/desk/$doctype', params: { doctype: q }, search: { filters: undefined } })
  }

  const initials = (user?.full_name || user?.name || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  const suggestions =
    search.trim().length > 0
      ? (doctypes.data?.data ?? [])
          .filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()))
          .slice(0, 7)
      : []

  // Command actions surfaced through the awesomebar (the ⌘K palette).
  const commands = [
    { id: 'new-doctype', label: 'New DocType', run: () => navigate({ to: '/desk/new-doctype' }) },
    { id: 'toggle-theme', label: 'Toggle dark mode', run: () => toggleTheme() },
    { id: 'home', label: 'Go to Desk home', run: () => navigate({ to: '/desk' }) },
  ]
  const commandHits =
    search.trim().length > 1
      ? commands.filter((c) => c.label.toLowerCase().includes(search.trim().toLowerCase()))
      : []

  // Sidebar curation (from the PR-2 comparison): app doctypes surface first,
  // grouped by module; the engine's Core doctypes sit below under System.
  // Everything stays visible — this is ordering, not hiding.
  const byModule = new Map<string, { name: string; module: string }[]>()
  for (const dt of doctypes.data?.data ?? []) {
    const key = dt.module || 'Core'
    byModule.set(key, [...(byModule.get(key) ?? []), dt])
  }
  const appModules = [...byModule.keys()].filter((m) => m !== 'Core').sort()
  const coreDoctypes = byModule.get('Core') ?? []

  return (
    <div className="flex h-full flex-col">
      {/* Navbar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 sm:gap-4 sm:px-4">
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          data-testid="sidebar-toggle"
          aria-label="Toggle menu"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)] md:hidden"
        >
          ☰
        </button>
        <Link to="/desk" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-brand)] text-xs font-bold text-white">
            F
          </span>
          <span className="hidden text-sm font-semibold text-[var(--color-ink)] sm:inline">Frappe Clone</span>
        </Link>

        <form onSubmit={runSearch} className="relative mx-auto w-full max-w-md" data-testid="awesomebar">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or type a command…"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-1.5 pr-10 text-sm outline-none focus:border-[var(--color-brand)] focus:bg-[var(--color-surface)] focus:ring-2 focus:ring-[var(--color-brand)]/15"
          />
          <kbd
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-[10px] text-[var(--color-ink-faint)]"
            aria-hidden="true"
          >
            ⌘K
          </kbd>
          {(suggestions.length > 0 || commandHits.length > 0 || (docHits.data?.results.length ?? 0) > 0) && (
            <div className="fc-card absolute z-20 mt-1 w-full overflow-hidden py-1" data-testid="awesomebar-results">
              {/* PR-2-style command actions, matched by name. */}
              {commandHits.map((cmd) => (
                <button
                  key={cmd.id}
                  type="button"
                  onClick={() => {
                    setSearch('')
                    cmd.run()
                  }}
                  data-testid={`awesomebar-cmd-${cmd.id}`}
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]"
                >
                  <span className="text-[var(--color-brand)]">›</span> {cmd.label}
                </button>
              ))}
              {suggestions.map((d) => (
                <Link
                  key={d.name}
                  to="/desk/$doctype"
                  params={{ doctype: d.name }}
                  search={{ filters: undefined }}
                  onClick={() => setSearch('')}
                  className="block px-3 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]"
                >
                  {d.name}
                  <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{d.module}</span>
                </Link>
              ))}
              {/* UI-014: "new X" action for matched DocTypes */}
              {suggestions.slice(0, 2).map((d) => (
                <Link
                  key={`new-${d.name}`}
                  to="/desk/$doctype/$name"
                  params={{ doctype: d.name, name: 'new' }}
                  onClick={() => setSearch('')}
                  data-testid="awesomebar-new"
                  className="block px-3 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]"
                >
                  <span className="text-[var(--color-brand)]">+</span> New {d.name}
                </Link>
              ))}
              {/* UI-014: document hits */}
              {docHits.data?.results.map((h) => (
                <button
                  key={`${h.doctype}/${h.name}`}
                  onClick={() => openDoc(h)}
                  data-testid="awesomebar-doc"
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]"
                >
                  {h.title}
                  {h.title !== h.name && (
                    <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{h.name}</span>
                  )}
                  <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{h.doctype}</span>
                </button>
              ))}
            </div>
          )}
        </form>

        <div className="flex items-center gap-3">
          <select
            data-testid="language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            title="Language"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-ink)]"
          >
            <option value="en">EN</option>
            <option value="fr">FR</option>
            <option value="es">ES</option>
          </select>
          <button
            onClick={toggleTheme}
            data-testid="theme-toggle"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <div className="relative" title="Notifications">
            <span className="text-[var(--color-ink-muted)]" data-testid="notif-bell">
              🔔
            </span>
            {(unread.data?.count ?? 0) > 0 && (
              <span
                className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-semibold text-white"
                data-testid="unread-count"
              >
                {unread.data?.count}
              </span>
            )}
          </div>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white"
            data-testid="session-user"
            title={user?.full_name || user?.name}
          >
            <span aria-hidden="true">{initials}</span>
            <span className="sr-only">{user?.full_name || user?.name}</span>
          </div>
          <button onClick={logout} data-testid="logout" className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            {t('Log out')}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* UI-025: on mobile, a backdrop closes the drawer. */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 top-12 z-20 bg-black/30 md:hidden"
            data-testid="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Sidebar — static on md+, a slide-in drawer on mobile. Clicking any
            link inside closes the drawer. */}
        <aside
          data-testid="desk-sidebar"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) setSidebarOpen(false)
          }}
          className={`fixed bottom-0 left-0 top-12 z-30 flex w-64 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-transform md:static md:top-0 md:w-60 md:shrink-0 md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="px-3 pt-4">
            <Link
              to="/desk/new-doctype"
              data-testid="new-doctype-link"
              className="fc-btn-primary w-full justify-center"
            >
              + New DocType
            </Link>
          </div>
          {(workspaces.data?.data.length ?? 0) > 0 && (
            <div data-testid="workspace-nav">
              <div className="px-4 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                Workspaces
              </div>
              <nav className="px-2">
                {workspaces.data?.data.map((w) => (
                  <Link
                    key={w.name}
                    to="/desk/workspace/$name"
                    params={{ name: w.name }}
                    data-testid={`workspace-link-${w.name}`}
                    className="block rounded-md px-2 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-subtle)]"
                    activeProps={{ className: 'block rounded-md px-2 py-1.5 text-sm font-medium text-[var(--color-brand)] bg-[var(--color-brand-tint)]' }}
                  >
                    {w.label || w.name}
                  </Link>
                ))}
              </nav>
            </div>
          )}
          <nav className="flex-1 overflow-y-auto px-2 pb-4" data-testid="doctype-nav">
            {doctypes.isLoading && <p className="px-2 py-1 text-xs text-[var(--color-ink-faint)]">Loading…</p>}
            {/* App modules first (Ticketing, Helpdesk, …), engine Core last. */}
            {appModules.map((mod) => (
              <div key={mod}>
                <div className="px-2 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                  {mod}
                </div>
                {(byModule.get(mod) ?? []).map((dt) => (
                  <Link
                    key={dt.name}
                    to="/desk/$doctype"
                    params={{ doctype: dt.name }}
                    search={{ filters: undefined }}
                    className="block rounded-md px-2 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-subtle)]"
                    activeProps={{
                      className:
                        'block rounded-md px-2 py-1.5 text-sm font-medium text-[var(--color-brand)] bg-[var(--color-brand-tint)]',
                    }}
                  >
                    {dt.name}
                  </Link>
                ))}
              </div>
            ))}
            {coreDoctypes.length > 0 && (
              <div className="px-2 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                System
              </div>
            )}
            {coreDoctypes.map((dt) => (
              <Link
                key={dt.name}
                to="/desk/$doctype"
                params={{ doctype: dt.name }}
                search={{ filters: undefined }}
                className="block rounded-md px-2 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-subtle)]"
                activeProps={{
                  className:
                    'block rounded-md px-2 py-1.5 text-sm font-medium text-[var(--color-brand)] bg-[var(--color-brand-tint)]',
                }}
              >
                {dt.name}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Page canvas */}
        <main className="min-w-0 flex-1 overflow-auto bg-[var(--color-canvas)] p-4 sm:p-6">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
