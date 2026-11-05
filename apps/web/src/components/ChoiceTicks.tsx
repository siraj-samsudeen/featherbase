import { useEffect, useRef, useState } from 'react'
import { ChevronDown, SearchInput, buttonClasses, cardClasses, touchRowClasses } from '@featherbase/shop-floor'

const SEARCH_AFTER = 8

/** #820: a button that opens a list of a Choice column's choices to tick. The
 *  quick filter box and Add filter both use it. */
export function ChoiceTicks({
  label,
  choices,
  labelOf = (choice) => choice,
  ticked,
  onChange,
  settle = (next) => next,
  buttonText,
  testId,
  listTestId,
  className,
}: {
  /** The column's name, for the button's and the list's accessible names. */
  label: string
  choices: string[]
  /** #826: what a choice reads as; it is ticked and stored by its value. */
  labelOf?: (choice: string) => string
  ticked: string[]
  onChange: (ticked: string[]) => void
  /** What `ticked` will read once a change has been written: the quick filter
   *  reads none when every choice, or none, is ticked. */
  settle?: (ticked: string[]) => string[]
  buttonText: string
  testId: string
  listTestId: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // Closes on a click outside it, or on Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The ticks shown change at once, before the filter they write comes back,
  // so quick ticks build on each other. A `ticked` that none of them wrote (a
  // change made elsewhere) replaces them.
  const [shown, setShown] = useState(ticked)
  const pending = useRef<string[]>([])
  const key = ticked.join('\n')
  useEffect(() => {
    const at = pending.current.indexOf(key)
    if (at >= 0) pending.current.splice(0, at + 1)
    else {
      pending.current = []
      setShown(ticked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  function change(next: string[]) {
    setShown(next)
    pending.current.push(settle(next).join('\n'))
    onChange(next)
  }

  function toggle(choice: string, on: boolean) {
    tickAll([choice], on)
  }

  // A list longer than this can be searched; Select all and Clear then act on
  // the choices found, and ticks the search hides stay as they are.
  const searchable = choices.length > SEARCH_AFTER
  const [query, setQuery] = useState('')
  const found = searchable
    ? choices.filter((c) => labelOf(c).toLowerCase().includes(query.trim().toLowerCase()))
    : choices

  function tickAll(these: string[], on: boolean) {
    const next = new Set(shown)
    for (const c of these) {
      if (on) next.add(c)
      else next.delete(c)
    }
    change(choices.filter((c) => next.has(c)))
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`${label}: ${buttonText}`}
        data-testid={testId}
        className={buttonClasses({ className: `w-full justify-between font-normal ${className ?? ''}` })}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown aria-hidden size={16} className={open ? 'rotate-180' : undefined} />
      </button>
      {open && (
        <div
          role="group"
          aria-label={`${label} choices`}
          data-testid={listTestId}
          className={cardClasses('absolute left-0 z-10 mt-1 max-h-72 w-56 max-w-[calc(100vw-2rem)] overflow-y-auto p-2')}
        >
          {searchable && (
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label={`Search ${label} choices`}
              data-testid="choices-search"
              className="mb-1"
            />
          )}
          <div className="mb-1 flex gap-1 border-b border-border pb-1">
            <button
              type="button"
              onClick={() => tickAll(found, true)}
              data-testid="choices-select-all"
              className={touchRowClasses('rounded px-2 py-1 text-sm text-action hover:bg-subtle')}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => tickAll(found, false)}
              data-testid="choices-clear"
              className={touchRowClasses('rounded px-2 py-1 text-sm text-action hover:bg-subtle')}
            >
              Clear
            </button>
          </div>
          {found.map((c) => (
            <label key={c} className={touchRowClasses('flex items-center gap-2 rounded px-2 py-1 text-sm text-ink')}>
              <input type="checkbox" checked={shown.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />
              {labelOf(c)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
