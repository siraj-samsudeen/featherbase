// #911: a text column whose values already name rows of another table becomes
// a link to it, in place: same name, same values, same history.
import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { expectStatus } from './fixtures'

const ORG = 'Tcl Sales Org'
const PLANT = 'Tcl Plant'
const salesOrg = (type: 'Data' | 'Reference') =>
  ({ column_name: 'sales_org', label: 'Sales org', column_type: type, ...(type === 'Reference' ? { reference_table: ORG } : {}) })

async function seed(admin: TestClient, codes: string[]) {
  await admin.post('/api/table_def', { name: ORG, id_pattern: 'prompt', columns: [{ column_name: 'org_name', label: 'Org name', column_type: 'Data' }] })
  for (const [id, org_name] of [['1150', 'Ramachandran'], ['1160', 'Lakshmi']])
    await admin.post('/api/save_row', { table: ORG, row: { row_id: id, org_name } })
  await admin.post('/api/table_def', { name: PLANT, columns: [{ column_name: 'plant_name', label: 'Plant name', column_type: 'Data' }, salesOrg('Data')] })
  const rows: { row_id: string; updated_at: string }[] = []
  for (const [i, code] of codes.entries())
    rows.push(await admin.post('/api/save_row', { table: PLANT, row: { plant_name: `Plant ${i + 1}`, sales_org: code } }))
  return rows
}

const turnInto = (admin: TestClient, type: 'Data' | 'Reference') =>
  admin.fetch(`/api/table_def/${encodeURIComponent(PLANT)}`, {
    method: 'PUT',
    body: JSON.stringify({ columns: [{ column_name: 'plant_name', label: 'Plant name', column_type: 'Data' }, salesOrg(type)] }),
  })

const column = async (admin: TestClient) =>
  (await admin.get<{ columns: { column_name: string; column_type: string; reference_table?: string | null }[] }>(
    `/api/table/${encodeURIComponent(PLANT)}:meta`)).columns.find(c => c.column_name === 'sales_org')

const values = async (admin: TestClient) =>
  (await admin.get<{ data: { sales_org: string | null }[] }>(
    `/api/table/${encodeURIComponent(PLANT)}?fields=${encodeURIComponent(JSON.stringify(['sales_org']))}&order_by=plant_name`)).data.map(r => r.sales_org)

test('a text column whose every value names a row becomes a link, keeping its values and history', async ({ admin }) => {
  const [first] = await seed(admin, ['1160', '1160', ''])
  await admin.post('/api/save_row', { table: PLANT, row: { ...first, sales_org: '1150' } })
  const response = await turnInto(admin, 'Reference')
  await expectStatus(response, 200)
  expect(await column(admin)).toMatchObject({ column_type: 'Reference', reference_table: ORG })
  expect(await values(admin)).toEqual(['1150', '1160', null])
  const activity = await admin.get<{ versions: { data: unknown }[] }>(`/api/activity/${encodeURIComponent(PLANT)}/${first.row_id}`)
  expect(JSON.stringify(activity.versions)).toContain('1150')
})

test('once it is a link, a value naming no row is refused like any link', async ({ admin }) => {
  await seed(admin, ['1150'])
  await expectStatus(await turnInto(admin, 'Reference'), 200)
  await expect(admin.post('/api/save_row', { table: PLANT, row: { plant_name: 'Plant 9', sales_org: '9999' } }))
    .rejects.toMatchObject({ status: 417 })
})

test('a value with no row refuses the change, naming the value, and the column stays text', async ({ admin }) => {
  await seed(admin, ['1150', '9999', '8888', '9999'])
  const response = await turnInto(admin, 'Reference')
  await expectStatus(response, 417)
  const { error } = await response.json() as { error: { message: string; fields: Record<string, string> } }
  expect(error.fields.sales_org).toMatch(/8888, 9999/)
  expect(error.fields.sales_org).not.toMatch(/1150/)
  expect(await column(admin)).toMatchObject({ column_type: 'Data' })
  expect(await values(admin)).toEqual(['1150', '9999', '8888', '9999'])
})

test('a link column turns back into text, keeping its values', async ({ admin }) => {
  await seed(admin, ['1150', '1160'])
  await expectStatus(await turnInto(admin, 'Reference'), 200)
  const back = await admin.fetch(`/api/table_def/${encodeURIComponent(PLANT)}`, {
    method: 'PUT',
    body: JSON.stringify({ columns: [{ column_name: 'plant_name', label: 'Plant name', column_type: 'Data' }, { ...salesOrg('Data'), reference_table: ORG }] }),
  })
  await expectStatus(back, 200)
  expect(await column(admin)).toMatchObject({ column_type: 'Data' })
  expect((await column(admin))?.reference_table ?? null).toBeNull()
  expect(await values(admin)).toEqual(['1150', '1160'])
})

test('a text column still cannot become a number', async ({ admin }) => {
  await seed(admin, ['1150'])
  const response = await admin.fetch(`/api/table_def/${encodeURIComponent(PLANT)}`, {
    method: 'PUT',
    body: JSON.stringify({ columns: [{ column_name: 'plant_name', label: 'Plant name', column_type: 'Data' }, { ...salesOrg('Data'), column_type: 'Int' }] }),
  })
  await expectStatus(response, 417)
  expect((await response.json()).error.fields.sales_org).toMatch(/column_type cannot change/)
})

test('a link to a settings Table is refused: its rows are not stored as rows', async ({ admin }) => {
  await seed(admin, ['1150'])
  await admin.post('/api/table_def', { name: 'Tcl Prefs', kind: 'settings', columns: [{ column_name: 'home', label: 'Home', column_type: 'Data' }] })
  const response = await admin.fetch(`/api/table_def/${encodeURIComponent(PLANT)}`, {
    method: 'PUT',
    body: JSON.stringify({ columns: [{ column_name: 'plant_name', label: 'Plant name', column_type: 'Data' }, { ...salesOrg('Reference'), reference_table: 'Tcl Prefs' }] }),
  })
  await expectStatus(response, 417)
  expect((await response.json()).error.fields.sales_org).toMatch(/Tcl Prefs rows are not stored here/)
})
