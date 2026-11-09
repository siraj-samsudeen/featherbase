// #881: a link to a row of any Table. A Decision names the exact records it
// shapes, in different Tables: a Table column (a link to Table) says which
// Table, and a row column bound to it says which row of it.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { expectRefused, expectStatus, grantRole, makeTable } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

const PLANT = 'Atl Plant'
const UNIT = 'Atl Business Unit'
const OTHER = 'Atl Other'
const DECISION = 'Atl Decision'
const url = (table: string) => `/api/table/${encodeURIComponent(table)}`
const row = (table: string, id: string) => `${url(table)}/${encodeURIComponent(id)}`

const shapes = (choices = `${PLANT}\n${UNIT}`) => [
  { column_name: 'title', column_type: 'Data' },
  { column_name: 'shapes_table', label: 'Shapes Table', column_type: 'Reference', reference_table: 'Table' },
  { column_name: 'shapes', label: 'Shapes', column_type: 'Reference', table_column: 'shapes_table', choices },
]

async function setup(admin: TestClient) {
  await makeTable(admin, { name: PLANT, id_pattern: 'prompt', columns: ['city'] })
  await makeTable(admin, { name: UNIT, id_pattern: 'prompt', columns: ['label'] })
  await makeTable(admin, { name: OTHER, id_pattern: 'prompt', columns: ['note'] })
  await admin.post('/api/save_row', { table: PLANT, row: { row_id: '8151', city: 'Palakkad' } })
  await admin.post('/api/save_row', { table: UNIT, row: { row_id: 'PKN-GOLD', label: 'Gold' } })
  await admin.post('/api/save_row', { table: OTHER, row: { row_id: 'x1' } })
  await makeTable(admin, { name: DECISION, columns: shapes() })
}

const decide = (client: TestClient, values: Record<string, unknown>) =>
  client.post<{ row_id: string } & Record<string, unknown>>('/api/save_row', { table: DECISION, row: { title: 'Close the plant', ...values } })

