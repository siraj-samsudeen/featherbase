import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'

type Row = Record<string, unknown>

interface PrintFormat {
  row_id: string
  is_default: boolean
  template: string
  letter_head?: string | null
}

// PRN-004: a Letter Head is a reusable header/footer block, stored as an
// ordinary Table. It is applied to any printed row — the one marked
// is_default, one named on the Print Format, or one chosen here.
interface LetterHead {
  row_id: string
  is_default: boolean
  header_html: string
  footer_html: string
}

// PRN-002: {{ field }} interpolation over a row. Admin-authored
// templates are trusted (like Frappe's Jinja print formats).
function interpolate(template: string, doc: Row): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = doc[key]
    if (v == null) return ''
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return String(v)
  })
}

// PRN-001: clean, printable rendering of any row from its metadata —
// no app chrome (navbar/sidebar). Rendered at /print/:doctype/:name so it
// sits outside the Admin layout. PRN-002: an optional named/default Print
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
      api.get<Row>(`/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })
  const formats = useQuery({
    queryKey: ['print-formats', doctype],
    queryFn: () =>
      listResource<PrintFormat>('Print Format', {
        filters: [['ref_table', '=', doctype]],
        fields: ['row_id', 'is_default', 'template', 'letter_head'],
        order_by: 'row_id asc',
        limit_page_length: 100,
      }),
  })
  const letterHeads = useQuery({
    queryKey: ['letter-heads'],
    queryFn: () =>
      listResource<LetterHead>('Letter Head', {
        fields: ['row_id', 'is_default', 'header_html', 'footer_html'],
        order_by: 'row_id asc',
        limit_page_length: 100,
      }),
  })
  // undefined = auto (default / format-named); 'none' = suppressed; else a name.
  const [letterHeadChoice, setLetterHeadChoice] = useState<string | undefined>(undefined)

  if (meta.isLoading || doc.isLoading)
    return <p className="p-8 text-sm text-gray-500">Loading…</p>
  if (meta.isError || doc.isError)
    return <p className="p-8 text-sm text-red-600">Cannot load {doctype} {name}</p>

  const m = meta.data!
  const d = doc.data!

  const formatList = formats.data?.data ?? []
  // ?format=<name> selects that format; ?format=standard forces the auto
  // layout; no param falls back to the Table's default format (if any).
  const active =
    format === 'standard'
      ? undefined
      : (format && formatList.find((f) => f.row_id === format)) ||
        (format === undefined ? formatList.find((f) => f.is_default) : undefined)
  const fmt = (v: unknown) => {
    if (v == null || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return String(v)
  }

  // Resolve the letterhead with the same precedence as the server: explicit
  // choice > format-named > default. 'none' suppresses it.
  const lhList = letterHeads.data?.data ?? []
  const activeLetterHead =
    letterHeadChoice === 'none'
      ? undefined
      : lhList.find(
          (l) =>
            l.row_id === (letterHeadChoice ?? active?.letter_head ?? undefined),
        ) ?? (letterHeadChoice === undefined ? lhList.find((l) => l.is_default) : undefined)

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
              value={active?.row_id ?? 'standard'}
              onChange={(e) => onFormatChange?.(e.target.value)}
              className="fc-input w-44"
              data-testid="print-format-picker"
            >
              <option value="standard">Standard (auto)</option>
              {formatList.map((f) => (
                <option key={f.row_id} value={f.row_id}>
                  {f.row_id}
                  {f.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}
          {lhList.length > 0 && (
            <select
              value={letterHeadChoice ?? 'auto'}
              onChange={(e) =>
                setLetterHeadChoice(e.target.value === 'auto' ? undefined : e.target.value)
              }
              className="fc-input w-44"
              data-testid="letter-head-picker"
            >
              <option value="auto">Letterhead: default</option>
              <option value="none">No letterhead</option>
              {lhList.map((l) => (
                <option key={l.row_id} value={l.row_id}>
                  {l.row_id}
                  {l.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => window.print()} className="fc-btn" data-testid="print-button">
            Print
          </button>
        </div>
      </div>

      {activeLetterHead?.header_html && (
        <header
          data-testid="letter-head-header"
          className="mb-6 border-b-2 border-[var(--color-ink)] pb-3"
          dangerouslySetInnerHTML={{ __html: interpolate(activeLetterHead.header_html, d) }}
        />
      )}

      {active ? (
        <div
          data-testid="print-format-body"
          data-format={active.row_id}
          dangerouslySetInnerHTML={{ __html: interpolate(active.template ?? '', d) }}
        />
      ) : (
        <AutoLayout m={m} d={d} fmt={fmt} />
      )}

      {activeLetterHead?.footer_html && (
        <footer
          data-testid="letter-head-footer"
          className="mt-8 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-ink-muted)]"
          dangerouslySetInnerHTML={{ __html: interpolate(activeLetterHead.footer_html, d) }}
        />
      )}
    </div>
  )
}

function AutoLayout({
  m,
  d,
  fmt,
}: {
  m: TableMeta
  d: Row
  fmt: (v: unknown) => string
}) {
  const scalarColumns = m.columns.filter(
    (c) => !NO_COLUMN_TYPES.has(c.column_type) && c.column_type !== 'Sub-table' && !c.hidden,
  )
  const subTableColumns = m.columns.filter((c) => c.column_type === 'Sub-table' && !c.hidden)
  return (
    <div data-testid="print-auto-layout">

      <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
        {scalarColumns.map((c: ColumnDef) => (
          <div key={c.column_name} className="break-inside-avoid" data-testid={`print-field-${c.column_name}`}>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
              {c.label ?? c.column_name}
            </dt>
            <dd className="text-sm" data-print-value={c.column_name}>
              {fmt(d[c.column_name])}
            </dd>
          </div>
        ))}
      </dl>

      {subTableColumns.map((tc) => {
        const rows = (d[tc.column_name] as Row[] | undefined) ?? []
        const cols = rows.length ? Object.keys(rows[0]).filter((k) => visibleChildCol(k)) : []
        return (
          <div key={tc.column_name} className="mt-8" data-testid={`print-table-${tc.column_name}`}>
            <h2 className="mb-2 text-sm font-semibold">{tc.label ?? tc.column_name}</h2>
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

// Sub-table rows carry framework columns; only show meaningful ones in print.
const HIDDEN_CHILD_COLS = new Set([
  'row_id',
  'created_by',
  'created_at',
  'updated_at',
  'updated_by',
  'status',
  'position',
  'parent',
  'parenttype',
  'parentfield',
])
function visibleChildCol(key: string): boolean {
  return !HIDDEN_CHILD_COLS.has(key)
}
