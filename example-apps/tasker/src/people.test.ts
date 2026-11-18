import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { listVisiblePeople, peopleWithTaskResponsibility, personName } from './people'

// The member directory exposes names without broad Person read access.
// A refused directory remains a restricted picker rather than a page crash.
describe('the people list behind the Tasker pickers', () => {
  it('passes the people through when the user may read the member directory', async () => {
    const people = [{ row_id: 'psn_a', full_name: 'Asha' }]
    expect(await listVisiblePeople(async () => ({ data: people }))).toEqual({ people, limited: false })
  })

  it('a refused member-directory read (403) is an empty, limited list, not an error', async () => {
    expect(await listVisiblePeople(async () => { throw new ApiError('No permission', 403) })).toEqual({ people: [], limited: true })
  })

  it('any other failure is still an error', async () => {
    await expect(listVisiblePeople(async () => { throw new ApiError('Server error', 500) })).rejects.toThrow('Server error')
  })
})

// #1298: until the member directory answers, the signed-in person is still a current member.
describe('the people the pickers offer', () => {
  it('names the signed-in person by their own name while the member directory is loading', () => {
    const people = peopleWithTaskResponsibility([], [], { row_id: 'psn_me', full_name: 'Asha Patel' })
    expect(personName(people.find((person) => person.row_id === 'psn_me'))).toBe('Asha Patel')
  })

  it('still calls someone a former member when only a task names them', () => {
    const people = peopleWithTaskResponsibility([{ row_id: 'psn_me', full_name: 'Asha Patel' }], [{ assigned_to: 'psn_gone' }], { row_id: 'psn_me', full_name: 'Asha Patel' })
    expect(personName(people.find((person) => person.row_id === 'psn_gone'))).toBe('Former member')
  })
})
