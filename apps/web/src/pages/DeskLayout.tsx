import { useState } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { clearSession, getSessionUser, listResource } from '../lib/api'

// Frappe-style Desk shell: top navbar (brand + awesomebar + avatar) and a
// workspace sidebar. All DocTypes render inside <Outlet/>.
export function DeskLayout() {
  const navigate = useNavigate()
  const user = getSessionUser()
  const [search, setSearch] = useState('')

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

  function runSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = search.trim()
    if (!q) return
    const hit = doctypes.data?.data.find(
      (d) => d.name.toLowerCase() === q.toLowerCase(),
    )
    const target = hit?.name ?? q
    navigate({ to: '/desk/$doctype', params: { doctype: target }, search: { filters: undefined } })
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
          {suggestions.length > 0 && (
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
            </div>
          )}
        </form>

        <div className="flex items-center gap-3">
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
