import type { ReactNode } from 'react'
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
 * 360px) or below it (bottom: at most half the window tall, scrolling).
 * Neither ever scrolls the page sideways. With no pane the content fills it all.
 */
export function SplitWithPane({ place, pane, children }: {
  place: ResolvedPanePlace
  pane: ReactNode
  children: ReactNode
}) {
  const right = place === 'right'
  return (
    <div data-testid="split-with-pane" className={`flex min-h-0 min-w-0 flex-1 ${right ? 'flex-row' : 'flex-col'}`}>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
      {pane != null && pane !== false && (
        <div data-testid="split-pane" className={right
          ? 'flex min-h-0 w-2/5 min-w-90 max-w-full shrink-0 flex-col'
          : 'flex max-h-[50vh] min-h-0 w-full min-w-0 shrink-0 flex-col overflow-y-auto'}
        >{pane}</div>
      )}
    </div>
  )
}
