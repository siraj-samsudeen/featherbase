import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { tableSchemaToZod, zodFieldErrors } from 'shared'
import { ApiError, api, getToken, listResource } from '../lib/api'
import { useRealtime } from '../lib/realtime'
import { Link as RouterLink } from '@tanstack/react-router'
import { NO_COLUMN_TYPES, isSourceReadOnly, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { useClientScripts, type Frm } from '../lib/client-scripts'
import { useI18n } from '../lib/i18n'
import { Attachments } from './Attachments'
import { Assignments } from './Assignments'
import { Tags } from './Tags'
import { Comments } from './Comments'
import { ActivityTimeline } from './ActivityTimeline'
import { WorkflowActions } from './WorkflowActions'
import { ConnectionsPanel, RelatedTabs } from './ConnectionsPanel'
import { usePeek } from './Peek'

type Row = Record<string, unknown>

// UI-004/UI-005: ONE form component renders and saves every Table from
// its metadata. Layout columns group into sections/columns (UI-008 refines).
// `prefill` (#100) seeds a NEW row's initial values — how "+ New Attendance"
// from an Employee's connections arrives with employee already set.
export function FormView({
  table,
  name,
  prefill,
}: {
  table: string
  name: string
  prefill?: Row
}) {
  const isNew = name === 'new'
  const meta = useMeta(table)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { t } = useI18n()

  const doc = useQuery({
    queryKey: ['doc', table, name],
    enabled: Boolean(meta.data) && !isNew,
    queryFn: () =>
      api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`),
  })

  // #102 review: prefill seeds the INITIAL state synchronously, so the very
  // first render (and any client-script `onload` in the first effect flush)
  // already sees the prefilled reference — an onload set_value merges on
  // top of it instead of racing it. Route-level keying on the prefill
  // string remounts this component when the prefill changes.
  const [values, setValues] = useState<Row>(() => (isNew && prefill ? { ...prefill } : {}))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  // TLC-J2 (docs/specs/0007-table-lifecycle.md): removing the row you are
  // looking at. Deletion existed only in the list's bulk bar, so removing one
  // row meant going back, finding it again and ticking a checkbox (#252).
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [staleBanner, setStaleBanner] = useState(false)
  const [scriptError, setScriptError] = useState<string | null>(null)

  // CUST-003: client scripts registered for this Table. valuesRef mirrors the
  // live values so a script handler always sees current column values.
  const clientScripts = useClientScripts(table)
  const valuesRef = useRef<Row>({})
  valuesRef.current = values
  const onloadFired = useRef(false)

  // RT-002: another session saving this document shows a refresh banner.
  // The user's own save is suppressed via a short window (their save
  // triggers a local refetch already).
  const suppressStaleUntil = useRef(0)
  useRealtime(isNew ? [] : [`row:${table}:${name}`], (e) => {
    if (e.event === 'updated' && Date.now() > suppressStaleUntil.current) setStaleBanner(true)
  })

  const baseline = useMemo(() => {
    if (isNew) return {}
    return doc.data ?? {}
  }, [doc.data, isNew])

  useEffect(() => {
    // Prefilled values on a new row count as edits (the form starts dirty,
    // so a pure-prefill save is possible), not as the saved baseline.
    setValues(isNew && prefill ? { ...prefill } : baseline)
    setErrors({})
    onloadFired.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline])

  // CUST-003: surface client-script compile errors; fire onload once the form
  // and its scripts are ready.
  useEffect(() => {
    if (clientScripts.errors.length) setScriptError(`Client script error: ${clientScripts.errors[0]}`)
  }, [clientScripts.errors])
  useEffect(() => {
    if (onloadFired.current) return
    const onload = clientScripts.handlers.onload
    if (!onload) return
    onloadFired.current = true
    try {
      onload({
        doc: valuesRef.current,
        get_value: (f: string) => valuesRef.current[f],
        set_value: (f: string, v: unknown) => setField(f, v),
      })
    } catch (err) {
      setScriptError(`Client script error (onload): ${err instanceof Error ? err.message : String(err)}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientScripts.handlers, values])

  if (meta.isLoading || (!isNew && doc.isLoading))
    return <p className="text-sm text-gray-400">Loading…</p>
  if (meta.isError || (!isNew && doc.isError))
    return <p className="text-sm text-red-600">Cannot load {table} {name}</p>

  const m = meta.data!
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)

  // Build the `frm` a client-script handler receives, over a given doc snapshot.
  function makeFrm(docSnapshot: Row): Frm {
    return {
      doc: docSnapshot,
      get_value: (f: string) => docSnapshot[f],
      set_value: (f: string, v: unknown) => setField(f, v),
    }
  }

  // CUST-003: run a client-script handler, catching errors so a broken script
  // never crashes the Admin — it surfaces in a dismissible banner.
  function fireHandler(key: string, docSnapshot: Row) {
    const handler = clientScripts.handlers[key]
    if (!handler) return
    try {
      handler(makeFrm(docSnapshot))
    } catch (err) {
      setScriptError(`Client script error (${key}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function setField(fieldname: string, value: unknown) {
    const next = { ...valuesRef.current, [fieldname]: value }
    valuesRef.current = next
    setValues(next)
    setErrors((e) => {
      const { [fieldname]: _drop, ...rest } = e
      return rest
    })
    // CUST-003: fire the field's change handler with the updated doc.
    fireHandler(fieldname, next)
  }

  const status = String((baseline as Record<string, unknown>).status ?? 'draft')
  const submittable = Boolean(m.is_submittable) && !isNew
  // EDS-13: a bound Table on a read-only source renders with no write
  // affordance at all — every field read-only, Save/Rename absent.
  const sourceReadOnly = isSourceReadOnly(m)
  const boundSource = m.data_source ?? null

  async function runAction(action: 'submit' | 'cancel' | 'amend') {
    setBanner(null)
    try {
      const res = await api.post<Row>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}:${action}`,
      )
      await queryClient.invalidateQueries({ queryKey: ['doc', table] })
      await queryClient.invalidateQueries({ queryKey: ['list', table] })
      if (action === 'amend') {
        navigate({ to: '/admin/$table/$name', params: { table, name: String(res.row_id) }, search: { prefill: undefined } })
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
      const res = await api.post<Row>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}:rename`,
        { new_name: renameValue },
      )
      await queryClient.invalidateQueries({ queryKey: ['list', table] })
      setRenaming(false)
      navigate({ to: '/admin/$table/$name', params: { table, name: String(res.row_id) }, search: { prefill: undefined } })
    } catch (err) {
      setBanner(err instanceof ApiError ? err.message : 'Rename failed')
    }
  }

  // TLC-R3: one row, at the documented address. The server owns every
  // refusal — a referencing row (TLC-R3.referenced), a submitted row, an
  // engine-managed table — and the dialog reports whichever comes back
  // rather than pre-judging it here, so the UI can never disagree with the
  // rule that actually holds.
  async function deleteRow() {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.delete(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
      )
      await queryClient.invalidateQueries({ queryKey: ['doc', table] })
      await queryClient.invalidateQueries({ queryKey: ['list', table] })
      navigate({ to: '/admin/$table', params: { table }, search: { filters: undefined } })
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Delete failed')
      setDeleteBusy(false)
    }
  }

  async function save() {
    // CUST-003: a before_save client-script handler can adjust fields (or throw
    // to block) before validation runs.
    fireHandler('before_save', valuesRef.current)
    // UI-009/META-013: the client validates with the SAME metadata-generated
    // zod schema the server uses — invalid forms never reach the network.
    const schema = tableSchemaToZod(m.columns)
    const result = schema.safeParse(valuesRef.current)
    if (!result.success) {
      setErrors(zodFieldErrors(result.error))
      setBanner('Please fix the highlighted fields')
      return
    }
    setSaving(true)
    setBanner(null)
    setErrors({})
    try {
      const payload: Row = { ...valuesRef.current }
      if (!isNew) {
        payload.row_id = name
        payload.updated_at = baseline.updated_at
      } else {
        delete payload.row_id
      }
      suppressStaleUntil.current = Date.now() + 2000
      const saved = await api.post<Row>('/api/save_row', { table, row: payload })
      await queryClient.invalidateQueries({ queryKey: ['doc', table] })
      await queryClient.invalidateQueries({ queryKey: ['list', table] })
      await queryClient.invalidateQueries({ queryKey: ['versions', table, name] })
      if (isNew) {
        navigate({
          to: '/admin/$table/$name',
          params: { table, name: String(saved.row_id) },
          search: { prefill: undefined },
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

  // Group columns into sections split by Section Break.
  const sections: ColumnDef[][] = [[]]
  for (const f of m.columns) {
    if (f.column_type === 'Section Break') sections.push([])
    else if (!f.hidden) sections[sections.length - 1].push(f)
  }

  return (
    <div data-testid="form-view" className="max-w-5xl">
      <nav className="mb-2 text-xs text-gray-500" data-testid="breadcrumbs">
        <RouterLink to="/admin" className="hover:underline">Admin</RouterLink>
        <span className="mx-1">/</span>
        <RouterLink
          to="/admin/$table"
          params={{ table }}
          search={{ filters: undefined }}
          className="hover:underline"
        >
          {table}
        </RouterLink>
        <span className="mx-1">/</span>
        <span className="text-gray-700">{isNew ? 'New' : name}</span>
      </nav>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">
            {table}: {isNew ? 'New' : name}
          </h1>
          <span className="text-xs text-gray-500" data-testid="form-status">
            {dirty ? 'Not saved' : isNew ? 'New document' : 'Saved'}
          </span>
          {boundSource && (
            <span
              className="fc-pill ml-2 align-middle text-[10px]"
              data-testid="source-badge"
              title={`Rows live on data source ${boundSource}`}
            >
              {boundSource} · {sourceReadOnly ? 'read-only' : 'read-write'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {table === 'Data Source' && !isNew && (
            <RouterLink
              to="/admin/source/$name"
              params={{ name }}
              data-testid="form-source-browser"
              className="fc-btn"
            >
              Browse &amp; Reflect
            </RouterLink>
          )}
          {!isNew && <WorkflowActions table={table} name={name} />}
          {submittable && (
            <span
              data-testid="status-badge"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                status === 'submitted'
                  ? 'bg-[var(--color-good-tint)] text-[var(--color-good)]'
                  : status === 'cancelled'
                    ? 'bg-[var(--color-danger-tint)] text-[var(--color-danger)]'
                    : 'bg-[var(--color-subtle)] text-[var(--color-ink-muted)]'
              }`}
            >
              {status === 'submitted' ? 'Submitted' : status === 'cancelled' ? 'Cancelled' : 'Draft'}
            </span>
          )}
          {!isNew && (
            <RouterLink
              to="/print/$table/$name"
              params={{ table, name }}
              search={{ format: undefined }}
              data-testid="form-print"
              className="fc-btn"
            >
              Print
            </RouterLink>
          )}
          {/* #100 pattern 6: walk this row's relational neighborhood. */}
          {!isNew && m.kind !== 'settings' && (
            <RouterLink
              to="/admin/map/$table/$name"
              params={{ table, name }}
              search={{ trail: undefined }}
              data-testid="form-map"
              className="fc-btn"
            >
              Map
            </RouterLink>
          )}
          {/* A bound row's pk belongs to the source — never renameable here. */}
          {!isNew && !renaming && !boundSource && (
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
          {/* TLC-J2.1: the row I am looking at is the row I can remove.
              Absent where rows are not deletable at all — a settings table's
              single row and a sub-table's rows (both refused by the server,
              so an affordance here would only ever produce an error), and a
              read-only source, which owns its rows. */}
          {!isNew &&
            !sourceReadOnly &&
            m.kind !== 'settings' &&
            m.kind !== 'sub_table' && (
              <button
                onClick={() => {
                  setDeleteError(null)
                  setConfirmingDelete(true)
                }}
                data-testid="form-delete"
                className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)]"
              >
                {t('Delete')}
              </button>
            )}
          {!sourceReadOnly && (
            <button
              onClick={save}
              disabled={saving || !dirty || (submittable && status !== 'draft')}
              data-testid="form-save"
              className="fc-btn-primary disabled:opacity-40"
            >
              {saving ? t('Saving…') : t('Save')}
            </button>
          )}
          {submittable && status === 'draft' && !dirty && (
            <button
              onClick={() => runAction('submit')}
              data-testid="form-submit"
              className="fc-btn-primary"
            >
              Submit
            </button>
          )}
          {submittable && status === 'submitted' && (
            <button
              onClick={() => runAction('cancel')}
              data-testid="form-cancel"
              className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)]"
            >
              Cancel
            </button>
          )}
          {submittable && status === 'cancelled' && (
            <button
              onClick={() => runAction('amend')}
              data-testid="form-amend"
              className="fc-btn"
            >
              Amend
            </button>
          )}
        </div>
      </div>
      {/* TLC-J2.2 / TLC-R4: a real dialog that NAMES the row. Deliberately
          the same shape as the table-level confirmation in ListView (DEL-J1.2)
          — labelled, aria-modal, Escape-dismissable, destructive action on the
          right — so a confirmation reads the same wherever it appears. */}
      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !deleteBusy && setConfirmingDelete(false)}
          onKeyDown={(e) => e.key === 'Escape' && !deleteBusy && setConfirmingDelete(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-row-title"
            className="fc-card w-full max-w-md p-4"
            data-testid="delete-row-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="delete-row-title"
              className="mb-2 text-base font-semibold text-[var(--color-ink)]"
            >
              Delete {table} {name}?
            </h2>
            <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
              This cannot be undone.
            </p>
            {deleteError && (
              <p className="mb-3 text-sm text-[var(--color-danger)]" data-testid="delete-row-error">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                autoFocus
                onClick={() => setConfirmingDelete(false)}
                disabled={deleteBusy}
                className="fc-btn"
                data-testid="delete-row-cancel"
              >
                Cancel
              </button>
              <button
                onClick={deleteRow}
                disabled={deleteBusy}
                className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] disabled:opacity-40"
                data-testid="delete-row-confirm"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {banner && (
        <p
          className={`mb-3 text-sm ${banner === 'Saved' || banner === 'Done' ? 'text-[var(--color-good)]' : 'text-[var(--color-danger)]'}`}
          data-testid="form-banner"
        >
          {banner}
        </p>
      )}
      {scriptError && (
        <div
          className="mb-3 flex items-center justify-between rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn-tint)] px-3 py-2 text-sm text-[var(--color-warn)]"
          data-testid="client-script-error"
        >
          <span>{scriptError}</span>
          <button onClick={() => setScriptError(null)} className="ml-2 text-xs underline">
            dismiss
          </button>
        </div>
      )}
      {staleBanner && (
        <div
          className="mb-3 flex items-center justify-between rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn-tint)] px-3 py-2 text-sm"
          data-testid="stale-banner"
        >
          <span className="text-[var(--color-ink)]">
            This document was changed in another session.
          </span>
          <button
            onClick={async () => {
              await queryClient.invalidateQueries({ queryKey: ['doc', table, name] })
              setStaleBanner(false)
            }}
            data-testid="stale-refresh"
            className="fc-btn"
          >
            Refresh
          </button>
        </div>
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
                f.column_type === 'Column Break' ? (
                  <div key={f.column_name} className="hidden md:block" />
                ) : (
                  <FieldControl
                    key={f.column_name}
                    field={
                      sourceReadOnly || (submittable && status !== 'draft')
                        ? { ...f, read_only: true }
                        : f
                    }
                    value={values[f.column_name]}
                    error={errors[f.column_name]}
                    onChange={(v) => setField(f.column_name, v)}
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
            <ConnectionsPanel table={table} name={name} />
            <Assignments table={table} name={name} />
            <Tags table={table} name={name} />
            <Attachments table={table} name={name} />
            <Comments table={table} name={name} />
            <ActivityTimeline table={table} name={name} />
          </aside>
        )}
      </div>
      {!isNew && m.kind === 'table' && <RelatedTabs table={table} name={name} />}
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
  field: ColumnDef
  value: unknown
  error?: string
  onChange: (value: unknown) => void
  meta: TableMeta
  values: Row
  setField: (columnName: string, value: unknown) => void
}) {
  const settings = useSettings()
  const { t } = useI18n()
  const base = 'fc-input'
  const label = (
    <label className="fc-label">
      {t(field.label ?? field.column_name)}
      {field.reqd && <span className="text-red-500"> *</span>}
    </label>
  )
  // SET-004: below Date/Currency/Float inputs, show the value as it renders
  // globally (native inputs can't honor a custom format), so the form
  // reflects System Settings just like lists do.
  const preview =
    value != null && value !== '' && ['Date', 'Datetime', 'Currency', 'Float'].includes(field.column_type) ? (
      <p className="mt-1 text-xs text-[var(--color-ink-faint)]" data-testid={`preview-${field.column_name}`}>
        {formatValue(field.column_type, value, settings)}
      </p>
    ) : null
  const err = error && (
    <p className="mt-1 text-xs text-red-600" data-testid={`error-${field.column_name}`}>
      {error}
    </p>
  )
  const common = {
    disabled: field.read_only,
    'data-field': field.column_name,
    'data-fieldtype': field.column_type,
  }

  const wide = ['Text', 'Long Text', 'JSON', 'Sub-table'].includes(field.column_type)
  const wrap = (control: React.ReactNode) => (
    <div className={wide ? 'md:col-span-2' : ''}>
      {label}
      {control}
      {preview}
      {err}
    </div>
  )

  switch (field.column_type) {
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
    case 'Choice':
      return wrap(
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={base}
          {...common}
        >
          <option value="" />
          {(field.choices ?? '')
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
    case 'Sub-table':
      return wrap(
        <ChildGrid
          field={field}
          rows={(values[field.column_name] as Row[] | undefined) ?? []}
          onChange={(rows) => setField(field.column_name, rows)}
        />,
      )
    case 'Reference':
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
          refTable={meta.name}
          refName={typeof values.row_id === 'string' ? values.row_id : undefined}
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
  field: ColumnDef
  rows: Row[]
  onChange: (rows: Row[]) => void
}) {
  const childMeta = useMeta(field.row_table ?? '')
  if (!childMeta.data) return <p className="text-xs text-gray-400">Loading rows…</p>
  const cols = childMeta.data.columns.filter(
    (f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden,
  )
  function setCell(i: number, columnName: string, value: unknown) {
    onChange(rows.map((r, j) => (j === i ? { ...r, [columnName]: value } : r)))
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200" data-testid={`table-${field.column_name}`}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left">
          <tr>
            {cols.map((c) => (
              <th key={c.column_name} className="border-b border-gray-200 px-2 py-1 text-xs font-medium text-gray-600">
                {c.label ?? c.column_name}
              </th>
            ))}
            <th className="w-20 border-b border-gray-200" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.row_id ?? i)} className="border-b border-gray-100 last:border-0">
              {cols.map((c) => (
                <td key={c.column_name} className="px-1 py-1">
                  <input
                    value={String(row[c.column_name] ?? '')}
                    onChange={(e) => setCell(i, c.column_name, e.target.value)}
                    className="w-full rounded border border-transparent px-1 py-0.5 hover:border-gray-200 focus:border-gray-400"
                    data-childfield={c.column_name}
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
        data-testid={`add-row-${field.column_name}`}
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
  field: ColumnDef
  value: unknown
  onChange: (value: unknown) => void
  className: string
  common: Record<string, unknown>
}) {
  const target = field.reference_table ?? ''
  const [query, setQuery] = useState<string | null>(null) // null = not searching
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const peek = usePeek()
  const navigate = useNavigate()
  // #100 pattern 1: a set reference is a place you can GO — ◎ peeks at the
  // row in a slide-over, ↗ navigates to its form. Hidden while searching.
  const hasValue = Boolean(value) && query === null

  function search(q: string) {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await listResource<{ row_id: string }>(target, {
          filters: q ? [['row_id', 'like', `%${q}%`]] : [],
          fields: ['row_id'],
          limit_page_length: 10,
        })
        setOptions(res.data.map((r) => r.row_id))
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
        placeholder={`Reference: ${target}`}
        value={shown}
        onFocus={() => search(shown)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value)
          search(e.target.value)
        }}
        className={`${className} ${hasValue ? 'pr-14' : ''}`}
        {...common}
      />
      {hasValue && (
        <span className="absolute inset-y-0 right-2 flex items-center gap-0.5">
          {peek.available && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault()
                peek.push({ kind: 'record', table: target, name: String(value) })
              }}
              title={`Peek at ${target} ${String(value)}`}
              data-testid={`link-peek-${field.column_name}`}
              className="rounded px-1 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"
            >
              ◎
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault()
              navigate({
                to: '/admin/$table/$name',
                params: { table: target, name: String(value) },
                search: { prefill: undefined },
              })
            }}
            title={`Open ${target} ${String(value)}`}
            data-testid={`link-open-${field.column_name}`}
            className="rounded px-1 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"
          >
            ↗
          </button>
        </span>
      )}
      {open && (
        <div
          className="absolute z-10 mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
          data-testid={`link-options-${field.column_name}`}
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
            to="/admin/$table/$name"
            params={{ table: target, name: 'new' }}
            search={{ prefill: undefined }}
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
  refTable,
  refName,
}: {
  field: ColumnDef
  value: unknown
  onChange: (value: unknown) => void
  common: Record<string, unknown>
  refTable: string
  refName?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const isImage = field.column_type === 'Attach Image'
  // #173: a private file URL carries no credential — the <img>/<a> request is
  // same-origin, so the HttpOnly `sid` cookie authenticates it.
  const url = typeof value === 'string' && value ? value : null

  async function upload(file: globalThis.File) {
    setBusy(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('ref_table', refTable)
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
        data-attach-input={field.column_name}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
        }}
      />
      {url ? (
        <div>
          {isImage && (
            <img
              src={url}
              alt={field.label ?? field.column_name}
              data-testid={`attach-preview-${field.column_name}`}
              className="mb-2 max-h-40 rounded-md border border-[var(--color-border)]"
            />
          )}
          <div className="flex items-center gap-2 text-sm">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[var(--color-brand)] hover:underline"
              data-testid={`attach-link-${field.column_name}`}
            >
              {url.split('/').pop()?.replace(/^[0-9a-f]{16}_/, '')}
            </a>
            {!field.read_only && (
              <button
                type="button"
                onClick={() => onChange(null)}
                data-testid={`attach-clear-${field.column_name}`}
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
          data-testid={`attach-btn-${field.column_name}`}
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
