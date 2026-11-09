import { expect } from 'vitest'
import { test } from './pg-test'
import { expectRefused, grantRole, makeTable } from './fixtures'

test('a reference to a private embedded row is checked against its parent creator', async ({ admin, createUser }) => {
  const lines = await makeTable(admin, { name: 'Private Ref Line', kind: 'sub_table', columns: ['note'] })
  const parent = await makeTable(admin, { name: 'Private Ref Parent', access_policy: { version: 1, roles: ['Ref Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check', { column_name: 'lines', column_type: 'Sub-table', row_table: lines.name }] })
  const reference = await makeTable(admin, { name: 'Private Ref Pointer', columns: [{ column_name: 'line', column_type: 'Reference', reference_table: lines.name }] })
  await grantRole(admin, { table: [parent.name, lines.name, reference.name], role: 'Ref Member', can_read: true, can_create: true, can_write: true })
  const creator = await createUser({ roles: ['Ref Member'] })
  const peer = await createUser({ roles: ['Ref Member'] })
  const record = await creator.post<{ lines: { row_id: string }[] }>(parent.url, { title: 'Private instructions', lines: [{ note: 'Creator-only step' }] })
  const line = record.lines[0].row_id
  await expectRefused(peer.post(reference.url, { line }), 403, 'This work is not available to you')
  expect(await creator.post(reference.url, { line })).toMatchObject({ line })
})

test('a missing protected reference does not reveal whether private work exists', async ({ admin, createUser }) => {
  const target = await makeTable(admin, { name: 'Private Missing Target', access_policy: { version: 1, roles: ['Missing Ref Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  const pointer = await makeTable(admin, { name: 'Private Missing Pointer', columns: [{ column_name: 'target', column_type: 'Reference', reference_table: target.name }] })
  await grantRole(admin, { table: [target.name, pointer.name], role: 'Missing Ref Member', can_read: true, can_create: true })
  const owner = await createUser({ roles: ['Missing Ref Member'] })
  await expectRefused(owner.post(pointer.url, { target: 'not-a-private-row' }), 403, 'This work is not available to you')
  expect(await owner.get(pointer.listUrl({ fields: ['row_id'] }))).toMatchObject({ total: 0, data: [] })
})
