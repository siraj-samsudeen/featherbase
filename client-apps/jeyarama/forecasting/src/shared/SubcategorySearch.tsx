// "Search your subcategories" (the prototype's search, every forecasting page): the shared SearchInput under the
// page header, with a "/" key hint. Typing narrows the table (the page filters with `matches`); Enter opens the
// first match; Escape clears; when nothing matches, the nearest names are offered. `SearchBox` is the same search
// over anything with a name (the Sections landing searches its sections).
import { useEffect } from 'react'
import { SearchInput } from '@featherbase/shop-floor'
import { matches, nearest, type Line } from './model'

const INPUT_ID = 'fr-search'

export function SearchBox<T extends { name: string }>({ items, match, query, onQuery, onOpen, label, many, none }: {
  items: T[]; match: (item: T, q: string) => boolean; query: string; onQuery: (q: string) => void; onOpen: (name: string) => void
  /** The placeholder and the field's name: "Search your subcategories". */
  label: string
  /** What the items are, for the count: "subcategories". */
  many: string
  /** The "no match" note, before the query: "No subcategory in your section is called". */
  none: string
}) {
  // "/" anywhere but in a field puts the cursor in the search
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return
      e.preventDefault(); document.getElementById(INPUT_ID)?.focus()
    }
    document.addEventListener('keydown', slash)
    return () => document.removeEventListener('keydown', slash)
  }, [])
  const hits = query.trim() ? items.filter(l => match(l, query)) : []
  return (
    <div className="fr-search">
      <div className="relative">
        <SearchInput id={INPUT_ID} value={query} placeholder={label} aria-label={label} autoComplete="off" spellCheck={false}
          className="pr-11" onChange={e => onQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && hits[0]) { e.preventDefault(); onOpen(hits[0].name) }
            else if (e.key === 'Escape') { onQuery(''); (e.target as HTMLInputElement).blur() }
          }} />
        <kbd aria-hidden className="fr-kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</kbd>
      </div>
      {query.trim() && (
        <div className="fr-search-note" role="status">
          {hits.length
            ? <>{hits.length} of {items.length} {many} match. <kbd className="fr-kbd">Enter</kbd> opens {hits[0].name} · <kbd className="fr-kbd">Esc</kbd> clears</>
            : <>{none} “{query}”. Nearest: {nearest(items, query).map((l, i) => (
              <span key={l.name}>{i ? ' · ' : ''}<button type="button" className="fr-link" onClick={() => { onQuery(''); onOpen(l.name) }}>{l.name}</button></span>))}</>}
        </div>)}
    </div>
  )
}

export function SubcategorySearch({ lines, query, onQuery, onOpen, scope = 'your section' }: {
  lines: Line[]; query: string; onQuery: (q: string) => void; onOpen: (name: string) => void
  /** Where the search looks, in words, for the "no match" note. */
  scope?: string
}) {
  return <SearchBox items={lines} match={matches} query={query} onQuery={onQuery} onOpen={onOpen}
    label="Search your subcategories" many="subcategories" none={`No subcategory in ${scope} is called`} />
}
