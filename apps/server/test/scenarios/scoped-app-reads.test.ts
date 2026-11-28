// scoped-app-reads' fenced scenarios (#1454): the `scopedproof` app's answers Table, about places (mapped on store and
// section, the section standing for a subcategory here), read through the ordinary Table read, with the places the
// provider answers. Every row is made up.
import { afterEach, describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused } from '../fixtures'
import { ANSWER, ids, installed, list, removeScopedFolders, withPlaces } from '../scoped-proof-app'

const scenario = scenarioFor(test, 'scoped-app-reads')
afterEach(removeScopedFolders)
const save = (client: TestClient, row: Record<string, unknown>) => client.post('/api/save_row', { table: ANSWER, row })
const row = (client: TestClient, id: string) => client.get<{ updated_at: string }>(`/api/table/${encodeURIComponent(ANSWER)}/${id}`)

describe('scoped-app-reads', () => {
  scenario("A section's answers, and no other", async ({ admin, createUser }, step) => {
    let reader!: TestClient
    await step('a review Table holds an answer at store "9001" for subcategory "000000001" and one for subcategory "000000004"', async () => {
      await installed(admin)
      await save(admin, { row_id: 'first', store: '9001', section: '000000001', body: 'first' })
      await save(admin, { row_id: 'second', store: '9001', section: '000000004', body: 'second' })
      reader = await createUser({ roles: ['Answer Reader'] })
    })
    await withPlaces([{ label: '9001 one section', filters: { store: ['9001'], section: ['000000001'] } }], async () => {
      await step('the reader\'s only place is store "9001" with subcategory "000000001"')
      let listed: { row_id: string }[] = []
      await step('the reader lists the review Table', async () => { listed = await list(reader) })
      await step('it answers the first answer only', () => expect(ids(listed)).toEqual(['first']))
      await step('opening the second answer is refused', () => expectRefused(row(reader, 'second'), 403))
    })
  })

  scenario('A place the Table cannot apply adds nothing', async ({ admin, createUser }, step) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces([{ label: 'North by line', filters: { store: ['N1'], line: ['L1'] } }], async () => {
      await step("a reader's place names a filter the Table does not map")
      let listed: { row_id: string }[] = []
      await step('the reader lists the Table', async () => { listed = await list(reader) })
      await step('that place adds no rows', () => expect(listed).toEqual([]))
    })
  })

  scenario('Someone with no places sees only what they wrote', async ({ admin, createUser }, step) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces([], async () => {
      await step('the org chart gives the reader no place')
      let listed: { row_id: string }[] = []
      await step('the reader saves an answer and lists the review Table', async () => {
        await save(reader, { row_id: 'mine', store: 'S1', section: 'mens', body: 'my own' })
        listed = await list(reader)
      })
      await step('the list holds that answer only', () => expect(ids(listed)).toEqual(['mine']))
    })
  })

  scenario("A row outside one's places is not changed", async ({ admin, createUser }, step) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await save(admin, { row_id: 'elsewhere', store: '9002', section: 'kids', body: 'theirs' })
    const current = await row(admin, 'elsewhere')
    await withPlaces([{ label: '9001', filters: { store: ['9001'] } }], async () => {
      await step('the reader\'s only place is store "9001"')
      let change!: Promise<unknown>
      await step('the reader changes an answer at store "9002"', () => { change = save(reader, { row_id: 'elsewhere', updated_at: current.updated_at, body: 'changed' }) })
      await step('the change is refused', () => expectRefused(change, 403))
    })
  })
})
