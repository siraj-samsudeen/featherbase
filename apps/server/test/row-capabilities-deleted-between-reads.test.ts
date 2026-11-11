// rowCapabilities reads a row twice: once as the caller may see it (getDoc),
// then whole, to judge what may be done to it. A row deleted between the two
// reads is not found, rather than judged as nothing. The window between them
// is held open with module mocks: the deletion runs in the getMeta call that
// follows getDoc's last step (restrictRow).
import { expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { rowCapabilities, saveDoc } from '../src/document'
import { makeTable } from './fixtures'

const window = vi.hoisted(() => ({ table: '', row: '', docRead: false }))

vi.mock('../src/row-readers', async (original) => {
  const actual = await original<typeof import('../src/row-readers')>()
  return { ...actual, restrictRow: async (...args: Parameters<typeof actual.restrictRow>) => {
    const out = await actual.restrictRow(...args)
    if (window.table) window.docRead = true
    return out
  } }
})
vi.mock('../src/meta', async (original) => {
  const actual = await original<typeof import('../src/meta')>()
  return { ...actual, getMeta: async (table: string) => {
    if (window.docRead && table === window.table) {
      const { tableRelation } = await import('../src/table-engine')
      await sql`delete from ${sql(await tableRelation(table))} where row_id = ${window.row}`
      window.table = ''
      window.docRead = false
    }
    return actual.getMeta(table)
  } }
})

test('a row deleted between the two reads of its capabilities is not found', async ({ admin }) => {
  await makeTable(admin, { name: 'Rcd Note', columns: ['title'] })
  const doc = await saveDoc('Rcd Note', { title: 'here, then gone' }, 'Administrator')
  Object.assign(window, { table: 'Rcd Note', row: String(doc.row_id), docRead: false })
  await expect(rowCapabilities('Rcd Note', String(doc.row_id), 'Administrator'))
    .rejects.toMatchObject({ type: 'NotFoundError', message: `Rcd Note ${doc.row_id} not found` })
})
