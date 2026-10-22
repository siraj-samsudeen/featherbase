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

test('dates read DD-Mon-YYYY, from a day or a timestamp, without drifting a day', () => {
  expect(formatDate('2026-03-09', DEFAULT_SETTINGS.date_format)).toBe('09-Mar-2026')
  expect(formatDate('2026-12-31T23:59:00Z', DEFAULT_SETTINGS.date_format)).toBe('31-Dec-2026')
})

test('rupees group the Indian way', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'INR' }))).toBe('₹12,34,567.50')
})

test('another currency keeps its own grouping', () => {
  expect(formatCurrency(1234567.5, with_({ currency: 'USD' }))).toBe('$1,234,567.50')
  expect(formatCurrency(1234567.5, with_({ currency: 'GBP' }))).toBe('£1,234,567.50')
})

test('a plain decimal groups the Indian way', () => {
  expect(formatNumber(1234567.5, 2)).toBe('12,34,567.50')
})
