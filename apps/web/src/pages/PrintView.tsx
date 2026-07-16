import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta, type DocField } from '../lib/meta'

type Doc = Record<string, unknown>

// PRN-001: clean, printable rendering of any document from its metadata —
// no app chrome (navbar/sidebar). Rendered at /print/:doctype/:name so it
// sits outside the Desk layout.
export function PrintView({ doctype, name }: { doctype: string; name: string }) {
  const meta = useMeta(doctype)
  const doc = useQuery({
    queryKey: ['doc', doctype, name],
    enabled: Boolean(meta.data),
    queryFn: () =>
      api.get<Doc>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })

  if (meta.isLoading || doc.isLoading)
    return <p className="p-8 text-sm text-gray-500">Loading…</p>
  if (meta.isError || doc.isError)
    return <p className="p-8 text-sm text-red-600">Cannot load {doctype} {name}</p>

  const m = meta.data!
  const d = doc.data!
  const fmt = (v: unknown) => {
    if (v == null || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return String(v)
  }

  const scalarFields = m.fields.filter(
    (f) => !NO_COLUMN_TYPES.has(f.fieldtype) && f.fieldtype !== 'Table' && !f.hidden,
  )
  const tableFields = m.fields.filter((f) => f.fieldtype === 'Table' && !f.hidden)

  return (
    <div
      className="mx-auto max-w-3xl bg-white p-10 text-[var(--color-ink)] print:p-0"
      data-testid="print-view"
    >
      <div className="mb-6 flex items-start justify-between border-b border-[var(--color-border-strong)] pb-4">
        <div>
          <h1 className="text-2xl font-semibold">{doctype}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]" data-testid="print-docname">
            {name}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="fc-btn print:hidden"
          data-testid="print-button"
        >
          Print
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
        {scalarFields.map((f: DocField) => (
          <div key={f.fieldname} className="break-inside-avoid" data-testid={`print-field-${f.fieldname}`}>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
              {f.label ?? f.fieldname}
            </dt>
            <dd className="text-sm" data-print-value={f.fieldname}>
              {fmt(d[f.fieldname])}
            </dd>
          </div>
        ))}
      </dl>

      {tableFields.map((tf) => {
        const rows = (d[tf.fieldname] as Doc[] | undefined) ?? []
        const childMeta = m // child columns come from the row keys
        void childMeta
        const cols = rows.length ? Object.keys(rows[0]).filter((k) => visibleChildCol(k)) : []
        return (
          <div key={tf.fieldname} className="mt-8" data-testid={`print-table-${tf.fieldname}`}>
            <h2 className="mb-2 text-sm font-semibold">{tf.label ?? tf.fieldname}</h2>
            <table className="w-full border border-[var(--color-border-strong)] text-sm">
              <thead className="bg-[var(--color-subtle)] text-left">
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="border border-[var(--color-border)] px-2 py-1 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} data-testid="print-table-row">
                    {cols.map((c) => (
                      <td key={c} className="border border-[var(--color-border)] px-2 py-1">
                        {fmt(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="px-2 py-2 text-[var(--color-ink-faint)]">No rows</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// Child rows carry framework columns; only show meaningful ones in print.
const HIDDEN_CHILD_COLS = new Set([
  'name',
  'owner',
  'creation',
  'modified',
  'modified_by',
  'docstatus',
  'idx',
  'parent',
  'parenttype',
  'parentfield',
])
function visibleChildCol(key: string): boolean {
  return !HIDDEN_CHILD_COLS.has(key)
}
