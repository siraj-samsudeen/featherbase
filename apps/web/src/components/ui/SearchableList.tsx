import type { ReactNode } from 'react'
import { Button } from './Button'
import { SearchInput } from './Field'
import { fmtCount } from '../../lib/inr'

/** Searches the entire supplied collection. Paginated remote data must instead search its server. */
export function SearchableList<Row>({ label, placeholder = label, items, query, onQueryChange, getSearchText, children }: {
  label: string
  placeholder?: string
  items: Row[]
  query: string
  onQueryChange: (query: string) => void
  getSearchText: (row: Row) => string
  children: (matching: Row[]) => ReactNode
}) {
  const needle = query.trim().toLocaleLowerCase()
  const matching = items.filter((item) => getSearchText(item).toLocaleLowerCase().includes(needle))
  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-2 bg-canvas py-1">
        <div className="min-w-0 flex-1"><SearchInput aria-label={label} placeholder={placeholder} value={query} onChange={(event) => onQueryChange(event.target.value)} /></div>
        {query && <Button onClick={() => onQueryChange('')}>Clear search</Button>}
        <span role="status" className="text-sm text-ink-muted">{fmtCount(matching.length)} of {fmtCount(items.length)}</span>
      </div>
      <div className="min-h-0 min-w-0 flex-1">{children(matching)}</div>
    </section>
  )
}
