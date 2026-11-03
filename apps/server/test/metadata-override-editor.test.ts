import { test } from './pg-test'
import { expect } from 'vitest'
import { sql, withTransaction } from '../src/db'
import { applyMigrationFile } from '../src/migrate'
import { invalidateMeta } from '../src/meta'

test('editor migration preserves authored wording', async ({ admin }) => {
  await sql`update table_def set id_pattern = 'prompt' where name = 'Metadata Override'`
  await sql`update column_def set label = case column_name
    when 'table_name' then 'doc_type' when 'column_name' then 'Our column'
    when 'property' then 'Property' when 'value' then 'value' end
    where parent = 'Metadata Override'`
  await sql`delete from migration where name = '0011_metadata_override_editor.sql'`
  await withTransaction(() => applyMigrationFile('0011_metadata_override_editor.sql'))
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
