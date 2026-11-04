// The import run's failures read in the file's own row order, whichever stage
// refused them — the duplicate gate before sending, or the server per row
// (merged web coverage, ADR 0012: no test had two failures to order). Real
// in-process server; the session is the Administrator's.
import { afterEach } from 'vitest'
import { clearSession, setSession } from '../src/lib/api'
import { sendImportRun } from '../src/lib/import-run'
import { test, expect } from './pg-test'

afterEach(() => clearSession())

test('failures from the duplicate gate and from the server come back in source-row order', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', {
    name: 'Iro Zone',
    columns: [
      { column_name: 'zone', column_type: 'Data', label: 'Zone', unique: true },
      { column_name: 'pop', column_type: 'Int', label: 'Pop', reqd: true },
    ],
  })
  const report = await sendImportRun({
    table: 'Iro Zone',
    upsert: { key_column: 'zone', empty_cells: 'keep', columns: ['zone', 'pop'] },
    rows: [
      { sourceIndex: 0, values: { zone: 'Alpha', pop: 1 } },
      { sourceIndex: 2, values: { zone: 'Bravo' } }, // the server refuses: pop is required
      { sourceIndex: 4, values: { zone: 'Dup', pop: 2 } }, // the gate refuses both Dups
      { sourceIndex: 5, values: { zone: 'Charlie', pop: 3 } },
      { sourceIndex: 7, values: { zone: 'Dup', pop: 4 } },
    ],
  })
  expect(report.failed.map((f) => f.sourceIndex)).toEqual([2, 4, 7])
  expect(report.inserted).toBe(2)
})

test('#851 changes in separate import parts count together', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.post('/api/table_def', {
    name: 'Iro Zone', track_changes: false,
    columns: [
      { column_name: 'zone', column_type: 'Data' },
      { column_name: 'pop', column_type: 'Int' },
    ],
  })
  const original = Array.from({ length: 520 }, (_, i) => ({ zone: `Z${i}`, pop: 1000 + i }))
  await admin.post('/api/table/Iro%20Zone:import', { rows: original })
  const report = await sendImportRun({
    table: 'Iro Zone', dryRun: true,
    upsert: { key_column: 'zone', empty_cells: 'keep', columns: ['zone', 'pop'] },
    rows: original.map((row, i) => ({ sourceIndex: i, values: {
      ...row, pop: row.pop + (i < 11 || (i >= 500 && i < 510) ? 7 : 0),
    } })),
  })
  expect(report).toMatchObject({
    updated: 520, changed: 21, unchanged: 499, inserted: 0,
    fields_updated: 21, fields_kept: 0, rows_kept: 0, conflicts: 0, failed: [],
  })
})
