import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError, api, clearSession, getSessionUser, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta, type DocField } from '../lib/meta'

type Doc = Record<string, unknown>

// WEB-003: the customer portal. A logged-in website user sees only the
// documents they own (enforced server-side by if_owner permissions, PERM-007),
// listed outside the Desk in a minimal public shell. Opening another user's
// document returns 403 from the API and is surfaced as an access error.

function PortalShell({ children }: { children: React.ReactNode }) {
  const user = getSessionUser()
  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <header className="flex h-12 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-brand)] text-xs font-bold text-white">F</span>
          <span className="text-sm font-semibold text-[var(--color-ink)]">Portal</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-ink-muted)]">
          <span data-testid="portal-user">{user?.full_name || user?.name}</span>
          <button
            data-testid="portal-logout"
            onClick={() => {
              clearSession()
              window.location.href = '/login'
            }}
            className="hover:text-[var(--color-ink)]"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  )
}

export function PortalListPage({ doctype }: { doctype: string }) {
  const meta = useMeta(doctype)
  const listFields = (meta.data?.fields ?? []).filter(
    (f) => f.in_list_view && !NO_COLUMN_TYPES.has(f.fieldtype) && f.fieldtype !== 'Table',
  )
  const columns = listFields.length ? listFields.map((f) => f.fieldname) : []

  const rows = useQuery({
    queryKey: ['portal-list', doctype, columns],
    enabled: Boolean(meta.data),
    queryFn: () =>
      // The API scopes this to the caller's own documents via if_owner.
      listResource<Doc>(doctype, {
        fields: [...new Set(['name', ...columns])],
        order_by: 'modified desc',
        limit_page_length: 200,
      }),
  })

  const label = (fn: string) => meta.data?.fields.find((f) => f.fieldname === fn)?.label ?? fn
  const cell = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

  return (
    <PortalShell>
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]" data-testid="portal-title">
        My {doctype}
      </h1>
      {meta.isError && <p className="text-sm text-red-600" data-testid="portal-error">Cannot load {doctype}</p>}
      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm" data-testid="portal-list">
          <thead className="bg-[var(--color-subtle)] text-left text-xs text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">{label(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.data?.data.map((row) => (
              <tr key={String(row.name)} className="border-t border-[var(--color-border)]" data-testid="portal-row">
                <td className="px-3 py-1.5">
                  <Link
                    to="/portal/$doctype/$name"
                    params={{ doctype, name: String(row.name) }}
                    className="text-[var(--color-brand)] hover:underline"
                  >
                    {String(row.name)}
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
          <p className="px-3 py-6 text-center text-sm text-[var(--color-ink-faint)]" data-testid="portal-empty">
            You have no documents yet.
          </p>
        )}
      </div>
    </PortalShell>
  )
}

export function PortalDocPage({ doctype, name }: { doctype: string; name: string }) {
  const meta = useMeta(doctype)
  const doc = useQuery({
    retry: false,
    queryKey: ['portal-doc', doctype, name],
    queryFn: () => api.get<Doc>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })

  const forbidden = doc.error instanceof ApiError && (doc.error.status === 403 || doc.error.status === 404)
  const fields = (meta.data?.fields ?? []).filter(
    (f: DocField) => !NO_COLUMN_TYPES.has(f.fieldtype) && f.fieldtype !== 'Table' && !f.hidden,
  )
  const val = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

  return (
    <PortalShell>
      <Link to="/portal/$doctype" params={{ doctype }} className="mb-4 inline-block text-sm text-[var(--color-brand)] hover:underline">
        ← Back to my {doctype}
      </Link>
      {forbidden ? (
        <div className="fc-card p-6 text-center" data-testid="portal-forbidden">
          <p className="text-sm font-medium text-[var(--color-danger)]">You don't have access to this document.</p>
        </div>
      ) : doc.isLoading || meta.isLoading ? (
        <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>
      ) : doc.data ? (
        <div className="fc-card p-6" data-testid="portal-doc">
          <h1 className="mb-4 text-lg font-semibold text-[var(--color-ink)]">{name}</h1>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.fieldname}>
                <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">{f.label ?? f.fieldname}</dt>
                <dd className="text-sm text-[var(--color-ink)]" data-testid={`portal-field-${f.fieldname}`}>
                  {val(doc.data[f.fieldname])}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </PortalShell>
  )
}
