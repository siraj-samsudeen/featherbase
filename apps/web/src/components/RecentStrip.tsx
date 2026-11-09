import { Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { parseFilters } from 'shared'
import { api, getSessionUser } from '../lib/api'
import { describeFilters, recentActions, type RecentEntry } from '../lib/recents'
import { RowTitle } from '../lib/row-titles'
import { useI18n } from '../lib/i18n'
import { touchRowClasses } from '@featherbase/shop-floor'
import { FilterWords, type Filter } from './ListFilters'

// #101 Phase 2: recall placed where the repeat work happens — this user's
// recent rows and recent filter sets for THIS table, from the same
// localStorage buffer the command bar reads. A view chip re-applies its
// whole filter set through the normal onFiltersChange pipeline (the filters
// live in the URL, so this is just replaying a remembered list state).
export function RecentStrip({
  table,
  meta,
  withRetired,
  onApply,
}: {
  table: string
  /** Names each filter's column; until it loads a filter reads as stored. */
  meta: import('../lib/meta').TableMeta | undefined
  /** #959: offer retired rows only while the list shows them. */
  withRetired: boolean
  onApply: (filters: Filter[]) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const user = getSessionUser()
  const entries = user ? recentActions(user.row_id, 60) : []
  const remembered = entries.filter((e) => e.kind === 'row' && e.key.startsWith(`row:${table}/`)).slice(0, 8)
  // #741: history outlives rows. Offer only rows the server still has for this
  // reader (row_titles answers for those alone), and none until it has said.
  const ids = remembered.map((e) => e.label)
  const present = useQuery({
    queryKey: ['recent-strip-rows', table, ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { titles } = await api.post<{ titles: Array<{ table: string; row_id: string; title: string; retired?: true }> }>(
        '/api/row_titles', { rows: ids.map((row_id) => ({ table, row_id })) })
      for (const t of titles) queryClient.setQueryData(['row-title', table, t.row_id], t.title)
      return new Map(titles.map((t) => [t.row_id, t.retired === true]))
    },
  })
  // #959: a retired row stays out of the chips while the list leaves it out.
  const rows = remembered.filter((e) => present.data?.has(e.label) && (withRetired || !present.data.get(e.label))).slice(0, 4)
  const views = entries
    .map((e) => {
      if (e.kind !== 'list' || !e.key.startsWith(`list:${table}?`)) return null
      // A remembered address is user input: keep only well-formed filters (#87),
      // so one typed by hand can never blank the list.
      const parsed = parseFilters(e.key.slice(`list:${table}?`.length)) as Filter[]
      return parsed.length > 0 ? { entry: e, parsed } : null
    })
    .filter((v): v is { entry: RecentEntry; parsed: Filter[] } => v !== null)
    .slice(0, 3)
  if (rows.length === 0 && views.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="recent-strip">
      <span className="text-xs font-semibold text-ink-subtle">
        Recent
      </span>
      {rows.map((r) => (
        <Link
          key={r.key}
          to="/featherbase/admin/table/$table/row/$name"
          params={{ table, name: r.label }}
          search={{ prefill: undefined }}
          data-testid="recent-strip-row"
          className={touchRowClasses('inline-flex items-center rounded-full border border-border-control bg-surface px-2.5 py-0.5 text-xs text-ink-muted hover:border-action hover:text-action')}
        >
          <RowTitle table={table} rowId={r.label} />
        </Link>
      ))}
      {views.map(({ entry, parsed }) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => onApply(parsed)}
          data-testid="recent-strip-view"
          title={describeFilters(JSON.stringify(parsed), meta?.columns, t)}
          className={touchRowClasses('max-w-72 truncate rounded-full bg-action-tint px-2.5 py-0.5 text-xs font-medium text-action hover:opacity-80')}
        >
          {parsed.map((f, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              <FilterWords meta={meta} filter={f} />
            </Fragment>
          ))}
        </button>
      ))}
    </div>
  )
}
