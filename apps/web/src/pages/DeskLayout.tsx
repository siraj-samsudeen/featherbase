import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, clearSession, getSessionUser, listResource } from '../lib/api'
import { useRealtime } from '../lib/realtime'
import { useTheme } from '../lib/theme'

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
  const [search, setSearch] = useState('')

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

  return (
    <div className="flex h-full flex-col">
      {/* Navbar */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-white px-4">
        <Link to="/desk" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-brand)] text-xs font-bold text-white">
            F
          </span>
          <span className="text-sm font-semibold text-[var(--color-ink)]">Frappe Clone</span>
        </Link>

        <form onSubmit={runSearch} className="relative mx-auto w-full max-w-md" data-testid="awesomebar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or go to…"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-brand)] focus:bg-white focus:ring-2 focus:ring-[var(--color-brand)]/15"
          />
          {(suggestions.length > 0 || (docHits.data?.results.length ?? 0) > 0) && (
            <div className="fc-card absolute z-20 mt-1 w-full overflow-hidden py-1" data-testid="awesomebar-results">
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
            Log out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-white">
          <div className="px-3 pt-4">
            <Link
              to="/desk/new-doctype"
              data-testid="new-doctype-link"
              className="fc-btn-primary w-full justify-center"
            >
              + New DocType
            </Link>
          </div>
          <div className="px-4 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Workspace
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-4" data-testid="doctype-nav">
            {doctypes.isLoading && <p className="px-2 py-1 text-xs text-[var(--color-ink-faint)]">Loading…</p>}
            {doctypes.data?.data.map((dt) => (
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
        <main className="min-w-0 flex-1 overflow-auto bg-[var(--color-canvas)] p-6">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
