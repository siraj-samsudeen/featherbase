import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
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
    filters: [{ fieldname: 'n', label: 'N', fieldtype: 'Int' }],
    execute: async (filters) => ({
      columns: ['n', 'doubled'],
      rows: [{ n: filters.n ?? 0, doubled: Number(filters.n ?? 0) * 2 }],
    }),
  })
  await admin.post('/api/save_doc', {
    doctype: 'Report',
    doc: { name: REPORT, ref_doctype: 'User', report_type: 'Script Report', report_script: 'Srv Echo' },
  })
}

describe('RPT-005: script reports', () => {
  test('exposes the registered report and its declared filters', async ({ admin }) => {
    await setup(admin)
    const meta = await scriptReportMeta(REPORT, 'Administrator')
    expect(meta.script).toBe('Srv Echo')
    expect(meta.filters).toEqual([{ fieldname: 'n', label: 'N', fieldtype: 'Int' }])
  })

  test('runs the registered execute() with the given filters', async ({ admin }) => {
    await setup(admin)
    const res = await runScriptReport(REPORT, { n: 21 }, 'Administrator')
    expect(res.columns).toEqual(['n', 'doubled'])
    expect(res.rows).toEqual([{ n: 21, doubled: 42 }])
  })

  test('loads file-based reports (the User Report sample) and scopes them', async ({ admin }) => {
    await setup(admin)
    const built = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Report',
        doc: { name: 'SR Srv Bad', ref_doctype: 'User', report_type: 'Script Report', report_script: 'User Report' },
      }),
    })
    expect(built.status).toBe(201)
    const res = await runScriptReport('SR Srv Bad', {}, 'Administrator')
    expect(res.columns).toContain('name')
    expect(res.rows.some((r) => r.name === 'Administrator')).toBe(true)
  })

  test('rejects a Report that names an unregistered script', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Report',
        doc: { name: 'SR Srv Missing', ref_doctype: 'User', report_type: 'Script Report', report_script: 'No Such Report' },
      }),
    })
    expect(res.status).toBe(201)
    await expect(runScriptReport('SR Srv Missing', {}, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })
})