describe('a column that links to a row of any Table', () => {
  test('links rows of two different Tables, each checked to exist', async ({ admin }) => {
    await setup(admin)
    const plant = await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    const unit = await decide(admin, { shapes_table: UNIT, shapes: 'PKN-GOLD' })
    expect([plant.shapes_table, plant.shapes, unit.shapes_table, unit.shapes]).toEqual([PLANT, '8151', UNIT, 'PKN-GOLD'])
    // The row half alone means nothing: PKN-GOLD is not a Plant.
    await expect(decide(admin, { shapes_table: PLANT, shapes: 'PKN-GOLD' }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: `${PLANT} PKN-GOLD does not exist` } })
  })

  test('refuses a row without its Table, and a Table the column does not allow', async ({ admin }) => {
    await setup(admin)
    await expect(decide(admin, { shapes: '8151' }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: 'Choose its Table first' } })
    await expect(decide(admin, { shapes_table: OTHER, shapes: 'x1' }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: `${OTHER} is not one of the Tables this column links to` } })
    // A Table with no row linked yet is fine: the Table is chosen first.
    expect((await decide(admin, { shapes_table: PLANT })).shapes).toBeNull()
  })

  test('with no allowed Tables listed, links any stored Table', async ({ admin }) => {
    await setup(admin)
    await makeTable(admin, { name: `${DECISION} Any`, columns: shapes('') })
    const saved = await admin.post<Record<string, unknown>>('/api/save_row', { table: `${DECISION} Any`, row: { shapes_table: OTHER, shapes: 'x1' } })
    expect(saved).toMatchObject({ shapes_table: OTHER, shapes: 'x1' })
  })

  test('only a stored Table can be allowed, and the Table column must be a link to Table', async ({ admin }) => {
    await setup(admin)
    await makeTable(admin, { name: 'Atl Line', kind: 'sub_table', columns: ['note'] })
    await expect(makeTable(admin, { name: 'Atl Bad 1', columns: shapes('Atl Line') }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: 'Atl Line cannot be a link target: only a stored Table\'s rows can be' } })
    await expect(makeTable(admin, { name: 'Atl Bad 2', columns: shapes('Atl Nowhere') }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: 'Link target Atl Nowhere does not exist' } })
    await expect(makeTable(admin, { name: 'Atl Bad 3', columns: [
      { column_name: 'kind', column_type: 'Data' },
      { column_name: 'shapes', column_type: 'Reference', table_column: 'kind' },
    ] })).rejects.toMatchObject({ status: 417, fields: { shapes: 'kind must be a link to Table in this Table' } })
  })

  test("refuses a link to a row the person saving can't read, without naming it", async ({ admin, createUser }) => {
    await setup(admin)
    await grantRole(admin, { role: 'Atl Clerk', table: [DECISION, UNIT], can_read: true, can_write: true, can_create: true })
    const clerk = await createUser({ roles: ['Atl Clerk'] })
    await expect(decide(clerk, { shapes_table: PLANT, shapes: '8151' }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: `${PLANT} 8151 does not exist` } })
    expect(await decide(clerk, { shapes_table: UNIT, shapes: 'PKN-GOLD' })).toMatchObject({ shapes: 'PKN-GOLD' })
    // A link someone else made stays when the clerk changes something else.
    const made = await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    const loaded = await clerk.get<{ updated_at: string }>(row(DECISION, made.row_id))
    expect(await clerk.fetch(row(DECISION, made.row_id), { method: 'PATCH', body: JSON.stringify({ title: 'Keep the plant', updated_at: loaded.updated_at }) }))
      .toMatchObject({ status: 200 })
  })

  test('a linked row cannot be deleted, and says which row links to it', async ({ admin }) => {
    await setup(admin)
    const decision = await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    await expect(admin.delete(row(PLANT, '8151')))
      .rejects.toThrow(`Cannot delete ${PLANT} 8151: it is linked from ${DECISION} ${decision.row_id}`)
    // A row of another Table with the same id is not linked.
    await admin.post('/api/save_row', { table: OTHER, row: { row_id: '8151' } })
    await admin.delete(row(OTHER, '8151'))
  })

  test("a row's new id carries its links along", async ({ admin }) => {
    await setup(admin)
    const decision = await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    await admin.post(`${row(PLANT, '8151')}:rename`, { new_name: '8152' })
    expect(await admin.get(row(DECISION, decision.row_id))).toMatchObject({ shapes_table: PLANT, shapes: '8152' })
  })

  test("a Table's new name carries its links and the column's allowed Tables along", async ({ admin }) => {
    await setup(admin)
    const decision = await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    await admin.post(`/api/table_def/${encodeURIComponent(PLANT)}/rename`, { to: 'Atl Site' })
    expect(await admin.get(row(DECISION, decision.row_id))).toMatchObject({ shapes_table: 'Atl Site', shapes: '8151' })
    const meta = await admin.get<{ columns: { column_name: string; choices: string | null }[] }>(`${url(DECISION)}:meta`)
    expect(meta.columns.find((c) => c.column_name === 'shapes')?.choices).toBe(`Atl Site\n${UNIT}`)
    expect(await decide(admin, { shapes_table: 'Atl Site', shapes: '8151' })).toMatchObject({ shapes: '8151' })
  })

  test('renaming the Table column keeps the pair', async ({ admin }) => {
    await setup(admin)
    await admin.post(`/api/table_def/${encodeURIComponent(DECISION)}/rename_column`, { from: 'shapes_table', to: 'shapes_kind' })
    expect(await decide(admin, { shapes_kind: PLANT, shapes: '8151' })).toMatchObject({ shapes_kind: PLANT, shapes: '8151' })
  })

  test('a Table that a link allows, or that a link points into, cannot be deleted', async ({ admin }) => {
    await setup(admin)
    await expectStatus(await admin.fetch(`/api/table_def/${encodeURIComponent(PLANT)}`, { method: 'DELETE' }), 417)
    await makeTable(admin, { name: `${DECISION} Any`, columns: shapes('') })
    const linked = await admin.post<{ row_id: string }>('/api/save_row', { table: `${DECISION} Any`, row: { shapes_table: OTHER, shapes: 'x1' } })
    const refused = await admin.fetch(`/api/table_def/${encodeURIComponent(OTHER)}`, { method: 'DELETE' })
    expect([refused.status, ((await refused.json()) as { error: { message: string } }).error.message])
      .toEqual([417, `Cannot delete ${OTHER}: referenced by ${DECISION} Any.shapes`])
    // With the link removed, the Table goes; the row that named it stays.
    const loaded = await admin.get<{ updated_at: string }>(row(`${DECISION} Any`, linked.row_id))
    await admin.fetch(row(`${DECISION} Any`, linked.row_id), { method: 'PATCH', body: JSON.stringify({ shapes: null, updated_at: loaded.updated_at }) })
    await expectStatus(await admin.fetch(`/api/table_def/${encodeURIComponent(OTHER)}`, { method: 'DELETE' }), 200)
    expect(await admin.get(row(`${DECISION} Any`, linked.row_id))).toMatchObject({ shapes_table: null, shapes: null })
  })

  test('a link added to an existing Table, and the Tables a link can never name', async ({ admin }) => {
    await setup(admin)
    await makeTable(admin, { name: 'Atl Line', kind: 'sub_table', columns: ['note'] })
    await makeTable(admin, { name: 'Atl Later', columns: ['title'] })
    const meta = await admin.get<{ columns: Record<string, unknown>[] }>(`${url('Atl Later')}:meta`)
    await admin.put(`/api/table_def/${encodeURIComponent('Atl Later')}`, { columns: [...meta.columns, ...shapes('').slice(1)] })
    const save = (values: Record<string, unknown>) => admin.post<Record<string, unknown>>('/api/save_row', { table: 'Atl Later', row: values })
    expect(await save({ shapes_table: PLANT, shapes: '8151' })).toMatchObject({ shapes: '8151' })
    await expect(save({ shapes_table: '', shapes: '8151' }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: 'Choose its Table first' } })
    await expect(save({ shapes_table: 'Atl Line', shapes: '8151' }))
      .rejects.toMatchObject({ status: 417, fields: { shapes: 'Atl Line cannot be linked to' } })
    // The Table column here is a link to Table, so it can't name a missing one.
    await expectRefused(save({ shapes_table: 'Atl Nowhere', shapes: '8151' }), 417)
  })

  test('a link column takes its Table only from a plain link to Table', async ({ admin }) => {
    await expect(makeTable(admin, { name: 'Atl Bad 4', columns: [
      { column_name: 'shapes_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'shapes', column_type: 'Data', table_column: 'shapes_table' },
    ] })).rejects.toMatchObject({ status: 417, fields: { shapes: 'Only a link column without a target Table can take its Table from another column' } })
    await expect(makeTable(admin, { name: 'Atl Bad 5', columns: [
      { column_name: 'shapes', column_type: 'Reference', table_column: 'shapes' },
    ] })).rejects.toMatchObject({ status: 417, fields: { shapes: 'shapes must be a link to Table in this Table' } })
  })

  test("a link held in a Sub-table's row names the row that owns it", async ({ admin }) => {
    await setup(admin)
    await makeTable(admin, { name: 'Atl Step', kind: 'sub_table', columns: shapes() })
    await makeTable(admin, { name: 'Atl Plan', columns: [{ column_name: 'steps', column_type: 'Sub-table', row_table: 'Atl Step' }] })
    const plan = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Atl Plan', row: { steps: [{ title: 'Close', shapes_table: PLANT, shapes: '8151' }] } })
    await expect(admin.delete(row(PLANT, '8151')))
      .rejects.toThrow(`Cannot delete ${PLANT} 8151: it is linked from Atl Plan ${plan.row_id}`)
  })

  test('a Table holding links can itself be deleted', async ({ admin }) => {
    await setup(admin)
    await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    await expectStatus(await admin.fetch(`/api/table_def/${encodeURIComponent(DECISION)}`, { method: 'DELETE' }), 200)
    await admin.delete(row(PLANT, '8151'))
  })

  test('a link set later, on a row saved without one, is checked the same', async ({ admin }) => {
    await setup(admin)
    const empty = await decide(admin, {})
    const patch = async (values: Record<string, unknown>) => {
      const loaded = await admin.get<{ updated_at: string }>(row(DECISION, empty.row_id))
      return admin.fetch(row(DECISION, empty.row_id), { method: 'PATCH', body: JSON.stringify({ ...values, updated_at: loaded.updated_at }) })
    }
    await expectStatus(await patch({ shapes_table: PLANT, shapes: 'PKN-GOLD' }), 417)
    await expectStatus(await patch({ shapes_table: PLANT, shapes: '8151' }), 200)
    expect(await admin.get(row(DECISION, empty.row_id))).toMatchObject({ shapes_table: PLANT, shapes: '8151' })
    // The same row id in another Table is another row, checked afresh.
    await expectStatus(await patch({ shapes_table: UNIT }), 417)
    await admin.post('/api/save_row', { table: UNIT, row: { row_id: '8151', label: 'Palakkad unit' } })
    await expectStatus(await patch({ shapes_table: UNIT }), 200)
  })

  test("the linked row's Connections count the rows linking to it, in a Table or in a Sub-table", async ({ admin, createUser }) => {
    await setup(admin)
    await makeTable(admin, { name: 'Atl Step', kind: 'sub_table', columns: shapes() })
    await makeTable(admin, { name: 'Atl Plan', columns: [{ column_name: 'steps', column_type: 'Sub-table', row_table: 'Atl Step' }] })
    await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    await decide(admin, { shapes_table: PLANT, shapes: '8151' })
    await decide(admin, { shapes_table: UNIT, shapes: 'PKN-GOLD' })
    const plan = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Atl Plan', row: { steps: [{ title: 'Close', shapes_table: PLANT, shapes: '8151' }] } })
    await admin.post('/api/save_row', { table: 'Atl Plan', row: { steps: [{ title: 'Grow', shapes_table: UNIT, shapes: 'PKN-GOLD' }] } })
    type Connection = { table: string; column: string; via: string | null; count: number; filters: unknown[] }
    const connections = (await admin.get<{ connections: Connection[] }>(`${row(PLANT, '8151')}:connections`)).connections
    const decisions = connections.find((c) => c.table === DECISION && c.column === 'shapes')!
    const plans = connections.find((c) => c.table === 'Atl Plan' && c.via === 'Atl Step')!
    expect([decisions.count, plans.count]).toEqual([2, 1])
    // A link allowing any Table may point here too, though none does yet.
    await makeTable(admin, { name: `${DECISION} Any`, columns: shapes('') })
    const withAny = (await admin.get<{ connections: Connection[] }>(`${row(PLANT, '8151')}:connections`)).connections
    expect(withAny.find((c) => c.table === `${DECISION} Any`)?.count).toBe(0)
    // A row no link can point at (a settings Table's) lists none of them.
    const settings = (await admin.get<{ connections: Connection[] }>(`${row('System Settings', 'System Settings')}:connections`)).connections
    expect(settings.filter((c) => c.column === 'shapes')).toEqual([])
    // Each connection's filters open exactly those rows.
    const listed = await admin.get<{ data: { row_id: string }[] }>(`${url('Atl Plan')}?filters=${encodeURIComponent(JSON.stringify(plans.filters))}`)
    expect(listed.data.map((r) => r.row_id)).toEqual([plan.row_id])
    // Someone who can't read Decisions doesn't see them counted.
    await grantRole(admin, { role: 'Atl Plant Reader', table: PLANT, can_read: true })
    const reader = await createUser({ roles: ['Atl Plant Reader'] })
    const theirs = (await reader.get<{ connections: Connection[] }>(`${row(PLANT, '8151')}:connections`)).connections
    expect(theirs.filter((c) => c.column === 'shapes')).toEqual([])
  })
})
