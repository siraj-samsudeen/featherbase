import { expect } from 'vitest'
import { test } from './pg-test'
import { expectRefused, expectStatus, grantRole, makeTable } from './fixtures'
import { eventVisibleTo } from '../src/realtime'
import { deleteStored } from '../src/storage'
import { assertMandatoryAccess, hasMandatoryRowAccess, needsMandatoryRowRead } from '../src/mandatory-access'
import { getMeta } from '../src/meta'

test('creator privacy hides a row from administrators, other members and their lists', async ({ admin, createUser }) => {
  const table = await makeTable(admin, {
    name: 'Private Notebook',
    access_policy: { version: 1, roles: ['Notebook Member'], shared_column: 'shared' },
    columns: ['title', 'shared:Check'],
  })
  await grantRole(admin, { table: table.name, role: 'Notebook Member', can_read: true, can_create: true, can_write: true })
  const owner = await createUser({ roles: ['Notebook Member'] })
  const peer = await createUser({ roles: ['Notebook Member'] })
  const manager = await createUser({ roles: ['System Manager', 'Notebook Member'] })
  const row = await owner.post<Record<string, unknown>>('/api/save_row', { table: table.name, row: { title: 'Private draft', created_by: 'Administrator' } })
  expect(await owner.get(table.rowUrl(String(row.row_id)))).toMatchObject({ title: 'Private draft', created_by: owner.user })
  const capabilities = `${table.rowUrl(String(row.row_id))}:capabilities`
  expect(await owner.get(capabilities)).toMatchObject({ write: true })
  for (const other of [admin, peer, manager]) {
    await expectRefused(other.get(table.rowUrl(String(row.row_id))), 403)
    await expectRefused(other.get(capabilities), 403)
    await expectRefused(other.post('/api/save_row', { table: table.name, row: { row_id: row.row_id, updated_at: row.updated_at, title: 'Changed' } }), 403)
  }
  expect(await peer.get(table.listUrl({ fields: ['row_id', 'title'] }))).toMatchObject({ total: 0, data: [] })
  expect(await manager.get(table.listUrl({ fields: ['row_id', 'title'] }))).toMatchObject({ total: 0, data: [] })
  await expectRefused(admin.delete(table.defUrl), 403)
  expect(await eventVisibleTo(manager.user!, { channel: `list:${table.name}`, event: 'updated', payload: { table: table.name, row_id: row.row_id } })).toBe(false)
})

test('private attachments and activity stay private even through administrator lists', async ({ admin, createUser }) => {
  const table = await makeTable(admin, {
    name: 'Private Journal',
    access_policy: { version: 1, roles: ['Journal Member'], shared_column: 'shared' },
    columns: ['title', 'shared:Check'],
  })
  await grantRole(admin, { table: [table.name, 'Comment'], role: 'Journal Member', can_read: true, can_create: true, can_write: true })
  const owner = await createUser({ roles: ['Journal Member'] })
  const row = await owner.post<Record<string, unknown>>('/api/save_row', { table: table.name, row: { title: 'Draft instructions' } })
  const comment = await owner.post<Record<string, unknown>>('/api/save_row', { table: 'Comment', row: { ref_table: table.name, ref_name: row.row_id, content: 'Private answer' } })
  await expectRefused(admin.get(`/api/table/Comment/${comment.row_id}`), 403)
  const query = new URLSearchParams({ filters: JSON.stringify([['ref_table', '=', table.name]]), fields: JSON.stringify(['row_id', 'content']) })
  expect(await admin.get(`/api/table/Comment?${query}`)).toMatchObject({ total: 0, data: [] })
  await expectRefused(admin.get(`/api/activity/${encodeURIComponent(table.name)}/${row.row_id}`), 403)
  await owner.post('/api/save_row', { table: table.name, row: { row_id: row.row_id, updated_at: row.updated_at, title: 'Updated private instructions' } })
  const feed = await admin.get<{ items: { sub?: string }[] }>('/api/activity_feed?scope=team')
  expect(feed.items.filter(item => item.sub === table.name)).toEqual([])
})

