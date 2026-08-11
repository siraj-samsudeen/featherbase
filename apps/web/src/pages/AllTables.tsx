import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { listResource } from '../lib/api'

// #80: with the sidebar flipped to Home Pages, this page keeps EVERY table
// reachable — it is the sidebar's "All tables" entry. Same curation as the
// old sidebar (#74): user tables first, grouped by module; every platform
// table under ONE System group, collapsed by default with a count badge.
// Grouping, never hiding.
export function AllTablesPage() {
  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: () =>
      listResource<{ row_id: string; module: string; system: boolean }>('Table', {
        filters: [['kind', '!=', 'sub_table']],
        fields: ['name', 'module', 'system'],
        order_by: 'name asc',
        limit_page_length: 200,
      }),
  })

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

  const byModule = new Map<string, { row_id: string; module: string; system: boolean }[]>()
  const systemTables: { row_id: string; module: string; system: boolean }[] = []
  for (const dt of tables.data?.data ?? []) {
    if (dt.system) {
      systemTables.push(dt)
      continue
    }
    const key = dt.module || 'Custom'
    byModule.set(key, [...(byModule.get(key) ?? []), dt])
  }
  const appModules = [...byModule.keys()].sort()

  const linkClass =
    'block rounded-md px-2 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-subtle)]'
  const activeClass =
    'block rounded-md px-2 py-1.5 text-sm font-medium text-[var(--color-brand)] bg-[var(--color-brand-tint)]'

  return (
    <div className="max-w-3xl" data-testid="all-tables-page">
      <h1 className="mb-2 text-lg font-semibold text-[var(--color-ink)]">All tables</h1>
      <nav className="fc-card px-3 py-2" data-testid="doctype-nav">
        {tables.isLoading && (
          <p className="px-2 py-1 text-xs text-[var(--color-ink-faint)]">Loading…</p>
        )}
        {appModules.map((mod) => (
          <div key={mod}>
            <div className="px-2 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {mod}
            </div>
            {(byModule.get(mod) ?? []).map((dt) => (
              <Link
                key={dt.row_id}
                to="/admin/$doctype"
                params={{ doctype: dt.row_id }}
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
              className="flex w-full items-center gap-1.5 rounded-md px-2 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
            >
              <span
                aria-hidden="true"
                className={`inline-block text-[9px] transition-transform ${systemOpen ? 'rotate-90' : ''}`}
              >
                ▶
              </span>
              System
              <span
                data-testid="system-group-count"
                className="ml-auto rounded-full bg-[var(--color-subtle)] px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[var(--color-ink-muted)]"
              >
                {systemTables.length}
              </span>
            </button>
            {systemOpen &&
              systemTables.map((dt) => (
                <Link
                  key={dt.row_id}
                  to="/admin/$doctype"
                  params={{ doctype: dt.row_id }}
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
