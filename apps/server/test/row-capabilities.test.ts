import { describe, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from './pg-test'
import { expectRefused, expectStatus, grantRole, makeTable, patchDoc, tableRef } from './fixtures'

const DT = 'Cap800 Document'
const rows = tableRef(DT)
const capabilities = (id: string) => `${rows.rowUrl(id)}:capabilities`
const readerCapabilities = {
  write: false, rename: false, delete: false, submit: false, cancel: false,
  amend: false, retire: false, reactivate: false, purge: false, assign: false, tag: true, comment: false, upload: false,
}

describe('#800 row action capabilities', () => {
  test('settings advertise saving only with a settings write grant, never row lifecycle actions', async ({ admin, createUser }) => {
    const settings = await makeTable(admin, { name: 'Cap800 Settings', kind: 'settings', columns: ['title'] })
    const url = settings.rowUrl(settings.name)
    await grantRole(admin, { role: 'Cap800 Settings Reader', table: settings.name, tier: 'basic', can_read: true })
    const user = await createUser({ roles: ['Cap800 Settings Reader'] })
    expect(await user.get(`${url}:capabilities`)).toEqual(readerCapabilities)
    const [write] = await grantRole(admin, { role: 'Cap800 Settings Reader', table: settings.name, tier: 'basic', can_write: true })
    expect(await user.get(`${url}:capabilities`)).toEqual({ ...readerCapabilities, write: true })
    await user.post('/api/save_row', { table: settings.name, row: { title: 'Saved settings' } })
    expect(await admin.get(url)).toMatchObject({ title: 'Saved settings' })
    await admin.delete(tableRef('Permission').rowUrl(write))
    expect(await user.get(`${url}:capabilities`)).toEqual(readerCapabilities)
    await expectRefused(user.post('/api/save_row', { table: settings.name, row: { title: 'Forbidden' } }), 403)
  })

  test('attached comment deletion advice requires its grant and retains parent access checks', async ({ admin, createUser }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    const [parentRead] = await grantRole(admin, { role: 'Cap800 Attached Reader', table: DT, tier: 'basic', can_read: true })
    await grantRole(admin, { role: 'Cap800 Attached Reader', table: 'Comment', tier: 'basic', can_read: true })
    const user = await createUser({ roles: ['Cap800 Attached Reader'] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Parent' } })
    const comment = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Comment', row: { ref_table: DT, ref_name: row.row_id, content: 'Attached note' },
    })
    const url = tableRef('Comment').rowUrl(comment.row_id)
    expect(await user.get(`${url}:capabilities`)).toMatchObject({ delete: false })
    await grantRole(admin, { role: 'Cap800 Attached Reader', table: 'Comment', tier: 'basic', can_delete: true })
    expect(await user.get(`${url}:capabilities`)).toMatchObject({ delete: true })
    await admin.delete(tableRef('Permission').rowUrl(parentRead))
    await expectRefused(user.get(`${url}:capabilities`), 403)
    await expectRefused(user.delete(url), 403)
    await grantRole(admin, { role: 'Cap800 Attached Reader', table: DT, tier: 'basic', can_read: true })
    await user.delete(url)
    await expectRefused(admin.get(url), 404)
  })

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
      ...readerCapabilities, write: true, rename: true, delete: true, submit: true, retire: true,
    })
    expect(await user.get(capabilities(other.row_id))).toEqual(readerCapabilities)
    await expectRefused(user.post(`${rows.rowUrl(other.row_id)}:rename`, { new_name: 'cap800-stolen' }), 403)
    await expectRefused(user.delete(rows.rowUrl(other.row_id)), 403)
    await expectRefused(user.post(`${rows.rowUrl(other.row_id)}:submit`), 403)
    expect(await user.post<{ row_id: string }>(`${rows.rowUrl(own.row_id)}:rename`, { new_name: 'cap800-owned' }))
      .toMatchObject({ row_id: 'cap800-owned' })
    await user.post(`${rows.rowUrl('cap800-owned')}:submit`)
    await admin.post(`${rows.rowUrl(other.row_id)}:submit`)
    expect(await user.get(capabilities('cap800-owned'))).toMatchObject({ write: false, delete: false, submit: false, cancel: true, amend: false })
    expect(await user.get(capabilities(other.row_id))).toMatchObject({ write: false, delete: false, submit: false, cancel: false, amend: false })
    await expectRefused(user.post(`${rows.rowUrl(other.row_id)}:cancel`), 403)
    await user.post(`${rows.rowUrl('cap800-owned')}:cancel`)
    await admin.post(`${rows.rowUrl(other.row_id)}:cancel`)
    expect(await user.get(capabilities('cap800-owned'))).toMatchObject({ write: false, submit: false, cancel: false, amend: true })
    expect(await user.get(capabilities(other.row_id))).toMatchObject({ write: false, submit: false, cancel: false, amend: false })
    await expectRefused(user.post(`${rows.rowUrl(other.row_id)}:amend`), 403)
    expect(await user.post(`${rows.rowUrl('cap800-owned')}:amend`)).toMatchObject({ submission_status: 'draft', amended_from: 'cap800-owned' })
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
    await expectRefused(patchDoc(user, rows.rowUrl(row.row_id), { ...await user.get(rows.rowUrl(row.row_id)), title: 'Forbidden' }), 403)
    await patchDoc(admin, shareUrl, { ...await admin.get(shareUrl), write: true })
    expect(await user.get(capabilities(row.row_id))).toEqual({ ...readerCapabilities, write: true })
    await patchDoc(user, rows.rowUrl(row.row_id), { ...await user.get(rows.rowUrl(row.row_id)), title: 'Edited by share' })
    expect(await admin.get(rows.rowUrl(row.row_id))).toMatchObject({ title: 'Edited by share' })
    await expectRefused(user.post(`${rows.rowUrl(row.row_id)}:rename`, { new_name: 'cap800-share-rename' }), 403)
    await expectRefused(user.delete(rows.rowUrl(row.row_id)), 403)
    await expectRefused(user.post(`${rows.rowUrl(row.row_id)}:submit`), 403)
    await patchDoc(admin, shareUrl, { ...await admin.get(shareUrl), write: false })
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
    await patchDoc(admin, shareUrl, { ...await admin.get(shareUrl), read: false })
    const normal = await user.fetch(rows.rowUrl(row.row_id))
    const descriptor = await user.fetch(capabilities(row.row_id))
    await expectStatus(descriptor, 403)
    expect(descriptor.status).toBe(normal.status)
    expect(await descriptor.json()).toEqual(await normal.json())
  })

  test('grant additions and revocation refresh row actions without changing parent-read rights', async ({ admin, createUser }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    await grantRole(admin, { role: 'Cap800 Changing', table: DT, tier: 'basic', can_read: true })
    const user = await createUser({ roles: ['Cap800 Changing'] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Fresh grants' } })
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
    const grants = await grantRole(admin, { role: 'Cap800 Changing', table: DT, tier: 'basic', can_write: true, can_delete: true })
    expect(await user.get(capabilities(row.row_id))).toEqual({ ...readerCapabilities, write: true, rename: true, delete: true, retire: true })
    for (const grant of grants) await admin.delete(tableRef('Permission').rowUrl(grant))
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
  })

  test('a read share does not turn an out-of-scope restricted reference into mutation rights', async ({ admin, createUser }) => {
    const regions = await makeTable(admin, { name: 'Cap800 Region', id_pattern: 'prompt', columns: ['title'] })
    for (const id of ['north', 'south']) await admin.post('/api/save_row', { table: regions.name, row: { row_id: id } })
    await makeTable(admin, { name: DT, columns: [
      'title', { column_name: 'region', column_type: 'Reference', reference_table: regions.name, tier: 'restricted' },
    ] })
    await grantRole(admin, { role: 'Cap800 Scoped Writer', table: DT, tier: 'basic', can_read: true, can_write: true, can_delete: true })
    const user = await createUser({ roles: ['Cap800 Scoped Writer'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: regions.name, for_value: 'north' } })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Southern row', region: 'south' } })
    const share = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Share', row: { share_table: DT, share_name: row.row_id, person: user.user, read: true },
    })
    expect(await user.get(capabilities(row.row_id))).toEqual(readerCapabilities)
    await expectRefused(patchDoc(user, rows.rowUrl(row.row_id), { ...await user.get(rows.rowUrl(row.row_id)), title: 'Forbidden' }), 403)
    const shareUrl = tableRef('Share').rowUrl(share.row_id)
    await patchDoc(admin, shareUrl, { ...await admin.get(shareUrl), write: true })
    expect(await user.get(capabilities(row.row_id))).toEqual({ ...readerCapabilities, write: true })
    await patchDoc(user, rows.rowUrl(row.row_id), { ...await user.get(rows.rowUrl(row.row_id)), title: 'Shared edit' })
    expect(await admin.get(rows.rowUrl(row.row_id))).toMatchObject({ title: 'Shared edit', region: 'south' })
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
      await expectRefused(patchDoc(admin, url, { ...await admin.get(url), title: 'Not writable' }), 403)
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
    await expectRefused(patchDoc(admin, url, { ...await admin.get(url), data: '{}' }), 403)
  })
})