test('dependent rows inherit privacy and become visible when their parent is shared', async ({ admin, createUser }) => {
  const parent = await makeTable(admin, { name: 'Private Dossier', access_policy: { version: 1, roles: ['Dossier Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  const child = await makeTable(admin, { name: 'Dossier Note', access_policy: { version: 1, roles: ['Dossier Member'], inherit_column: 'dossier' }, columns: ['body', { column_name: 'dossier', column_type: 'Reference', reference_table: parent.name, reqd: true }] })
  await grantRole(admin, { table: [parent.name, child.name], role: 'Dossier Member', can_read: true, can_write: true, can_create: true })
  const owner = await createUser({ roles: ['Dossier Member'] })
  const peer = await createUser({ roles: ['Dossier Member'] })
  const row = await owner.post<Record<string, unknown>>(parent.url, { title: 'Private notes' })
  const note = await owner.post<Record<string, unknown>>(child.url, { body: 'First note', dossier: row.row_id })
  await expectRefused(peer.get(child.rowUrl(String(note.row_id))), 403)
  expect(await peer.get(child.listUrl({ fields: ['row_id'] }))).toMatchObject({ total: 0, data: [] })
  await owner.post('/api/save_row', { table: parent.name, row: { row_id: row.row_id, updated_at: row.updated_at, shared: true } })
  expect(await peer.get(child.rowUrl(String(note.row_id)))).toMatchObject({ body: 'First note' })
  expect(await peer.get(child.listUrl({ fields: ['row_id'] }))).toMatchObject({ total: 1, data: [{ row_id: note.row_id }] })
  const peerDraft = await peer.post<Record<string, unknown>>(parent.url, { title: 'Peer private draft' })
  await expectRefused(owner.post('/api/save_row', { table: child.name, row: { row_id: note.row_id, updated_at: note.updated_at, dossier: peerDraft.row_id } }), 403)
  const publicParent = await makeTable(admin, { name: 'Public Dossier', columns: ['title'] })
  await expectRefused(admin.put(child.defUrl, { columns: [{ column_name: 'body', column_type: 'Data' }, { column_name: 'dossier', column_type: 'Reference', reference_table: publicParent.name, reqd: true }] }), 403)
})

test('an individual share neither overrides privacy nor exposes its private target to administrators', async ({ admin, createUser }) => {
  const table = await makeTable(admin, { name: 'Private Brief', access_policy: { version: 1, roles: ['Brief Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  await grantRole(admin, { table: table.name, role: 'Brief Member', can_read: true, can_create: true, can_write: true })
  const owner = await createUser({ roles: ['System Manager', 'Brief Member'] })
  const peer = await createUser({ roles: ['Brief Member'] })
  const row = await owner.post<Record<string, unknown>>(table.url, { title: 'Private brief' })
  const share = await owner.post<Record<string, unknown>>('/api/save_row', { table: 'Share', row: { share_table: table.name, share_name: row.row_id, person: peer.user, read: true, write: true } })
  await expectRefused(peer.get(table.rowUrl(String(row.row_id))), 403)
  await expectRefused(peer.post('/api/save_row', { table: table.name, row: { row_id: row.row_id, updated_at: row.updated_at, title: 'Attempt' } }), 403)
  await expectRefused(admin.get(`/api/table/Share/${share.row_id}`), 403)
  expect(await admin.get(`/api/table/Share?filters=${encodeURIComponent(JSON.stringify([['share_table', '=', table.name]]))}`)).toMatchObject({ total: 0, data: [] })
})

test('removing membership refuses the next request in the same session', async ({ admin, createUser }) => {
  const table = await makeTable(admin, { name: 'Members Board', access_policy: { version: 1, roles: ['Board Member'] }, columns: ['title'] })
  await grantRole(admin, { table: table.name, role: 'Board Member', can_read: true, can_create: true, can_write: true })
  const member = await createUser({ roles: ['Board Member'] })
  const row = await member.post<Record<string, unknown>>(table.url, { title: 'Shared agenda' })
  const person = await admin.get<Record<string, unknown>>(`/api/table/Person/${member.user}`)
  await admin.post('/api/save_row', { table: 'Person', row: { row_id: member.user, updated_at: person.updated_at, roles: [] } })
  await expectRefused(member.get(table.rowUrl(String(row.row_id))), 403)
  await expectRefused(member.post('/api/save_row', { table: table.name, row: { row_id: row.row_id, updated_at: row.updated_at, title: 'Changed' } }), 403)
  expect(await eventVisibleTo(member.user!, { channel: `list:${table.name}`, event: 'updated', payload: { table: table.name, row_id: row.row_id } })).toBe(false)
})

test('administrators cannot weaken an existing privacy policy through the schema editor', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Protected Schema', access_policy: { version: 1, roles: ['Schema Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  await expectRefused(admin.put(table.defUrl, { name: table.name, access_policy: { version: 1, roles: ['System Manager'] }, columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'shared', column_type: 'Check' }] }), 403)
})

test('a public-bucket attachment on private work still requires its creator session', async ({ admin, createUser, api }) => {
  const table = await makeTable(admin, { name: 'Private Attachment', access_policy: { version: 1, roles: ['Attachment Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  await grantRole(admin, { table: table.name, role: 'Attachment Member', can_read: true, can_create: true })
  const owner = await createUser({ roles: ['System Manager', 'Attachment Member'] })
  const row = await owner.post<Record<string, unknown>>(table.url, { title: 'Private instructions' })
  const form = new FormData()
  form.append('file', new File(['Creator only'], 'private-notes.txt', { type: 'text/plain' }))
  form.append('ref_table', table.name)
  form.append('ref_name', String(row.row_id))
  const upload = await owner.fetch('/api/upload_file', { method: 'POST', body: form })
  await expectStatus(upload, 201)
  const file = await upload.json() as { file_url: string }
  try {
    await expectStatus(await owner.fetch(file.file_url), 200)
    await expectStatus(await admin.fetch(file.file_url), 403)
    await expectStatus(await api.fetch(file.file_url), 401)
    await expectRefused(admin.get(`/api/signed_url?file_url=${encodeURIComponent(file.file_url)}`), 403)
  } finally {
    // The SQL sandbox rolls back rows; uploaded bytes live outside Postgres.
    await deleteStored(file.file_url)
  }
})

test('sub-table lists inherit mandatory privacy even for administrators', async ({ admin, createUser }) => {
  const lines = await makeTable(admin, { name: 'Private Notebook Line', kind: 'sub_table', columns: ['note'] })
  const books = await makeTable(admin, { name: 'Private Notebook Parent', access_policy: { version: 1, roles: ['Notebook Parent Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check', { column_name: 'lines', column_type: 'Sub-table', row_table: lines.name }] })
  await grantRole(admin, { table: [books.name, lines.name], role: 'Notebook Parent Member', can_read: true, can_create: true })
  const owner = await createUser({ roles: ['Notebook Parent Member'] })
  const peer = await createUser({ roles: ['Notebook Parent Member'] })
  await owner.post(books.url, { title: 'Private book', lines: [{ note: 'Private embedded note' }] })
  for (const viewer of [admin, peer])
    expect(await viewer.get(lines.listUrl({ fields: ['row_id', 'note'] }))).toMatchObject({ total: 0, data: [] })
})

test('a reference write cannot probe or link another creator’s private row', async ({ admin, createUser }) => {
  const target = await makeTable(admin, { name: 'Private Reference Target', access_policy: { version: 1, roles: ['Reference Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  const link = await makeTable(admin, { name: 'Public Reference Holder', columns: [{ column_name: 'target', column_type: 'Reference', reference_table: target.name }] })
  await grantRole(admin, { table: [target.name, link.name], role: 'Reference Member', can_read: true, can_create: true })
  const owner = await createUser({ roles: ['Reference Member'] })
  const peer = await createUser({ roles: ['Reference Member'] })
  const row = await owner.post<Record<string, unknown>>(target.url, { title: 'Private target' })
  for (const id of [row.row_id, 'missing-private-row'])
    await expectRefused(peer.post(link.url, { target: id }), 403)
})

test('members can choose teammates by name without broad Person access', async ({ admin, createUser }) => {
  const table = await makeTable(admin, { name: 'Team Notes', access_policy: { version: 1, roles: ['Notes Member'] }, columns: ['title'] })
  await grantRole(admin, { table: table.name, role: 'Notes Member', can_read: true })
  const member = await createUser({ roles: ['Notes Member'], fullName: 'Asha Patel' })
  const teammate = await createUser({ roles: ['Notes Member'], fullName: 'Ravi Shah' })
  const outsider = await createUser({ roles: [], fullName: 'Outside Person' })
  const url = `/api/table_members/${encodeURIComponent(table.name)}`
  expect(await member.get(url)).toEqual({ data: [
    { row_id: member.user, full_name: 'Asha Patel' },
    { row_id: teammate.user, full_name: 'Ravi Shah' },
  ] })
  await expectRefused(outsider.get(url), 403)
  await expectRefused(admin.get(url), 403)
})

test('rows that record a reference (a Share) are always read under mandatory access', async () => {
  expect(await needsMandatoryRowRead('Share')).toBe(true)
})

test('a chain of parents deeper than eight stops: the read answers, the check refuses', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Deep Private', access_policy: { version: 1, roles: ['Deep Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  expect(await hasMandatoryRowAccess(table.name, 'any', 9)).toBe(true)
  await expect(assertMandatoryAccess('Administrator', await getMeta(table.name), { row_id: 'any' }, 9)).rejects.toMatchObject({ type: 'PermissionError' })
})

test('a Share or a dependent row naming a protected row that does not exist is refused', async ({ admin, createUser }) => {
  const parent = await makeTable(admin, { name: 'Gone Dossier', access_policy: { version: 1, roles: ['Gone Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  const child = await makeTable(admin, { name: 'Gone Note', access_policy: { version: 1, roles: ['Gone Member'], inherit_column: 'dossier' }, columns: ['body', { column_name: 'dossier', column_type: 'Reference', reference_table: parent.name }] })
  await expect(assertMandatoryAccess('Administrator', await getMeta('Share'), { share_table: parent.name, share_name: 'no-such-row' }))
    .rejects.toMatchObject({ type: 'PermissionError' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Gone Member' } })
  const member = await createUser({ roles: ['Gone Member'] })
  await expect(assertMandatoryAccess(member.user!, await getMeta(child.name), { row_id: 'n1', dossier: 'no-such-dossier' }))
    .rejects.toMatchObject({ type: 'PermissionError' })
})
