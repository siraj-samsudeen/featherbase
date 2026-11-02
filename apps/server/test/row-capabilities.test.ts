import { describe, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from './pg-test'
import { expectApiError, grantRole, makeTable, patchDoc, tableRef } from './fixtures'

const DT = 'Cap800 Document'
const rows = tableRef(DT)
const capabilities = (id: string) => `${rows.rowUrl(id)}:capabilities`
const readerCapabilities = {
  write: false, rename: false, delete: false, submit: false, cancel: false,
  amend: false, assign: false, tag: true, comment: false, upload: false,
}

describe('#800 row action capabilities', () => {
  test('a reader receives only actions their explicit grants allow', async ({ admin, createUser }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    await grantRole(admin, { role: 'Cap800 Reader', table: DT, tier: 'basic', can_read: true })
    const reader = await createUser({ roles: ['Cap800 Reader'] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Read only' } })
    expect(await reader.get(capabilities(row.row_id))).toEqual(readerCapabilities)
  })

  test('own-row mutation grants apply to owned rows, not other readable rows', async ({ admin, createUser }) => {
    await makeTable(admin, { name: DT, columns: ['title'], is_submittable: true })
    await grantRole(admin, { role: 'Cap800 Read All', table: DT, tier: 'basic', can_read: true })
    await grantRole(admin, {
      role: 'Cap800 Own Writer', table: DT, tier: 'basic', own_rows_only: true,
      can_create: true, can_write: true, can_delete: true, can_submit: true, can_cancel: true, can_amend: true,
    })
    const user = await createUser({ roles: ['Cap800 Read All', 'Cap800 Own Writer'] })
    const own = await user.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Mine' } })
    const other = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Not mine' } })
    expect(await user.get(capabilities(own.row_id))).toEqual({
      ...readerCapabilities, write: true, rename: true, delete: true, submit: true,
    })
    expect(await user.get(capabilities(other.row_id))).toEqual(readerCapabilities)
    await expectApiError(user.post(`${rows.rowUrl(other.row_id)}:rename`, { new_name: 'cap800-stolen' }), { status: 403 })
    await expectApiError(user.delete(rows.rowUrl(other.row_id)), { status: 403 })
    await expectApiError(user.post(`${rows.rowUrl(other.row_id)}:submit`), { status: 403 })
    expect(await user.post<{ row_id: string }>(`${rows.rowUrl(own.row_id)}:rename`, { new_name: 'cap800-owned' }))
      .toMatchObject({ row_id: 'cap800-owned' })
    await user.post(`${rows.rowUrl('cap800-owned')}:submit`)
    await admin.post(`${rows.rowUrl(other.row_id)}:submit`)
    expect(await user.get(capabilities('cap800-owned'))).toMatchObject({ write: false, delete: false, submit: false, cancel: true, amend: false })
    expect(await user.get(capabilities(other.row_id))).toMatchObject({ write: false, delete: false, submit: false, cancel: false, amend: false })
    await expectApiError(user.post(`${rows.rowUrl(other.row_id)}:cancel`), { status: 403 })
    await user.post(`${rows.rowUrl('cap800-owned')}:cancel`)
    await admin.post(`${rows.rowUrl(other.row_id)}:cancel`)
    expect(await user.get(capabilities('cap800-owned'))).toMatchObject({ write: false, submit: false, cancel: false, amend: true })
    expect(await user.get(capabilities(other.row_id))).toMatchObject({ write: false, submit: false, cancel: false, amend: false })
    await expectApiError(user.post(`${rows.rowUrl(other.row_id)}:amend`), { status: 403 })
    expect(await user.post(`${rows.rowUrl('cap800-owned')}:amend`)).toMatchObject({ status: 'draft', amended_from: 'cap800-owned' })
  })

  test('read and write shares refresh the descriptor but never grant rename or lifecycle rights', async ({ admin, createUser }) => {
    await makeTable(admin, { name: DT, columns: ['title'], is_submittable: true })
    const user = await createUser({ roles: [] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Shared' } })
    const share = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Share', row: { share_table: DT, share_name: row.row_id, person: user.user, read: true },
    })
    const shareUrl = tableRef('Share').rowUrl(share.row_id)
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
    await expectApiError(patchDoc(user, rows.rowUrl(row.row_id), { ...await user.get(rows.rowUrl(row.row_id)), title: 'Forbidden' }), { status: 403 })
    await patchDoc(admin, shareUrl, { ...await admin.get(shareUrl), write: true })
    expect(await user.get(capabilities(row.row_id))).toEqual({ ...readerCapabilities, write: true })
    await patchDoc(user, rows.rowUrl(row.row_id), { ...await user.get(rows.rowUrl(row.row_id)), title: 'Edited by share' })
    expect(await admin.get(rows.rowUrl(row.row_id))).toMatchObject({ title: 'Edited by share' })
    await expectApiError(user.post(`${rows.rowUrl(row.row_id)}:rename`, { new_name: 'cap800-share-rename' }), { status: 403 })
    await expectApiError(user.delete(rows.rowUrl(row.row_id)), { status: 403 })
    await expectApiError(user.post(`${rows.rowUrl(row.row_id)}:submit`), { status: 403 })
    await patchDoc(admin, shareUrl, { ...await admin.get(shareUrl), write: false })
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
    await patchDoc(admin, shareUrl, { ...await admin.get(shareUrl), read: false })
    const normal = await user.fetch(rows.rowUrl(row.row_id))
    const descriptor = await user.fetch(capabilities(row.row_id))
    expect(descriptor.status).toBe(403)
    expect(descriptor.status).toBe(normal.status)
    expect(await descriptor.json()).toEqual(await normal.json())
  })

  test('grant additions and revocation refresh row actions without changing parent-read rights', async ({ admin, createUser }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    await grantRole(admin, { role: 'Cap800 Changing', table: DT, tier: 'basic', can_read: true })
    const user = await createUser({ roles: ['Cap800 Changing'] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Fresh grants' } })
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
    const [grant] = await grantRole(admin, { role: 'Cap800 Changing', table: DT, tier: 'basic', can_write: true, can_delete: true })
    expect(await user.get(capabilities(row.row_id))).toEqual({ ...readerCapabilities, write: true, rename: true, delete: true })
    await admin.delete(tableRef('Permission').rowUrl(grant))
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
  })

  for (const [table, key] of [['ToDo', 'assign'], ['Comment', 'comment'], ['File', 'upload']] as const) {
    test(`${key} follows its independent ${table} create grant, not parent write`, async ({ admin, createUser }) => {
      await makeTable(admin, { name: DT, columns: ['title'] })
      await grantRole(admin, { role: 'Cap800 Collaborator', table: DT, tier: 'basic', can_read: true })
      const user = await createUser({ roles: ['Cap800 Collaborator'] })
      const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Collaboration' } })
      expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
      const [grant] = await grantRole(admin, { role: 'Cap800 Collaborator', table, tier: 'basic', can_create: true })
      expect(await user.get(capabilities(row.row_id))).toEqual({ ...readerCapabilities, [key]: true })
      await admin.delete(tableRef('Permission').rowUrl(grant))
      expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
      await grantRole(admin, { role: 'Cap800 Collaborator', table: DT, tier: 'basic', can_write: true })
      expect(await user.get(capabilities(row.row_id))).toEqual({ ...readerCapabilities, write: true, rename: true })
    })
  }

  test('unreadable and missing parents return exactly the normal row-read failure', async ({ admin, createUser }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    await grantRole(admin, {
      role: 'Cap800 Own Reader', table: DT, tier: 'basic', can_read: true, own_rows_only: true,
    })
    await grantRole(admin, { role: 'Cap800 Own Reader', table: ['ToDo', 'Comment', 'File'], tier: 'basic', can_create: true })
    const user = await createUser({ roles: ['Cap800 Own Reader'] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Unreadable' } })
    for (const [id, status] of [[row.row_id, 403], ['missing-cap800', 404]] as const) {
      const normal = await user.fetch(rows.rowUrl(id))
      const descriptor = await user.fetch(capabilities(id))
      expect(descriptor.status).toBe(status)
      expect(descriptor.status).toBe(normal.status)
      expect(await descriptor.json()).toEqual(await normal.json())
    }
  })

  test('read-only source rows hide row mutations even for Administrator', async ({ admin }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cap800-source-'))
    writeFileSync(path.join(dir, 'records.csv'), 'id,title\n1,Source row\n')
    try {
      await admin.post('/api/table/Data%20Source', { row_id: 'cap800-csv', engine: 'csv-folder', root_path: dir, access: 'read_only' })
      const reflected = await admin.post<{ created: { name: string }[] }>('/api/table/Data%20Source/cap800-csv:reflect', { tables: ['records.csv'] })
      expect(reflected.created).toHaveLength(1)
      const source = tableRef(reflected.created[0].name)
      const listed = await admin.get<{ data: { row_id: string }[] }>(source.url)
      expect(listed.data).toHaveLength(1)
      const url = source.rowUrl(listed.data[0].row_id)
      expect(await admin.get(`${url}:capabilities`)).toMatchObject({ write: false, rename: false, delete: false, submit: false, cancel: false, amend: false })
      await expectApiError(patchDoc(admin, url, { ...await admin.get(url), title: 'Not writable' }), { status: 403 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('platform-written history rows never advertise generic row mutations', async ({ admin }) => {
    await makeTable(admin, { name: DT, columns: ['title'], track_changes: true })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Before' } })
    await patchDoc(admin, rows.rowUrl(row.row_id), { ...await admin.get(rows.rowUrl(row.row_id)), title: 'After' })
    const versions = tableRef('Version')
    const history = await admin.get<{ data: { row_id: string }[] }>(versions.listUrl({ filters: [['ref_table', '=', DT], ['ref_name', '=', row.row_id]] }))
    expect(history.data).toHaveLength(1)
    const url = versions.rowUrl(history.data[0].row_id)
    expect(await admin.get(`${url}:capabilities`)).toMatchObject({ write: false, rename: false, delete: false, submit: false, cancel: false, amend: false })
    await expectApiError(patchDoc(admin, url, { ...await admin.get(url), data: '{}' }), { status: 403 })
  })
})
