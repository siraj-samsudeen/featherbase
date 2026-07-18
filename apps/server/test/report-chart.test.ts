import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { runReportChart, pinChartToDashboard } from '../src/report-chart'
import { getDoc } from '../src/document'

// RPT-006: a chart series derived from a saved report's rows, and pinning it
// onto a dashboard.

const DT = 'Rc Srv Sale'
const REPORT = 'Rc Srv Report'
const DASH = 'Rc Srv Dashboard'

// Each test rebuilds the DocType, rows, report, and dashboard inside its own
// rolled-back transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    autoname: 'prompt',
    fields: [
      { fieldname: 'region', fieldtype: 'Select', options: 'North\nSouth', in_list_view: true },
      { fieldname: 'amount', fieldtype: 'Int', in_list_view: true },
    ],
  })
  const rows = [
    ['s1', 'North', 100],
    ['s2', 'South', 50],
    ['s3', 'North', 25],
  ] as const
  for (const [name, region, amount] of rows)
    await admin.post(`/api/resource/${encodeURIComponent(DT)}`, { name, region, amount })

  await admin.post('/api/save_doc', {
    doctype: 'Report',
    doc: { name: REPORT, ref_doctype: DT, report_type: 'Report Builder', config: { columns: ['region', 'amount'], filters: [] } },
  })
  await admin.post('/api/save_doc', {
    doctype: 'Dashboard',
    doc: { name: DASH, label: 'RC Dash', config: { cards: [], charts: [] } },
  })
}

describe('RPT-006: report charts', () => {
  test('derives a per-row chart using explicit label/value fields', async ({ admin }) => {
    await setup(admin)
    const { data } = await runReportChart(
      { report: REPORT, label_field: 'region', value_field: 'amount' },
      'Administrator',
    )
    // Order follows list order (modified desc); assert as a set of pairs.
    const pairs = data.map((d) => `${d.label}:${d.value}`).sort()
    expect(pairs).toEqual(['North:100', 'North:25', 'South:50'])
  })

  test('derives an aggregated chart with group_by (per-group counts)', async ({ admin }) => {
    await setup(admin)
    const { data } = await runReportChart({ report: REPORT, group_by: 'region' }, 'Administrator')
    const byLabel = Object.fromEntries(data.map((d) => [d.label, d.value]))
    expect(byLabel).toEqual({ North: 2, South: 1 })
  })

  test('picks sensible default fields when none are given', async ({ admin }) => {
    await setup(admin)
    const { data } = await runReportChart({ report: REPORT }, 'Administrator')
    // label defaults to first non-name column (region), value to first numeric (amount).
    expect(data.every((d) => ['North', 'South'].includes(d.label))).toBe(true)
    expect(data.reduce((s, d) => s + d.value, 0)).toBe(175)
  })

  test('pins the chart onto the dashboard config (idempotent on label)', async ({ admin }) => {
    await setup(admin)
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
