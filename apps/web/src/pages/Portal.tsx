import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { TopBar } from '../components/TopBar'
import { ThemeChoiceProvider } from '../lib/theme-choice'
import { NO_COLUMN_TYPES, useMeta, type ColumnDef } from '../lib/meta'
import { cardClasses } from '../components/ui'

type Row = Record<string, unknown>

// WEB-003: the customer portal. A logged-in website user sees only the
// rows they own (enforced server-side by own_rows_only permissions, PERM-007),
// listed outside the Admin in a minimal public shell. Opening another user's
// row returns 403 from the API and is surfaced as an access error.

// #489: the shared top bar; who is signed in, and signing out, are in its
// Account menu.
function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeChoiceProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        <TopBar />
        <main className="mx-auto w-full max-w-3xl p-6">{children}</main>
      </div>
    </ThemeChoiceProvider>
  )
}

export function PortalListPage({ table }: { table: string }) {
  const meta = useMeta(table)
  const listColumns = (meta.data?.columns ?? []).filter(
    (c) => c.in_list_view && !NO_COLUMN_TYPES.has(c.column_type) && c.column_type !== 'Sub-table',
  )
  const columns = listColumns.length ? listColumns.map((c) => c.column_name) : []

  const rows = useQuery({
    queryKey: ['portal-list', table, columns],
    enabled: Boolean(meta.data),
    queryFn: () =>
      // The API scopes this to the caller's own rows via own_rows_only.
      listResource<Row>(table, {
        fields: [...new Set(['row_id', ...columns])],
        order_by: 'updated_at desc',
        limit_page_length: 200,
      }),
  })

  const label = (fn: string) => meta.data?.columns.find((c) => c.column_name === fn)?.label ?? fn
  const cell = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

  return (
    <PortalShell>
      <h1 className="mb-4 text-xl font-semibold text-ink" data-testid="portal-title">
        My {table}
      </h1>
      {meta.isError && <p className="text-sm text-negative" data-testid="portal-error">Cannot load {table}</p>}
      <div className={cardClasses('overflow-x-auto')}>
        <table className="w-full text-sm" data-testid="portal-list">
          <thead className="bg-subtle text-left text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">{label(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.data?.data.map((row) => (
              <tr key={String(row.row_id)} className="border-t border-border" data-testid="portal-row">
                <td className="px-3 py-1.5">
                  <Link
                    to="/featherbase/portal/$table/$name"
                    params={{ table, name: String(row.row_id) }}
                    className="text-action hover:underline"
                  >
                    {String(row.row_id)}
                  </Link>
                </td>
                {columns.map((c) => (
                  <td key={c} className="px-3 py-1.5">{cell(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data?.data.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-ink-subtle" data-testid="portal-empty">
            You have no rows yet.
          </p>
        )}
      </div>
    </PortalShell>
  )
}

export function PortalRowPage({ table, name }: { table: string; name: string }) {
  const meta = useMeta(table)
  const doc = useQuery({
    retry: false,
    queryKey: ['portal-doc', table, name],
    queryFn: () => api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`),
  })

  const forbidden = doc.error instanceof ApiError && (doc.error.status === 403 || doc.error.status === 404)
  const columns = (meta.data?.columns ?? []).filter(
    (c: ColumnDef) => !NO_COLUMN_TYPES.has(c.column_type) && c.column_type !== 'Sub-table' && !c.hidden,
  )
  const val = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

  return (
    <PortalShell>
      <Link to="/featherbase/portal/$table" params={{ table }} className="mb-4 inline-block text-sm text-action hover:underline">
        ← Back to my {table}
      </Link>
      {forbidden ? (
        <div className={cardClasses('p-6 text-center')} data-testid="portal-forbidden">
          <p className="text-sm font-medium text-negative">You don't have access to this row.</p>
        </div>
      ) : doc.isLoading || meta.isLoading ? (
        <p className="text-sm text-ink-subtle">Loading…</p>
      ) : doc.data ? (
        <div className={cardClasses('p-6')} data-testid="portal-doc">
          <h1 className="mb-4 text-lg font-semibold text-ink">{name}</h1>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {columns.map((c) => (
              <div key={c.column_name}>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">{c.label ?? c.column_name}</dt>
                <dd className="text-sm text-ink" data-testid={`portal-field-${c.column_name}`}>
                  {val(doc.data[c.column_name])}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </PortalShell>
  )
}
