import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { exportCustomizations, importCustomizations } from '../src/customizations'
import type { TestClient } from 'feather-testing-postgres'
import { expectApiError, expectStatus, grantRole, tableRef } from './fixtures'
import { deleteStored } from '../src/storage'

// CUST-005: customizations (Custom Fields + Metadata Overrides) round-trip
// through export → import, recreating the column and re-applying the property.

const DT = 'Cust5 Srv'

// Per-test setup (the sandbox rolls everything back): the Table plus one
// custom field and one metadata override.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', {
    table: 'Custom Field',
    row: {
      row_id: `${DT}-priority`,
      dt: DT,
      column_name: 'priority',
      label: 'Priority',
      column_type: 'Choice',
      choices: 'Low\nHigh',
      in_list_view: true,
    },
  })
  await admin.post('/api/table/Metadata%20Override', {
    row_id: `${DT}-title-reqd`, table_name: DT, column_name: 'title', property: 'reqd', value: '1',
  })
}

describe('CUST-005: export/import customizations', () => {
  test('#800 collaboration flags round-trip over HTTP without deleting existing content', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const target = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Keep collaboration' } })
    const assignee = await createUser({ roles: [] })
    await admin.post('/api/assign', { table: DT, row_id: target.row_id, assign_to: assignee.user })
    await admin.post('/api/tags', { table: DT, row_id: target.row_id, tag: 'keep-me' })
    const comment = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Comment', row: { ref_table: DT, ref_name: target.row_id, content: 'Keep this discussion' },
    })
    const form = new FormData()
    form.append('file', new File(['Keep these bytes'], 'issue800.txt', { type: 'text/plain' }))
    form.append('ref_table', DT)
    form.append('ref_name', target.row_id)
    form.append('is_private', '1')
    const file = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
    await expectStatus(file, 201)
    const uploaded = await file.json() as { row_id: string; file_url: string }
    try {
      const paths = [
        tableRef(DT).rowUrl(target.row_id),
        `/api/tags/${encodeURIComponent(DT)}/${target.row_id}`,
        tableRef('ToDo').listUrl({ filters: [['ref_table', '=', DT], ['reference_name', '=', target.row_id]] }),
        tableRef('Comment').rowUrl(comment.row_id),
        tableRef('File').rowUrl(uploaded.row_id),
      ]
      const before = await Promise.all(paths.map((path) => admin.get(path)))
      const flags = ['enable_assignments', 'enable_tags', 'enable_files', 'enable_discussion']
      const overrides: string[] = []
      for (const property of flags) {
        const saved = await admin.post<{ row_id: string }>('/api/save_row', {
          table: 'Metadata Override', row: { table_name: DT, property, value: 'true' },
        })
        overrides.push(saved.row_id)
      }
      const bundle = await admin.get<{ property_setters: Record<string, unknown>[] }>(`/api/export_customizations/${encodeURIComponent(DT)}`)
      expect(bundle.property_setters).toHaveLength(4)
      expect(bundle.property_setters).toEqual(expect.arrayContaining(flags.map((property) => ({
        table_name: DT, column_name: null, property, value: 'true',
      }))))
      expect(await admin.get(tableRef(DT).metaUrl)).toMatchObject(Object.fromEntries(flags.map((flag) => [flag, true])))
      for (const id of overrides) await admin.delete(tableRef('Metadata Override').rowUrl(id))
      expect(await admin.get(tableRef(DT).metaUrl)).toMatchObject(Object.fromEntries(flags.map((flag) => [flag, false])))
      expect(await Promise.all(paths.map((path) => admin.get(path)))).toEqual(before)
      expect(await (await admin.fetch(uploaded.file_url)).text()).toBe('Keep these bytes')
      expect(await admin.post('/api/import_customizations', bundle)).toEqual({ custom_fields: 0, property_setters: 4 })
      expect(await admin.get(tableRef(DT).metaUrl)).toMatchObject(Object.fromEntries(flags.map((flag) => [flag, true])))
      expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`)).toEqual(bundle)
      expect(await Promise.all(paths.map((path) => admin.get(path)))).toEqual(before)
      expect(await (await admin.fetch(uploaded.file_url)).text()).toBe('Keep these bytes')
    } finally {
      // Storage bytes, unlike the database rows, are not transaction-sandboxed.
      await deleteStored(uploaded.file_url)
    }
  })

  for (const enabled of [false, true]) {
    test(`#800 collaboration flags ${enabled} leave parent-row authorization unchanged`, async ({ admin, createUser }) => {
      await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
      if (enabled) {
        await admin.post('/api/import_customizations', {
          property_setters: ['enable_assignments', 'enable_tags', 'enable_files', 'enable_discussion'].map((property) => ({
            table_name: DT, property, value: '1',
          })),
        })
      }
      expect(await admin.get(tableRef(DT).metaUrl)).toMatchObject({
        enable_assignments: enabled, enable_tags: enabled, enable_files: enabled, enable_discussion: enabled,
      })
      await grantRole(admin, { role: 'Cust800 Reader', table: DT, tier: 'basic', can_read: true })
      await grantRole(admin, {
        role: 'Cust800 Collaborator', table: ['Comment', 'ToDo', 'File'], tier: 'basic', can_read: true, can_create: true, can_write: true,
      })
      const reader = await createUser({ roles: ['Cust800 Reader', 'Cust800 Collaborator'] })
      // Both users can create collaboration records; only one can read the parent.
      const outsider = await createUser({ roles: ['Cust800 Collaborator'] })
      const target = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Permission target' } })
      const uploaded: string[] = []
      try {
        for (const [actor, allowed] of [[reader, true], [outsider, false]] as const) {
          const body = { table: DT, row_id: target.row_id }
          if (allowed) {
            await actor.post('/api/assign', { ...body, assign_to: reader.user })
            await actor.post('/api/tags', { ...body, tag: 'permitted' })
            await actor.post('/api/save_row', {
              table: 'Comment', row: { ref_table: DT, ref_name: target.row_id, content: 'Permitted discussion' },
            })
          } else {
            await expectApiError(actor.post('/api/assign', { ...body, assign_to: reader.user }), { status: 403, type: 'PermissionError' })
            await expectApiError(actor.post('/api/tags', { ...body, tag: 'forbidden' }), { status: 403, type: 'PermissionError' })
            await expectApiError(actor.post('/api/save_row', {
              table: 'Comment', row: { ref_table: DT, ref_name: target.row_id, content: 'Forbidden discussion' },
            }), { status: 403, type: 'PermissionError' })
          }
          const form = new FormData()
          form.append('file', new File(['Authorized bytes'], 'permission800.txt', { type: 'text/plain' }))
          form.append('ref_table', DT)
          form.append('ref_name', target.row_id)
          const response = await actor.fetch('/api/upload_file', { method: 'POST', body: form })
          if (allowed) {
            await expectStatus(response, 201)
            const file = await response.json() as { file_url: string }
            uploaded.push(file.file_url)
          } else {
            await expectApiError(Promise.resolve(response), { status: 403, type: 'PermissionError' })
          }
          const activityPath = `/api/activity/${encodeURIComponent(DT)}/${target.row_id}`
          const tagsPath = `/api/tags/${encodeURIComponent(DT)}/${target.row_id}`
          if (allowed) {
            expect(await actor.get(tagsPath)).toEqual({ tags: ['permitted'] })
            expect(await actor.get(activityPath)).toMatchObject({ comments: [expect.objectContaining({ content: 'Permitted discussion' })] })
          } else {
            await expectApiError(actor.get(tagsPath), { status: 403, type: 'PermissionError' })
            await expectApiError(actor.get(activityPath), { status: 403, type: 'PermissionError' })
          }
        }
      } finally {
        for (const url of uploaded) await deleteStored(url)
      }
    })
  }

  test('exports the custom fields and metadata overrides for a Table', async ({ admin }) => {
    await setup(admin)
    const bundle = await exportCustomizations(DT)
    expect(bundle.custom_fields.map((f) => f.column_name)).toEqual(['priority'])
    expect(bundle.custom_fields[0].choices).toBe('Low\nHigh')
    expect(bundle.property_setters).toEqual([
      expect.objectContaining({ column_name: 'title', property: 'reqd', value: '1' }),
    ])
  })

  test('re-creates them on import after they are deleted', async ({ admin }) => {
    await setup(admin)
    const emptyDefault = await admin.post<{ row_id: string }>('/api/table/Metadata%20Override', {
      table_name: DT, column_name: 'priority', property: 'default_value', value: null,
    })
    const bundle = await exportCustomizations(DT)
    // Delete the customizations.
    await admin.delete(`/api/table/Metadata%20Override/${encodeURIComponent(emptyDefault.row_id)}`)
    await admin.delete(`/api/table/Custom%20Field/${encodeURIComponent(`${DT}-priority`)}`)
    await admin.delete(
      `/api/table/Metadata%20Override/${encodeURIComponent(`${DT}-title-reqd`)}`,
    )
    let meta = await getMeta(DT)
    expect(meta.columns.some((f) => f.column_name === 'priority')).toBe(false)
    expect(meta.columns.find((f) => f.column_name === 'title')?.reqd).toBeFalsy()

    // Import brings them back.
    const counts = await importCustomizations(bundle, 'Administrator')
    expect(counts).toEqual({ custom_fields: 1, property_setters: 2 })
    meta = await getMeta(DT)
    const priority = meta.columns.find((f) => f.column_name === 'priority')
    expect(priority).toMatchObject({ column_name: 'priority', column_type: 'Choice', label: 'Priority' })
    expect(priority?.choices).toBe('Low\nHigh')
    expect(priority?.default_value).toBeNull()
    expect(meta.columns.find((f) => f.column_name === 'title')?.reqd).toBe(true)
    const created = await admin.post<{ row_id: string }>('/api/save_row', {
      table: DT, row: { title: 'No imported default' },
    })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${created.row_id}`))
      .toMatchObject({ title: 'No imported default', priority: null })
    // The backing column exists again.
    const [col] = await sql`select 1 from information_schema.columns where table_name = 'cust5_srv' and column_name = 'priority'`
    expect(col).toEqual({ '?column?': 1 })
  })

  test('is idempotent — re-importing creates nothing new', async ({ admin }) => {
    await setup(admin)
    const bundle = await exportCustomizations(DT)
    const counts = await importCustomizations(bundle, 'Administrator')
    expect(counts).toEqual({ custom_fields: 0, property_setters: 0 })
  })

  test('an imported field with omitted options becomes an optional Data column', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: DT, columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    expect(await admin.post('/api/import_customizations', {
      custom_fields: [{ dt: DT, column_name: 'customer_note' }],
    })).toEqual({ custom_fields: 1, property_setters: 0 })
    const meta = await admin.get<{ columns: Record<string, unknown>[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    expect(meta.columns.find((f) => f.column_name === 'customer_note')).toMatchObject({
      label: 'Customer Note', column_type: 'Data', reqd: false, in_list_view: false, custom: true,
    })
    const created = await admin.post<{ row_id: string }>('/api/save_row', {
      table: DT, row: { title: 'With note', customer_note: 'Call after 4pm' },
    })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${created.row_id}`))
      .toMatchObject({ title: 'With note', customer_note: 'Call after 4pm' })
    const without = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'No note' } })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${without.row_id}`))
      .toMatchObject({ title: 'No note', customer_note: null })
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`)).toEqual({
      table: DT,
      custom_fields: [{
        dt: DT, column_name: 'customer_note', label: null, column_type: 'Data',
        reference_table: null, choices: null, choice_labels: null, row_table: null, reqd: false, in_list_view: false,
      }],
      property_setters: [],
    })
  })

  test('re-importing a Table-level label override does not duplicate it', async ({ admin }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const bundle = { property_setters: [{ table_name: DT, property: 'label', value: 'Customer requests' }] }
    expect(await admin.post('/api/import_customizations', bundle)).toEqual({ custom_fields: 0, property_setters: 1 })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}:meta`)).toMatchObject({ label: 'Customer requests' })
    const exported = {
      table: DT, custom_fields: [],
      property_setters: [{ table_name: DT, column_name: null, property: 'label', value: 'Customer requests' }],
    }
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`)).toEqual(exported)
    expect(await admin.post('/api/import_customizations', bundle)).toEqual({ custom_fields: 0, property_setters: 0 })
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`)).toEqual(exported)
  })

  test('an imported field cannot replace an existing base column', async ({ admin }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const saved = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'Keep this value' } })
    const rowPath = `/api/table/${encodeURIComponent(DT)}/${saved.row_id}`
    const before = await admin.get(rowPath)
    const metaPath = `/api/table/${encodeURIComponent(DT)}:meta`
    const meta = await admin.get(metaPath)
    await expectApiError(admin.post('/api/import_customizations', {
      custom_fields: [{ dt: DT, column_name: 'title', column_type: 'Choice', choices: 'Low\nHigh' }],
    }), { status: 409, type: 'ConflictError', message: `409 ConflictError: title already exists on ${DT}` })
    expect(await admin.get(rowPath)).toEqual(before)
    expect(await admin.get(metaPath)).toEqual(meta)
    expect(await admin.get(`/api/export_customizations/${encodeURIComponent(DT)}`))
      .toEqual({ table: DT, custom_fields: [], property_setters: [] })
  })

  test('exposes export/import over HTTP, gated to System Managers', async ({ admin }) => {
    await setup(admin)
    const bundle = await admin.get<{ custom_fields: unknown[] }>(
      `/api/export_customizations/${encodeURIComponent(DT)}`,
    )
    expect(bundle.custom_fields.length).toBe(1)
  })
})
