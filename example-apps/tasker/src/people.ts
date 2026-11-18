import { ApiError } from './api'
import type { Task } from './taskRows'

export type PersonOption = { row_id: string; full_name?: string | null }

/** The member directory never requires broad access to Person records. */
export const PEOPLE_LIMITED_NOTICE =
  'Tasker membership is required to choose teammates. Ask an administrator for Tasker access.'

/** A refused directory read leaves only already-known responsibility names. */
export async function listVisiblePeople(
  list: () => Promise<{ data: PersonOption[] }>,
): Promise<{ people: PersonOption[]; limited: boolean }> {
  try {
    return { people: (await list()).data, limited: false }
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return { people: [], limited: true }
    throw err
  }
}

export function peopleWithTaskResponsibility(
  listed: { row_id: string; full_name?: string | null }[],
  tasks: Pick<Task, 'assigned_to'>[],
  currentUser: PersonOption,
) {
  // #1298: the signed-in person is a current member, so until the directory
  // answers they are named by the name their session already holds.
  const people = [...listed]
  if (currentUser.row_id && !people.some((person) => person.row_id === currentUser.row_id)) people.push(currentUser)
  for (const rowId of tasks.map((task) => task.assigned_to ?? '')) {
    if (rowId && !people.some((person) => person.row_id === rowId)) people.push({ row_id: rowId })
  }
  return people
}

export function personName(person?: PersonOption) { return person?.full_name || 'Former member' }
