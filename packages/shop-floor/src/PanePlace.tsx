import { useEffect, useRef, type ReactNode } from 'react'
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

/**
 * Content with the drill pane beside it (right: about 40% wide, at least
 * 360px, as tall as the window) or below it (bottom: docked at the foot of
 * the window, half its height, so the content above keeps its size as the pane fills). A pane on the right stays in sight
 * while the page scrolls. With a pane at the bottom the split takes the
 * window's height, the content scrolling on its own above the pane, never
 * under it; opening one scrolls the split into view so the pane shows. Either
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
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (shown) return
    const back = opener.current
    if (back?.isConnected && (!document.activeElement || document.activeElement === document.body)) back.focus({ preventScroll: true })
  }, [shown])
  useEffect(() => {
    if (!docked) return
    // The line the pane shows stays in sight in the shorter content above it.
    split.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
    split.current?.scrollIntoView?.({ block: 'end' })
  }, [docked])
  return (
    <div ref={split} data-testid="split-with-pane" data-pane={shown ? place : undefined}
      className={`flex min-h-0 min-w-0 flex-1 ${right ? 'flex-row items-start gap-4' : 'flex-col'} ${docked ? 'h-[calc(100dvh-7rem)] min-h-96' : ''}`}>
      <div className="min-h-0 min-w-0 flex-1 self-stretch overflow-auto"
        onFocus={(event) => { opener.current = event.target as HTMLElement }}>{children}</div>
      {shown && (
        <div data-testid="split-pane" className={right
          ? 'sticky top-0 flex max-h-[calc(100dvh-5rem)] min-h-0 w-2/5 min-w-90 max-w-full shrink-0 flex-col overflow-y-auto bg-surface'
          : 'flex h-1/2 min-h-0 w-full min-w-0 shrink-0 flex-col overflow-y-auto border-t border-border bg-surface shadow-lg'}
        >{pane}</div>
      )}
    </div>
  )
}
