import { expect } from 'vitest'
import { test } from './pg-test'
import { makeTable, grantRole } from './fixtures'
import { changeColumnType } from '../src/table-engine'

const policy = { version: 1, roles: ['Schema Member'], shared_column: 'shared' }
const columns = [
  { column_name: 'title', column_type: 'Data' },
  { column_name: 'shared', column_type: 'Check' },
]

for (const kind of ['settings', 'sub_table']) {
  test(`mandatory privacy refuses ${kind} storage`, async ({ admin }) => {
    await expect(admin.post('/api/table_def', {
      name: 'Invalid Privacy Storage', kind, columns, access_policy: policy,
    })).rejects.toMatchObject({ status: 417, type: 'ValidationError', fields: {
      access_policy: 'Mandatory access requires a local collection',
    } })
  })
}

for (const [column, message] of [
  ['shared_column', 'The shared column must be a Check column'],
  ['inherit_column', 'The inherited access column must be a Reference column'],
]) {
  test(`mandatory privacy refuses a Data column as ${column}`, async ({ admin }) => {
    await expect(admin.post('/api/table_def', {
      name: 'Invalid Privacy Column', columns: [{ column_name: 'title', column_type: 'Data' }],
      access_policy: { version: 1, roles: ['Schema Member'], [column]: 'title' },
    })).rejects.toMatchObject({ status: 417, type: 'ValidationError', fields: { access_policy: message } })
  })
}

for (const [description, replacement] of [
  ['removed', [columns[0]]],
  ['given a public default', [columns[0], { ...columns[1], default_value: '1' }]],
  ['made required', [columns[0], { ...columns[1], reqd: true }]],
  ['changed to Data', [columns[0], { ...columns[1], column_type: 'Data' }]],
] as const) {
  test(`a privacy column cannot be ${description} through a schema update`, async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Immutable Privacy Column', columns, access_policy: policy })
    await expect(admin.put(table.defUrl, { columns: replacement })).rejects.toMatchObject({
      status: 403, type: 'PermissionError', message: expect.stringContaining('Columns that define mandatory access cannot be removed or redefined'),
    })
  })
}

test('a privacy column cannot be renamed through the schema editor', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Privacy Rename Guard', columns, access_policy: policy })
  await expect(admin.post(`${table.defUrl}/rename_column`, { from: 'shared', to: 'published' }))
    .rejects.toMatchObject({ status: 403, type: 'PermissionError', message: expect.stringContaining('A column that defines mandatory access cannot be renamed') })
})

test('a migration cannot change a privacy column type', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Privacy Migration Guard', columns, access_policy: policy })
  await expect(changeColumnType(table.name, 'shared', 'Data')).rejects.toMatchObject({
    type: 'PermissionError', message: 'A column that defines mandatory access cannot change type',
  })
})

test('a schema update with null policy preserves creator privacy', async ({ admin, createUser }) => {
  const table = await makeTable(admin, { name: 'Preserved Privacy', columns, access_policy: policy })
  await grantRole(admin, { table: table.name, role: 'Schema Member', can_read: true, can_create: true })
  const owner = await createUser({ roles: ['Schema Member'] })
  const peer = await createUser({ roles: ['Schema Member'] })
  const row = await owner.post<{ row_id: string }>(table.url, { title: 'Private instructions' })
  await admin.put(table.defUrl, { columns: [...columns, { column_name: 'summary', column_type: 'Text' }], access_policy: null })
  expect(await owner.get(table.rowUrl(row.row_id))).toMatchObject({ title: 'Private instructions' })
  await expect(peer.get(table.rowUrl(row.row_id))).rejects.toMatchObject({ status: 403, type: 'PermissionError' })
  expect(await peer.get(table.listUrl({ fields: ['row_id'] }))).toMatchObject({ total: 0, data: [] })
})

test('a row requiring inherited privacy cannot be created without its parent', async ({ admin, createUser }) => {
  const parent = await makeTable(admin, { name: 'Inherited Privacy Parent', columns, access_policy: policy })
  const child = await makeTable(admin, {
    name: 'Inherited Privacy Detail',
    columns: [{ column_name: 'parent_row', column_type: 'Reference', reference_table: parent.name }],
    access_policy: { version: 1, roles: ['Schema Member'], inherit_column: 'parent_row' },
  })
  await grantRole(admin, { table: child.name, role: 'Schema Member', can_read: true, can_create: true })
  const member = await createUser({ roles: ['Schema Member'] })
  await expect(member.post(child.url, {})).rejects.toMatchObject({ status: 403, type: 'PermissionError' })
  expect(await member.get(child.listUrl({ fields: ['row_id'] }))).toMatchObject({ total: 0, data: [] })
})
