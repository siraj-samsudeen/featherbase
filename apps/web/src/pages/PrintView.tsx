import { useQuery } from '@tanstack/react-query'
import { api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta, type DocField } from '../lib/meta'

type Doc = Record<string, unknown>

interface PrintFormat {
  name: string
  is_default: boolean
  template: string
}

// PRN-002: {{ field }} interpolation over a document. Admin-authored
// templates are trusted (like Frappe's Jinja print formats).
function interpolate(template: string, doc: Doc): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = doc[key]
    if (v == null) return ''
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return String(v)
  })
}

// PRN-001: clean, printable rendering of any document from its metadata —
// no app chrome (navbar/sidebar). Rendered at /print/:doctype/:name so it
// sits outside the Desk layout. PRN-002: an optional named/default Print
// Format template overrides the auto layout.
export function PrintView({
  doctype,
  name,
  format,
  onFormatChange,
}: {
  doctype: string
  name: string
  format?: string
  onFormatChange?: (name: string | undefined) => void
}) {
  const meta = useMeta(doctype)
  const doc = useQuery({
    queryKey: ['doc', doctype, name],
    enabled: Boolean(meta.data),
    queryFn: () =>
      api.get<Doc>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })
  const formats = useQuery({
    queryKey: ['print-formats', doctype],
    queryFn: () =>
      listResource<PrintFormat>('Print Format', {
        filters: [['doc_type', '=', doctype]],
        fields: ['name', 'is_default', 'template'],
        order_by: 'name asc',
        limit_page_length: 100,
      }),
  })

  if (meta.isLoading || doc.isLoading)
    return <p className="p-8 text-sm text-gray-500">Loading…</p>
  if (meta.isError || doc.isError)
    return <p className="p-8 text-sm text-red-600">Cannot load {doctype} {name}</p>

  const m = meta.data!
  const d = doc.data!

  const formatList = formats.data?.data ?? []
  // ?format=<name> selects that format; ?format=standard forces the auto
  // layout; no param falls back to the DocType's default format (if any).
  const active =
    format === 'standard'
      ? undefined
      : (format && formatList.find((f) => f.name === format)) ||
        (format === undefined ? formatList.find((f) => f.is_default) : undefined)
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
        <div className="flex items-center gap-2 print:hidden">
          {formatList.length > 0 && (
            <select
              value={active?.name ?? 'standard'}
              onChange={(e) => onFormatChange?.(e.target.value)}
              className="fc-input w-44"
              data-testid="print-format-picker"
            >
              <option value="standard">Standard (auto)</option>
              {formatList.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                  {f.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => window.print()} className="fc-btn" data-testid="print-button">
            Print
          </button>
        </div>
      </div>

      {active ? (
        <div
          data-testid="print-format-body"
          data-format={active.name}
          dangerouslySetInnerHTML={{ __html: interpolate(active.template ?? '', d) }}
        />
      ) : (
        <AutoLayout m={m} d={d} fmt={fmt} />
      )}
    </div>
  )
}

function AutoLayout({
  m,
  d,
  fmt,
}: {
  m: import('../lib/meta').DocTypeMeta
  d: Doc
  fmt: (v: unknown) => string
}) {
  const scalarFields = m.fields.filter(
    (f) => !NO_COLUMN_TYPES.has(f.fieldtype) && f.fieldtype !== 'Table' && !f.hidden,
  )
  const tableFields = m.fields.filter((f) => f.fieldtype === 'Table' && !f.hidden)
  return (
    <div data-testid="print-auto-layout">

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
