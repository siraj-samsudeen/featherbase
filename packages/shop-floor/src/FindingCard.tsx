import type { ReactNode } from 'react'
import { cx } from './cx'
import { fmtCount } from './format'

// #1340: one finding of an answer-first page (Minto: headline, then three or four findings, then the evidence): its
// count, its name, a plain reason and who acts. A finding is also a filter for the list beneath it: pressed, it says so.

export type FindingTone = 'caution' | 'neutral' | 'quiet' | 'opportunity'

const TONE: Record<FindingTone, { box: string; count: string }> = {
  caution: { box: 'bg-caution-tint', count: 'text-caution' },
  neutral: { box: 'bg-action-tint', count: 'text-action' },
  quiet: { box: 'bg-subtle', count: 'text-ink' },
  opportunity: { box: 'bg-opportunity-tint', count: 'text-opportunity' },
}

export function FindingCard({ count, title, reason, owner, tone = 'quiet', selected = false, onSelect, testid = 'finding-card' }: {
  count: number
  title: string
  reason: ReactNode
  /** Who acts, and when: "Owner: the owner · before the switch". */
  owner?: ReactNode
  tone?: FindingTone
  selected?: boolean
  onSelect?: () => void
  testid?: string
}) {
  const body = <>
    <span className={cx('text-3xl font-semibold leading-none tabular-nums', TONE[tone].count)} data-testid="finding-count">{fmtCount(count)}</span>
    <span className="text-[15px] font-semibold text-ink">{title}</span>
    <span className="text-[13px] leading-snug text-ink">{reason}</span>
    {owner && <span className="mt-1 text-xs text-ink-muted">{owner}</span>}
  </>
  const classes = cx('flex min-w-56 flex-1 basis-56 flex-col gap-1.5 rounded-card p-4 text-left', TONE[tone].box,
    selected && 'ring-2 ring-action', onSelect && 'cursor-pointer hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-focus')
  return onSelect
    ? <button type="button" aria-pressed={selected} onClick={onSelect} className={classes} data-testid={testid}>{body}</button>
    : <div className={classes} data-testid={testid}>{body}</div>
}
