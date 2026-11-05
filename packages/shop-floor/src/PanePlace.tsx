import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Segmented } from './Segmented'

export type PanePlaceValue = 'auto' | 'right' | 'bottom'
export type ResolvedPanePlace = 'right' | 'bottom'

/** The window width from which an automatically placed pane sits on the right. */
export const PANE_RIGHT_MIN_WIDTH = 1200

/** Where the pane goes: the chosen place, or for auto, right on a wide window and bottom otherwise. */
export function resolvePanePlace(value: PanePlaceValue, width: number): ResolvedPanePlace {
  if (value !== 'auto') return value
  return width >= PANE_RIGHT_MIN_WIDTH ? 'right' : 'bottom'
}

/** Auto / Right / Bottom; Auto names where it resolved to, "Auto (right)". */
export function PanePlace({ value, resolved, onChange, label = 'Pane place' }: {
  value: PanePlaceValue
  resolved: ResolvedPanePlace
  onChange: (value: PanePlaceValue) => void
  label?: string
}) {
  return <Segmented label={label} value={value} onChange={onChange} options={[
    { value: 'auto', label: `Auto (${resolved})` },
    { value: 'right', label: 'Right' },
    { value: 'bottom', label: 'Bottom' },
  ]} />
}

// Where focus was in the content when a pane opened, kept outside the
// component: the page around it can be drawn anew while the pane is open.
const opener: { el: HTMLElement | null; route: number[]; open: boolean } = { el: null, route: [], open: false }

/** The child positions from `root` down to `el`. */
function routeTo(root: Element, el: Element): number[] {
  const route: number[] = []
  for (let at: Element | null = el; at && at !== root; at = at.parentElement)
    route.unshift(at.parentElement ? [...at.parentElement.children].indexOf(at) : 0)
  return route
}

function find(root: Element, route: number[]): HTMLElement | null {
  let at: Element | undefined = root
  for (const i of route) at = at?.children[i]
  return at instanceof HTMLElement ? at : null
}

/** The least height a docked split takes, however little room is left. */
const MIN_DOCK = 320

/** The height from `el`'s top to the foot of what its scrolling frame shows. */
function roomBelow(el: HTMLElement): number {
  let frame = el.parentElement
  while (frame && !/(auto|scroll|hidden|clip)/.test(getComputedStyle(frame).overflowY)) frame = frame.parentElement
  const top = el.getBoundingClientRect().top
  if (!frame) return Math.max(MIN_DOCK, window.innerHeight - (top + window.scrollY))
  const box = frame.getBoundingClientRect()
  const offset = top - box.top + frame.scrollTop
  const padding = parseFloat(getComputedStyle(frame).paddingBottom) || 0
  return Math.max(MIN_DOCK, Math.round(frame.clientHeight - offset - padding))
}

/**
 * Content with the drill pane beside it (right: about 40% wide, at least
 * 360px, as tall as the window) or below it (bottom: docked at the foot of
 * its scrolling frame, half the split's height). A pane on the right stays in
 * sight while the page scrolls. With a pane at the bottom the split fills the
 * room its frame shows below what sits above it (a path bar stays in sight),
 * the content scrolling on its own above the pane, never under it. Either
 * pane scrolls inside itself, and neither ever scrolls the page sideways.
 * With no pane the content fills it all. `data-pane` says where the pane is,
 * so the page around can make room for one on the right.
 */
export function SplitWithPane({ place, pane, children }: {
  place: ResolvedPanePlace
  pane: ReactNode
  children: ReactNode
}) {
  const right = place === 'right'
  const shown = pane != null && pane !== false
  const docked = shown && !right
  const split = useRef<HTMLDivElement>(null)
  // The control the pane was opened from gets focus back when it closes.
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (shown) { opener.open = true; return }
    if (!opener.open) return
    opener.open = false
    if (document.activeElement && document.activeElement !== document.body) return
    // The page may have been drawn anew while the pane was open (its address
    // changed): the control is then found again at the same place in it.
    const back = opener.el?.isConnected ? opener.el : content.current && find(content.current, opener.route)
    back?.focus({ preventScroll: true })
  }, [shown])
  // Docked, the split fills what its scrolling frame (the page, or a frame it
  // sits in) shows below whatever is above it, so nothing above scrolls away.
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!docked) { setHeight(null); return }
    const measure = () => { if (split.current) setHeight(roomBelow(split.current)) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [docked])
  useEffect(() => {
    // Once the split has its docked height:
    if (!docked || height === null) return
    // The line the pane shows stays in sight in the shorter content above it.
    split.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
    split.current?.scrollIntoView?.({ block: 'nearest' })
  }, [docked, height])
  return (
    <div ref={split} data-testid="split-with-pane" data-pane={shown ? place : undefined}
      style={docked && height ? { height } : undefined}
      className={`flex min-h-0 min-w-0 flex-1 ${right ? 'flex-row items-start gap-4' : 'flex-col'}`}>
      <div ref={content} className="min-h-0 min-w-0 flex-1 self-stretch overflow-auto"
        onFocus={(event) => {
          opener.el = event.target as HTMLElement
          opener.route = routeTo(event.currentTarget, opener.el)
        }}>{children}</div>
      {shown && (
        <div data-testid="split-pane" className={right
          ? 'sticky top-0 flex max-h-[calc(100dvh-5rem)] min-h-0 w-2/5 min-w-90 max-w-full shrink-0 flex-col overflow-y-auto bg-surface'
          : 'flex h-1/2 min-h-0 w-full min-w-0 shrink-0 flex-col overflow-y-auto border-t border-border bg-surface shadow-lg'}
        >{pane}</div>
      )}
    </div>
  )
}
