import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'

// UI-026: renders a saved Dashboard — number cards and bar charts computed on
// demand from live data through the permission-scoped dashboard endpoints.

type Filter = [string, string, unknown]
interface CardCfg {
  label: string
  doctype: string
  filters?: Filter[]
}
interface ChartCfg {
  label: string
  // A chart is driven EITHER by a DocType + group_by (UI-026) OR by a saved
  // Report (RPT-006). Report-driven charts recompute from live report data.
  doctype?: string
  group_by?: string
  filters?: Filter[]
  report?: string
  label_field?: string
  value_field?: string
}
interface DashboardConfig {
  cards?: CardCfg[]
  charts?: ChartCfg[]
}

function NumberCard({ card }: { card: CardCfg }) {
  const q = useQuery({
    queryKey: ['dash-count', card.doctype, card.filters, card.label],
    queryFn: () =>
      api.post<{ count: number }>('/api/dashboard/count', {
        doctype: card.doctype,
        filters: card.filters ?? [],
      }),
  })
  return (
    <div className="fc-card p-4" data-testid={`card-${card.label}`}>
      <div className="text-sm text-[var(--color-ink-muted)]">{card.label}</div>
      <div className="mt-1 text-3xl font-semibold text-[var(--color-ink)]" data-testid={`card-value-${card.label}`}>
        {q.data ? q.data.count : q.isError ? '—' : '…'}
      </div>
    </div>
  )
}

function BarChart({ chart }: { chart: ChartCfg }) {
  const q = useQuery({
    queryKey: ['dash-chart', chart.report, chart.doctype, chart.group_by, chart.label_field, chart.value_field, chart.filters, chart.label],
    queryFn: () =>
      chart.report
        ? api.post<{ data: { label: string; value: number }[] }>('/api/report_chart', {
            report: chart.report,
            label_field: chart.label_field,
            value_field: chart.value_field,
            group_by: chart.group_by,
          })
        : api.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', {
            doctype: chart.doctype,
            group_by: chart.group_by,
            filters: chart.filters ?? [],
          }),
  })
  const rows = q.data?.data ?? []
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1
  return (
    <div className="fc-card p-4" data-testid={`chart-${chart.label}`}>
      <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">{chart.label}</div>
      {q.isError && <div className="text-sm text-red-600">Failed to load</div>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2" data-testid={`bar-${r.label}`}>
            <div className="w-24 shrink-0 truncate text-xs text-[var(--color-ink-muted)]">{r.label || '—'}</div>
            <div className="h-5 flex-1 rounded bg-[var(--color-subtle)]">
              <div
                className="h-5 rounded bg-[var(--color-brand)]"
                style={{ width: `${Math.round((r.value / max) * 100)}%`, minWidth: r.value ? '2px' : 0 }}
              />
            </div>
            <div className="w-8 shrink-0 text-right text-xs tabular-nums text-[var(--color-ink)]" data-testid={`bar-value-${r.label}`}>
              {r.value}
            </div>
          </div>
        ))}
        {!rows.length && !q.isLoading && (
          <div className="text-sm text-[var(--color-ink-faint)]">No data</div>
        )}
      </div>
    </div>
  )
}

export function DashboardView({ name }: { name: string }) {
  const dash = useQuery({
    queryKey: ['dashboard', name],
    queryFn: () => api.get<{ name: string; label?: string; config?: DashboardConfig | string }>(`/api/resource/Dashboard/${encodeURIComponent(name)}`),
  })

  if (dash.isError)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="dashboard-error">
        {dash.error instanceof ApiError ? dash.error.message : 'Dashboard not found'}
      </div>
    )
  if (!dash.data) return <div className="p-4 text-[var(--color-ink-faint)]">Loading…</div>

  const cfgRaw = dash.data.config
  const config: DashboardConfig =
    typeof cfgRaw === 'string' ? (JSON.parse(cfgRaw || '{}') as DashboardConfig) : (cfgRaw ?? {})
  const cards = config.cards ?? []
  const charts = config.charts ?? []

  return (
    <div data-testid="dashboard" className="space-y-6">
      <h1 className="text-lg font-semibold text-[var(--color-ink)]" data-testid="dashboard-title">
        {dash.data.label || dash.data.name}
      </h1>

      {cards.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="dashboard-cards">
          {cards.map((c) => (
            <NumberCard key={c.label} card={c} />
          ))}
        </div>
      )}

      {charts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="dashboard-charts">
          {charts.map((c) => (
            <BarChart key={c.label} chart={c} />
          ))}
        </div>
      )}
    </div>
  )
}
