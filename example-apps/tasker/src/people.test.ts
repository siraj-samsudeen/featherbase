import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { listVisiblePeople } from './people'

// #437: Person read is no longer granted to every signed-in principal, so a
// Tasker user may be refused the people list. The pickers then offer the
// people this user can see (themselves and people already on tasks) and say
// why, instead of failing.
describe('the people list behind the Tasker pickers', () => {
  it('passes the people through when the user may read Person', async () => {
    const people = [{ row_id: 'psn_a', full_name: 'Asha' }]
    expect(await listVisiblePeople(async () => ({ data: people }))).toEqual({ people, limited: false })
  })

  it('a refused Person read (403) is an empty, limited list, not an error', async () => {
    expect(await listVisiblePeople(async () => { throw new ApiError('No permission', 403) })).toEqual({ people: [], limited: true })
  })

  it('any other failure is still an error', async () => {
    await expect(listVisiblePeople(async () => { throw new ApiError('Server error', 500) })).rejects.toThrow('Server error')
  })
})
