// Indian amount, count and date formatting — the one home for it in the web app
// (design-guards.test.ts forbids toLocale*String everywhere else).
//
// ADR 750 (JeyaramaGroup/data-warehouse docs/adr/adr-750-indian-number-formatting.md)
// splits amounts into two regimes, chosen from what the number is FOR, never from
// how big it is:
//   - fmtExact  — the PRECISION regime: exact ₹, Indian-grouped, 2 dp padded, never
//     scaled. For amounts that must foot against another column or are paid.
//   - fmtINR    — the READABLE regime: the lakh/crore ladder, for "how big is this?"
//     summaries. Siraj ruled on 22-Oct-2026 (#380) that the sales-target summary
//     and rows are this regime.
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

/**
 * Readable ₹ (ADR 750 ladder): under ₹1,000 as is, under a lakh Indian-grouped
 * rupees, then `₹2.48 L` and `₹1.74 Cr`. Rounding happens before the rung is
 * chosen, so ₹99,999.60 reads ₹1.00 L, never ₹1,00,000. `signed` shows the
 * direction both ways (`+₹4,000`, `-₹41,000`); zero carries no sign.
 */
export function fmtINR(x: number | null | undefined, { signed = false }: { signed?: boolean } = {}): string {
  if (x == null || Number.isNaN(x) || !Number.isFinite(x)) return '—'
  const rupees = Math.round(Math.abs(x))
  const sign = rupees === 0 ? '' : x < 0 ? '-' : signed ? '+' : ''
  let body: string
  if (rupees < 1_00_000) body = rupees.toLocaleString('en-IN')
  else {
    const lakh = Math.round(rupees / 1_000) / 100
    const crore = Math.round(rupees / 1_00_000) / 100
    // A thousand crore and up keeps Indian grouping on the crore figure.
    body = lakh < 100 ? `${lakh.toFixed(2)} L` : `${crore.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`
  }
  return `${sign}₹${body}`
}

/** A count or quantity: rounded first, Indian grouping, no unit, no ₹, never "-0". Null-safe. */
export function fmtCount(x: number | null | undefined, decimals = 0): string {
  if (x == null || Number.isNaN(x) || !Number.isFinite(x)) return '—'
  const scale = 10 ** decimals
  const rounded = Math.round(x * scale) / scale || 0 // `|| 0` turns -0 into 0
  return rounded.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

/**
 * A value exactly as stored: Indian grouping and every significant digit it has,
 * never rounded, however small (1e-21 stays 0.000000000000000000001). ADR 750 evidence rule.
 */
export function fmtAsStored(x: number): string {
  return (x || 0).toLocaleString('en-IN', { maximumSignificantDigits: 21 })
}

/**
 * A number at a fixed precision with Indian digit grouping: list cells for Float
 * and Currency columns. The currency symbol is added by the caller.
 */
export function fmtNumber(x: number, precision: number): string {
  return x.toLocaleString('en-IN', { minimumFractionDigits: precision, maximumFractionDigits: precision })
}

/** "1,23,456", or "50 of 1,23,456" when only part of a set is shown. */
export function fmtShowing(shown: number, total: number): string {
  return shown === total ? fmtCount(total) : `${fmtCount(shown)} of ${fmtCount(total)}`
}

// Where each currency's readers live. Rupees are always ₹ with Indian grouping;
// any other currency is written as its own locale writes it (EUR: 1.234.567,50 €).
const CURRENCY_LOCALE: Record<string, string> = { USD: 'en-US', GBP: 'en-GB', EUR: 'de-DE', JPY: 'ja-JP' }

/**
 * An amount with its currency, at the precision setting. The setting may round
 * further, never past the currency's own minor unit (yen has none).
 */
export function fmtCurrency(x: number, precision: number, currency: string): string {
  if (currency === 'INR') {
    return `₹${x.toLocaleString('en-IN', { minimumFractionDigits: precision, maximumFractionDigits: precision })}`
  }
  try {
    const locale = CURRENCY_LOCALE[currency] ?? 'en-US'
    const own = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? precision
    const digits = Math.min(precision, own)
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x)
  } catch {
    // Not an ISO 4217 code: show the amount with the code beside it.
    return `${x.toLocaleString('en-IN', { minimumFractionDigits: precision, maximumFractionDigits: precision })} ${currency}`.trim()
  }
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A calendar heading: "October 2026". */
export function fmtMonthYear(d: Date): string {
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * A Date that stands for a day as DD-Mon-YYYY, read off whichever clock says
 * midnight: a Date built from local parts is local midnight, "2026-01-15" parses
 * to UTC midnight. The same rule as shared calendarDay(); never toISOString(),
 * which moves a local day east of UTC. (Since #387 the workbook parser hands
 * days over as YYYY-MM-DD text, which fmtDate formats directly.)
 */
export function fmtDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const localMidnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  if (!localMidnight && utcMidnight) return fmtDate(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`)
  return fmtDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO day -> DD-Mon-YYYY (ADR 844). Slash forms are ambiguous and never used. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const month = MONTHS[Number(m) - 1]
  return month ? `${d}-${month}-${y}` : iso
}

/**
 * An ISO instant as `DD-Mon-YYYY HH:MM IST` — the form report_server's
 * `data_as_of()` uses. Rendered in IST because that is where the readers are;
 * the servers run UTC and a bare UTC clock time would be read as local and be
 * five and a half hours wrong.
 */
export function fmtInstantIST(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${pad(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()} ` +
    `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`
  )
}
