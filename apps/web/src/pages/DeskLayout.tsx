import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, clearSession, getSessionUser, listResource } from '../lib/api'
import { useHomePages } from '../lib/home-pages'
import { useRealtime } from '../lib/realtime'
import { useTheme } from '../lib/theme'
import { PALETTES, usePalette, type Palette } from '../lib/palette'
import { useI18n } from '../lib/i18n'

interface SearchHit {
  table: string
  name: string
  title: string
}

// Frappe-style Admin shell: top navbar (brand + command bar + avatar) and a
// home page sidebar. All Tables render inside <Outlet/>.
export function DeskLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = getSessionUser()
  const { theme, toggle: toggleTheme } = useTheme()
  const { palette, set: setPalette } = usePalette()
  const { t, language, setLanguage } = useI18n()
  const [search, setSearch] = useState('')
  // UI-025: on narrow (mobile) widths the sidebar collapses into a drawer
  // toggled from the navbar; on md+ it is always shown.
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
  useRealtime(user ? [`user:${user.name}`] : [], (e) => {
    if (e.event === 'notification')
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] })
  })

  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: () =>
      listResource<{ name: string; module: string; system: boolean }>('Table', {
        filters: [['kind', '!=', 'sub_table']],
        fields: ['name', 'module', 'system'],
        order_by: 'name asc',
        limit_page_length: 200,
      }),
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
        if (dt && dt !== 'new-table') navigate({ to: '/desk/$doctype/$name', params: { doctype: dt, name: 'new' } })
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

  // UI-027 / #80: the sidebar lists the caller's visible Home Pages — the
  // dedicated endpoint is its only source (role visibility and link
  // permission-filtering are computed server-side).
  const homePages = useHomePages()

  function logout() {
    clearSession()
    // Drop all cached per-user data (whoami, lists, …) so the next account
    // in this tab never sees this user's still-fresh cache (PR #92 review),
    // and reset the theming attributes to the signed-out defaults.
    queryClient.clear()
    delete document.documentElement.dataset.palette
    delete document.documentElement.dataset.theme
    navigate({ to: '/login' })
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

  function openDoc(hit: SearchHit) {
    setSearch('')
    navigate({ to: '/desk/$doctype/$name', params: { doctype: hit.table, name: hit.name } })
  }

  // Enter opens the top match: an exactly-named Table's list first,
  // otherwise the first row hit.
  function runSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = search.trim()
    if (!q) return
    const dtHit = tables.data?.data.find((d) => d.name.toLowerCase() === q.toLowerCase())
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

  // User tables surface before system tables in suggestions (stable sort
  // keeps the alphabetical order within each group).
  const suggestions =
    search.trim().length > 0
      ? (tables.data?.data ?? [])
          .filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()))
          .sort((a, b) => Number(a.system) - Number(b.system))
          .slice(0, 7)
      : []

  // Command actions surfaced through the command bar (the ⌘K palette).
  const commands = [
    { id: 'new-table', label: 'New Table', run: () => navigate({ to: '/desk/new-table' }) },
    { id: 'toggle-theme', label: 'Toggle dark mode', run: () => toggleTheme() },
    { id: 'home', label: 'Go to Admin home', run: () => navigate({ to: '/desk' }) },
  ]
  const commandHits =
    search.trim().length > 1
      ? commands.filter((c) => c.label.toLowerCase().includes(search.trim().toLowerCase()))
      : []

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
              {/* UI-014: "new X" action for matched Tables */}
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
              {/* UI-014: row hits */}
              {docHits.data?.results.map((h) => (
                <button
                  key={`${h.table}/${h.name}`}
                  onClick={() => openDoc(h)}
                  data-testid="awesomebar-doc"
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]"
                >
                  {h.title}
                  {h.title !== h.name && (
                    <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{h.name}</span>
                  )}
                  <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{h.table}</span>
                </button>
              ))}
            </div>
          )}
        </form>

        <div className="flex items-center gap-3">
          {/* On narrow screens these selects move into the account menu —
              the navbar's controls don't wrap, so extra always-visible
              controls overflow at mobile widths (PR #92 review). */}
          <select
            data-testid="language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            title="Language"
            className="hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-ink)] md:block"
          >
            <option value="en">EN</option>
            <option value="fr">FR</option>
            <option value="es">ES</option>
          </select>
          <select
            data-testid="palette-select"
            value={palette}
            onChange={(e) => setPalette(e.target.value as Palette)}
            title="Color palette"
            className="hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs capitalize text-[var(--color-ink)] md:block"
          >
            {PALETTES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
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
          {/* #72: the avatar is the account menu — Change password + Log out. */}
          <div className="relative" ref={accountRef}>
            <button
              onClick={() => setAccountOpen((o) => !o)}
              data-testid="session-user"
              title={user?.full_name || user?.name}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white"
            >
              <span aria-hidden="true">{initials}</span>
              <span className="sr-only">{user?.full_name || user?.name}</span>
            </button>
            {accountOpen && (
              <div
                className="fc-card absolute right-0 top-9 z-30 w-56 overflow-hidden py-1"
                data-testid="account-menu"
                role="menu"
              >
                <div className="border-b border-[var(--color-border)] px-3 py-2">
                  <p className="truncate text-sm font-medium text-[var(--color-ink)]">
                    {user?.full_name || user?.name}
                  </p>
                  {user?.email && (
                    <p className="truncate text-xs text-[var(--color-ink-faint)]">{user.email}</p>
                  )}
                </div>
                {/* Mobile home of the navbar selects (hidden there below md). */}
                <div className="border-b border-[var(--color-border)] px-3 py-2 md:hidden">
                  <label className="fc-label" htmlFor="palette-select-mobile">
                    {t('Palette')}
                  </label>
                  <select
                    id="palette-select-mobile"
                    data-testid="palette-select-mobile"
                    value={palette}
                    onChange={(e) => setPalette(e.target.value as Palette)}
                    className="fc-input capitalize"
                  >
                    {PALETTES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <label className="fc-label mt-2" htmlFor="language-select-mobile">
                    {t('Language')}
                  </label>
                  <select
                    id="language-select-mobile"
                    data-testid="language-select-mobile"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="fc-input"
                  >
                    <option value="en">EN</option>
                    <option value="fr">FR</option>
                    <option value="es">ES</option>
                  </select>
                </div>
                <button
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false)
                    setPwModalOpen(true)
                  }}
                  data-testid="account-change-password"
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]"
                >
                  {t('Change password')}
                </button>
                <button
                  role="menuitem"
                  onClick={logout}
                  data-testid="logout"
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]"
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
              to="/desk/new-table"
              data-testid="new-doctype-link"
              className="fc-btn-primary w-full justify-center"
            >
              + New Table
            </Link>
            <Link
              to="/desk/import"
              search={{ table: undefined }}
              data-testid="import-data-link"
              className="fc-btn mt-2 w-full justify-center"
            >
              Import Data
            </Link>
          </div>
          {/* #80: the sidebar is Home Pages only (Frappe parity). Every
              table stays reachable through the All tables entry below —
              grouping and curation moved there, nothing is hidden. */}
          <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-3" data-testid="home-page-nav">
            {homePages.isLoading && (
              <p className="px-2 py-1 text-xs text-[var(--color-ink-faint)]">Loading…</p>
            )}
            {(homePages.data?.pages ?? []).map((p) => (
              <Link
                key={p.name}
                to="/desk/home/$name"
                params={{ name: p.name }}
                data-testid={`home-page-link-${p.name}`}
                className="block rounded-md px-2 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-subtle)]"
                activeProps={{
                  className:
                    'block rounded-md px-2 py-1.5 text-sm font-medium text-[var(--color-brand)] bg-[var(--color-brand-tint)]',
                }}
              >
                {p.icon ? `${p.icon} ` : ''}
                {p.label || p.name}
              </Link>
            ))}
          </nav>
          <div className="border-t border-[var(--color-border)] px-2 py-2">
            <Link
              to="/desk/all-tables"
              data-testid="all-tables-link"
              className="block rounded-md px-2 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-ink)]"
              activeProps={{
                className:
                  'block rounded-md px-2 py-1.5 text-sm font-medium text-[var(--color-brand)] bg-[var(--color-brand-tint)]',
              }}
            >
              All tables
            </Link>
          </div>
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

