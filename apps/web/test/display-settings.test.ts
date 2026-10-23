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

// Known defect #390, pinned: a Datetime list cell shows the instant's UTC day and no time, so in IST
// 00:00-05:29 reads as the previous day. Fixing #390 makes this pin fail: flip it to a plain test then.
test.fails('#390: a Datetime shows its day and time on the viewer\'s clock', () => {
  const before = process.env.TZ
  process.env.TZ = 'Asia/Kolkata'
  try {
    expect(formatValue('Datetime', '2026-12-31T20:00:00Z', DEFAULT_SETTINGS)).toBe('01-Jan-2027 01:30')
  } finally {
    process.env.TZ = before
  }
})

test('rupees group the Indian way', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'INR' }))).toBe('₹12,34,567.50')
})

test('another currency is written the way its own readers write it', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'USD' }))).toBe('$1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'GBP' }))).toBe('£1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'EUR' }))).toBe('1.234.567,50\u00a0€')
  expect(formatCurrency(1234567.5, with_({ currency: 'JPY', currency_precision: 0 }))).toBe('￥1,234,568')
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

test('the precision setting applies to every currency, as configured', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'USD', currency_precision: 0 }))).toBe('$1,234,568')
  expect(formatCurrency(1234567.5, with_({ currency: 'USD', currency_precision: 3 }))).toBe('$1,234,567.500')
  expect(formatCurrency(1234567.5, with_({ currency: 'JPY', currency_precision: 2 }))).toBe('￥1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'INR', currency_precision: 3 }))).toBe('₹12,34,567.500')
})

test('a plain decimal groups the Indian way', () => {
  expect(formatNumber(1234567.5, 2)).toBe('12,34,567.50')
})
