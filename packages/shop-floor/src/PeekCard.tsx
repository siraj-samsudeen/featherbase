import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTopLayer } from './TopLayer'

/**
 * #1349 item 2, #1289 item 11 (board 3): the shared peek card. A moment after the pointer rests on its trigger, or
 * when the trigger takes focus, a small raised card opens by it; it stays while the pointer is over either, and
 * leaving, or Escape, closes it. What it holds is the caller's: a count's first rows and the way to all of them.
 * The children render only while it is open, so what they read is read only then. On touch (UI owner), the first
 * tap on the trigger opens the card and the second does what the trigger does.
 *
 * It floats in the browser's top layer, kept inside the window (useTopLayer's `below-fit`), so no side panel or
 * scrolling box can cut it off (production bug, 20-Nov-2026). A browser without the Popover API draws it under its
 * trigger.
 */
export function PeekCard({ label, trigger, children, delay = 250 }: {
  /** The card's name for assistive technology: "Plants in Bayside". */
  label: string
  trigger: ReactNode
  children: ReactNode
  delay?: number
}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const anchor = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), wait)
  }
  const touch = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  useTopLayer(open, card, anchor, 'below-fit')
  const inside = (node: Node | null) => Boolean(node && (anchor.current?.contains(node) || card.current?.contains(node)))
  const escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()
    later(false, 0)
  }
  return (
    <span ref={anchor} className="relative inline-flex" data-testid="peek-card-anchor"
      onPointerEnter={(e) => { if (e.pointerType !== 'touch') later(true, delay) }}
      onPointerLeave={(e) => { if (e.pointerType !== 'touch') later(false, 120) }}
      onPointerDown={(e) => { touch.current = e.pointerType === 'touch' }}
      onClickCapture={(e) => {
        if (!touch.current || open) return
        e.preventDefault()
        e.stopPropagation()
        later(true, 0)
      }}
      onFocus={() => later(true, delay)}
      onBlur={(e) => { if (!inside(e.relatedTarget as Node | null)) later(false, 0) }}
      onKeyDown={escape}>
      {trigger}
      {open && (
        <div ref={card} role="dialog" aria-label={label}
          onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={() => later(false, 120)}
          className="absolute left-0 top-full z-50 mt-1.5 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2.5 rounded-xl border-0 bg-raised px-4 py-3.5 text-ink shadow-raised">
          {children}
        </div>
      )}
    </span>
  )
}
