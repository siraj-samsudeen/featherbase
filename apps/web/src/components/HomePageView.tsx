import { Link, useNavigate } from '@tanstack/react-router'
import { useHomePages, type HomePageShortcut } from '../lib/home-pages'
import { ActivityFeed } from './ActivityFeed'
import { ResumeStrip, RoutineCard } from './HomeRecall'

// UI-027 / #80: a Home Page renders its grouped link cards (curated in the
// `links` sub-table through the generic FormView — no dedicated editor) plus
// its legacy JSON shortcuts. Everything shown here has already been
// role-scoped and permission-filtered by GET /api/home_pages.

function routeFor(s: HomePageShortcut): string {
  const to = s.link_to
  switch (s.type) {
    case 'dashboard':
      return `/admin/dashboard/${encodeURIComponent(to)}`
    case 'report':
      return `/admin/query-report/${encodeURIComponent(to)}`
    case 'url':
      return to
    case 'doctype':
    default:
      return `/admin/${encodeURIComponent(to)}`
  }
}

export function HomePageView({ name }: { name: string }) {
  const navigate = useNavigate()
  const pages = useHomePages()

  if (pages.isError)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="home-page-error">
        Could not load Home Pages
      </div>
    )
  if (!pages.data) return <div className="p-4 text-[var(--color-ink-faint)]">Loading…</div>

  const page = pages.data.pages.find((p) => p.row_id === name)
  if (!page)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="home-page-error">
        Home Page not found
      </div>
    )

  return (
    <div data-testid="home-page" className="space-y-4">
      <h1 className="text-lg font-semibold text-[var(--color-ink)]" data-testid="home-page-title">
        {page.icon ? `${page.icon} ` : ''}
        {page.label || page.row_id}
      </h1>

      {/* #101 Phase 5: resuming beats browsing — last row/view/search first,
          then the pinned workspace or the routine suggestion. */}
      <ResumeStrip />
      <RoutineCard />

      {page.cards.length === 0 && page.shortcuts.length === 0 && (
        <p className="text-sm text-[var(--color-ink-faint)]" data-testid="home-page-empty">
          Nothing here yet. Links are curated on the Home Page document itself.
        </p>
      )}

      {page.cards.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-page-cards">
          {page.cards.map((card, i) => (
            <div key={card.label ?? i} className="fc-card p-4" data-testid={`home-card-${card.label ?? 'links'}`}>
              {card.label && (
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                  {card.label}
                </div>
              )}
              <div className="space-y-0.5">
                {card.links.map((l) => (
                  <Link
                    key={l.link_to}
                    to="/admin/$doctype"
                    params={{ doctype: l.link_to }}
                    search={{ filters: undefined }}
                    data-testid={`home-link-${l.link_to}`}
                    className="block rounded px-1.5 py-1 text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)] hover:text-[var(--color-brand)]"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legacy UI-027 shortcuts, still rendered as navigable cards. */}
      {page.shortcuts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="home-page-shortcuts">
          {page.shortcuts.map((s) => (
            <button
              key={s.label}
              data-testid={`shortcut-${s.label}`}
              onClick={() => navigate({ to: routeFor(s) })}
              className="fc-card p-4 text-left transition hover:border-[var(--color-brand)]"
            >
              <div className="text-sm font-medium text-[var(--color-ink)]">{s.label}</div>
              <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{s.type ?? 'doctype'}</div>
            </button>
          ))}
        </div>
      )}

      {/* #101 Phase 4: the activity feed rides every Home Page. */}
      <ActivityFeed />
    </div>
  )
}
