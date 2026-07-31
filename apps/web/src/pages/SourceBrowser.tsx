import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError, api } from '../lib/api'

// EDS-2: the Data Source browser — introspect a source, pick tables, reflect
// them into bound Tables. Admin tooling (System Manager only server-side),
// reached from the Data Source form; the reflected Tables themselves render
// through the generic ListView/FormView (invariant 3 stays intact).

interface Candidate {
  schema: string
  table: string
  pk: string | null
  bindable: boolean
  reason?: string
  proposed_name: string
  already_reflected: string | null
  columns: { name: string; data_type: string; column_type: string; is_pk: boolean }[]
}

interface IntrospectResult {
  source: string
  engine: string
  access: string
  tables: Candidate[]
}

export default function SourceBrowser({ name }: { name: string }) {
  const [schema, setSchema] = useState('')
  const [prefix, setPrefix] = useState('')
  const [module, setModule] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [testResult, setTestResult] = useState<string | null>(null)
  const [reflectResult, setReflectResult] = useState<
    | { created: { table: string; name: string }[]; skipped: { table: string; reason: string }[] }
    | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadKey, setLoadKey] = useState(0)

  const encoded = encodeURIComponent(name)
  const introspect = useQuery({
    queryKey: ['source-introspect', name, loadKey],
    enabled: loadKey > 0,
    queryFn: () =>
      api.get<IntrospectResult>(
        `/api/table/Data%20Source/${encoded}:introspect${
          schema ? `?schema=${encodeURIComponent(schema)}` : ''
        }${prefix ? `${schema ? '&' : '?'}prefix=${encodeURIComponent(prefix)}` : ''}`,
      ),
  })

  async function testConnection() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(
        `/api/table/Data%20Source/${encoded}:test_connection`,
        {},
      )
      setTestResult(r.ok ? 'Connection OK' : `Failed: ${r.error}`)
    } catch (e) {
      setTestResult(e instanceof ApiError ? `Failed: ${e.message}` : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function reflect() {
    if (!selected.size) return
    setBusy(true)
    setError(null)
    setReflectResult(null)
    try {
      const r = await api.post<NonNullable<typeof reflectResult>>(
        `/api/table/Data%20Source/${encoded}:reflect`,
        {
          schema: schema || undefined,
          tables: [...selected],
          module: module || undefined,
          prefix: prefix || undefined,
        },
      )
      setReflectResult(r)
      setSelected(new Set())
      setLoadKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reflect failed')
    } finally {
      setBusy(false)
    }
  }

  const tables = introspect.data?.tables ?? []

  return (
    <div data-testid="source-browser">
      <div className="mb-4">
        <div className="text-xs text-[var(--color-ink-faint)]">
          <Link to="/desk" className="hover:text-[var(--color-ink)]">Home</Link>
          {' / '}
          <Link
            to="/desk/$doctype/$name"
            params={{ doctype: 'Data Source', name }}
            className="hover:text-[var(--color-ink)]"
          >
            Data Source
          </Link>
          {' / '}
          {name}
        </div>
        <h1 className="text-xl font-semibold text-[var(--color-ink)]">Source browser: {name}</h1>
        {introspect.data && (
          <span className="text-xs text-[var(--color-ink-muted)]">
            {introspect.data.engine} · {introspect.data.access.replace('_', '-')}
          </span>
        )}
      </div>

      <div className="fc-card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="fc-label">Schema (optional)</span>
          <input
            className="fc-input w-48"
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            placeholder="e.g. control or gold.main"
            data-testid="sb-schema"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fc-label">Name prefix (optional)</span>
          <input
            className="fc-input w-36"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="e.g. Gold"
            data-testid="sb-prefix"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fc-label">Module (optional)</span>
          <input
            className="fc-input w-40"
            value={module}
            onChange={(e) => setModule(e.target.value)}
            placeholder={`defaults to ${name}`}
            data-testid="sb-module"
          />
        </label>
        <button
          className="fc-btn"
          onClick={() => setLoadKey((k) => k + 1)}
          disabled={busy || introspect.isFetching}
          data-testid="sb-load"
        >
          {introspect.isFetching ? 'Loading…' : 'Load tables'}
        </button>
        <button className="fc-btn" onClick={testConnection} disabled={busy} data-testid="sb-test">
          Test connection
        </button>
        {testResult && (
          <span
            className={`text-sm ${testResult === 'Connection OK' ? 'text-[var(--color-good)]' : 'text-[var(--color-danger)]'}`}
            data-testid="sb-test-result"
          >
            {testResult}
          </span>
        )}
      </div>

      {introspect.isError && (
        <p className="mb-3 text-sm text-[var(--color-danger)]">
          {introspect.error instanceof ApiError ? introspect.error.message : 'Introspection failed'}
        </p>
      )}
      {error && <p className="mb-3 text-sm text-[var(--color-danger)]" data-testid="sb-error">{error}</p>}

      {reflectResult && (
        <div className="fc-card mb-4 p-4 text-sm" data-testid="sb-result">
          {reflectResult.created.length > 0 && (
            <p>
              Created:{' '}
              {reflectResult.created.map((c, i) => (
                <span key={c.name}>
                  {i > 0 && ', '}
                  <Link
                    to="/desk/$doctype"
                    params={{ doctype: c.name }}
                    search={{ filters: undefined }}
                    className="text-[var(--color-brand)] hover:underline"
                  >
                    {c.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {reflectResult.skipped.length > 0 && (
            <p className="text-[var(--color-ink-muted)]">
              Skipped: {reflectResult.skipped.map((s) => `${s.table} (${s.reason})`).join('; ')}
            </p>
          )}
        </div>
      )}

      {tables.length > 0 && (
        <div className="fc-card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2">Source table</th>
                <th className="px-3 py-2">Primary key</th>
                <th className="px-3 py-2">Columns</th>
                <th className="px-3 py-2">Desk Table</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                const key = t.table
                const selectable = t.bindable && !t.already_reflected
                return (
                  <tr
                    key={`${t.schema}.${t.table}`}
                    className="border-b border-[var(--color-border)] last:border-0"
                    data-testid={`sb-row-${t.table}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={!selectable}
                        checked={selected.has(key)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {t.schema ? `${t.schema}.` : ''}
                      {t.table}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{t.pk ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                      {t.columns.length}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {t.already_reflected ? (
                        <Link
                          to="/desk/$doctype"
                          params={{ doctype: t.already_reflected }}
                          search={{ filters: undefined }}
                          className="text-[var(--color-brand)] hover:underline"
                        >
                          {t.already_reflected}
                        </Link>
                      ) : t.bindable ? (
                        t.proposed_name
                      ) : (
                        <span className="text-[var(--color-danger)]">{t.reason}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tables.length > 0 && (
        <div className="mt-4">
          <button
            className="fc-btn-primary disabled:opacity-40"
            onClick={reflect}
            disabled={busy || !selected.size}
            data-testid="sb-reflect"
          >
            {busy ? 'Reflecting…' : `Reflect ${selected.size || ''} table${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  )
}
