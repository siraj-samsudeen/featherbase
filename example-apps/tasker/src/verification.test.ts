import { describe, expect, it } from 'vitest'
import { SUBMITTED, closureNotes, waitingFor } from './verification'

const names: Record<string, string> = { ravi: 'Ravi', meena: 'Meena' }
const nameOf = (id: string) => names[id] ?? 'Former member'
const base = { task_state: 'In progress', assigned_to: 'ravi', acknowledged_at: '2026-11-07T04:00:00Z', verifier: 'meena' }
const texts = (task: Parameters<typeof closureNotes>[0]) => closureNotes(task, nameOf).map(note => note.text)

describe('closure notes on a task', () => {
  it('says who has not acknowledged an assignment', () => {
    expect(texts({ ...base, acknowledged_at: null })).toEqual(['Not acknowledged by Ravi'])
  })

  it('says nothing about acknowledgement once the task is settled', () => {
    expect(texts({ ...base, acknowledged_at: null, task_state: 'Cancelled', cancel_reason: 'Supplier closed' })).toEqual(['Cancelled: Supplier closed'])
  })

  it('names the verifier a submitted task waits for', () => {
    expect(texts({ ...base, task_state: SUBMITTED })).toEqual(['Waiting for Meena to verify'])
  })

  it('shows why a task was returned while it is back in progress', () => {
    expect(texts({ ...base, return_reason: 'Left counter still flickers', return_count: 1 })).toEqual(['Returned: Left counter still flickers'])
  })

  it('shows who verified a closed task and when', () => {
    expect(texts({ ...base, task_state: 'Done', verified_by: 'meena', verified_at: '2026-11-07T06:30:00Z' })).toEqual(['Verified by Meena · 07-Nov-2026'])
  })

  it('shows the first due date and how often it moved', () => {
    expect(texts({ ...base, original_due_date: '2026-11-07T00:00:00.000Z', extension_count: 1 })).toEqual(['was 07-Nov-2026 · extended 1 time'])
    expect(texts({ ...base, original_due_date: '2026-11-07', extension_count: 3 })).toEqual(['was 07-Nov-2026 · extended 3 times'])
  })

  it('says nothing for a task with no verification or extension', () => {
    expect(texts({ task_state: 'Not started', assigned_to: null })).toEqual([])
  })
})

describe('the To verify list', () => {
  const tasks = [
    { row_id: 'a', task_state: SUBMITTED, verifier: 'meena' },
    { row_id: 'b', task_state: 'In progress', verifier: 'meena' },
    { row_id: 'c', task_state: SUBMITTED, verifier: 'ravi' },
  ]
  it('holds only submitted tasks the person verifies', () => {
    expect(waitingFor(tasks, 'meena').map(task => task.row_id)).toEqual(['a'])
  })
})
