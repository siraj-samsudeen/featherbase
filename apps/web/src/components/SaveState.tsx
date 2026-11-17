import { useEffect, useId, useRef, useState } from 'react'
import { cardClasses, fmtClockTime, fmtDateTime } from '@featherbase/shop-floor'
import { PrincipalLink } from '../lib/people'

/** #1267: a saved record's one save state, at the tab row's right end. Hover
 *  or focus shows when it last changed and who changed it (a link to them);
 *  after a save on this page, the time of that save. */
export function SaveState({ dirty, savedHere, savedAt, updatedAt, updatedBy }: {
  dirty: boolean
  /** "Saved" just now, from this page's own save. */
  savedHere: boolean
  savedAt: Date | null
  updatedAt: unknown
  updatedBy: unknown
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState({ top: 0, right: 0 })
  const anchor = useRef<HTMLSpanElement>(null)
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined)
  const id = useId()
  useEffect(() => () => clearTimeout(closing.current), [])
  const changedAt = typeof updatedAt === 'string' && !Number.isNaN(new Date(updatedAt).getTime()) ? new Date(updatedAt) : null
  const by = typeof updatedBy === 'string' && updatedBy ? updatedBy : null
  const detail = dirty ? null : savedAt
    ? <>Saved {fmtClockTime(savedAt)}</>
    : changedAt
      ? <>Last changed {fmtDateTime(changedAt)}{by && <> by <PrincipalLink id={by} /></>}</>
      : null
  const show = () => {
    clearTimeout(closing.current)
    const box = anchor.current!.getBoundingClientRect()
    setAt({ top: box.bottom + 6, right: window.innerWidth - box.right })
    setOpen(true)
  }
  // A moment's grace, so the pointer can cross to the card and its link.
  const hide = () => {
    clearTimeout(closing.current)
    closing.current = setTimeout(() => setOpen(false), 150)
  }
  return (
    <span ref={anchor} className="relative inline-flex"
      onMouseEnter={detail ? show : undefined} onMouseLeave={hide}
      onFocus={detail ? show : undefined}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide() }}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}>
      <span tabIndex={detail ? 0 : undefined} aria-describedby={open && detail ? id : undefined} data-testid="save-state"
        className={`inline-flex items-center gap-1 rounded text-xs focus-visible:outline-2 focus-visible:outline-focus ${dirty ? 'text-ink-muted' : 'text-positive'}`}>
        {!dirty && <span aria-hidden>✓</span>}
        <span data-testid="form-status">{dirty ? 'Not saved' : savedHere ? <span data-testid="form-banner">Saved</span> : 'Saved'}</span>
      </span>
      {open && detail && (
        <span id={id} role="tooltip" data-testid="save-state-detail" style={{ top: at.top, right: at.right }}
          className={cardClasses('fixed z-30 whitespace-nowrap px-3 py-2 text-xs text-ink shadow-lg')}>
          {detail}
        </span>
      )}
    </span>
  )
}
