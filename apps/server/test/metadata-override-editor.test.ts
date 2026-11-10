import { test } from './pg-test'
import { expect } from 'vitest'
import { sql, withTransaction } from '../src/db'
import { applyMigrationFile } from '../src/migrate'
import { invalidateMeta } from '../src/meta'
import { patchDoc } from './fixtures'

test('editor migration preserves authored wording', async ({ admin }) => {
  await sql`update table_def set id_pattern = 'prompt' where name = 'Metadata Override'`
  await sql`update column_def set label = case column_name
    when 'table_name' then 'doc_type' when 'column_name' then 'Our column'
    when 'property' then 'Property' when 'value' then 'value' end
    where parent = 'Metadata Override'`
  await sql`delete from migration where name = '0015_metadata_override_editor.sql'`
  await withTransaction(() => applyMigrationFile('0015_metadata_override_editor.sql'))
  invalidateMeta('Metadata Override')
  const meta = await admin.get<{ id_pattern: string; columns: { column_name: string; label: string }[] }>('/api/table/Metadata%20Override:meta')
  expect(meta.id_pattern).toBe('hash')
  expect(Object.fromEntries(meta.columns.map(c => [c.column_name, c.label]))).toEqual({
    table_name: 'Table', column_name: 'Our column', property: 'Setting', value: 'Value',
  })
})

test('unknown supplied IDs still refuse an accidental update', async ({ admin }) => {
  await expect(admin.post('/api/save_row', { table: 'Metadata Override', row: {
    row_id: 'missing-adjustment', table_name: 'Person', column_name: 'full_name', property: 'label', value: 'Name',
  } })).rejects.toMatchObject({ status: 404 })
})

test('moving an adjustment restores the old target served metadata', async ({ admin }) => {
  for (const name of ['Editor Source', 'Editor Destination'])
    await admin.post('/api/table_def', { name, columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/table/Metadata%20Override', {
    table_name: 'Editor Source', column_name: 'title', property: 'label', value: 'Headline',
  })
  type Meta = { columns: { column_name: string; label: string }[] }
  const source = '/api/table/Editor%20Source:meta'
  const destination = '/api/table/Editor%20Destination:meta'
  expect((await admin.get<Meta>(source)).columns.find(c => c.column_name === 'title')?.label).toBe('Headline')
  expect((await admin.get<Meta>(destination)).columns.find(c => c.column_name === 'title')?.label).toBe('Title')
  await patchDoc(admin, `/api/table/Metadata%20Override/${row.row_id}`, {
    updated_at: row.updated_at, table_name: 'Editor Destination',
  })
  expect((await admin.get<Meta>(source)).columns.find(c => c.column_name === 'title')?.label).toBe('Title')
  expect((await admin.get<Meta>(destination)).columns.find(c => c.column_name === 'title')?.label).toBe('Headline')
})

test('a column setting has one editable adjustment', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Editor Unique', columns: [
    { column_name: 'title', column_type: 'Data' }, { column_name: 'other', column_type: 'Data' },
  ] })
  const adjustment = { table_name: 'Editor Unique', column_name: 'title', property: 'label', value: 'Headline' }
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/table/Metadata%20Override', adjustment)
  await expect(admin.post('/api/table/Metadata%20Override', adjustment)).rejects.toMatchObject({
    status: 417, message: expect.stringContaining('Edit the existing adjustment'),
  })
  await patchDoc(admin, `/api/table/Metadata%20Override/${row.row_id}`, { updated_at: row.updated_at, value: 'Renamed headline' })
  expect(await admin.get(`/api/table/Metadata%20Override/${row.row_id}`)).toMatchObject({ value: 'Renamed headline' })
  await admin.post('/api/table/Metadata%20Override', { ...adjustment, column_name: 'other' })
  await admin.post('/api/table/Metadata%20Override', { ...adjustment, property: 'hidden', value: 'true' })
})

test('Whole Table uniqueness normalizes empty scope', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Editor Whole', columns: [{ column_name: 'title', column_type: 'Data' }] })
  const adjustment = { table_name: 'Editor Whole', property: 'label', value: 'Whole label' }
  await admin.post('/api/table/Metadata%20Override', { ...adjustment, column_name: null })
  await expect(admin.post('/api/table/Metadata%20Override', { ...adjustment, column_name: '' })).rejects.toMatchObject({
    status: 417, message: expect.stringContaining('Edit the existing adjustment'),
  })
  await admin.post('/api/table/Metadata%20Override', { ...adjustment, column_name: 'title' })
})

test('retargeting to an occupied setting refuses the move', async ({ admin }) => {
  for (const name of ['Editor Occupied', 'Editor Original'])
    await admin.post('/api/table_def', { name, columns: [{ column_name: 'title', column_type: 'Data' }] })
  const adjustment = { column_name: 'title', property: 'label', value: 'Headline' }
  await admin.post('/api/table/Metadata%20Override', { ...adjustment, table_name: 'Editor Occupied' })
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/table/Metadata%20Override', {
    ...adjustment, table_name: 'Editor Original',
  })
  await expect(patchDoc(admin, `/api/table/Metadata%20Override/${row.row_id}`, {
    updated_at: row.updated_at, table_name: 'Editor Occupied',
  })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Edit the existing adjustment') })
  expect(await admin.get(`/api/table/Metadata%20Override/${row.row_id}`)).toMatchObject({ table_name: 'Editor Original' })
})

test('an adjustment to a Column the Table no longer has changes nothing', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Editor Dropped', columns: [
    { column_name: 'title', column_type: 'Data', label: 'Title' }, { column_name: 'gone', column_type: 'Data', label: 'Gone' },
  ] })
  await admin.post('/api/table/Metadata%20Override', { table_name: 'Editor Dropped', column_name: 'gone', property: 'label', value: 'Was here' })
  await admin.put('/api/table_def/Editor%20Dropped', { columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }], remove_columns: ['gone'] })
  type Meta = { columns: { column_name: string; label: string }[] }
  expect((await admin.get<Meta>('/api/table/Editor%20Dropped:meta')).columns.map(c => [c.column_name, c.label])).toEqual([['title', 'Title']])
})
