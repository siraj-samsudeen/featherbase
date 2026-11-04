import { ApiError } from './api'

export type PersonOption = { row_id: string; full_name?: string | null }

/** Shown when the user may not read Person: the pickers still work, with
 *  the people this user can see. */
export const PEOPLE_LIMITED_NOTICE =
  'You can see only yourself and the people already on tasks, so the people choices are limited. Ask an administrator for read access to Person to choose anyone else.'

/** The people the pickers offer. Person read is granted to named roles only
 *  (#437), so a refused read (403) is an empty, limited list, never an
 *  error: the page then offers the user and the people already on tasks. */
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
