import type { ReactNode } from 'react'
import { cx } from './cx'
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from './icons'

type NoticeTone = 'info' | 'caution' | 'negative' | 'positive'

const TONE: Record<NoticeTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'border-border bg-subtle', icon: 'text-ink-muted', Icon: Info },
  caution: { box: 'border-caution/40 bg-caution-tint', icon: 'text-caution', Icon: TriangleAlert },
  negative: { box: 'border-negative/40 bg-negative-tint', icon: 'text-negative', Icon: CircleX },
  positive: { box: 'border-positive/40 bg-positive-tint', icon: 'text-positive', Icon: CircleCheck },
}

/**
 * An inline message about the screen it sits on. A failure interrupts as an
 * alert; anything else is a polite status. The words carry the meaning; the
 * colour and icon only repeat it.
 */
export function Notice({ tone = 'info', className, children }: { tone?: NoticeTone; className?: string; children: ReactNode }) {
  const { box, icon, Icon } = TONE[tone]
  return (
    <div
      role={tone === 'negative' ? 'alert' : 'status'}
      className={cx('flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-sm text-ink', box, className)}
    >
      <Icon aria-hidden size={18} className={cx('mt-px shrink-0', icon)} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
