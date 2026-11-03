import { test, expect } from './pg-test'
import { renameColumn } from '../src/table-engine'

const columns = [{ column_name: 'enabled', column_type: 'Check', in_list_view: true }]

test('browse settings persist, preserve on omission and clear explicitly without hiding audit rows from the API', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Browse Location', id_pattern: 'prompt', columns,
    browse_presentation: { default_filters: [['enabled', '=', true]] },
  })
  await admin.post('/api/table_def', {
    name: 'Browse Branch', columns: [{ column_name: 'location', column_type: 'Reference', reference_table: 'Browse Location' }],
  })
  const presentation = { default_filters: [['enabled', '=', true]], preferred_related: { table: 'Browse Branch', column: 'location' } }
  await admin.put('/api/table_def/Browse%20Location', { columns, browse_presentation: presentation })
  expect(await admin.get('/api/table/Browse%20Location:meta')).toMatchObject({ browse_presentation: presentation })
  await admin.put('/api/table_def/Browse%20Location', { columns })
  expect(await admin.get('/api/table/Browse%20Location:meta')).toMatchObject({ browse_presentation: presentation })
  for (const [id, enabled] of [['active', true], ['audit', false]])
    await admin.post('/api/save_row', { table: 'Browse Location', row: { row_id: id, enabled } })
  expect(await admin.get('/api/table/Browse%20Location')).toMatchObject({ total: 2 })
  const filter = encodeURIComponent(JSON.stringify([['enabled', '=', true]]))
  expect(await admin.get(`/api/table/Browse%20Location?filters=${filter}`)).toMatchObject({ total: 1 })
  await admin.put('/api/table_def/Browse%20Location', { columns, browse_presentation: null })
  expect(await admin.get('/api/table/Browse%20Location:meta')).toMatchObject({ browse_presentation: null })
})

test('browse settings reject missing filter columns and unrelated references atomically', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Browse Invalid', columns })
  for (const presentation of [
    { default_filters: [['missing', '=', true]] },
    { default_filters: [['enabled', 'in', true]] },
    { default_filters: [['enabled', '=', [true]]] },
    { preferred_related: { table: 'Browse Invalid', column: 'enabled' } },
  ]) {
    await expect(admin.put('/api/table_def/Browse%20Invalid', { columns, browse_presentation: presentation }))
      .rejects.toMatchObject({ status: 417 })
  }
  expect(await admin.get('/api/table/Browse%20Invalid:meta')).toMatchObject({ browse_presentation: null })
})

test('a display label changes presentation without renaming storage or references', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Browse Label', label: 'Locations', columns })
  expect(await admin.get('/api/table/Browse%20Label:meta')).toMatchObject({ name: 'Browse Label', label: 'Locations' })
  await admin.put('/api/table_def/Browse%20Label', { columns, label: 'Venues' })
  await admin.put('/api/table_def/Browse%20Label', { columns })
  expect(await admin.get('/api/table/Browse%20Label:meta')).toMatchObject({ name: 'Browse Label', label: 'Venues' })
  await admin.put('/api/table_def/Browse%20Label', { columns, label: null })
  expect(await admin.get('/api/table/Browse%20Label:meta')).toMatchObject({ name: 'Browse Label', label: null })
})


test('column renames carry default filters and preferred related references', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Browse Rename', columns })
  await admin.post('/api/table_def', { name: 'Browse Rename Child', columns: [
    { column_name: 'location', column_type: 'Reference', reference_table: 'Browse Rename' },
  ] })
  await admin.put('/api/table_def/Browse%20Rename', { columns, browse_presentation: {
    default_filters: [['enabled', '=', true]], preferred_related: { table: 'Browse Rename Child', column: 'location' },
  } })
  await renameColumn('Browse Rename', 'enabled', 'visible')
  await renameColumn('Browse Rename Child', 'location', 'venue')
  expect(await admin.get('/api/table/Browse%20Rename:meta')).toMatchObject({ browse_presentation: {
    default_filters: [['visible', '=', true]], preferred_related: { table: 'Browse Rename Child', column: 'venue' },
  } })
})
