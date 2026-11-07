import { describe, expect, it } from 'vitest'
import { fixByFor, isOpen, jobClock, warrantyNotice } from './jobRules'

describe('fix-by time', () => {
  it.each([
    ['Urgent', '2026-11-07T14:00:00.000Z'],
    ['High', '2026-11-08T10:00:00.000Z'],
    ['Normal', '2026-11-10T10:00:00.000Z'],
  ])('a %s job is due for fixing by its deadline', (priority, due) => {
    expect(fixByFor('2026-11-07T10:00:00.000Z', priority)).toBe(due)
  })

  it('treats an unknown priority as Normal', () => {
    expect(fixByFor('2026-11-07T10:00:00.000Z', 'Whenever')).toBe('2026-11-10T10:00:00.000Z')
  })
})

describe('job clock', () => {
  const urgent = { job_state: 'Reported', fix_by: '2026-11-07T14:00:00.000Z', reported_at: '2026-11-07T10:00:00.000Z' }

  it('shows the time left on an open job', () => {
    expect(jobClock(urgent, new Date('2026-11-07T11:00:00.000Z'))).toEqual({ tone: 'ok', label: '3h left' })
  })

  it('warns when under an hour is left', () => {
    expect(jobClock(urgent, new Date('2026-11-07T13:15:00.000Z'))).toEqual({ tone: 'soon', label: '45 min left' })
  })

  it('shows how late an open job is once its time has passed', () => {
    expect(jobClock(urgent, new Date('2026-11-07T16:00:00.000Z'))).toEqual({ tone: 'late', label: 'Late by 2h' })
    expect(jobClock(urgent, new Date('2026-11-09T17:30:00.000Z'))).toEqual({ tone: 'late', label: 'Late by 2d 3h' })
  })

  it('says how long a fixed job took and whether it was on time', () => {
    expect(jobClock({ ...urgent, job_state: 'Fixed', fixed_at: '2026-11-07T13:00:00.000Z' }, new Date('2026-11-08T00:00:00.000Z')))
      .toEqual({ tone: 'done', label: 'Fixed in 3h, on time' })
    expect(jobClock({ ...urgent, job_state: 'Fixed', fixed_at: '2026-11-07T19:00:00.000Z' }, new Date('2026-11-08T00:00:00.000Z')))
      .toEqual({ tone: 'done', label: 'Fixed in 9h, 5h late' })
  })

  it('stops the clock on a cancelled job', () => {
    expect(jobClock({ ...urgent, job_state: 'Cancelled' }, new Date('2026-11-09T00:00:00.000Z'))).toEqual({ tone: 'done', label: 'Cancelled' })
  })

  it('knows which stages are still open', () => {
    expect(['Reported', 'Assigned', 'In progress', 'Waiting for parts'].every(isOpen)).toBe(true)
    expect(['Fixed', 'Cancelled'].some(isOpen)).toBe(false)
  })
})

describe('warranty notice', () => {
  const today = '2026-11-07'

  it('warns when a warranty ends within 30 days', () => {
    expect(warrantyNotice('2026-11-30', today)).toBe('soon')
    expect(warrantyNotice('2026-12-07', today)).toBe('soon')
    expect(warrantyNotice('2026-12-08', today)).toBeNull()
  })

  it('says when a warranty has ended, reading a stored date by its day', () => {
    expect(warrantyNotice('2026-11-06T00:00:00.000Z', today)).toBe('ended')
    expect(warrantyNotice('2026-11-07T00:00:00.000Z', today)).toBe('soon')
  })

  it('says nothing without a warranty date', () => {
    expect(warrantyNotice(null, today)).toBeNull()
  })
})
