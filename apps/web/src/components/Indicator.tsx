// Status dots: a value that is a VERDICT takes its meaning colour (done is
// positive, overdue or failed is negative, "not set" is missing data). Every
// other status (open, urgent, pending, in progress, draft …) is a state, not a
// verdict, so it gets a stable identity colour from the series: the same
// value always has the same dot, and no dot reads as good or bad.
const VERDICT_POSITIVE = /\b(closed|resolved|done|complete|completed|approved|paid|success|succeeded|finished)\b/
const VERDICT_NEGATIVE = /\b(overdue|error|failed|rejected|blocked)\b/
const NO_VALUE = /\b(none|not set)\b/
const INDICATOR_PALETTE = [1, 2, 3, 4, 5].map((n) => `var(--color-series-${n})`)

export function indicatorColor(value: string): string {
  const v = value.toLowerCase()
  if (VERDICT_POSITIVE.test(v)) return 'var(--color-positive)'
  if (VERDICT_NEGATIVE.test(v)) return 'var(--color-negative)'
  if (NO_VALUE.test(v)) return 'var(--color-missing)'
  let h = 0
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return INDICATOR_PALETTE[h % INDICATOR_PALETTE.length]
}

export function Indicator({ value, label = value }: { value: string; label?: string }) {
  return (
    // Not inline-flex: a browser drops an atomic box whole when it runs out of
    // room, where plain text clips with an ellipsis (#1015).
    <span>
      <span
        aria-hidden="true"
        className="mr-1.5 inline-block size-2 rounded-full align-[0.05em]"
        style={{ backgroundColor: indicatorColor(value) }}
      />
      {label}
    </span>
  )
}
