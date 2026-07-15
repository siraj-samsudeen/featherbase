import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listResource } from '../lib/api'
import { listColumns, useMeta } from '../lib/meta'

const PAGE = 20

function cell(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return String(value)
}

// UI-002: ONE list component renders every DocType from its metadata.
export function ListView({ doctype }: { doctype: string }) {
  const meta = useMeta(doctype)
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const [start, setStart] = useState(0)

  const columns = meta.data ? listColumns(meta.data) : []
  const orderBy = sort
    ? `${sort.field} ${sort.dir}`
    : meta.data
      ? `${meta.data.sort_field || 'modified'} ${meta.data.sort_order || 'desc'}`
      : undefined

  const list = useQuery({
    queryKey: ['list', doctype, columns.map((c) => c.fieldname), orderBy, start],
    enabled: Boolean(meta.data),
    placeholderData: keepPreviousData,
    queryFn: () =>
      listResource(doctype, {
        fields: columns.map((c) => c.fieldname),
        order_by: orderBy,
        limit_start: start,
        limit_page_length: PAGE,
      }),
  })

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (meta.isError) return <p className="text-sm text-red-600">Cannot load {doctype}</p>

  const total = list.data?.total ?? 0
  const rows = list.data?.data ?? []

  function toggleSort(field: string) {
    setStart(0)
    setSort((s) =>
      s?.field === field
        ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    )
  }

  return (
    <div data-testid="list-view">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">{doctype}</h1>
        <span className="text-xs text-gray-500" data-testid="list-total">
          {total} total
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              {columns.map((col) => (
                <th key={col.fieldname} className="border-b border-gray-200">
                  <button
                    className="w-full px-3 py-2 text-left font-medium text-gray-600 hover:text-gray-900"
                    data-testid={`col-${col.fieldname}`}
                    onClick={() => toggleSort(col.fieldname)}
                  >
                    {col.label}
                    {sort?.field === col.fieldname && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="list-rows">
            {rows.map((row) => (
              <tr key={String(row.name)} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                {columns.map((col, i) => (
                  <td key={col.fieldname} className="px-3 py-2">
                    {i === 0 ? (
                      <Link
                        to="/desk/$doctype/$name"
                        params={{ doctype, name: String(row.name) }}
                        className="text-gray-900 underline-offset-2 hover:underline"
                      >
                        {cell(row[col.fieldname])}
                      </Link>
                    ) : (
                      <span className="text-gray-700">{cell(row[col.fieldname])}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-400">
                  No documents
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button
          disabled={start === 0}
          onClick={() => setStart((s) => Math.max(0, s - PAGE))}
          data-testid="prev-page"
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-xs text-gray-500" data-testid="page-info">
          {total === 0 ? 0 : start + 1}–{Math.min(start + PAGE, total)} of {total}
        </span>
        <button
          disabled={start + PAGE >= total}
          onClick={() => setStart((s) => s + PAGE)}
          data-testid="next-page"
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
