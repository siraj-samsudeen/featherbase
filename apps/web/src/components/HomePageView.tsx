import { Link, useNavigate } from '@tanstack/react-router'
import { useHomePages, type HomePageShortcut } from '../lib/home-pages'
import { ActivityFeed } from './ActivityFeed'
import { ResumeStrip, RoutineCard } from './HomeRecall'
import { cardClasses } from './ui'

// UI-027 / #80: a Home Page renders its grouped link cards (curated in the
// `links` sub-table through the generic FormView — no dedicated editor) plus
// its legacy JSON shortcuts. Everything shown here has already been
// role-scoped and permission-filtered by GET /api/home_pages.

export const UNLABELLED_CARD_HEADING = 'Tables'

function routeFor(s: HomePageShortcut): string {
  const to = s.link_to
  switch (s.type) {
    case 'dashboard':
      return `/featherbase/admin/dashboard/${encodeURIComponent(to)}`
    case 'report':
      return `/featherbase/admin/Report/${encodeURIComponent(to)}`
    case 'url':
      return to
    case 'table':
    default:
      return `/featherbase/admin/${encodeURIComponent(to)}`
  }
}

export function HomePageView({ name }: { name: string }) {
  const navigate = useNavigate()
  const pages = useHomePages()

  if (pages.isError)
    return (
      <div className={cardClasses('p-4 text-sm text-negative')} data-testid="home-page-error">
        Could not load Home Pages
      </div>
    )
  if (!pages.data) return <div className="p-4 text-ink-subtle">Loading…</div>

  const page = pages.data.pages.find((p) => p.row_id === name)
  if (!page)
    return (
      <div className={cardClasses('p-4 text-sm text-negative')} data-testid="home-page-error">
        Home Page not found
      </div>
    )

  return (
    <div data-testid="home-page" className="space-y-4">
      <h1 className="text-lg font-semibold text-ink" data-testid="home-page-title">
        {page.icon ? `${page.icon} ` : ''}
        {page.label || page.row_id}
      </h1>

      {/* #101 Phase 5: resuming beats browsing — last row/view/search first,
          then the pinned workspace or the routine suggestion. */}
      <ResumeStrip />
      <RoutineCard />

      {page.cards.length === 0 && page.shortcuts.length === 0 && (
        <p className="text-sm text-ink-subtle" data-testid="home-page-empty">
          Nothing here yet. Links are curated on the Home Page document itself.
        </p>
      )}

      {page.cards.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-page-cards">
          {page.cards.map((card, i) => (
            <div key={card.label ?? i} className={cardClasses('p-4')} data-testid={`home-card-${card.label ?? 'links'}`}>
              {/* Links curated before the first card break form a card with no
                  label of its own; every link here opens a Table, so it says so. */}
              <div className="mb-2 text-xs font-semibold text-ink-subtle" data-testid="home-card-heading">
                {card.label ?? UNLABELLED_CARD_HEADING}
              </div>
              <div className="space-y-0.5">
                {card.links.map((l) => (
                  <Link
                    key={l.link_to}
                    to="/featherbase/admin/$table"
                    params={{ table: l.link_to }}
                    search={{ filters: undefined }}
                    data-testid={`home-link-${l.link_to}`}
                    className="block rounded px-1.5 py-1 text-sm text-ink hover:bg-action-tint hover:text-action"
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
              className={cardClasses('p-4 text-left transition hover:border-action')}
            >
              <div className="text-sm font-medium text-ink">{s.label}</div>
              <div className="mt-1 text-xs text-ink-muted">{s.type ?? 'table'}</div>
            </button>
          ))}
        </div>
      )}

      {/* #101 Phase 4: the activity feed rides every Home Page. */}
      <ActivityFeed />
    </div>
  )
}
