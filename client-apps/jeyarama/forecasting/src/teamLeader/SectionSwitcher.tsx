// The review's section switcher (#1419): in the page header, a button naming the section that opens a search over
// the store's sections (floor › section, with the Team Leader), so a reviewer jumps without going back.
import { useEffect, useRef, useState } from 'react'
import { Button, ChevronDown, MENU_HEADING_CLASSES, SearchableList, menuClasses, menuItemClasses } from '@featherbase/shop-floor'
import type { SectionSummary } from './live'

export function SectionSwitcher({ store, current, sections, href, storeHref }: {
  store: string; current: string; sections: SectionSummary[]
  href: (s: SectionSummary) => string
  /** The store's landing page: every section by floor. */
  storeHref: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="relative" ref={box}>
      <Button aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)} icon={<ChevronDown aria-hidden size={16} data-chevron />}>
        Section: {current}
      </Button>
      {open && (
        <div className={menuClasses('absolute right-0 top-[calc(100%+6px)] z-40 w-[420px] max-h-[70vh] overflow-auto')} role="dialog" aria-label="Choose a section">
          <div className={MENU_HEADING_CLASSES}>{store} · sections by floor</div>
          <SearchableList label="Find a section" placeholder="Section, floor or Team Leader" items={sections} query={query} onQueryChange={setQuery}
            getSearchText={s => `${s.floor} ${s.section} ${s.teamLeaders.join(' ')}`}>
            {matching => (
              <div className="flex flex-col">
                {matching.map(s => (
                  <a key={s.section} href={href(s)} aria-current={s.section === current ? 'page' : undefined}
                    className={menuItemClasses({ className: 'h-auto flex-col items-start gap-0 py-1.5 whitespace-normal aria-[current=page]:bg-action-tint' })}>
                    <span><span className="text-ink-muted">{s.floor} › </span><span className="font-medium">{s.section}</span></span>
                    <span className="text-xs text-ink-muted">{s.teamLeaders.length ? s.teamLeaders.join(', ') : 'No Team Leader'} · {s.subcategories} subcategories</span>
                  </a>))}
              </div>)}
          </SearchableList>
          <a className={menuItemClasses({ className: 'mt-1 text-action' })} href={storeHref}>All sections of {store}</a>
        </div>)}
    </div>
  )
}
