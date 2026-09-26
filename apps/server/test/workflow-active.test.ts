import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makeTable, expectApiError } from './fixtures'
import { getActiveWorkflow } from '../src/workflow'

test('database rejects a second active workflow without restricting inactive alternatives', async () => {
  await sql`insert into workflow (row_id, ref_table, is_active) values
    ('Active original', 'Approval target', true),
    ('Inactive alternative', 'Approval target', false),
    ('Inactive spare', 'Approval target', false)`
  await expect(sql.begin(async tx => {
    await tx`update workflow set is_active = true where row_id = 'Inactive alternative'`
  })).rejects.toMatchObject({ code: '23505', constraint_name: 'workflow_one_active_per_table' })
  expect(await sql`select row_id from workflow where ref_table = 'Approval target' and is_active = true`)
    .toEqual([{ row_id: 'Active original' }])
})

test('installing the invariant refuses existing duplicates without changing either workflow', async () => {
  await sql`drop index featherbase.workflow_one_active_per_table`
  await sql`insert into workflow (row_id, ref_table, is_active) values
    ('Older rules', 'Duplicate target', true), ('Newer rules', 'Duplicate target', true)`
  const before = await sql`select * from workflow where ref_table = 'Duplicate target' order by row_id`
  const migration = readFileSync(new URL('../migrations/0098_workflow_one_active.sql', import.meta.url), 'utf8')
  await expect(sql.begin(tx => tx.unsafe(migration))).rejects.toMatchObject({ code: '23505' })
  expect(await sql`select * from workflow where ref_table = 'Duplicate target' order by row_id`).toEqual(before)
})

test('saving a competing active workflow names the original and preserves its rules', async ({ admin }) => {
  await makeTable(admin, { name: 'Single Workflow Target', columns: ['workflow_state'] })
  const first = await admin.post('/api/save_row', { table: 'Workflow', row: {
    row_id: 'Original approval', ref_table: 'Single Workflow Target', is_active: true,
    states: [{ state: 'Awaiting approval', target_status: 'draft' }],
  } })
  await expectApiError(admin.post('/api/save_row', { table: 'Workflow', row: {
    row_id: 'Competing approval', ref_table: 'Single Workflow Target', is_active: true,
    states: [{ state: 'Auto approved', target_status: 'draft' }],
  } }), { status: 409, type: 'ConflictError', message: expect.stringContaining('Original approval') })
  expect(await admin.get('/api/table/Workflow/Original%20approval')).toEqual(first)
  expect(await sql`select row_id from workflow where ref_table = 'Single Workflow Target'`)
    .toEqual([{ row_id: 'Original approval' }])
})

test('alternatives require explicit deactivation while different Tables stay independent', async ({ admin }) => {
  for (const name of ['Switch target', 'Independent target'])
    await makeTable(admin, { name, columns: ['workflow_state'] })
  const save = (row: Record<string, unknown>) => admin.post<Record<string, unknown>>('/api/save_row', { table: 'Workflow', row })
  let original = await save({ row_id: 'Switch original', ref_table: 'Switch target', is_active: true,
    states: [{ state: 'Review', target_status: 'draft' }] })
  const alternative = await save({ row_id: 'Switch alternative', ref_table: 'Switch target', is_active: false,
    states: [{ state: 'Triage', target_status: 'draft' }] })
  await save({ row_id: 'Switch spare', ref_table: 'Switch target', is_active: false,
    states: [{ state: 'Waiting', target_status: 'draft' }] })
  const independent = await save({ row_id: 'Independent rules', ref_table: 'Independent target', is_active: true,
    states: [{ state: 'Queue', target_status: 'draft' }] })
  original = await save({ ...original, states: [{ state: 'Reviewed', target_status: 'draft' }] })
  await expectApiError(save({ ...alternative, is_active: true }), {
    status: 409, type: 'ConflictError', message: expect.stringContaining('Switch original'),
  })
  await expectApiError(save({ ...independent, ref_table: 'Switch target' }), {
    status: 409, type: 'ConflictError', message: expect.stringContaining('Switch original'),
  })
  expect(await admin.get('/api/table/Workflow/Switch%20alternative')).toEqual(alternative)
  expect(await admin.get('/api/table/Workflow/Independent%20rules')).toEqual(independent)
  expect(await getActiveWorkflow('Switch target')).toMatchObject({ row_id: 'Switch original', states: [{ state: 'Reviewed' }] })
  await save({ ...original, is_active: false })
  expect(await getActiveWorkflow('Switch target')).toBeNull()
  await save({ ...alternative, is_active: true })
  expect(await getActiveWorkflow('Switch target')).toMatchObject({ row_id: 'Switch alternative', states: [{ state: 'Triage' }] })
  expect(await getActiveWorkflow('Independent target')).toMatchObject({ row_id: 'Independent rules' })
})

test('lookup refuses duplicate active workflows instead of selecting the newest edit', async () => {
  await sql`drop index featherbase.workflow_one_active_per_table`
  await sql`insert into workflow (row_id, ref_table, is_active, updated_at) values
    ('Older rules', 'Broken target', true, '2025-01-01'),
    ('Newer rules', 'Broken target', true, '2026-01-01')`
  await expect(getActiveWorkflow('Broken target')).rejects.toMatchObject({
    type: 'ConflictError', message: expect.stringContaining('multiple active workflows'),
  })
})

test('unrelated workflow uniqueness violations retain the ordinary field validation error', async ({ admin }) => {
  await makeTable(admin, { name: 'Other constraint target', columns: ['workflow_state'] })
  // A real, unrelated constraint on the same Table catches an overbroad mapper.
  await sql`create unique index workflow_test_state_field on featherbase.workflow (state_field)`
  const row = { ref_table: 'Other constraint target', is_active: false, state_field: 'workflow_state',
    states: [{ state: 'Pending', target_status: 'draft' }] }
  await admin.post('/api/save_row', { table: 'Workflow', row: { ...row, row_id: 'Other constraint first' } })
  await expectApiError(admin.post('/api/save_row', { table: 'Workflow', row: { ...row, row_id: 'Other constraint second' } }), {
    status: 417, type: 'ValidationError', fields: { state_field: 'state_field must be unique' },
  })
})
