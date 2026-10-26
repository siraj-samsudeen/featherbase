import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { loadScriptReports, runScriptReport, scriptReportMeta, registerScriptReport } from '../src/script-report'

// RPT-005: script reports resolve a registered server function via the Report
// doc, expose its declared filters, and run it with permission-scoped data.

const REPORT = 'SR Srv Users'

// The script-report registry is process-global with no unregister API;
// re-registering 'Srv Echo' is an idempotent Map.set, and the name is unique
// to this file, so leaving it registered leaks nothing observable.
async function setup(admin: TestClient) {
  await loadScriptReports()
  // A synthetic report with declared filters, for deterministic assertions.
  registerScriptReport({
    name: 'Srv Echo',
    filters: [{ column_name: 'n', label: 'N', column_type: 'Int' }],
    execute: async (filters) => ({
      columns: ['n', 'doubled'],
      rows: [{ n: filters.n ?? 0, doubled: Number(filters.n ?? 0) * 2 }],
    }),
  })
  await admin.post('/api/save_row', {
    table: 'Report',
    row: { row_id: REPORT, ref_table: 'Person', report_type: 'Script Report', report_script: 'Srv Echo' },
  })
}

describe('RPT-005: script reports', () => {
  test('exposes the registered report and its declared filters', async ({ admin }) => {
    await setup(admin)
    const meta = await scriptReportMeta(REPORT, 'Administrator')
    expect(meta.script).toBe('Srv Echo')
    expect(meta.filters).toEqual([{ column_name: 'n', label: 'N', column_type: 'Int' }])
  })

  test('runs the registered execute() with the given filters', async ({ admin }) => {
    await setup(admin)
    const res = await runScriptReport(REPORT, { n: 21 }, 'Administrator')
    expect(res.columns).toEqual(['n', 'doubled'])
    expect(res.rows).toEqual([{ n: 21, doubled: 42 }])
  })

  test('loads file-based reports (the Person Report sample) and scopes them', async ({ admin }) => {
    await setup(admin)
    const built = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({
        table: 'Report',
        row: { row_id: 'SR Srv Bad', ref_table: 'Person', report_type: 'Script Report', report_script: 'Person Report' },
      }),
    })
    expect(built.status).toBe(201)
    const res = await runScriptReport('SR Srv Bad', {}, 'Administrator')
    expect(res.columns).toContain('row_id')
    expect(res.rows.some((r) => r.row_id === 'Administrator')).toBe(true)
  })

  test('rejects a Report that names an unregistered script', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({
        table: 'Report',
        row: { row_id: 'SR Srv Missing', ref_table: 'Person', report_type: 'Script Report', report_script: 'No Such Report' },
      }),
    })
    expect(res.status).toBe(201)
    await expect(runScriptReport('SR Srv Missing', {}, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })

  test('a choice filter narrows the rows: Enabled Yes returns only enabled people, No only the others', async ({ admin, createUser }) => {
    await setup(admin)
    const gone = await createUser({ email: 'sr.gone@example.com', fullName: 'Gone Person' })
    await sql`update person set enabled = false where row_id = ${gone.user}`
    await admin.post('/api/save_row', {
      table: 'Report',
      row: { row_id: 'SR Srv Enabled', ref_table: 'Person', report_type: 'Script Report', report_script: 'Person Report' },
    })
    const meta = await scriptReportMeta('SR Srv Enabled', 'Administrator')
    expect(meta.filters.map((f) => f.label)).toEqual(['Enabled'])
    const yes = await runScriptReport('SR Srv Enabled', { enabled: 'Yes' }, 'Administrator')
    const no = await runScriptReport('SR Srv Enabled', { enabled: 'No' }, 'Administrator')
    expect(yes.rows.every((r) => r.enabled === true)).toBe(true)
    expect(yes.rows.some((r) => r.row_id === gone.user)).toBe(false)
    expect(no.rows.map((r) => r.row_id)).toContain(gone.user)
    expect(no.rows.every((r) => r.enabled === false)).toBe(true)
  })

  test('a person who may not read the Report cannot run its script', async ({ admin, createUser }) => {
    await setup(admin)
    await admin.post('/api/save_row', {
      table: 'Report',
      row: { row_id: 'SR Srv Scoped', ref_table: 'Person', report_type: 'Script Report', report_script: 'Person Report' },
    })
    const nobody = await createUser({ email: 'sr.nobody@example.com', fullName: 'No Roles' })
    // Without read access to the Report itself, the script never runs.
    await expect(runScriptReport('SR Srv Scoped', {}, String(nobody.user))).rejects.toMatchObject({ type: 'PermissionError' })
  })
})
