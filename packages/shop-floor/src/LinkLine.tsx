import type { ReactNode } from 'react'
import { cx } from './cx'
import { fmtCount } from './format'

// #1340: the Links tab's pieces, shared by the record page (its own groups, an app's groups, the tick list) and any
// app page that explains a record the same way (Dash's Explain A Person): a section with its heading and count, a
// line with a tick on its left and a chip on its right, the tick, and the chip saying where something came from.

/** The tones a chip may take; each repeats what its words say. Quiet is a plain fact. */
export type ChipTone = 'neutral' | 'quiet' | 'positive' | 'caution' | 'negative' | 'opportunity' | 'missing'

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-action-tint text-action',
  quiet: 'bg-tag text-ink-muted',
  positive: 'bg-positive-tint text-positive',
  caution: 'bg-caution-tint text-caution',
  negative: 'bg-negative-tint text-negative',
  opportunity: 'bg-opportunity-tint text-opportunity',
  missing: 'bg-missing-tint text-missing',
}

/** A small chip on a line's right: where a link came from ("from HR", "given by hand", "via Store Manager"). */
export function ToneChip({ tone = 'quiet', children, className, testid = 'source-chip' }: { tone?: ChipTone; children: ReactNode; className?: string; testid?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-[7px] py-px font-mono text-xs', CHIP_TONE[tone], className)}
      data-testid={testid} data-tone={tone}>{children}</span>
  )
}

const BOX = 'grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] text-xs leading-none'

/** A tick that only says: locked (it comes from elsewhere and changes there), on, or off. */
export function TickMark({ state, label, title }: { state: 'locked' | 'on' | 'off'; label: string; title?: string }) {
  return (
    <span role="img" aria-label={label} title={title} data-testid={state === 'locked' ? 'tick-locked' : 'tick-mark'} data-state={state}
      className={cx(BOX, state === 'locked' ? 'border-caution bg-caution-tint text-caution'
        : state === 'on' ? 'border-action bg-action text-surface' : 'border-border-control bg-surface')}>
      {state === 'off' ? '' : '✓'}
    </span>
  )
}

/** One line of a Links section: a tick (or nothing) on its left, the line and a quiet note under it, chips and actions on its right. */
export function LinkLine({ lead, children, note, side, below, testid = 'link-line' }: {
  lead?: ReactNode
  children: ReactNode
  note?: ReactNode
  side?: ReactNode
  /** Under the whole line, across it: a reason opened by Why?, or a small form. */
  below?: ReactNode
  testid?: string
}) {
  return (
    <li className={cx('grid items-center gap-x-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-subtle',
      lead ? 'grid-cols-[22px_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]')} data-testid={testid}>
      {lead}
      <span className="flex min-w-0 flex-col">
        <span className="min-w-0">{children}</span>
        {note && <span className="text-xs text-ink-muted" data-testid="link-line-note">{note}</span>}
      </span>
      <span className="flex flex-wrap items-center justify-end gap-1.5">{side}</span>
      {below && <span className={cx('text-xs text-ink-muted', lead ? 'col-start-2 col-span-2' : 'col-span-2')}>{below}</span>}
    </li>
  )
}

/** A Links section: its heading and count, its own links on the right, and its lines. */
export function LinkSection({ heading, count, actions, children, empty, id, testid = 'link-section' }: {
  heading: string
  /** The count beside the heading: a number, or words such as "3 of 14". */
  count?: number | string
  actions?: ReactNode
  children: ReactNode
  /** Said in place of the lines when there are none. */
  empty?: ReactNode
  id?: string
  testid?: string
}) {
  return (
    <section aria-label={heading} id={id} tabIndex={id ? -1 : undefined} data-testid={testid}
      className="flex min-w-0 scroll-mt-4 flex-col gap-1.5 rounded-lg focus:outline-none focus-visible:outline-2 focus-visible:outline-focus">
      <div className="flex min-w-0 items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">{heading}</h4>
        {count !== undefined && <span className="text-[12.5px] text-ink-muted" data-testid="link-section-count">{typeof count === 'number' ? fmtCount(count) : count}</span>}
        <span className="flex-1" />
        {actions}
      </div>
      {empty ?? <ul className="grid gap-0.5">{children}</ul>}
    </section>
  )
}
