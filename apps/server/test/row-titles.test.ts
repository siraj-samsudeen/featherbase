import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { grantRole, makeTable } from './fixtures'

// Home cleanup: POST /api/row_titles answers what a person reads for each
// referenced row, scoped to what the caller may read. A Table with no title
// column still gets a readable title, never the bare composite id.

const MERCH = 'Row Title Merch Map'

async function seedMerch(admin: Parameters<typeof makeTable>[0]) {
  await makeTable(admin, {
    name: MERCH,
    id_pattern: 'prompt',
    columns: ['store_code', 'material_group', 'mch_subcategory', 'section_name'],
  })
  await admin.post('/api/save_row', {
    table: MERCH,
    row: { row_id: '1517|040802006', store_code: '1517', material_group: '040802006', mch_subcategory: 'Kurti Z', section_name: 'Kurti' },
  })
}

type Titles = { titles: Array<{ table: string; row_id: string; title: string }> }

describe('POST /api/row_titles', () => {
  test('a Table with no title column titles a row from its readable values', async ({ admin }) => {
    await seedMerch(admin)
    const res = await admin.post<Titles>('/api/row_titles', { rows: [{ table: MERCH, row_id: '1517|040802006' }] })
    expect(res.titles).toEqual([{ table: MERCH, row_id: '1517|040802006', title: '1517 · Kurti Z' }])
  })

  test("a Table's title column wins", async ({ admin }) => {
    await makeTable(admin, { name: 'Row Title Customer', id_pattern: 'prompt', title_column: 'customer_name', columns: ['code', 'customer_name'] })
    await admin.post('/api/save_row', { table: 'Row Title Customer', row: { row_id: 'C-1', code: 'C-1', customer_name: 'Acme Traders' } })
    const res = await admin.post<Titles>('/api/row_titles', { rows: [{ table: 'Row Title Customer', row_id: 'C-1' }] })
    expect(res.titles[0]?.title).toBe('Acme Traders')
  })

  test('rows the caller cannot read, missing rows and unknown Tables are left out', async ({ admin, createUser }) => {
    await seedMerch(admin)
    const outsider = await createUser({ roles: [] })
    const denied = await outsider.post<Titles>('/api/row_titles', { rows: [{ table: MERCH, row_id: '1517|040802006' }] })
    expect(denied.titles).toEqual([])

    await grantRole(admin, { role: 'Row Title Reader', table: MERCH, can_read: true })
    const reader = await createUser({ roles: ['Row Title Reader'] })
    const mixed = await reader.post<Titles>('/api/row_titles', {
      rows: [
        { table: MERCH, row_id: '1517|040802006' },
        { table: MERCH, row_id: 'missing' },
        { table: 'No Such Table', row_id: 'x' },
      ],
    })
    expect(mixed.titles.map((t) => t.row_id)).toEqual(['1517|040802006'])
  })

  test('a malformed body is refused', async ({ admin }) => {
    const res = await admin.fetch('/api/row_titles', { method: 'POST', body: JSON.stringify({ rows: 'nope' }), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(417)
  })
})
