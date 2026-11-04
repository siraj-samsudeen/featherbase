import { ApiError } from './api'

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
