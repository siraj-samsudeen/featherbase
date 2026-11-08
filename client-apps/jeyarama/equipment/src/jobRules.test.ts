import { describe, expect, it } from 'vitest'
import { coverNotice, fixByFor, isOpen, jobClock, jobStage, placePath, siteOf, warrantyNotice, workflowState } from './jobRules'

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
    expect(jobClock({ ...urgent, job_state: 'Fixed', restored_at: '2026-11-07T13:00:00.000Z' }, new Date('2026-11-08T00:00:00.000Z')))
      .toEqual({ tone: 'done', label: 'Fixed in 3h, on time' })
    expect(jobClock({ ...urgent, job_state: 'Fixed', restored_at: '2026-11-07T19:00:00.000Z' }, new Date('2026-11-08T00:00:00.000Z')))
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

describe('place path', () => {
  const places = [
    { row_id: 'site', place_name: 'Enchakkal WH 9151', parent_place: null },
    { row_id: 'bldg', place_name: 'Main building', parent_place: 'site' },
    { row_id: 'floor', place_name: 'Ground floor', parent_place: 'bldg' },
    { row_id: 'area', place_name: 'Cold chain', parent_place: 'floor' },
  ]

  it('reads a place from its site down', () => {
    expect(placePath('area', places)).toBe('Enchakkal WH 9151 › Main building › Ground floor › Cold chain')
    expect(placePath('site', places)).toBe('Enchakkal WH 9151')
  })

  it('finds the site a place is in', () => {
    expect(siteOf('area', places)).toBe('site')
    expect(siteOf('site', places)).toBe('site')
    expect(siteOf(null, places)).toBeNull()
  })

  it('stops on a loop or a missing parent rather than running forever', () => {
    const looped = [{ row_id: 'a', place_name: 'A', parent_place: 'b' }, { row_id: 'b', place_name: 'B', parent_place: 'a' }]
    expect(placePath('a', looped)).toBe('B › A')
    expect(placePath('gone', places)).toBe('gone')
  })
})

describe('workflow state and stage', () => {
  it('works the workflow out from the asset’s jobs', () => {
    expect(workflowState([], new Set())).toBe('No open work')
    expect(workflowState([{ row_id: 'j1', job_state: 'In progress' }], new Set())).toBe('Repair job open')
    expect(workflowState([{ row_id: 'j1', job_state: 'Fixed' }], new Set())).toBe('Waiting for the store to confirm')
    expect(workflowState([{ row_id: 'j1', job_state: 'Fixed' }], new Set(['j1']))).toBe('No open work')
  })

  it('shows a confirmed fixed job as Closed', () => {
    expect(jobStage({ row_id: 'j1', job_state: 'Fixed' }, new Set(['j1']))).toBe('Closed')
    expect(jobStage({ row_id: 'j1', job_state: 'Fixed' }, new Set())).toBe('Fixed')
    expect(jobStage({ row_id: 'j1', job_state: 'Assigned' }, new Set(['j1']))).toBe('Assigned')
  })
})

describe('cover notice', () => {
  const today = '2026-11-07'

  it('names the warranty first, then an AMC, while either still runs', () => {
    expect(coverNotice({ warranty_until: '2027-03-12', amc_until: '2027-06-30', amc_vendor: 'Voltas' }, today)).toBe('Under warranty until 12-Mar-2027')
    expect(coverNotice({ warranty_until: '2026-10-01', amc_until: '2027-06-30', amc_vendor: 'Blue Star' }, today)).toBe('Under AMC with Blue Star until 30-Jun-2027')
    expect(coverNotice({ warranty_until: '2026-11-07T00:00:00.000Z', amc_until: null, amc_vendor: null }, today)).toBe('Under warranty until 07-Nov-2026')
  })

  it('says nothing once cover has ended', () => {
    expect(coverNotice({ warranty_until: '2026-10-01', amc_until: '2026-11-06', amc_vendor: 'Blue Star' }, today)).toBeNull()
  })
})