// #72: change the session user's own password. Posts { password } to
// /api/set_password (the endpoint scopes to the caller when no user is given).
// Mirrors the ResetPassword page's form: fc-card / fc-label / fc-input, a
// client-side confirm check, then a success state.
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4"
      data-testid="change-password-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fc-card w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-label="Change password">
        <h2 className="mb-4 text-base font-semibold text-[var(--color-ink)]">Change password</h2>
        {done ? (
          <div className="space-y-4" data-testid="change-password-done">
            <p className="text-sm text-[var(--color-ink)]">Your password has been updated.</p>
            <button
              type="button"
              onClick={onClose}
              className="fc-btn-primary w-full justify-center py-2"
              data-testid="change-password-close"
            >
              Done
            </button>
          </div>
        ) : (
          <form className="space-y-4" data-testid="change-password-form" onSubmit={onSubmit}>
            <div>
              <label className="fc-label" htmlFor="account-new-password">
                New password
              </label>
              <input
                id="account-new-password"
                type="password"
                name="password"
                autoComplete="new-password"
                autoFocus
                className="fc-input"
                data-testid="change-password-new"
              />
            </div>
            <div>
              <label className="fc-label" htmlFor="account-confirm-password">
                Confirm password
              </label>
              <input
                id="account-confirm-password"
                type="password"
                name="confirm"
                autoComplete="new-password"
                className="fc-input"
                data-testid="change-password-confirm"
              />
            </div>
            {error && (
              <p className="text-sm text-[var(--color-danger)]" data-testid="change-password-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="fc-btn" data-testid="change-password-cancel">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="fc-btn-primary" data-testid="change-password-submit">
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
