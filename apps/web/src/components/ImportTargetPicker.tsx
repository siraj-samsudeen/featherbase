import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tableMatchQuality } from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, type TableMeta } from '../lib/meta'
import type { ParsedSheet } from '../lib/parse-file'
import type { ImportTarget, MappableColumn, SheetPlan } from '../lib/import-plan'
import { cardClasses, inputClasses } from '@featherbase/shop-floor'
import { fmtCount } from '@featherbase/shop-floor'

// Named UI-side import thresholds (packages/shared/src/import.ts) — suggestion bets. (IMPORT_CHUNK
// lives with the import-run module now.)
export const SUGGEST_MIN_SCORE = 0.3 // weakest near-match worth surfacing as a hint

const SUGGEST_MAX = 3 // hints shown per sheet

export async function fetchTargets(): Promise<ImportTarget[]> {
  const list = await listResource<{ row_id: string }>('Table', {
    filters: [['kind', '=', 'table']],
    fields: ['row_id'],
    order_by: 'row_id asc',
    limit_page_length: 500,
  })
  // #1007: the list names every Table, but an app's mandatory access can still
  // refuse this person one, even a System Manager. A refusal only leaves that
  // Table out; anything else, like an outage, is not "no targets" and still fails.
  // #1076: so does an app installed or upgraded after this page loaded (409):
  // its Tables are offered from the next reload, the rest import as usual.
  const metas = await Promise.all(
    list.data.map((t) =>
      api.get<TableMeta>(`/api/table/${encodeURIComponent(t.row_id)}:meta`).catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 403 || err.status === 409)) return null
        throw err
      }),
    ),
  )
  // #905: an archived Table takes no rows, so it is no import target.
  return metas.flatMap((m) => (m && !m.archived_at ? [{ name: m.name, columns: mappableColumns(m) }] : []))
}

// IMP-013: the target picker. A native <select> over hundreds of Tables was
// unusable — "New Table…" needed a full scroll-back, and the best candidates
// were buried alphabetically. This combobox pins the two actions on top,
// ranks the closest column-overlap matches next (with how much of each
// Table the sheet covers), and filters the full list through a search box.
export function TargetPicker({
  i,
  plan,
  sheet,
  targets,
  onPick,
}: {
  i: number
  plan: SheetPlan
  sheet: ParsedSheet
  targets: ImportTarget[]
  onPick: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const ranked = useMemo(
    () =>
      targets
        .map((t) => ({ t, q: tableMatchQuality(sheet.headers, t.columns) }))
        .filter((r) => r.q.score >= SUGGEST_MIN_SCORE)
        .sort((a, b) => b.q.score - a.q.score || b.q.coverage - a.q.coverage)
        .slice(0, SUGGEST_MAX),
    [targets, sheet],
  )

  const f = filter.trim().toLowerCase()
  const bestMatches = ranked.filter((r) => r.t.name.toLowerCase().includes(f))
  const bestNames = new Set(ranked.map((r) => r.t.name))
  const rest = targets.filter((t) => t.name.toLowerCase().includes(f) && !bestNames.has(t.name))

  const display = plan.mode === 'new' ? 'New Table…' : plan.table

  function pick(value: string) {
    onPick(value)
    setOpen(false)
    setFilter('')
  }

  const optionClass =
    'block w-full rounded px-2 py-1 text-left text-sm text-ink hover:bg-action-tint'
  const sectionClass =
    'px-2 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle'

  return (
    <div ref={rootRef} className="relative">
      <input
        readOnly
        value={display}
        onClick={() => setOpen((o) => !o)}
        data-testid={`iw-target-${i}`}
        className={inputClasses('w-56 cursor-pointer py-1')}
      />
      {open && (
        <div
          className={cardClasses('absolute right-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto p-1')}
          data-testid={`iw-target-menu-${i}`}
        >
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') {
                const first = bestMatches[0]?.t.name ?? rest[0]?.name
                if (first) pick(first)
              }
            }}
            placeholder="Search Tables…"
            data-testid={`iw-target-search-${i}`}
            className={inputClasses('mb-1 w-full py-1')}
          />
          <button type="button" onClick={() => pick('__new__')} data-testid={`iw-target-new-${i}`} className={optionClass}>
            <span className="text-action">+</span> New Table…
          </button>
          {bestMatches.length > 0 && (
            <>
              <div className={sectionClass}>Best matches</div>
              {bestMatches.map(({ t, q }) => (
                <button
                  type="button"
                  key={t.name}
                  onClick={() => pick(t.name)}
                  data-testid={`iw-target-opt-${i}-${t.name}`}
                  className={optionClass}
                >
                  {t.name}
                  <span className="ml-2 text-xs text-ink-subtle">
                    {q.mapped} of its {t.columns.length} columns
                  </span>
                </button>
              ))}
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className={sectionClass}>All Tables</div>
              {rest.map((t) => (
                <button
                  type="button"
                  key={t.name}
                  onClick={() => pick(t.name)}
                  data-testid={`iw-target-opt-${i}-${t.name}`}
                  className={optionClass}
                >
                  {t.name}
                </button>
              ))}
            </>
          )}
          {bestMatches.length === 0 && rest.length === 0 && (
            <p className="px-2 py-1 text-xs text-ink-subtle">No Table matches "{filter}"</p>
          )}
        </div>
      )}
    </div>
  )
}

// The target Table's CURRENT row count, shown beside the sheet's own counts
// so "11 rows in the file" vs "0 rows in the Table" can never be conflated.
export function TargetRowCount({ i, table }: { i: number; table: string }) {
  const count = useQuery({
    queryKey: ['iw-count', table],
    // #859: every row an import can match, retired ones included.
    queryFn: () => api.get<{ count: number }>(`/api/table/${encodeURIComponent(table)}:count?with_retired=true`),
    staleTime: 30_000,
  })
  if (count.data == null) return null
  return (
    <span className="text-xs text-ink-muted" data-testid={`iw-target-count-${i}`}>
      holds {fmtCount(count.data.count)} rows now
    </span>
  )
}

function mappableColumns(meta: TableMeta): MappableColumn[] {
  return meta.columns
    .filter(
      (c) =>
        !NO_COLUMN_TYPES.has(c.column_type) &&
        c.column_type !== 'Sub-table' &&
        !c.hidden &&
        !c.read_only,
    )
    .map((c) => ({ column_name: c.column_name, label: c.label, column_type: c.column_type }))
}
