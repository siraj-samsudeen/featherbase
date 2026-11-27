import { Link, useNavigate } from '@tanstack/react-router'
import { rowHref, tableHref } from 'shared'
import { useHomePages, type HomePageShortcut } from '../lib/home-pages'
import { ActivityFeed } from './ActivityFeed'
import { ResumeStrip, RoutineCard } from './HomeRecall'
import { cardClasses, Chip, touchRowClasses } from '@featherbase/shop-floor'

// UI-027 / #80: a Home Page renders its grouped link cards (curated in the
// `links` sub-table through the generic FormView — no dedicated editor) plus
// its legacy JSON shortcuts. Everything shown here has already been
// role-scoped and permission-filtered by GET /api/home_pages.

const UNLABELLED_CARD_HEADING = 'Tables'

function routeFor(s: HomePageShortcut): string {
  const to = s.link_to
  switch (s.type) {
    case 'dashboard':
      return `/featherbase/admin/dashboard/${encodeURIComponent(to)}`
    case 'report':
      return rowHref('Report', to)
    case 'url':
      return to
    case 'table':
    default:
      return tableHref(to)
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

      {page.cards.length === 0 && page.shortcuts.length === 0 && page.pages.length === 0 && (
        <p className="text-sm text-ink-subtle" data-testid="home-page-empty">
          Nothing here yet. Links are curated on the Home Page document itself.
        </p>
      )}

      {(page.cards.length > 0 || page.pages.length > 0) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-3" data-testid="home-page-cards">
          {/* #1410: the group's runtime pages, beside its Tables. A Draft is listed only for someone who may build. */}
          {page.pages.length > 0 && (
            <div className={cardClasses('p-4')} data-testid="home-card-pages">
              <div className="mb-2 text-xs font-semibold text-ink-subtle" data-testid="home-card-heading">Pages</div>
              <ul className="space-y-0.5">
                {page.pages.map((each) => (
                  <li key={each.name} className="flex items-center gap-2">
                    <Link
                      to="/featherbase/admin/page/$name"
                      params={{ name: each.name }}
                      data-testid={`home-page-link-${each.name}`}
                      className={touchRowClasses('flex min-w-0 items-center rounded px-1.5 py-1 text-sm text-ink hover:bg-action-tint hover:text-action')}
                    >
                      {each.title}
                    </Link>
                    {each.status === 'Draft' && <Chip hue="amber" compact>Draft</Chip>}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
                    to="/featherbase/admin/table/$table"
                    params={{ table: l.link_to }}
                    search={{ filters: undefined }}
                    data-testid={`home-link-${l.link_to}`}
                    className={touchRowClasses('flex items-center rounded px-1.5 py-1 text-sm text-ink hover:bg-action-tint hover:text-action')}
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3" data-testid="home-page-shortcuts">
          {page.shortcuts.map((s) => s.type === 'url' && !s.link_to.startsWith('/featherbase/') ? (
            // An address outside the Admin (an app's own pages) is a page of its own: a plain link loads it,
            // where the Admin's router would answer "Page not found".
            <a key={s.label} href={s.link_to} data-testid={`shortcut-${s.label}`} className={cardClasses('block p-4 text-left transition hover:bg-hover')}>
              <div className="text-sm font-medium text-ink">{s.label}</div>
              <div className="mt-1 text-xs text-ink-muted">{s.type}</div>
            </a>
          ) : (
            <button
              key={s.label}
              data-testid={`shortcut-${s.label}`}
              onClick={() => navigate({ to: routeFor(s) })}
              className={cardClasses('p-4 text-left transition hover:bg-hover')}
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
