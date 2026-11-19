import { Chip, chipHue, statusHue, useRowDensity, type ChipHue } from '@featherbase/shop-floor'

// #1348 (board 1, Chips With Meaning): a Choice value is a chip. A status is green when live, amber when not
// yet, grey when finished, with its dot; a failure keeps red; every other value is a category and takes one of
// eight tints from its name, so it has the same colour on every page. Compact Rows drops the dot.
const FAILED = /\b(overdue|error|failed|rejected|blocked)\b/

export function indicatorHue(value: string): ChipHue {
  if (FAILED.test(value.toLowerCase())) return 'red'
  return statusHue(value) ?? chipHue(value)
}

export function Indicator({ value, label }: { value: string; label: string }) {
  const hue = indicatorHue(value)
  const compact = useRowDensity() === 'compact'
  return <Chip hue={hue} dot={hue === 'green' || hue === 'amber' || hue === 'grey'} compact={compact}>{label}</Chip>
}
