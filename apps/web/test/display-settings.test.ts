// System Settings display defaults (#380 review, Siraj's decision 22-Oct-2026):
// Jeyarama is an Indian business, so a clean install shows rupees with Indian
// grouping and dates as DD-Mon-YYYY (ADR 844). Another currency keeps its own
// locale's grouping.
import { expect, test } from 'vitest'
import { DISPLAY_DEFAULTS } from 'shared'
import { DEFAULT_SETTINGS, formatCurrency, formatDate, formatNumber, formatValue, type Settings } from '../src/lib/settings'

const with_ = (o: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...o })

test('a clean install is rupees and DD-Mon-YYYY, from the one shared default', () => {
  expect(DEFAULT_SETTINGS).toEqual(DISPLAY_DEFAULTS)
  expect(DEFAULT_SETTINGS.currency).toBe('INR')
  expect(DEFAULT_SETTINGS.date_format).toBe('dd-mon-yyyy')
})

test('a day reads DD-Mon-YYYY', () => {
  expect(formatDate('2026-03-09', DEFAULT_SETTINGS.date_format)).toBe('09-Mar-2026')
})

/** Run fn on another clock, restoring the test's own afterwards. */
function onClock<T>(tz: string, fn: () => T): T {
  const before = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    process.env.TZ = before
  }
}

// #390: a Datetime is an instant, so it reads with its time on the viewer's own clock; cutting the
// UTC text showed IST 00:00-05:29 as the previous day, with no time.
test('#390: a Datetime shows its day and time on the viewer\'s clock', () => {
  onClock('Asia/Kolkata', () => {
    expect(formatValue('Datetime', '2026-12-31T20:00:00Z', DEFAULT_SETTINGS)).toBe('01-Jan-2027 01:30')
  })
})

test.each([
  ['00:00', '2024-10-20T18:30:00Z', '21-Oct-2024 00:00'],
  ['05:29', '2024-10-20T23:59:00Z', '21-Oct-2024 05:29'],
  ['05:30', '2024-10-21T00:00:00Z', '21-Oct-2024 05:30'],
  ['02:00', '2024-10-20T20:30:00.000Z', '21-Oct-2024 02:00'],
])('#390: IST %s reads as the IST day', (_label, instant, shown) => {
  onClock('Asia/Kolkata', () => expect(formatValue('Datetime', instant, DEFAULT_SETTINGS)).toBe(shown))
})

test('#390: the same instant reads on each viewer\'s own clock', () => {
  const instant = '2024-10-21T02:15:00Z'
  expect(onClock('UTC', () => formatValue('Datetime', instant, DEFAULT_SETTINGS))).toBe('21-Oct-2024 02:15')
  expect(onClock('America/New_York', () => formatValue('Datetime', instant, DEFAULT_SETTINGS))).toBe('20-Oct-2024 22:15')
})

test('#390: a Date stays the stored calendar day on every clock', () => {
  for (const tz of ['Asia/Kolkata', 'America/New_York', 'UTC']) {
    expect(onClock(tz, () => formatValue('Date', '2026-03-09', DEFAULT_SETTINGS))).toBe('09-Mar-2026')
  }
})

test('#390: text that is not an instant is shown as it is', () => {
  expect(formatValue('Datetime', 'soon', DEFAULT_SETTINGS)).toBe('soon')
})

test('rupees group the Indian way', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'INR' }))).toBe('₹12,34,567.50')
})

test('another currency is written the way its own readers write it', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'USD' }))).toBe('$1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'GBP' }))).toBe('£1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'EUR' }))).toBe('1.234.567,50\u00a0€')
  expect(formatCurrency(1234567.5, with_({ currency: 'JPY' }))).toBe('￥1,234,568')
})

test('a negative amount puts its sign before the currency symbol', () => {
  expect(formatCurrency(-1234, with_({ currency: 'INR' }))).toBe('-₹1,234.00')
  expect(formatCurrency(-0, with_({ currency: 'INR' }))).toBe('₹0.00')
  expect(formatCurrency(-0.001, with_({ currency: 'INR' }))).toBe('₹0.00')
  expect(formatCurrency(-1234, with_({ currency: 'USD' }))).toBe('-$1,234.00')
})

test('a code that is not ISO 4217 still shows the amount, with the code beside it', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'RUPEE' }))).toBe('12,34,567.50 RUPEE')
})

// Decision 23-Oct-2026 (#4332): the setting may show fewer decimals, never more than the
// currency's ISO 4217 minor unit (JPY 0; INR, USD, EUR 2), which Intl.NumberFormat resolves.
test('the precision setting is capped at the currency\'s ISO 4217 minor unit', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'USD', currency_precision: 0 }))).toBe('$1,234,568')
  expect(formatCurrency(1234567.5, with_({ currency: 'USD', currency_precision: 3 }))).toBe('$1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'JPY', currency_precision: 2 }))).toBe('￥1,234,568')
  expect(formatCurrency(1234567.5, with_({ currency: 'INR', currency_precision: 3 }))).toBe('₹12,34,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'INR', currency_precision: 0 }))).toBe('₹12,34,568')
})

test('a plain decimal groups the Indian way', () => {
  expect(formatNumber(1234567.5, 2)).toBe('12,34,567.50')
})
