import { AppError } from './errors'
import { getDoc, saveDoc } from './document'
import { runReportRows } from './auto-email-report'

// RPT-006: derive a { label, value }[] chart series from a saved report's rows,
// and pin such a chart onto a Dashboard so it renders alongside its cards.

export interface ReportChartSpec {
  report: string
  label_field?: string
  value_field?: string
  group_by?: string
}

function isNumeric(v: unknown): boolean {
  return v != null && v !== '' && !Number.isNaN(Number(v))
}

// Choose sensible defaults: the label is the first non-`name` column, the value
// is the first column whose data is numeric.
function pickFields(
  columns: string[],
  rows: Record<string, unknown>[],
  spec: ReportChartSpec,
): { labelField: string; valueField: string } {
  const labelField = spec.label_field ?? columns.find((c) => c !== 'name') ?? columns[0]
  const valueField =
    spec.value_field ??
    columns.find((c) => c !== labelField && rows.some((r) => isNumeric(r[c]))) ??
    columns.find((c) => c !== labelField) ??
    columns[0]
  return { labelField, valueField }
}

// Run the report and shape its rows into chart points. With `group_by`, rows are
// aggregated into per-group counts; otherwise each row becomes a bar
// (label_field → value_field). Permissions are enforced by runReportRows.
export async function runReportChart(
  spec: ReportChartSpec,
  user: string,
): Promise<{ data: { label: string; value: number }[] }> {
  if (!spec.report) throw new AppError('ValidationError', 'Expected { report }')
  const { columns, rows } = await runReportRows(spec.report, user)

  if (spec.group_by) {
    if (!columns.includes(spec.group_by))
      throw new AppError('ValidationError', `Unknown group_by field ${spec.group_by}`)
    const counts = new Map<string, number>()
    for (const r of rows) {
      const key = r[spec.group_by] == null ? '' : String(r[spec.group_by])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return { data: [...counts.entries()].map(([label, value]) => ({ label, value })) }
  }

  const { labelField, valueField } = pickFields(columns, rows, spec)
  return {
    data: rows.map((r) => ({
      label: r[labelField] == null ? '' : String(r[labelField]),
      value: isNumeric(r[valueField]) ? Number(r[valueField]) : 0,
    })),
  }
}

interface DashboardChart {
  label: string
  report: string
  label_field?: string
  value_field?: string
  group_by?: string
}
interface DashboardConfig {
  cards?: unknown[]
  charts?: (DashboardChart | Record<string, unknown>)[]
}

// RPT-006: pin a report-driven chart onto a Dashboard's config.charts. Idempotent
// on the chart label (re-pinning updates in place). Goes through saveDoc, so the
// caller's write permission on Dashboard is enforced.
export async function pinChartToDashboard(
  dashboard: string,
  chart: DashboardChart,
  user: string,
): Promise<Record<string, unknown>> {
  if (!chart?.report || !chart?.label)
    throw new AppError('ValidationError', 'Expected chart { label, report }')
  const dash = await getDoc('Dashboard', dashboard, user)
  const cfgRaw = dash.config
  const config: DashboardConfig =
    typeof cfgRaw === 'string' ? (JSON.parse(cfgRaw || '{}') as DashboardConfig) : ((cfgRaw as DashboardConfig) ?? {})
  const charts = Array.isArray(config.charts) ? [...config.charts] : []
  const at = charts.findIndex((ch) => (ch as DashboardChart).label === chart.label)
  if (at >= 0) charts[at] = chart
  else charts.push(chart)
  const nextConfig = { ...config, charts }
  // Carry the loaded `modified` stamp (as a full-precision ISO string) so the
  // optimistic-concurrency check on updates passes — a bare Date stringifies
  // without milliseconds and would spuriously conflict.
  const modified = dash.modified ? new Date(dash.modified as string).toISOString() : undefined
  return saveDoc('Dashboard', { name: dashboard, modified, config: nextConfig }, user)
}
