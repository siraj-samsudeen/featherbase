import { useId, type ReactNode } from 'react'
import { fmtPct } from '../../lib/inr'
import { cx } from './cx'

export type HeadlineTone = 'negative' | 'caution' | 'positive' | 'missing' | 'neutral'

const TONE_TEXT: Record<HeadlineTone, string> = {
  negative: 'text-negative',
  caution: 'text-caution',
  positive: 'text-positive',
  missing: 'text-missing',
  neutral: 'text-ink',
}
const TONE_FILL: Record<HeadlineTone, string> = {
  negative: 'bg-negative',
  caution: 'bg-caution',
  positive: 'bg-positive',
  missing: 'bg-missing',
  neutral: 'bg-action',
}

/**
 * Achievement bands of the sales-target legend (the Dive's "<90% · 90–99% ·
 * 100%+"): below 90% is negative, 90% up to 100% caution, 100% and over
 * positive; no target is missing.
 */
export function achievementTone(pct: number | null | undefined): HeadlineTone {
  if (pct == null || Number.isNaN(pct)) return 'missing'
  // Judge the value as the page shows it (one decimal), so 89.96 shown as 90% is not red.
  const shown = Math.round(pct * 10) / 10
  if (shown < 90) return 'negative'
  if (shown < 100) return 'caution'
  return 'positive'
}

/**
 * The answer-first block that leads a report page: what period, the
 * conclusion in words, the supporting figures, and optionally progress
 * toward a target as a meter.
 */
export function Headline({
  label,
  conclusion,
  tone = 'neutral',
  detail,
  progress,
  className,
}: {
  label: ReactNode
  conclusion: string
  tone?: HeadlineTone
  detail?: ReactNode
  progress?: { value: number; marker?: number; label: string }
  className?: string
}) {
  const id = useId()
  const max = Math.max(100, progress?.value ?? 0)
  return (
    <section aria-labelledby={id} className={cx('rounded-card border border-border bg-surface p-4 shadow-sm', className)}>
      <p className="text-sm font-semibold text-ink-muted">{label}</p>
      <h2 id={id} className={cx('mt-1 text-3xl font-extrabold leading-tight tabular-nums', TONE_TEXT[tone])}>
        {conclusion}
      </h2>
      {detail && <p className="mt-1 text-base text-ink">{detail}</p>}
      {progress && (
        <div className="mt-3">
          <div
            role="meter"
            aria-label={progress.label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={progress.value}
            aria-valuetext={fmtPct(progress.value)}
            className="relative h-3 overflow-hidden rounded-full border border-border-control bg-surface"
          >
            <div
              className={cx('absolute inset-y-0 left-0 rounded-full', TONE_FILL[tone])}
              style={{ width: `${(Math.max(0, progress.value) / max) * 100}%` }}
            />
            {progress.marker != null && (
              // Placed on the meter's own scale, which stretches past 100 when the value does.
              <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `${(progress.marker / max) * 100}%` }} />
            )}
          </div>
          {progress.marker != null && (
            <p className="mt-1 text-xs text-ink-muted">Line marks {progress.marker}%</p>
          )}
        </div>
      )}
    </section>
  )
}
