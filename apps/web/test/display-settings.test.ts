// System Settings display defaults (#380 review, Siraj's decision 22-Oct-2026):
// Jeyarama is an Indian business, so a clean install shows rupees with Indian
// grouping and dates as DD-Mon-YYYY (ADR 844). Another currency keeps its own
// locale's grouping.
import { expect, test } from 'vitest'
import { DEFAULT_SETTINGS, formatCurrency, formatDate, formatNumber, type Settings } from '../src/lib/settings'

const with_ = (o: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...o })

test('a clean install is rupees and DD-Mon-YYYY', () => {
  expect(DEFAULT_SETTINGS.currency).toBe('INR')
  expect(DEFAULT_SETTINGS.date_format).toBe('dd-mon-yyyy')
})

test('a day reads DD-Mon-YYYY', () => {
  expect(formatDate('2026-03-09', DEFAULT_SETTINGS.date_format)).toBe('09-Mar-2026')
})

// A Datetime instant shows its UTC day and no time today, so IST 00:00-05:29 reads as the previous day.
test.todo('a Datetime shows its day and time on the viewer\'s clock (featherbase#390)')

test('rupees group the Indian way', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'INR' }))).toBe('₹12,34,567.50')
})

test('another currency is written the way its own readers write it', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'USD' }))).toBe('$1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'GBP' }))).toBe('£1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'EUR' }))).toBe('1.234.567,50\u00a0€')
  expect(formatCurrency(1234567.5, with_({ currency: 'JPY' }))).toBe('￥1,234,568')
})

test('a code that is not ISO 4217 still shows the amount, with the code beside it', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'RUPEE' }))).toBe('12,34,567.50 RUPEE')
})

test('the precision setting can round further but never adds a minor unit the currency lacks', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'USD', currency_precision: 0 }))).toBe('$1,234,568')
  expect(formatCurrency(1234567.5, with_({ currency: 'JPY', currency_precision: 3 }))).toBe('￥1,234,568')
  expect(formatCurrency(1234567.5, with_({ currency: 'INR', currency_precision: 3 }))).toBe('₹12,34,567.500')
})

test('a plain decimal groups the Indian way', () => {
  expect(formatNumber(1234567.5, 2)).toBe('12,34,567.50')
})
