import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useShellTables, type TableSummary } from '../lib/session'
import { cardClasses } from '../components/ui'

// #80: with the sidebar flipped to Home Pages, this page keeps EVERY table
// reachable — it is the sidebar's "All tables" entry. Same curation as the
// old sidebar (#74): user tables first, grouped by module; every platform
// table under ONE System group, collapsed by default with a count badge.
// Grouping, never hiding.
export function AllTablesPage() {
  const tables = useShellTables()

  // The System group's open/closed choice sticks per browser (#74 — the
  // same localStorage-mirror pattern as lib/theme.ts).
  const [systemOpen, setSystemOpen] = useState(() => {
    try {
      return localStorage.getItem('fc_sidebar_system_open') === '1'
    } catch {
      return false
    }
  })
  function toggleSystemGroup() {
    setSystemOpen((open) => {
      try {
        localStorage.setItem('fc_sidebar_system_open', open ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !open
    })
  }

  const byModule = new Map<string, TableSummary[]>()
  const systemTables: TableSummary[] = []
  for (const dt of tables ?? []) {
    if (dt.system) {
      systemTables.push(dt)
      continue
    }
    const key = dt.module || 'Custom'
    byModule.set(key, [...(byModule.get(key) ?? []), dt])
  }
  const appModules = [...byModule.keys()].sort()

  const linkClass =
    'block rounded-md px-2 py-1.5 text-sm text-ink hover:bg-subtle'
  const activeClass =
    'block rounded-md px-2 py-1.5 text-sm font-medium text-action bg-action-tint'

  return (
    <div className="max-w-3xl" data-testid="all-tables-page">
      <h1 className="mb-2 text-lg font-semibold text-ink">All tables</h1>
      <nav className={cardClasses('px-3 py-2')} data-testid="table-nav">
        {tables === undefined && (
          <p className="px-2 py-1 text-xs text-ink-subtle">Loading…</p>
        )}
        {appModules.map((mod) => (
          <div key={mod}>
            <div className="px-2 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              {mod}
            </div>
            {(byModule.get(mod) ?? []).map((dt) => (
              <Link
                key={dt.row_id}
                to="/featherbase/admin/$table"
                params={{ table: dt.row_id }}
                search={{ filters: undefined }}
                className={linkClass}
                activeProps={{ className: activeClass }}
              >
                {dt.row_id}
              </Link>
            ))}
          </div>
        ))}
        {systemTables.length > 0 && (
          <>
            <button
              type="button"
              onClick={toggleSystemGroup}
              aria-expanded={systemOpen}
              data-testid="system-group-toggle"
              className="flex w-full items-center gap-1.5 rounded-md px-2 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle hover:text-ink-muted"
            >
              <span
                aria-hidden="true"
                className={`inline-block text-xs transition-transform ${systemOpen ? 'rotate-90' : ''}`}
              >
                ▶
              </span>
              System
              <span
                data-testid="system-group-count"
                className="ml-auto rounded-full bg-subtle px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal text-ink-muted"
              >
                {systemTables.length}
              </span>
            </button>
            {systemOpen &&
              systemTables.map((dt) => (
                <Link
                  key={dt.row_id}
                  to="/featherbase/admin/$table"
                  params={{ table: dt.row_id }}
                  search={{ filters: undefined }}
                  className={linkClass}
                  activeProps={{ className: activeClass }}
                >
                  {dt.row_id}
                </Link>
              ))}
          </>
        )}
      </nav>
    </div>
  )
}
