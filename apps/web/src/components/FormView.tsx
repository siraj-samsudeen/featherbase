import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { metaToZod, zodFieldErrors } from 'shared'
import { ApiError, api, getToken, listResource } from '../lib/api'
import { Link as RouterLink } from '@tanstack/react-router'
import { NO_COLUMN_TYPES, useMeta, type DocField, type DocTypeMeta } from '../lib/meta'
import { Attachments } from './Attachments'
import { Comments } from './Comments'
import { ActivityTimeline } from './ActivityTimeline'

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
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

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

  const docstatus = Number((baseline as Record<string, unknown>).docstatus ?? 0)
  const submittable = Boolean(m.is_submittable) && !isNew

  async function runAction(path: string) {
    setBanner(null)
    try {
      const res = await api.post<Doc>(path, { doctype, name })
      await queryClient.invalidateQueries({ queryKey: ['doc', doctype] })
      await queryClient.invalidateQueries({ queryKey: ['list', doctype] })
      if (path === '/api/amend_doc') {
        navigate({ to: '/desk/$doctype/$name', params: { doctype, name: String(res.name) } })
      } else {
        setBanner('Done')
      }
    } catch (err) {
      setBanner(err instanceof ApiError ? err.message : 'Action failed')
    }
  }

  // DOC-012: rename this document and cascade to all Link references, then
  // navigate to the new name.
  async function doRename() {
    setBanner(null)
    try {
      const res = await api.post<Doc>('/api/rename_doc', { doctype, name, new_name: renameValue })
      await queryClient.invalidateQueries({ queryKey: ['list', doctype] })
      setRenaming(false)
      navigate({ to: '/desk/$doctype/$name', params: { doctype, name: String(res.name) } })
    } catch (err) {
      setBanner(err instanceof ApiError ? err.message : 'Rename failed')
    }
  }

  async function save() {
    // UI-009/META-013: the client validates with the SAME metadata-generated
    // zod schema the server uses — invalid forms never reach the network.
    const schema = metaToZod(m.fields)
    const result = schema.safeParse(values)
    if (!result.success) {
      setErrors(zodFieldErrors(result.error))
      setBanner('Please fix the highlighted fields')
      return
    }
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
      await queryClient.invalidateQueries({ queryKey: ['versions', doctype, name] })
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
    <div data-testid="form-view" className="max-w-5xl">
      <nav className="mb-2 text-xs text-gray-500" data-testid="breadcrumbs">
        <RouterLink to="/desk" className="hover:underline">Desk</RouterLink>
        <span className="mx-1">/</span>
        <RouterLink
          to="/desk/$doctype"
          params={{ doctype }}
          search={{ filters: undefined }}
          className="hover:underline"
        >
          {doctype}
        </RouterLink>
        <span className="mx-1">/</span>
        <span className="text-gray-700">{isNew ? 'New' : name}</span>
      </nav>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">
            {doctype}: {isNew ? 'New' : name}
          </h1>
          <span className="text-xs text-gray-500" data-testid="form-status">
            {dirty ? 'Not saved' : isNew ? 'New document' : 'Saved'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {submittable && (
            <span
              data-testid="docstatus-badge"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                docstatus === 1
                  ? 'bg-[var(--color-good-tint)] text-[var(--color-good)]'
                  : docstatus === 2
                    ? 'bg-[var(--color-danger-tint)] text-[var(--color-danger)]'
                    : 'bg-[var(--color-subtle)] text-[var(--color-ink-muted)]'
              }`}
            >
              {docstatus === 1 ? 'Submitted' : docstatus === 2 ? 'Cancelled' : 'Draft'}
            </span>
          )}
          {!isNew && (
            <RouterLink
              to="/print/$doctype/$name"
              params={{ doctype, name }}
              data-testid="form-print"
              className="fc-btn"
            >
              Print
            </RouterLink>
          )}
          {!isNew && !renaming && (
            <button
              onClick={() => {
                setRenameValue(name)
                setRenaming(true)
              }}
              data-testid="form-rename"
              className="fc-btn"
            >
              Rename
            </button>
          )}
          {renaming && (
            <span className="flex items-center gap-1">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                data-testid="rename-input"
                className="fc-input w-40"
              />
              <button onClick={doRename} data-testid="rename-confirm" className="fc-btn-primary">
                Rename
              </button>
              <button onClick={() => setRenaming(false)} className="fc-btn">
                Cancel
              </button>
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty || (submittable && docstatus !== 0)}
            data-testid="form-save"
            className="fc-btn-primary disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {submittable && docstatus === 0 && !dirty && (
            <button
              onClick={() => runAction('/api/submit_doc')}
              data-testid="form-submit"
              className="fc-btn-primary"
            >
              Submit
            </button>
          )}
          {submittable && docstatus === 1 && (
            <button
              onClick={() => runAction('/api/cancel_doc')}
              data-testid="form-cancel"
              className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)]"
            >
              Cancel
            </button>
          )}
          {submittable && docstatus === 2 && (
            <button
              onClick={() => runAction('/api/amend_doc')}
              data-testid="form-amend"
              className="fc-btn"
            >
              Amend
            </button>
          )}
        </div>
      </div>
      {banner && (
        <p
          className={`mb-3 text-sm ${banner === 'Saved' || banner === 'Done' ? 'text-[var(--color-good)]' : 'text-[var(--color-danger)]'}`}
          data-testid="form-banner"
        >
          {banner}
        </p>
      )}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 max-w-3xl flex-1">
          {sections.map((fields, si) => (
            <div
              key={si}
              data-testid={`form-section-${si}`}
              className="fc-card mb-4 grid grid-cols-1 gap-4 p-5 md:grid-cols-2"
            >
              {fields.map((f) =>
                f.fieldtype === 'Column Break' ? (
                  <div key={f.fieldname} className="hidden md:block" />
                ) : (
                  <FieldControl
                    key={f.fieldname}
                    field={submittable && docstatus !== 0 ? { ...f, read_only: true } : f}
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
        {!isNew && (
          <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
            <Attachments doctype={doctype} name={name} />
            <Comments doctype={doctype} name={name} />
            <ActivityTimeline doctype={doctype} name={name} />
          </aside>
        )}
      </div>
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
  const base = 'fc-input'
  const label = (
    <label className="fc-label">
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
        <LinkControl
          field={field}
          value={value}
          onChange={onChange}
          className={base}
          common={common}
        />,
      )
    case 'Attach':
    case 'Attach Image':
      return wrap(
        <AttachControl
          field={field}
          value={value}
          onChange={onChange}
          common={common}
          refDoctype={meta.name}
          refName={typeof values.name === 'string' ? values.name : undefined}
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
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
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
            <th className="w-20 border-b border-gray-200" />
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
              <td className="whitespace-nowrap px-1 text-center">
                <button
                  aria-label="Move row up"
                  onClick={() => move(i, -1)}
                  className="px-0.5 text-gray-300 hover:text-gray-700"
                >
                  ↑
                </button>
                <button
                  aria-label="Move row down"
                  onClick={() => move(i, 1)}
                  className="px-0.5 text-gray-300 hover:text-gray-700"
                >
                  ↓
                </button>
                <button
                  aria-label="Remove row"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="px-0.5 text-gray-300 hover:text-red-600"
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


// UI-006: debounced autocomplete over the permission-filtered list API.
function LinkControl({
  field,
  value,
  onChange,
  className,
  common,
}: {
  field: DocField
  value: unknown
  onChange: (value: unknown) => void
  className: string
  common: Record<string, unknown>
}) {
  const target = field.options ?? ''
  const [query, setQuery] = useState<string | null>(null) // null = not searching
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  function search(q: string) {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await listResource<{ name: string }>(target, {
          filters: q ? [['name', 'like', `%${q}%`]] : [],
          fields: ['name'],
          limit_page_length: 10,
        })
        setOptions(res.data.map((r) => r.name))
        setOpen(true)
      } catch {
        setOptions([])
      }
    }, 150)
  }

  const shown = query ?? String(value ?? '')

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        placeholder={`Link: ${target}`}
        value={shown}
        onFocus={() => search(shown)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value)
          search(e.target.value)
        }}
        className={className}
        {...common}
      />
      {open && (
        <div
          className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg"
          data-testid={`link-options-${field.fieldname}`}
        >
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={() => {
                onChange(o)
                setQuery(null)
                setOpen(false)
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50"
              data-testid="link-option"
            >
              {o}
            </button>
          ))}
          {!options.length && (
            <p className="px-3 py-1.5 text-sm text-gray-400">No matches</p>
          )}
          <RouterLink
            to="/desk/$doctype/$name"
            params={{ doctype: target, name: 'new' }}
            className="block border-t border-gray-100 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
            data-testid="link-create-new"
          >
            + Create new {target}
          </RouterLink>
        </div>
      )}
    </div>
  )
}

// UI-023: Attach / Attach Image — upload a file, store its URL as the field
// value, preview images, and allow clearing. The doc still has to be saved
// for the value to persist, like any other field edit.
function AttachControl({
  field,
  value,
  onChange,
  common,
  refDoctype,
  refName,
}: {
  field: DocField
  value: unknown
  onChange: (value: unknown) => void
  common: Record<string, unknown>
  refDoctype: string
  refName?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const isImage = field.fieldtype === 'Attach Image'
  const url = typeof value === 'string' && value ? value : null
  const withToken = (u: string) => (u.startsWith('/private/') ? `${u}?token=${getToken()}` : u)

  async function upload(file: globalThis.File) {
    setBusy(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('ref_doctype', refDoctype)
      if (refName) form.append('ref_name', refName)
      const res = await fetch('/api/upload_file', {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
        body: form,
      })
      const body = (await res.json()) as { file_url?: string; error?: { message?: string } }
      if (!res.ok || !body.file_url)
        throw new Error(body.error?.message ?? `Upload failed (${res.status})`)
      onChange(body.file_url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div {...common}>
      <input
        ref={inputRef}
        type="file"
        accept={isImage ? 'image/*' : undefined}
        className="hidden"
        data-attach-input={field.fieldname}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
        }}
      />
      {url ? (
        <div>
          {isImage && (
            <img
              src={withToken(url)}
              alt={field.label ?? field.fieldname}
              data-testid={`attach-preview-${field.fieldname}`}
              className="mb-2 max-h-40 rounded-md border border-[var(--color-border)]"
            />
          )}
          <div className="flex items-center gap-2 text-sm">
            <a
              href={withToken(url)}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[var(--color-brand)] hover:underline"
              data-testid={`attach-link-${field.fieldname}`}
            >
              {url.split('/').pop()?.replace(/^[0-9a-f]{16}_/, '')}
            </a>
            {!field.read_only && (
              <button
                type="button"
                onClick={() => onChange(null)}
                data-testid={`attach-clear-${field.fieldname}`}
                className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(field.read_only) || busy}
          data-testid={`attach-btn-${field.fieldname}`}
          className="fc-btn text-sm"
        >
          {busy ? 'Uploading…' : `Attach ${isImage ? 'image' : 'file'}`}
        </button>
      )}
      {uploadError && (
        <p className="mt-1 text-xs text-[var(--color-danger)]">{uploadError}</p>
      )}
    </div>
  )
}
