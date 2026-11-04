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
