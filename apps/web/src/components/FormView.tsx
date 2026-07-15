import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ApiError, api } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta, type DocField, type DocTypeMeta } from '../lib/meta'

type Doc = Record<string, unknown>

// UI-004/UI-005: ONE form component renders and saves every DocType from
// its metadata. Layout fields group into sections/columns (UI-008 refines).
export function FormView({ doctype, name }: { doctype: string; name: string }) {
  const isNew = name === 'new'
  const meta = useMeta(doctype)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const doc = useQuery({
    queryKey: ['doc', doctype, name],
    enabled: Boolean(meta.data) && !isNew,
    queryFn: () =>
      api.get<Doc>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })

  const [values, setValues] = useState<Doc>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const baseline = useMemo(() => {
    if (isNew) return {}
    return doc.data ?? {}
  }, [doc.data, isNew])

  useEffect(() => {
    setValues(baseline)
    setErrors({})
  }, [baseline])

  if (meta.isLoading || (!isNew && doc.isLoading))
    return <p className="text-sm text-gray-400">Loading…</p>
  if (meta.isError || (!isNew && doc.isError))
    return <p className="text-sm text-red-600">Cannot load {doctype} {name}</p>

  const m = meta.data!
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)

  function setField(fieldname: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldname]: value }))
    setErrors((e) => {
      const { [fieldname]: _drop, ...rest } = e
      return rest
    })
  }

  async function save() {
    setSaving(true)
    setBanner(null)
    setErrors({})
    try {
      const payload: Doc = { ...values }
      if (!isNew) {
        payload.name = name
        payload.modified = baseline.modified
      } else {
        delete payload.name
      }
      const saved = await api.post<Doc>('/api/save_doc', { doctype, doc: payload })
      await queryClient.invalidateQueries({ queryKey: ['doc', doctype] })
      await queryClient.invalidateQueries({ queryKey: ['list', doctype] })
      if (isNew) {
        navigate({
          to: '/desk/$doctype/$name',
          params: { doctype, name: String(saved.name) },
        })
      } else {
        setBanner('Saved')
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) setErrors(err.fields)
        setBanner(err.message)
      } else {
        setBanner('Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  // Group fields into sections split by Section Break.
  const sections: DocField[][] = [[]]
  for (const f of m.fields) {
    if (f.fieldtype === 'Section Break') sections.push([])
    else if (!f.hidden) sections[sections.length - 1].push(f)
  }

  return (
    <div data-testid="form-view" className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {doctype}: {isNew ? 'New' : name}
          </h1>
          <span className="text-xs text-gray-500" data-testid="form-status">
            {dirty ? 'Not saved' : isNew ? 'New document' : 'Saved'}
          </span>
        </div>
        <button
          onClick={save}
          disabled={saving || !dirty}
          data-testid="form-save"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {banner && (
        <p
          className={`mb-3 text-sm ${banner === 'Saved' ? 'text-green-700' : 'text-red-600'}`}
          data-testid="form-banner"
        >
          {banner}
        </p>
      )}
      {sections.map((fields, si) => (
        <div key={si} className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {fields.map((f) =>
            f.fieldtype === 'Column Break' ? (
              <div key={f.fieldname} className="hidden md:block" />
            ) : (
              <FieldControl
                key={f.fieldname}
                field={f}
                value={values[f.fieldname]}
                error={errors[f.fieldname]}
                onChange={(v) => setField(f.fieldname, v)}
                meta={m}
                values={values}
                setField={setField}
              />
            ),
          )}
        </div>
      ))}
    </div>
  )
}

function FieldControl({
  field,
  value,
  error,
  onChange,
  meta,
  values,
  setField,
}: {
  field: DocField
  value: unknown
  error?: string
  onChange: (value: unknown) => void
  meta: DocTypeMeta
  values: Doc
  setField: (fieldname: string, value: unknown) => void
}) {
  const base =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500'
  const label = (
    <label className="mb-1 block text-xs font-medium text-gray-600">
      {field.label ?? field.fieldname}
      {field.reqd && <span className="text-red-500"> *</span>}
    </label>
  )
  const err = error && (
    <p className="mt-1 text-xs text-red-600" data-testid={`error-${field.fieldname}`}>
      {error}
    </p>
  )
  const common = {
    disabled: field.read_only,
    'data-field': field.fieldname,
    'data-fieldtype': field.fieldtype,
  }

  const wide = ['Text', 'Long Text', 'JSON', 'Table'].includes(field.fieldtype)
  const wrap = (control: React.ReactNode) => (
    <div className={wide ? 'md:col-span-2' : ''}>
      {label}
      {control}
      {err}
    </div>
  )

  switch (field.fieldtype) {
    case 'Check':
      return wrap(
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
          {...common}
        />,
      )
    case 'Select':
      return wrap(
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={base}
          {...common}
        >
          <option value="" />
          {(field.options ?? '')
            .split('\n')
            .filter(Boolean)
            .map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
        </select>,
      )
    case 'Date':
      return wrap(
        <input
          type="date"
          value={value ? String(value).slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className={base}
          {...common}
        />,
      )
    case 'Datetime':
      return wrap(
        <input
          type="datetime-local"
          value={value ? toLocalDatetime(String(value)) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className={base}
          {...common}
        />,
      )
    case 'Int':
    case 'Float':
    case 'Currency':
      return wrap(
        <input
          type="number"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className={base}
          {...common}
        />,
      )
    case 'Text':
    case 'Long Text':
      return wrap(
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={base}
          {...common}
        />,
      )
    case 'JSON':
      return wrap(
        <textarea
          value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={`${base} font-mono`}
          {...common}
        />,
      )
    case 'Table':
      return wrap(
        <ChildGrid
          field={field}
          rows={(values[field.fieldname] as Doc[] | undefined) ?? []}
          onChange={(rows) => setField(field.fieldname, rows)}
        />,
      )
    case 'Link':
      return wrap(
        <input
          type="text"
          role="combobox"
          aria-expanded="false"
          placeholder={`Link: ${field.options ?? ''}`}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          className={base}
          {...common}
        />,
      )
    default:
      return wrap(
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          className={base}
          {...common}
        />,
      )
  }
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Minimal child grid: renders child rows with editable cells. Full add/
// delete/reorder verification is UI-007.
function ChildGrid({
  field,
  rows,
  onChange,
}: {
  field: DocField
  rows: Doc[]
  onChange: (rows: Doc[]) => void
}) {
  const childMeta = useMeta(field.options ?? '')
  if (!childMeta.data) return <p className="text-xs text-gray-400">Loading rows…</p>
  const cols = childMeta.data.fields.filter(
    (f) => !NO_COLUMN_TYPES.has(f.fieldtype) && !f.hidden,
  )
  function setCell(i: number, fieldname: string, value: unknown) {
    onChange(rows.map((r, j) => (j === i ? { ...r, [fieldname]: value } : r)))
  }
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200" data-testid={`table-${field.fieldname}`}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left">
          <tr>
            {cols.map((c) => (
              <th key={c.fieldname} className="border-b border-gray-200 px-2 py-1 text-xs font-medium text-gray-600">
                {c.label ?? c.fieldname}
              </th>
            ))}
            <th className="w-8 border-b border-gray-200" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.name ?? i)} className="border-b border-gray-100 last:border-0">
              {cols.map((c) => (
                <td key={c.fieldname} className="px-1 py-1">
                  <input
                    value={String(row[c.fieldname] ?? '')}
                    onChange={(e) => setCell(i, c.fieldname, e.target.value)}
                    className="w-full rounded border border-transparent px-1 py-0.5 hover:border-gray-200 focus:border-gray-400"
                    data-childfield={c.fieldname}
                  />
                </td>
              ))}
              <td className="px-1 text-center">
                <button
                  aria-label="Remove row"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="text-gray-300 hover:text-red-600"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => onChange([...rows, {}])}
        data-testid={`add-row-${field.fieldname}`}
        className="w-full border-t border-gray-100 px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50"
      >
        + Add row
      </button>
    </div>
  )
}
