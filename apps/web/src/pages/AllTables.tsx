import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { adminPageTitle } from 'shared'
import { useShellTables, type TableSummary } from '../lib/session'
import { metaQuery, tableLabel } from '../lib/meta'
import { SearchInput, cardClasses, touchRowClasses } from '@featherbase/shop-floor'

// #80: with the sidebar flipped to Home Pages, this page keeps EVERY table
// reachable — it is the sidebar's "All tables" entry. Same curation as the
// old sidebar (#74): user tables first, grouped by module; every platform
// table under ONE System group, collapsed by default with a count badge.
// Grouping, never hiding. #1242 (admin-lists 10-14): each Table by its label
// with its one line, a "Find a table" search, sentence-case groups in a grid.

/** A group heading in sentence case ("Store layout"), its acronyms kept ("SAP masters"). */
const sentence = (words: string) => words.split(/\s+/).map((w, i) => (/^[A-Z0-9]{2,}$/.test(w) ? w : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ')

/** The Tables whose label can differ from their name: an app's ("tickets.ticket"
 *  reads "Ticket") and a view. Every other Table is named by its name. */
const mayHaveLabel = (t: TableSummary) => t.row_id.includes('.') || t.kind === 'view'

export function AllTablesPage() {
  const tables = useShellTables()
  const labelled = (tables ?? []).filter(mayHaveLabel)
  const metas = useQueries({ queries: labelled.map((t) => metaQuery(t.row_id)) })
  const labels = new Map(labelled.map((t, i) => [t.row_id, tableLabel(t.row_id, metas[i]?.data)]))
  /** A Table as people read it: its label, else its name. */
  const nameOf = (t: TableSummary) => labels.get(t.row_id) ?? t.row_id
  const [find, setFind] = useState('')

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

  // Search narrows by what people read (the label), the name and the module.
  const words = find.trim().toLowerCase()
  const matches = (t: TableSummary) => !words || [nameOf(t), t.row_id, t.module, t.description ?? ''].some((w) => w.toLowerCase().includes(words))
  const byModule = new Map<string, TableSummary[]>()
  const systemTables: TableSummary[] = []
  // #905: archived Tables stay reachable here, under their own group.
  const archivedTables: TableSummary[] = []
  for (const dt of tables ?? []) {
    if (!matches(dt)) continue
    if (dt.archived) {
      archivedTables.push(dt)
      continue
    }
    if (dt.system) {
      systemTables.push(dt)
      continue
    }
    const key = dt.module || 'Custom'
    byModule.set(key, [...(byModule.get(key) ?? []), dt])
  }
  const appModules = [...byModule.keys()].sort()
  // While searching, the System group opens to show what matched in it.
  const showSystem = systemOpen || Boolean(words)

  const linkClass = touchRowClasses('flex min-w-0 flex-col rounded-md px-2 py-1.5 text-sm text-ink hover:bg-subtle')
  const activeClass = touchRowClasses('flex min-w-0 flex-col rounded-md px-2 py-1.5 text-sm font-medium text-action bg-action-tint')
  const heading = 'px-2 pb-1 text-[13px] font-medium text-ink-muted'

  const tableLink = (dt: TableSummary) => (
    <Link
      key={dt.row_id}
      to="/featherbase/admin/table/$table"
      params={{ table: dt.row_id }}
      search={{ filters: undefined }}
      className={linkClass}
      activeProps={{ className: activeClass }}
    >
      <span className="truncate font-medium">
        {nameOf(dt)}
        {/* #1021: a view says what it is a view of. */}
        {dt.kind === 'view' && dt.view_of && (
          <span className="ml-2 text-xs font-normal text-ink-subtle" data-testid="all-tables-view-of">view of {dt.view_of}</span>
        )}
      </span>
      {dt.description && <span className="truncate text-[13px] text-ink-muted">{dt.description}</span>}
    </Link>
  )

  return (
    <div className="w-full" data-testid="all-tables-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">{adminPageTitle('all-tables')}</h1>
        <SearchInput
          // Someone opening All tables is looking for one.
          autoFocus
          aria-label="Find a table"
          placeholder="Find a table"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          data-testid="all-tables-find"
          className="w-72"
        />
      </div>
      <nav data-testid="table-nav" aria-label="All tables">
        {tables === undefined && (
          <p className="px-2 py-1 text-xs text-ink-subtle">Loading…</p>
        )}
        {tables !== undefined && words && !appModules.length && !systemTables.length && !archivedTables.length && (
          <p className="px-2 py-1 text-sm text-ink-muted" data-testid="all-tables-none">No table matches "{find.trim()}".</p>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {appModules.map((mod) => (
            <section key={mod} aria-label={mod} className={cardClasses('px-2 py-3')}>
              <h2 className={heading}>{sentence(mod)}</h2>
              {(byModule.get(mod) ?? []).map(tableLink)}
            </section>
          ))}
          {systemTables.length > 0 && (
            <section aria-label="System" className={cardClasses('px-2 py-3')}>
              <button
                type="button"
                onClick={toggleSystemGroup}
                aria-expanded={showSystem}
                data-testid="system-group-toggle"
                className={touchRowClasses(`flex w-full items-center gap-1.5 rounded-md ${heading} hover:text-ink`)}
              >
                <span aria-hidden="true" className={`inline-block text-xs transition-transform ${showSystem ? 'rotate-90' : ''}`}>▶</span>
                System
                <span data-testid="system-group-count" className="ml-auto rounded-full bg-subtle px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                  {systemTables.length}
                </span>
              </button>
              {showSystem && systemTables.map(tableLink)}
            </section>
          )}
          {archivedTables.length > 0 && (
            <section aria-label="Archived tables" data-testid="archived-group" className={cardClasses('px-2 py-3')}>
              <h2 className={heading}>Archived tables</h2>
              {archivedTables.map(tableLink)}
            </section>
          )}
        </div>
      </nav>
    </div>
  )
}
