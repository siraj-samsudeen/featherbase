import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'
import { runReportChart, pinChartToDashboard } from '../src/report-chart'
import { getDoc } from '../src/document'

// RPT-006: a chart series derived from a saved report's rows, and pinning it
// onto a dashboard.

const DT = 'Rc Srv Sale'
const REPORT = 'Rc Srv Report'
const DASH = 'Rc Srv Dashboard'

async function cleanup() {
  await sql`delete from tab_dashboard where name = ${DASH}`
  await sql`delete from tab_report where name = ${REPORT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_rc_srv_sale')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      autoname: 'prompt',
      fields: [
        { fieldname: 'region', fieldtype: 'Select', options: 'North\nSouth', in_list_view: true },
        { fieldname: 'amount', fieldtype: 'Int', in_list_view: true },
      ],
    }),
  })
  const rows = [
    ['s1', 'North', 100],
    ['s2', 'South', 50],
    ['s3', 'North', 25],
  ]
  for (const [name, region, amount] of rows)
    await areq(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ name, region, amount }),
    })

  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'Report',
      doc: { name: REPORT, ref_doctype: DT, report_type: 'Report Builder', config: { columns: ['region', 'amount'], filters: [] } },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Dashboard', doc: { name: DASH, label: 'RC Dash', config: { cards: [], charts: [] } } }),
  })
})

afterAll(cleanup)

describe('RPT-006: report charts', () => {
  it('derives a per-row chart using explicit label/value fields', async () => {
    const { data } = await runReportChart(
      { report: REPORT, label_field: 'region', value_field: 'amount' },
      'Administrator',
    )
    // Order follows list order (modified desc); assert as a set of pairs.
    const pairs = data.map((d) => `${d.label}:${d.value}`).sort()
    expect(pairs).toEqual(['North:100', 'North:25', 'South:50'])
  })

  it('derives an aggregated chart with group_by (per-group counts)', async () => {
    const { data } = await runReportChart({ report: REPORT, group_by: 'region' }, 'Administrator')
    const byLabel = Object.fromEntries(data.map((d) => [d.label, d.value]))
    expect(byLabel).toEqual({ North: 2, South: 1 })
  })

  it('picks sensible default fields when none are given', async () => {
    const { data } = await runReportChart({ report: REPORT }, 'Administrator')
    // label defaults to first non-name column (region), value to first numeric (amount).
    expect(data.every((d) => ['North', 'South'].includes(d.label))).toBe(true)
    expect(data.reduce((s, d) => s + d.value, 0)).toBe(175)
  })

  it('pins the chart onto the dashboard config (idempotent on label)', async () => {
    await pinChartToDashboard(
      DASH,
      { label: REPORT, report: REPORT, group_by: 'region' },
      'Administrator',
    )
    let dash = await getDoc('Dashboard', DASH, 'Administrator')
    let charts = (dash.config as { charts: { label: string; report: string }[] }).charts
    expect(charts).toHaveLength(1)
    expect(charts[0]).toMatchObject({ label: REPORT, report: REPORT, group_by: 'region' })

    // Re-pinning the same label updates in place rather than duplicating.
    await pinChartToDashboard(
      DASH,
      { label: REPORT, report: REPORT, label_field: 'region', value_field: 'amount' },
      'Administrator',
    )
    dash = await getDoc('Dashboard', DASH, 'Administrator')
    charts = (dash.config as { charts: { label: string; report: string }[] }).charts
    expect(charts).toHaveLength(1)
    expect(charts[0]).toMatchObject({ value_field: 'amount' })
  })
})
