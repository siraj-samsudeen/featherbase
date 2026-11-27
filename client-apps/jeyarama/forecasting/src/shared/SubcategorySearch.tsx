// "Search your subcategories" (the prototype's search, every forecasting page): the shared SearchInput under the
// page header, with a "/" key hint. Typing narrows the table (the page filters with `matches`); Enter opens the
// first match; Escape clears; when nothing matches, the nearest names are offered.
import { useEffect } from 'react'
import { SearchInput } from '@featherbase/shop-floor'
import { matches, nearest, type Line } from './model'

const INPUT_ID = 'fr-search'

export function SubcategorySearch({ lines, query, onQuery, onOpen, scope = 'your section' }: {
  lines: Line[]; query: string; onQuery: (q: string) => void; onOpen: (name: string) => void
  /** Where the search looks, in words, for the "no match" note. */
  scope?: string
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
  const hits = query.trim() ? lines.filter(l => matches(l, query)) : []
  return (
    <div className="fr-search">
      <div className="relative">
        <SearchInput id={INPUT_ID} value={query} placeholder="Search your subcategories" aria-label="Search your subcategories" autoComplete="off" spellCheck={false}
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
            ? <>{hits.length} of {lines.length} subcategories match. <kbd className="fr-kbd">Enter</kbd> opens {hits[0].name} · <kbd className="fr-kbd">Esc</kbd> clears</>
            : <>No subcategory in {scope} is called “{query}”. Nearest: {nearest(lines, query).map((l, i) => (
              <span key={l.name}>{i ? ' · ' : ''}<button type="button" className="fr-link" onClick={() => { onQuery(''); onOpen(l.name) }}>{l.name}</button></span>))}</>}
        </div>)}
    </div>
  )
}
