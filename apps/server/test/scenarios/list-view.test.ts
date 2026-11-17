// list-view (#1196): the is blank and is not blank filters, over the list's API.
// The list page's own scenarios are in apps/web/test/scenarios/list-view.test.tsx.
import { describe, expect } from 'vitest'
import { sql } from '../../src/db'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { makeTable } from '../fixtures'
import { tableRelation } from '../../src/table-engine'

const scenario = scenarioFor(test, 'list-view')
const TABLE = 'Blank Names'

describe('list-view', () => {
  scenario('Is blank finds empty and empty-text values', async ({ admin }, step) => {
    const names = async (filters: unknown) => (await admin.get<{ data: { name: string | null; note: string }[] }>(
      `/api/table/${encodeURIComponent(TABLE)}?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent('["name","note"]')}&order_by=note%20asc`)).data
    let blank: Awaited<ReturnType<typeof names>> = []
    await step('a table with a row whose name is empty, a row whose name is empty text and a row named "Asha"', async () => {
      await makeTable(admin, { name: TABLE, columns: ['name', 'note'] })
      for (const note of ['1 empty', '2 empty text', '3 Asha']) await admin.post('/api/save_row', { table: TABLE, row: { note } })
      // Empty text, as an upload leaves it: written past the save path, which may tidy it.
      const relation = await tableRelation(TABLE)
      await sql`update ${sql(relation)} set name = '' where note = '2 empty text'`
      await sql`update ${sql(relation)} set name = 'Asha' where note = '3 Asha'`
    })
    await step('the user filters name is blank', async () => { blank = await names([['name', 'is blank', null]]) })
    await step('the list shows the first two rows', () => expect(blank.map(r => r.note)).toEqual(['1 empty', '2 empty text']))
    await step('name is not blank shows only "Asha"', async () =>
      expect((await names([['name', 'is not blank', null]])).map(r => r.name)).toEqual(['Asha']))
  })
})
