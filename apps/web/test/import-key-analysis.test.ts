import { afterEach } from 'vitest'
import { clearSession, setSession } from '../src/lib/api'
import { analyzeImportKeys } from '../src/lib/import-run'
import { test, expect } from './pg-test'

afterEach(() => clearSession())

test('#851 key coverage combines all import parts', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await admin.post('/api/table/Ika%20Zone:import', { rows })
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([{ column: 'code', matched: 520, complete: true }])
})

test('#851 a duplicate spanning import parts is not a candidate', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await admin.post('/api/table/Ika%20Zone:import', { rows })
  rows[519].code = ' Z0 '
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([])
})

test('#851 partial remembered-key coverage stays incomplete across parts', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await admin.post('/api/table/Ika%20Zone:import', { rows: rows.slice(0, 510) })
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([{ column: 'code', matched: 510, complete: false }])
})

test('#851 an ambiguous key in the last part removes the candidate', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', { name: 'Ika Zone', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const rows = Array.from({ length: 520 }, (_, i) => ({ code: `Z${i}` }))
  await admin.post('/api/table/Ika%20Zone:import', { rows: [...rows, { code: 'Z519' }] })
  expect(await analyzeImportKeys({ table: 'Ika Zone', columns: ['code'], rows: rows.map((values, sourceIndex) => ({ values, sourceIndex })) }))
    .toEqual([])
})

test('#851 key analysis failures reach the caller', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await expect(analyzeImportKeys({ table: 'Missing Key Table', columns: ['code'], rows: [{ sourceIndex: 0, values: { code: 'Z0' } }] }))
    .rejects.toThrow()
})
