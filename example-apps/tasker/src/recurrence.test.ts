import { expect, test } from 'vitest'
import { nextOccurrence } from './recurrence'

test('a weekly schedule skips slots before completion', () => {
  expect(nextOccurrence({ mode: 'weekly', interval: 1, anchor: '2026-10-19' }, '2026-10-28T11:00:00Z', 'Asia/Kolkata')).toBe('2026-11-01T18:30:00.000Z')
})

test('a month-end schedule keeps its original day after a short month', () => {
  const schedule = { mode: 'monthly' as const, interval: 1, anchor: '2027-01-31' }
  expect(nextOccurrence(schedule, '2027-01-31T10:00:00Z', 'Asia/Kolkata')).toBe('2027-02-27T18:30:00.000Z')
  expect(nextOccurrence(schedule, '2027-02-28T10:00:00Z', 'Asia/Kolkata')).toBe('2027-03-30T18:30:00.000Z')
})

test('completion intervals start from the actual completion instant', () => {
  expect(nextOccurrence({ mode: 'after_completion', interval: 7, anchor: '2026-10-19' }, '2026-10-28T11:15:00Z', 'Asia/Kolkata')).toBe('2026-11-04T11:15:00.000Z')
})

test('daily schedules follow the local calendar across daylight saving', () => {
  expect(nextOccurrence({ mode: 'daily', interval: 1, anchor: '2027-03-01' }, '2027-03-14T05:00:00Z', 'America/New_York')).toBe('2027-03-15T04:00:00.000Z')
})

test('an invalid recurrence interval is refused', () => {
  expect(() => nextOccurrence({ mode: 'daily', interval: 0, anchor: '2027-03-01' }, '2027-03-14T05:00:00Z', 'UTC')).toThrow('Choose an interval from 1 to 365')
})

test.each(['bad', '2027-02-30', '2027-99-99'])('an invalid anchor %s is refused', anchor => {
  expect(() => nextOccurrence({ mode: 'daily', interval: 1, anchor }, '2027-03-14T05:00:00Z', 'UTC')).toThrow('Choose a valid starting date')
})

test.each([1.5, 366])('an invalid interval %s is refused', interval => {
  expect(() => nextOccurrence({ mode: 'daily', interval, anchor: '2027-03-01' }, '2027-03-14T05:00:00Z', 'UTC')).toThrow('Choose an interval from 1 to 365')
})

test('an invalid completion instant is refused', () => {
  expect(() => nextOccurrence({ mode: 'daily', interval: 1, anchor: '2027-03-01' }, 'not a time', 'UTC')).toThrow('A completion time is required')
})
