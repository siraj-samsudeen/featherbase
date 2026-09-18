// Indian amount and date formatting for report surfaces.
//
// ADR 750 (JeyaramaGroup/data-warehouse docs/adr/adr-750-indian-number-formatting.md)
// splits amounts into two regimes, chosen from what the number is FOR, never from
// how big it is. The sales-target report is the PRECISION regime on every count:
// its rows foot against the total. So amounts are exact rupees, Indian-grouped,
// two decimals padded — never scaled to lakh or crore at any magnitude.
//
// ⛔ Never hand-roll `"₹" + (v / 1e5).toFixed(2) + "L"`. With no magnitude test
// ₹850 renders as "₹0.01L". That shipped in twelve surfaces, eleven of which
// should not have been scaling at all.

/** Exact ₹, Indian digit grouping, exactly 2 dp padded. Null-safe. */
export function fmtExact(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return '—'
  const sign = x < 0 ? '-' : ''
  return (
    sign +
    '₹' +
    Math.abs(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
}

/**
 * Above or below target, with an explicit sign BOTH ways. A gap that reads
 * "₹10,000.00" is ambiguous about direction; "+₹10,000.00" is not.
 */
export function fmtSigned(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return '—'
  return (x > 0 ? '+' : '') + fmtExact(x)
}

/** Achievement percentage, one decimal, Indian-grouped. */
export function fmtPct(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x) || !Number.isFinite(x)) return '—'
  return x.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO day -> DD-Mon-YYYY (ADR 844). Slash forms are ambiguous and never used. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const month = MONTHS[Number(m) - 1]
  return month ? `${d}-${month}-${y}` : iso
}
