import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { loadScriptReports, runScriptReport, scriptReportMeta, registerScriptReport } from '../src/script-report'
import { areq } from './helpers'

// RPT-005: script reports resolve a registered server function via the Report
// doc, expose its declared filters, and run it with permission-scoped data.

const REPORT = 'SR Srv Users'

async function cleanup() {
  await sql`delete from tab_report where name in (${REPORT}, 'SR Srv Bad')`
}

beforeAll(async () => {
  await cleanup()
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
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'Report',
      doc: { name: REPORT, ref_doctype: 'User', report_type: 'Script Report', report_script: 'Srv Echo' },
    }),
  })
  if (res.status !== 201) throw new Error(`create report: ${res.status}`)
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('RPT-005: script reports', () => {
  it('exposes the registered report and its declared filters', async () => {
    const meta = await scriptReportMeta(REPORT, 'Administrator')
    expect(meta.script).toBe('Srv Echo')
    expect(meta.filters).toEqual([{ fieldname: 'n', label: 'N', fieldtype: 'Int' }])
  })

  it('runs the registered execute() with the given filters', async () => {
    const res = await runScriptReport(REPORT, { n: 21 }, 'Administrator')
    expect(res.columns).toEqual(['n', 'doubled'])
    expect(res.rows).toEqual([{ n: 21, doubled: 42 }])
  })

  it('loads file-based reports (the User Report sample) and scopes them', async () => {
    const built = await areq('/api/save_doc', {
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

  it('rejects a Report that names an unregistered script', async () => {
    await sql`delete from tab_report where name = 'SR Srv Missing'`
    const res = await areq('/api/save_doc', {
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
    await sql`delete from tab_report where name = 'SR Srv Missing'`
  })
})
