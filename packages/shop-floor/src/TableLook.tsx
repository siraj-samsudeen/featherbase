import { createContext, useContext } from 'react'
import { cx } from './cx'

// #1348 (board 2, Site list): every table's look, shared by the Admin list, Dash's Grid and DataList. The
// header is a quiet-fill band; rows are told apart by space and the hover tint, never a line. Comfortable
// (44px, 14px text) is the default; Compact Rows is 32px, 13px text, a faint zebra, and chips without dots.

export type RowDensity = 'comfortable' | 'compact'

/** The rows' density, for what draws inside a cell (a chip drops its dot in Compact Rows). */
export const RowDensityContext = createContext<RowDensity>('comfortable')
export const useRowDensity = () => useContext(RowDensityContext)

/** A header cell: 36px, quiet fill, a 12.5/500 grey label, the band's ends rounded. */
export function headCellClasses({ first = false, last = false, className }: { first?: boolean; last?: boolean; className?: string } = {}): string {
  return cx(
    'h-9 bg-subtle px-3 text-left align-middle text-[12.5px] font-medium whitespace-nowrap text-ink-subtle',
    first && 'rounded-l-lg',
    last && 'rounded-r-lg',
    className,
  )
}

/** A body cell. Put `group` on its row: hover and the selected row (aria-selected) tint the whole row. */
export function cellClasses({ density = 'comfortable', first = false, last = false, className }: {
  density?: RowDensity; first?: boolean; last?: boolean; className?: string
} = {}): string {
  return cx(
    'px-3 align-middle',
    density === 'compact' ? 'h-8 text-[13px] group-even:bg-subtle' : 'h-11 text-sm',
    'group-hover:bg-hover group-aria-selected:bg-hover',
    first && 'rounded-l-lg',
    last && 'rounded-r-lg',
    className,
  )
}

/** The table element: separate cells, so a sticky cell keeps its fill and the rounded ends show. */
export const TABLE_CLASSES = 'w-full border-separate border-spacing-0'
