import { afterEach } from 'vitest'
import { clearSession, setSession } from '../src/lib/api'
import { analyzeImportKeys } from '../src/lib/import-run'
import { test, expect } from './pg-test'
import { grantRole } from 'server/test/fixtures'
import { sql } from 'server/src/db'
import { quoteRelation, tableRelation } from 'server/src/table-engine'

afterEach(() => clearSession())

// #1042: these tests are about the analysis, not the import that seeds it,
// and seeding 500 rows through :import (every save's full chain) took ~8 s.
async function seedZones(codes: string[], createdBy: string) {
  const relation = quoteRelation(await tableRelation('Ika Zone'))
  await sql.unsafe(`insert into ${relation} (row_id, code, created_by, updated_by)
    select gen_random_uuid()::text, code, $2, $2 from unnest($1::text[]) as seed(code)`, [codes, createdBy])
}

test('#851 key coverage combines all import parts', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await seedZones(rows.map((r) => r.code), admin.user!)
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([{ column: 'code', matched: 520, complete: true, can_match: true }])
})

test('#851 readable coverage survives aggregation without write permission', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await seedZones(rows.map((r) => r.code), admin.user!)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Ika Reader' } })
  await grantRole(admin, { table: 'Ika Zone', role: 'Ika Reader', can_read: true, can_create: true, can_write: false })
  const user = await createUser({ roles: ['Ika Reader'] })
  setSession(user.token!, { row_id: user.user!, email: null, full_name: null })
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([{ column: 'code', matched: 520, complete: true, can_match: false }])
})

test('#851 matching permission must hold in every import part', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Ika Reader' } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Ika Own Writer' } })
  await grantRole(admin, { table: 'Ika Zone', role: 'Ika Reader', can_read: true, can_create: true })
  await grantRole(admin, { table: 'Ika Zone', role: 'Ika Own Writer', can_write: true, own_rows_only: true })
  const user = await createUser({ roles: ['Ika Reader', 'Ika Own Writer'] })
  // The last part is the user's own and writable, so accepting its
  // permission alone must not erase the first part's refusal.
  await seedZones(rows.slice(0, 500).map((r) => r.code), admin.user!)
  await seedZones(rows.slice(500).map((r) => r.code), user.user!)
  setSession(user.token!, { row_id: user.user!, email: null, full_name: null })
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([{ column: 'code', matched: 520, complete: true, can_match: false }])
})

test('#851 a duplicate spanning import parts is not a candidate', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await seedZones(rows.map((r) => r.code), admin.user!)
  rows[519].code = ' Z0 '
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([])
})

test('#851 partial remembered-key coverage stays incomplete across parts', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await seedZones(rows.slice(0, 510).map((r) => r.code), admin.user!)
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([{ column: 'code', matched: 510, complete: false, can_match: true }])
})

test('#851 an ambiguous key in the last part removes the candidate', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await seedZones([...rows.map((r) => r.code), 'Z519'], admin.user!)
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([])
})

test('#851 key analysis failures reach the caller', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await expect(analyzeImportKeys({ table: 'Missing Key Table', columns: ['code'], rows: [{ sourceIndex: 0, values: { code: 'Z0' } }] }))
    .rejects.toThrow()
})
