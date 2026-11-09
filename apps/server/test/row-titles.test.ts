import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { expectStatus, grantRole, makePerson, makeTable } from './fixtures'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

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
  test('Table definitions use their natural name by default', async ({ admin, createUser }) => {
    await makeTable(admin, { name: 'Title SAP Plant', module: 'Custom', columns: ['plant_name'] })
    await grantRole(admin, { role: 'Definition Title Reader', table: 'Table', can_read: true })
    const reader = await createUser({ roles: ['Definition Title Reader'] })
    const rows = [{ table: 'Table', row_id: 'Title SAP Plant' }]
    expect((await reader.post<Titles>('/api/row_titles', { rows })).titles)
      .toEqual([{ ...rows[0], title: 'Title SAP Plant' }])
    const outsider = await createUser({ roles: [] })
    expect((await outsider.post<Titles>('/api/row_titles', { rows })).titles).toEqual([])
  })

  test('an effective authored Table title keeps precedence', async ({ admin }) => {
    await makeTable(admin, { name: 'Authored SAP Plant', module: 'Custom', description: 'Plant catalogue', columns: ['plant_name'] })
    await sql`insert into metadata_override (row_id, table_name, property, value)
      values ('title-860', 'Table', 'title_column', 'description')`
    invalidateMeta('Table')
    const rows = [{ table: 'Table', row_id: 'Authored SAP Plant' }]
    expect((await admin.post<Titles>('/api/row_titles', { rows })).titles)
      .toEqual([{ ...rows[0], title: 'Plant catalogue' }])
  })

  test.for(['Person', 'Service Account'] as const)('a %s-valued title resolves through principal names', async (principalTable, { admin, createUser }) => {
    const principal = principalTable === 'Person'
      ? await makePerson({ full_name: 'Title Owner' })
      : (await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'title-importer' })).row_id
    const name = `Row Title ${principalTable}`
    await makeTable(admin, { name, title_column: 'owner', id_pattern: 'prompt', columns: [
      { column_name: 'owner', column_type: 'Reference', reference_table: principalTable }, 'description',
    ] })
    await admin.post('/api/save_row', { table: name, row: { row_id: 'owned-1', owner: principal, description: 'Public description' } })
    await admin.post('/api/save_row', { table: name, row: { row_id: 'unassigned-1', description: 'Waiting for an owner' } })
    const rows = [{ table: name, row_id: 'owned-1' }, { table: name, row_id: 'unassigned-1' }]
    const res = await admin.post<Titles>('/api/row_titles', { rows })
    expect(res.titles.sort((a, b) => a.row_id.localeCompare(b.row_id))).toEqual([
      { table: name, row_id: 'owned-1', title: principalTable === 'Person' ? 'Title Owner' : 'title-importer' },
      { table: name, row_id: 'unassigned-1', title: 'Waiting for an owner' },
    ])
    const outsider = await createUser({ roles: [] })
    expect((await outsider.post<Titles>('/api/row_titles', { rows })).titles).toEqual([])
    if (principalTable === 'Person') {
      await grantRole(admin, { role: 'Title Only Reader', table: name, can_read: true })
      const reader = await createUser({ roles: ['Title Only Reader'] })
      const limited = await reader.post<Titles>('/api/row_titles', { rows })
      expect(limited.titles.sort((a, b) => a.row_id.localeCompare(b.row_id))).toEqual([
        { table: name, row_id: 'owned-1', title: 'Unnamed person' },
        { table: name, row_id: 'unassigned-1', title: 'Waiting for an owner' },
      ])
    }
  })

  test('a restricted principal title column never discloses its name', async ({ admin, createUser }) => {
    const owner = await makePerson({ full_name: 'Private Title Owner' })
    const name = 'Row Title Restricted'
    await makeTable(admin, { name, title_column: 'owner', id_pattern: 'prompt', columns: [
      { column_name: 'owner', column_type: 'Reference', reference_table: 'Person', tier: 'restricted' }, 'description',
    ] })
    await admin.post('/api/save_row', { table: name, row: { row_id: 'private-1', owner, description: 'Public title' } })
    await grantRole(admin, { role: 'Basic Title Reader', table: name, can_read: true })
    await grantRole(admin, { role: 'Basic Title Reader', table: 'Person', can_read: true })
    const reader = await createUser({ roles: ['Basic Title Reader'] })
    const res = await reader.post<Titles>('/api/row_titles', { rows: [{ table: name, row_id: 'private-1' }] })
    expect(res.titles[0]?.title).toBe('Public title')
  })

  test('a Table with no title column titles a row from its readable values', async ({ admin }) => {
    await seedMerch(admin)
    const res = await admin.post<Titles>('/api/row_titles', { rows: [{ table: MERCH, row_id: '1517|040802006' }] })
    expect(res.titles).toEqual([{ table: MERCH, row_id: '1517|040802006', title: 'Kurti Z · 1517' }])
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
    await expectStatus(res, 417)
  })
})
