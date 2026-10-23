import type { ReactNode } from 'react'
import { cx } from './cx'

export type StatusTone = 'negative' | 'caution' | 'positive' | 'opportunity' | 'missing' | 'neutral'

const TONE: Record<StatusTone, string> = {
  negative: 'bg-negative-tint text-negative',
  caution: 'bg-caution-tint text-caution',
  positive: 'bg-positive-tint text-positive',
  opportunity: 'bg-opportunity-tint text-opportunity',
  missing: 'bg-missing-tint text-missing',
  neutral: 'bg-action-tint text-action',
}

export function statusClasses(tone: StatusTone = 'neutral', className?: string): string {
  return cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[tone], className)
}

/** A status in words; the colour only repeats what the words say. */
export function StatusPill({ tone, className, children }: { tone?: StatusTone; className?: string; children: ReactNode }) {
  return <span className={statusClasses(tone, className)}>{children}</span>
}
