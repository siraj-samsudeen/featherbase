import type { ReactNode } from 'react'
import { cx } from './cx'

// #1348 chips with meaning (board 1, "Chips With Meaning"). A status is green when live, amber when not yet and
// grey when finished; a category takes one of eight tints from its name, so it has the same colour on every
// page; red is kept for a data problem. Levels (Own / Team / Area) are not categories: they use the shared tag.

export const CATEGORY_HUES = ['blue', 'teal', 'violet', 'pink', 'orange', 'lime', 'cyan', 'yellow'] as const
export type ChipHue = (typeof CATEGORY_HUES)[number] | 'green' | 'amber' | 'grey' | 'red'

// Written out whole, so Tailwind's scanner sees every class.
const HUE: Record<ChipHue, { chip: string; dot?: string }> = {
  blue: { chip: 'bg-chip-blue text-chip-blue-ink' },
  teal: { chip: 'bg-chip-teal text-chip-teal-ink' },
  violet: { chip: 'bg-chip-violet text-chip-violet-ink' },
  pink: { chip: 'bg-chip-pink text-chip-pink-ink' },
  orange: { chip: 'bg-chip-orange text-chip-orange-ink' },
  lime: { chip: 'bg-chip-lime text-chip-lime-ink' },
  cyan: { chip: 'bg-chip-cyan text-chip-cyan-ink' },
  yellow: { chip: 'bg-chip-yellow text-chip-yellow-ink' },
  green: { chip: 'bg-chip-green text-chip-green-ink', dot: 'bg-chip-green-dot' },
  amber: { chip: 'bg-chip-amber text-chip-amber-ink', dot: 'bg-chip-amber-dot' },
  grey: { chip: 'bg-chip-grey text-chip-grey-ink', dot: 'bg-chip-grey-dot' },
  red: { chip: 'bg-chip-red text-chip-red-ink' },
}

/** One of the eight category tints, from the value's name: the same value always gets the same tint. */
export function chipHue(value: string): ChipHue {
  let h = 0
  for (const ch of value.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return CATEGORY_HUES[h % CATEGORY_HUES.length]
}

const LIVE = new Set(['open', 'active', 'live', 'running', 'in progress', 'enabled', 'approved', 'current'])
const NOT_YET = new Set(['planned', 'draft', 'pending', 'not started', 'new', 'waiting', 'on hold', 'scheduled', 'queued', 'proposed'])
const FINISHED = new Set(['closed', 'inactive', 'done', 'cancelled', 'canceled', 'completed', 'archived', 'retired', 'resolved', 'ended', 'disabled', 'expired'])

/** A Status column's colour: green live, amber not yet, grey finished; null for a word that is none of these. */
export function statusHue(value: string): 'green' | 'amber' | 'grey' | null {
  const word = value.trim().toLowerCase()
  if (LIVE.has(word)) return 'green'
  if (NOT_YET.has(word)) return 'amber'
  if (FINISHED.has(word)) return 'grey'
  return null
}

/** The chip's look, for an element that must stay its own (a RecordLink drawn as a chip). */
export function chipClasses({ hue, compact = false, className }: { hue: ChipHue; compact?: boolean; className?: string }): string {
  return cx(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium',
    compact ? 'px-2 py-px text-xs leading-[18px]' : 'px-2.5 py-[3px] text-[12.5px] leading-[18px]',
    HUE[hue].chip,
    className,
  )
}

/** #1348: the shared tag chip for a source, a reach or a level ("from HR", "via Floor Manager", "Team"):
 *  neutral, never a category tint, never a border. */
export function tagClasses(className?: string): string {
  return cx('inline-flex items-center whitespace-nowrap rounded-md bg-tag px-2 py-0.5 text-[12.5px] text-tag-ink', className)
}

/** A tinted pill. `dot` marks a status; Compact Rows drops the dot and shrinks the chip. */
export function Chip({ hue, dot = false, compact = false, className, children }: {
  hue: ChipHue
  dot?: boolean
  compact?: boolean
  className?: string
  children: ReactNode
}) {
  const mark = dot && !compact ? HUE[hue].dot : undefined
  return (
    <span className={chipClasses({ hue, compact, className })} data-chip={hue}>
      {mark && <span aria-hidden data-chip-dot className={cx('size-1.5 shrink-0 rounded-full', mark)} />}
      {children}
    </span>
  )
}
