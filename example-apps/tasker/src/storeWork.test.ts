import { describe, expect, it } from 'vitest'
import { NO_STORE, dueMark, localDay, storeBucket, summarizeByStore } from './storeWork'

const today = '2026-11-06'
const open = { task_state: 'In progress' }

describe('due marks', () => {
  it('marks an unfinished task past its due date Overdue', () => {
    expect(dueMark({ ...open, due_date: '2026-11-04' }, today)).toBe('overdue')
  })

  it('marks a task Due today on its due date', () => {
    expect(dueMark({ ...open, due_date: today }, today)).toBe('due_today')
  })

  it('marks a task Scheduled while its start date is still to come', () => {
    expect(dueMark({ ...open, start_date: '2026-11-10', due_date: '2026-11-12' }, today)).toBe('scheduled')
  })

  it('gives no mark to a task that has started and is not yet due, or has no dates', () => {
    expect(dueMark({ ...open, start_date: '2026-11-01', due_date: '2026-11-20' }, today)).toBeNull()
    expect(dueMark(open, today)).toBeNull()
  })

  it.each(['Done', 'Cancelled'])('never marks a %s task', (task_state) => {
    expect(dueMark({ task_state, due_date: '2026-11-04' }, today)).toBeNull()
    expect(dueMark({ task_state, start_date: '2026-11-10' }, today)).toBeNull()
  })

  it('reads a stored date by its day, as the server sends it', () => {
    expect(dueMark({ ...open, due_date: '2026-11-04T00:00:00.000Z' }, today)).toBe('overdue')
    expect(dueMark({ ...open, due_date: '2026-11-06T00:00:00.000Z' }, today)).toBe('due_today')
    expect(dueMark({ ...open, start_date: '2026-11-10T00:00:00.000Z' }, today)).toBe('scheduled')
  })

  it('reads today in the local calendar', () => {
    expect(localDay(new Date(2026, 10, 6, 23, 30))).toBe('2026-11-06')
    expect(localDay(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02')
  })
})

describe('store summary', () => {
  it('puts every task in exactly one column and leaves cancelled tasks out', () => {
    expect(storeBucket({ task_state: 'Done', due_date: '2026-11-01' }, today)).toBe('completed')
    expect(storeBucket({ ...open, due_date: '2026-11-04' }, today)).toBe('overdue')
    expect(storeBucket({ ...open, start_date: '2026-11-10' }, today)).toBe('scheduled')
    expect(storeBucket({ ...open, due_date: today }, today)).toBe('ongoing')
    expect(storeBucket(open, today)).toBe('ongoing')
    expect(storeBucket({ task_state: 'Cancelled' }, today)).toBeNull()
  })

  it('counts one row per store, a row for no store and a total', () => {
    const keel = 'keelkattalai', avadi = 'avadi'
    const tasks = [
      { store: keel, task_state: 'Done' },
      { store: keel, task_state: 'In progress', due_date: '2026-11-04' },
      { store: keel, task_state: 'Not started', start_date: '2026-11-10' },
      { store: keel, task_state: 'In progress' },
      { store: keel, task_state: 'Blocked', due_date: today },
      { store: keel, task_state: 'Cancelled' },
      { store: null, task_state: 'Not started' },
    ]
    const summary = summarizeByStore(tasks, [avadi, keel], today)
    expect(summary.rows).toEqual([
      { store: avadi, total: 0, completed: 0, overdue: 0, scheduled: 0, ongoing: 0 },
      { store: keel, total: 5, completed: 1, overdue: 1, scheduled: 1, ongoing: 2 },
      { store: NO_STORE, total: 1, completed: 0, overdue: 0, scheduled: 0, ongoing: 1 },
    ])
    expect(summary.total).toEqual({ store: '', total: 6, completed: 1, overdue: 1, scheduled: 1, ongoing: 3 })
  })

  it('counts a task whose store is no longer listed under no store', () => {
    const summary = summarizeByStore([{ store: 'closed-store', task_state: 'In progress' }], [], today)
    expect(summary.rows).toEqual([{ store: NO_STORE, total: 1, completed: 0, overdue: 0, scheduled: 0, ongoing: 1 }])
  })
})
