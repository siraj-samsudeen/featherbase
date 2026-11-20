import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** The card's width, and the room it keeps from the window's edges and from its trigger. */
export const CARD_WIDTH = 340
const EDGE = 8
const GAP = 6

/** Whether this browser has a top layer for popovers (a test DOM hides a popover it can't show, so it gets none). */
const TOP_LAYER = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype

export interface CardPlace { left: number; top: number; width: number; side: 'below' | 'above' }

/**
 * Where the card goes (production bug, 20-Nov-2026: it opened to the right and the side panel cut it off): under its
 * trigger, aligned to its left edge, shifted left as far as it must to stay in the window, and above the trigger when
 * there is no room below but there is above. Never wider than the window allows.
 */
export function placeCard(trigger: { left: number; top: number; bottom: number }, card: { height: number },
  view: { width: number; height: number }): CardPlace {
  const width = Math.min(CARD_WIDTH, view.width - 2 * EDGE)
  const left = Math.max(EDGE, Math.min(trigger.left, view.width - width - EDGE))
  const below = trigger.bottom + GAP
  const above = trigger.top - GAP - card.height
  const flip = below + card.height > view.height - EDGE && above >= EDGE
  return { left, top: flip ? above : below, width, side: flip ? 'above' : 'below' }
}

/**
 * #1349 item 2, #1289 item 11 (board 3): the shared peek card. A moment after the pointer rests on its trigger, or
 * when the trigger takes focus, a small raised card opens by it; it stays while the pointer is over either, and
 * leaving, or Escape, closes it. What it holds is the caller's: a count's first rows and the way to all of them.
 * The children render only while it is open, so what they read is read only then. On touch (UI owner), the first
 * tap on the trigger opens the card and the second does what the trigger does.
 *
 * The card is shown in the browser's top layer (a manual popover), placed in the window by `placeCard`, so no
 * panel, scrolling box or container it sits in can cut it off.
 */
export function PeekCard({ label, trigger, children, delay = 250 }: {
  /** The card's name for assistive technology: "Plants in Bayside". */
  label: string
  trigger: ReactNode
  children: ReactNode
  delay?: number
}) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<CardPlace | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const anchor = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), wait)
  }
  const touch = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  // Placed once it is drawn (its height is known), and again as the page scrolls or the window changes.
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return }
    // The top layer, where the browser has it (a test DOM may not): over everything, clipped by nothing.
    if (TOP_LAYER && card.current && !card.current.matches(':popover-open')) card.current.showPopover()
    const measure = () => {
      const at = anchor.current!.getBoundingClientRect()
      setPlace(placeCard(at, { height: card.current?.getBoundingClientRect().height ?? 0 }, { width: window.innerWidth, height: window.innerHeight }))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])
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
        <div ref={card} role="dialog" aria-label={label} data-side={place?.side} popover={TOP_LAYER ? 'manual' : undefined}
          onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={() => later(false, 120)}
          onBlur={(e) => { if (!inside(e.relatedTarget as Node | null)) later(false, 0) }} onKeyDown={escape}
          style={place ? { left: place.left, top: place.top, width: place.width } : { left: -9999, top: 0, width: CARD_WIDTH }}
          // A popover's own frame (inset, margin, border) gives way to the card's.
          className="fixed z-50 m-0 flex flex-col gap-2.5 rounded-xl border-0 bg-raised px-4 py-3.5 text-ink shadow-raised [inset:auto]">
          {children}
        </div>
      )}
    </span>
  )
}
