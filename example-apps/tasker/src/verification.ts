import { fmtDate, localCalendarDate } from '@featherbase/shop-floor'

export const SUBMITTED = 'Submitted for verification'

export interface ClosureFields {
  task_state: string | null
  assigned_to?: string | null
  acknowledged_at?: string | null
  verifier?: string | null
  verified_by?: string | null
  verified_at?: string | null
  return_reason?: string | null
  return_count?: number | null
  cancel_reason?: string | null
  original_due_date?: string | null
  extension_count?: number | null
}

export type ClosureNoteKind = 'unacknowledged' | 'waiting' | 'returned' | 'verified' | 'cancelled' | 'extended'

const day = (value: string) => value.slice(0, 10)
const settled = (task: ClosureFields) => task.task_state === 'Done' || task.task_state === 'Cancelled'

/** The short notes a task row and its details show about acknowledgement, verification and extensions. */
export function closureNotes(task: ClosureFields, nameOf: (person: string) => string): { kind: ClosureNoteKind; text: string }[] {
  const notes: { kind: ClosureNoteKind; text: string }[] = []
  if (task.assigned_to && !task.acknowledged_at && !settled(task))
    notes.push({ kind: 'unacknowledged', text: `Not acknowledged by ${nameOf(task.assigned_to)}` })
  if (task.task_state === SUBMITTED && task.verifier)
    notes.push({ kind: 'waiting', text: `Waiting for ${nameOf(task.verifier)} to verify` })
  if (task.return_reason && task.task_state !== SUBMITTED && !settled(task))
    notes.push({ kind: 'returned', text: `Returned: ${task.return_reason}` })
  if (task.task_state === 'Done' && task.verified_by)
    notes.push({ kind: 'verified', text: `Verified by ${nameOf(task.verified_by)}${task.verified_at ? ` · ${fmtDate(localCalendarDate(Date.parse(task.verified_at), 'Asia/Kolkata'))}` : ''}` })
  if (task.task_state === 'Cancelled' && task.cancel_reason)
    notes.push({ kind: 'cancelled', text: `Cancelled: ${task.cancel_reason}` })
  const extended = Number(task.extension_count ?? 0)
  if (extended > 0 && task.original_due_date)
    notes.push({ kind: 'extended', text: `was ${fmtDate(day(task.original_due_date))} · extended ${extended} ${extended === 1 ? 'time' : 'times'}` })
  return notes
}

/** Submitted tasks waiting for this person's check. */
export function waitingFor<T extends { task_state: string | null; verifier?: string | null }>(tasks: T[], person: string): T[] {
  return tasks.filter(task => task.task_state === SUBMITTED && task.verifier === person)
}
