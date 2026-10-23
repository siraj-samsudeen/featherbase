// A dashboard bar shows a count as a count, but a report value chart shows the
// field's value as stored: Codex on #386 caught fmtCount(value, 2) rounding a
// Float such as 1.2345 to 1.23.
import { expect, test } from 'vitest'
import { chartValueText } from '../src/components/DashboardView'
import { fmtAsStored } from '../src/lib/inr'

test('a value as stored keeps every decimal, grouped the Indian way', () => {
  expect(fmtAsStored(1.2345)).toBe('1.2345')
  expect(fmtAsStored(1234567.891)).toBe('12,34,567.891')
  expect(fmtAsStored(1e-7)).toBe('0.0000001')
  expect(fmtAsStored(1e-21)).toBe('0.000000000000000000001')
  expect(fmtAsStored(-0.000123)).toBe('-0.000123')
  expect(fmtAsStored(-0)).toBe('0')
})

test('table charts and grouped report charts are counts', () => {
  expect(chartValueText({ label: 'x', table: 'T', group_by: 'region' }, 1234)).toBe('1,234')
  expect(chartValueText({ label: 'x', report: 'R', group_by: 'region' }, 2)).toBe('2')
})

test('a report value chart shows the value as stored, never rounded', () => {
  expect(chartValueText({ label: 'x', report: 'R', value_field: 'amount' }, 1.2345)).toBe('1.2345')
  expect(chartValueText({ label: 'x', report: 'R', value_field: 'amount' }, 1234567.5)).toBe('12,34,567.5')
})
