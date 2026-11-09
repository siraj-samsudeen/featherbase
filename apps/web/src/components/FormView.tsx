import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useBlocker, useNavigate } from '@tanstack/react-router'
import { choiceLabel, idFromColumn, tableHref, namingColumn, INSTANCE_SETTINGS_FILE, INSTANCE_SETTINGS_TABLES, tableSchemaToZod, zodFieldErrors } from 'shared'
import { ApiError, api } from '../lib/api'
import { changeOverride, overrideControl } from '../lib/metadata-override-editor'
import { isOpaqueId } from '../lib/people'
import { RowTitle } from '../lib/row-titles'
import { useRowCapabilities } from '../lib/row-capabilities'
import { useIsSystemManager, useWhoAmI } from '../lib/session'
import { useRealtime } from '../lib/realtime'
import { isRowsReadOnly, isSourceReadOnly, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { useClientScripts, type Frm } from '../lib/client-scripts'
import { useI18n } from '../lib/i18n'
import { Attachments } from './Attachments'
import {
  ArrangeBar, BookkeepingLine, FieldGroupView, UnlinkedNote, ValueField, arrangeFields, unlinkedSourceTable, useFormArrangement,
} from './FormArrangement'
import { Assignments } from './Assignments'
import { Tags } from './Tags'
import { Comments } from './Comments'
import { PersonSignInMethods } from './PersonSignInMethods'
import { PersonIdentifiers } from './PersonIdentifiers'
import { IdentifierSystemDefaults } from './IdentifierSystemDefaults'
import { ActivityTimeline } from './ActivityTimeline'
import { ActionDisclosure } from './ActionDisclosure'
import { RetireDialog, RetiredBadge, RetiredNotice, reactivateRow } from './RowRetirement'
import { PurgeDialog } from './PurgeDialog'
import { WorkflowActions } from './WorkflowActions'
import { RowConnections } from './RowPane'
import { RecordNav } from './RecordNav'
import { RowMap } from './RowMap'
import { RowTree } from './RowTree'
import { useNavigation } from '../lib/navigation'
import { GlossaryHelp } from './GlossaryHelp'
import { ReadingPresentation } from './ReadingPresentation'
import { ChangeRecord } from './ChangeRecord'
import { refreshWaitingAfterSave } from '../pages/WaitingForAccess'
import { INSTANCE_HEALTH_QUERY_KEY } from '../pages/InstanceHealth'
import { ArchivedBanner } from './ArchiveTable'
import { ContentTabs, buttonClasses, cardClasses, inputClasses, labelClasses, pillClasses, touchLinkClasses } from '@featherbase/shop-floor'
import type { Row } from './form-row'
import { LinkControl, anyTableFilters } from './LinkControl'
import { AttachControl } from './AttachControl'
import { ChildGrid } from './ChildGrid'

// #545: a JSON column's box holds text while the person types. On save, text
// typed into it becomes the value it describes; text that isn't JSON is
// refused at the field. Only boxes the person typed in are read this way: a
// stored value, a prefill or a value a client script set goes back as it is.
function parseTypedJson(columns: ColumnDef[], values: Row, typed: ReadonlySet<string>): { values: Row; errors: Record<string, string> } {
  const out: Row = { ...values }
  const errors: Record<string, string> = {}
  for (const f of columns) {
    if (f.column_type !== 'JSON' || !typed.has(f.column_name)) continue
    const text = values[f.column_name]
    if (typeof text !== 'string') continue
    if (!text.trim()) {
      out[f.column_name] = null
      continue
    }
    try {
      out[f.column_name] = JSON.parse(text)
    } catch {
      errors[f.column_name] = 'must be valid JSON'
    }
  }
  return { values: out, errors }
}

const VIEW_TAB = { form: 'Form', map: 'Map', tree: 'Tree' } as const
const TAB_VIEW: Record<string, 'form' | 'map' | 'tree' | undefined> = { Form: 'form', Map: 'map', Tree: 'tree' }

// UI-004/UI-005: ONE form component renders and saves every Table from
// its metadata. Layout columns group into sections/columns (UI-008 refines).
// `prefill` (#100) seeds a NEW row's initial values — how "+ New Attendance"
// from an Employee's connections arrives with employee already set.
export function FormView({
  table,
  name,
  prefill,
  isNew = false,
}: {
  table: string
  name: string
  prefill?: Row
  isNew?: boolean
}) {
  const meta = useMeta(table)
  const describedTable = useMeta(name, table === 'Table' && !isNew)
  const storage = table === 'Table' && !isNew ? describedTable.data?.storage_identity : null
  const [storageCopy, setStorageCopy] = useState('')
  const queryClient = useQueryClient()
  const routerNavigate = useNavigate()
  // #1009: where the form itself goes after an action (a new row saved, a row
  // deleted) is no one walking away from their changes.
  const leavingOnPurpose = useRef(false)
  const navigate = ((options: never) => {
    leavingOnPurpose.current = true
    return routerNavigate(options)
  }) as typeof routerNavigate
  const { t } = useI18n()
  const formSettings = useSettings()
  // #795: how this person arranges this Table's rows. A Table its builder
  // laid out in sections keeps that order until they pick another.
  const arrangement = useFormArrangement(table, Boolean(meta.data?.columns.some((c) => c.column_type === 'Section Break')))

  const doc = useQuery({
    queryKey: ['doc', table, name],
    enabled: Boolean(meta.data) && !isNew,
    queryFn: () =>
      api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`),
  })
  const access = useRowCapabilities(table, name, !isNew && doc.isSuccess, doc.data?.updated_at)
  const session = useWhoAmI()

  // #465 D5: the fields the instance settings file set are read-only here,
  // each with a sentence saying where it is changed instead.
  const managed = useQuery({
    queryKey: ['managed-fields', table, name],
    enabled: !isNew && (INSTANCE_SETTINGS_TABLES as readonly string[]).includes(table),
    queryFn: () =>
      api.get<{ fields: string[]; hint: string }>(
        `/api/instance-settings/managed/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
      ),
  })
  const managedFields = new Set(managed.data?.fields ?? [])
  // The server refuses renaming or deleting a row with a locked field, so the
  // form does not offer either (checklist item 10 on #465).
  const rowManaged = managedFields.size > 0

  // #102 review: prefill seeds the INITIAL state synchronously, so the very
  // first render (and any client-script `onload` in the first effect flush)
  // already sees the prefilled reference — an onload set_value merges on
  // top of it instead of racing it. Route-level keying on the prefill
  // string remounts this component when the prefill changes.
  const [values, setValues] = useState<Row>(() => (isNew && prefill ? { ...prefill } : {}))
  const editingOverride = table === 'Metadata Override'
  const overrideTarget = useMeta(editingOverride ? String(values.table_name ?? '') : '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [recordActionsOpen, setRecordActionsOpen] = useState(false)
  // TLC-J2 (docs/specs/0007-table-lifecycle.md): removing the row you are
  // looking at. Deletion existed only in the list's bulk bar, so removing one
  // row meant going back, finding it again and ticking a checkbox (#252).
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // #859: the server said Retire is the way out of a refused delete.
  const [deleteOffersRetire, setDeleteOffersRetire] = useState(false)
  const [retiring, setRetiring] = useState(false)
  const [purging, setPurging] = useState(false)
  const [staleBanner, setStaleBanner] = useState(false)
  const [scriptError, setScriptError] = useState<string | null>(null)
  // #910 / #800: the row's areas. Form, Map and Tree are part of the path,
  // so a step brings back the view it showed.
  const nav = useNavigation()
  const rowNav = nav?.step.screen === 'row' && nav.step.table === table && nav.step.row === name ? nav : null
  const pathView = rowNav?.step.view
  const [area, setLocalArea] = useState<string>(VIEW_TAB[pathView ?? 'form'])
  useEffect(() => { if (pathView) setLocalArea(VIEW_TAB[pathView]) }, [pathView])
  const setArea = (tab: string) => {
    setLocalArea(tab)
    const view = TAB_VIEW[tab]
    // Always written: a quick Form-then-Tree must end on Tree even before
    // the first address change lands.
    if (rowNav && view) rowNav.replace({ ...rowNav.step, view })
  }

  // CUST-003: client scripts registered for this Table. valuesRef mirrors the
  // live values so a script handler always sees current column values.
  const clientScripts = useClientScripts(table)
  const valuesRef = useRef<Row>({})
  valuesRef.current = values
  // The row onload last ran for: once per row opened, so the refetch after a
  // save (or a refresh) doesn't run it again and re-dirty the form (#538).
  const onloadFiredFor = useRef<string | null>(null)
  const rowKey = `${table}/${name}`

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

  // The baseline the form was last reset to. StrictMode replays effects on
  // mount; resetting again to the SAME baseline would wipe what onload set
  // in the first pass, and onload (once per row) wouldn't restore it.
  const appliedBaseline = useRef<Row | null>(null)
  // #545: the JSON columns whose box the person typed in since the last load.
  const typedJson = useRef(new Set<string>())
  useEffect(() => {
    if (appliedBaseline.current === baseline) return
    appliedBaseline.current = baseline
    // Prefilled values on a new row count as edits (the form starts dirty,
    // so a pure-prefill save is possible), not as the saved baseline.
    // valuesRef moves with it, so an onload firing in this same effect flush
    // starts from the loaded row, not the empty pre-load one (#538).
    const initial = isNew && prefill ? { ...prefill } : baseline
    typedJson.current = new Set()
    valuesRef.current = initial
    setValues(initial)
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline])

  // CUST-003: surface client-script compile errors; fire onload once the form,
  // its scripts and (for an existing row) the row itself are ready — a
  // set_value against the empty pre-load doc would blank the row (#538).
  useEffect(() => {
    if (clientScripts.errors.length) setScriptError(`Client script error: ${clientScripts.errors[0]}`)
  }, [clientScripts.errors])
  const rowLoaded = isNew || doc.data !== undefined
  useEffect(() => {
    if (onloadFiredFor.current === rowKey || !rowLoaded) return
    const onload = clientScripts.handlers.onload
    if (!onload) return
    onloadFiredFor.current = rowKey
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
  }, [clientScripts.handlers, values, rowLoaded, rowKey])

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)
  // #1009: what leaving would lose. Prefilled values save with the row (so Save
  // is on), but nobody typed them; until the form takes its first values there
  // is nothing to compare.
  const unsaved = dirty && appliedBaseline.current === baseline
    && !(isNew && JSON.stringify(values) === JSON.stringify(prefill ?? {}))
  // Only a different page unmounts the form: a tab or the side pane keeps it.
  const leaveGuard = useBlocker({
    shouldBlockFn: ({ current, next }) => unsaved && !leavingOnPurpose.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => unsaved && !leavingOnPurpose.current,
    withResolver: true,
  })

  if (meta.isLoading || (!isNew && (doc.isLoading || access.isLoading)))
    return <p className="text-sm text-ink-subtle">Loading…</p>
  if (meta.isError || (!isNew && doc.isError))
    return <p className="text-sm text-negative">Cannot load {table} {name}</p>

  const m = meta.data!

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
    // A value set here (by a client script, say) is a value, not typed text.
    typedJson.current.delete(fieldname)
    const next = editingOverride
      ? changeOverride(valuesRef.current, fieldname, value)
      : { ...valuesRef.current, [fieldname]: value }
    valuesRef.current = next
    setValues(next)
    // A grid's cell errors (`lines.0.customer`) are keyed by row position,
    // so any change to the grid drops them with the grid's own (#832 review).
    setErrors((e) => Object.fromEntries(
      Object.entries(e).filter(([key]) => key !== fieldname && !key.startsWith(`${fieldname}.`)),
    ))
    // CUST-003: fire the field's change handler with the updated doc.
    fireHandler(fieldname, next)
  }

  const status = String((baseline as Record<string, unknown>).submission_status ?? 'draft')
  const submittable = Boolean(m.is_submittable) && !isNew
  // EDS-13: a bound Table on a read-only source renders with no write
  // affordance at all — every field read-only, Save/Rename absent.
  const sourceReadOnly = isSourceReadOnly(m)
  // #432: also read-only when the platform alone writes the rows — the form
  // opens for reading, with no Save, Delete or Rename, for everyone.
  const rowsReadOnly = isRowsReadOnly(m) || (isNew
    ? !(session.data?.capabilities.manage || session.data?.capabilities.creatable.includes(table))
    : !access.data?.write)
  const boundSource = m.data_source ?? null
  // #324: rows named by whoever creates them ('prompt') need that name typed
  // in on the new-row form; every other naming rule assigns the ID itself.
  // #328: a writable binding with no mapped last-changed column saves with no
  // revision check (last write wins), so an open row says so for as long as
  // it is open. A new row has nothing at the source to overwrite.
  const uncheckedSaves = Boolean(boundSource) && !isNew && !rowsReadOnly && !m.external_modified
  const asksRowId = isNew && m.id_pattern === 'prompt' && !rowsReadOnly
  const renamable = !isNew && !boundSource && access.data?.rename && !rowManaged && !isOpaqueId(name)
  // #858: a row named after its own column keeps its id when that column
  // changes; the form says so and offers Rename to the id the rule gives now.
  const naming = namingColumn(m.id_pattern)
  const idNow = naming && rowLoaded ? idFromColumn(naming.prefix, values[naming.column]) : null
  const idOutOfStep = renamable && idNow !== null && idNow !== name ? idNow : null

  async function runAction(action: 'submit' | 'cancel' | 'amend') {
    setBanner(null)
    try {
      const res = await api.post<Row>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}:${action}`,
      )
      await queryClient.invalidateQueries({ queryKey: ['doc', table] })
      await queryClient.invalidateQueries({ queryKey: ['list', table] })
      if (action === 'amend') {
        navigate({ to: '/featherbase/admin/table/$table/row/$name', params: { table, name: String(res.row_id) }, search: { prefill: undefined } })
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
      navigate({ to: '/featherbase/admin/table/$table/row/$name', params: { table, name: String(res.row_id) }, search: { prefill: undefined } })
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
    setDeleteOffersRetire(false)
    try {
      // Echo the stamp the form actually loaded. Source-bound rows with a
      // mapped revision require it, as do local rows owned by an installed
      // app. A revisionless binding naturally keeps the query empty.
      const stamp = baseline.updated_at
      const query =
        stamp == null ? '' : `?updated_at=${encodeURIComponent(String(stamp))}`
      await api.delete(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}${query}`,
      )
      await queryClient.invalidateQueries({ queryKey: ['doc', table] })
      await queryClient.invalidateQueries({ queryKey: ['list', table] })
      // #898: its title goes too, so recents stop offering the row.
      queryClient.setQueryData(['row-title', table, name], null)
      await refreshWaitingAfterSave(queryClient, table)
      navigate({ to: '/featherbase/admin/table/$table', params: { table }, search: { filters: undefined } })
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Delete failed')
      setDeleteOffersRetire(err instanceof ApiError && err.fields?.retire === 'available')
      setDeleteBusy(false)
    }
  }

  async function save() {
    // CUST-003: a before_save client-script handler can adjust fields (or throw
    // to block) before validation runs.
    fireHandler('before_save', valuesRef.current)
    // UI-009/META-013: the client validates with the SAME metadata-generated
    // zod schema the server uses — invalid forms never reach the network.
    const schema = tableSchemaToZod(m.columns, { sourceLimitsLength: Boolean(m.data_source) })
    const json = parseTypedJson(m.columns, valuesRef.current, typedJson.current)
    const result = schema.safeParse(json.values)
    const fieldErrors = { ...(result.success ? {} : zodFieldErrors(result.error)), ...json.errors }
    if (editingOverride && valuesRef.current.column_name === undefined)
      fieldErrors.column_name = 'Choose a column or Whole Table'
    if (asksRowId && !String(valuesRef.current[ROW_ID_FIELD.column_name] ?? '').trim())
      fieldErrors[ROW_ID_FIELD.column_name] = 'Row ID is required'
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors)
      setBanner('Please fix the highlighted fields')
      return
    }
    setSaving(true)
    setBanner(null)
    setErrors({})
    try {
      const payload: Row = { ...json.values }
      if (!isNew) {
        payload.row_id = name
        payload.updated_at = baseline.updated_at
      } else if (asksRowId) {
        payload.row_id = String(payload.row_id).trim()
      } else {
        delete payload.row_id
      }
      suppressStaleUntil.current = Date.now() + 2000
      // A typed-in ID is a create, never an upsert: through save_row an ID
      // already in use would be read as an update of that row (#324).
      const saved = asksRowId
        ? await api.post<Row>(`/api/table/${encodeURIComponent(table)}`, payload)
        : await api.post<Row>('/api/save_row', { table, row: payload })
      await queryClient.invalidateQueries({ queryKey: ['doc', table] })
      await queryClient.invalidateQueries({ queryKey: ['list', table] })
      await queryClient.invalidateQueries({ queryKey: ['activity', table, name] })
      // A save can settle a health check, and the banners shouldn't lag behind it (#1003).
      void queryClient.invalidateQueries({ queryKey: INSTANCE_HEALTH_QUERY_KEY })
      if (editingOverride) {
        await queryClient.invalidateQueries({ queryKey: ['meta', String(saved.table_name)] })
        if (typeof baseline.table_name === 'string' && baseline.table_name !== saved.table_name)
          await queryClient.invalidateQueries({ queryKey: ['meta', baseline.table_name] })
      }
      await refreshWaitingAfterSave(queryClient, table)
      // #414: a person's name is cached per id for the heading, breadcrumb
      // and Recent; a save may have changed it.
      if (!isNew && isOpaqueId(name)) await queryClient.invalidateQueries({ queryKey: ['principal-name', name] })
      if (!isNew) await queryClient.invalidateQueries({ queryKey: ['row-title', table, name] })
      if (isNew) {
        navigate({
          to: '/featherbase/admin/table/$table/row/$name',
          params: { table, name: String(saved.row_id) },
          search: { prefill: undefined },
        })
      } else {
        setBanner('Saved')
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields)
      else if (asksRowId && err instanceof ApiError && err.type === 'ConflictError' && err.message.endsWith(' already exists'))
        setErrors({ [ROW_ID_FIELD.column_name]: 'Already in use' })
      setBanner(err instanceof ApiError ? err.message : 'Save failed')
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
  if (asksRowId) sections[0].unshift(ROW_ID_FIELD)

  // One field: on a row the user can only read, its value shown by type
  // (#795); otherwise the control that edits it.
  const control = (stored: ColumnDef) => {
    const { field: f, value } = editingOverride
      ? overrideControl(stored, values, overrideTarget.data)
      : { field: stored, value: values[stored.column_name] }
    return rowsReadOnly && !isNew ? (
      <ValueField key={f.column_name} field={f} value={value} meta={m} settings={formSettings} columns={arrangement.columns} />
    ) : (
      <FieldControl key={f.column_name} columns={isNew ? 2 : arrangement.columns}
        field={rowsReadOnly || (submittable && status !== 'draft') || managedFields.has(f.column_name) ? { ...f, read_only: true } : f}
        managedHint={managedFields.has(f.column_name) ? managed.data?.hint : undefined}
        value={value} error={errors[f.column_name]} errors={errors}
        onChange={(v) => {
          setField(f.column_name, v)
          if (f.column_type === 'JSON') typedJson.current.add(f.column_name)
        }}
        meta={m} values={values} setField={setField}
      />
    )
  }

  const work = <div className="flex flex-col gap-6 lg:flex-row">
    {/* Its columns follow its own width (a form beside the pane is narrow). */}
    <div className="@container min-w-0 max-w-[50rem] flex-1">
      {!isNew && (
        <ArrangeBar mode={arrangement.mode} columns={arrangement.columns}
          onMode={arrangement.setMode} onColumns={arrangement.setColumns} />
      )}
      {/* #1012: one column narrows the fields only, so the toolbar above stays put.
          The wrapper is wider than the fields because the toolbar needs 50rem on one line in a wide font. */}
      <div className={arrangement.columns === 1 && !isNew ? 'max-w-2xl' : 'max-w-3xl'} data-testid="form-fields">
      {!isNew && !arrangement.ready ? (
        <p className="text-sm text-ink-subtle">Loading…</p>
      ) : !isNew && arrangement.mode !== 'source' ? (() => {
        const { groups, bookkeeping } = arrangeFields(
          sections.flat(), baseline as Row, m, arrangement.mode, rowsReadOnly)
        return (
          <div className={cardClasses('mb-4 p-5')} data-testid="form-arranged" data-arrangement={arrangement.mode}>
            {groups.map((g) => (
              <FieldGroupView key={`${arrangement.mode}-${g.key}`} group={g} columns={arrangement.columns}>{control}</FieldGroupView>
            ))}
            {!rowsReadOnly && (
              <FieldGroupView group={{ key: 'bookkeeping', fields: bookkeeping }} columns={arrangement.columns}>{control}</FieldGroupView>
            )}
            <BookkeepingLine fields={rowsReadOnly ? bookkeeping : []} values={baseline as Row} settings={formSettings} />
          </div>
        )
      })() : (
        <div data-arrangement={isNew ? undefined : 'source'}>
          {sections.map((fields, si) => (
            <div
              key={si}
              data-testid={`form-section-${si}`}
              className={cardClasses(`mb-4 grid grid-cols-1 gap-4 p-5 ${arrangement.columns === 2 || isNew ? '@2xl:grid-cols-2' : ''}`)}
            >
              {fields.map((f) =>
                f.column_type === 'Column Break' ? (
                  arrangement.columns === 2 || isNew ? <div key={f.column_name} className="hidden @2xl:block" /> : null
                ) : (
                  control(f)
                ),
              )}
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
    {/* Only the Tables with panels of their own give the form a side column. */}
    {!isNew && (table === 'Person' || table === 'Identifier System') && <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
      {/* person-identities: the one platform Table whose rows sign in. */}
      {table === 'Person' && <PersonIdentifiers person={name} replacedBy={(values.replaced_by as string | null | undefined) ?? null} />}
      {table === 'Person' && <PersonSignInMethods user={name} />}
      {/* #628: what this person can see, and why. */}
      {table === 'Person' && (
        <RouterLink to="/featherbase/account/access/$person" params={{ person: name }} className="text-sm text-action hover:underline" data-testid="person-access-explanation">
          What they can see
        </RouterLink>
      )}
      {table === 'Identifier System' && <IdentifierSystemDefaults systemKey={name} />}
    </aside>}
  </div>
  const saveDisabled = saving || !dirty || (submittable && status !== 'draft') || (editingOverride && !overrideTarget.data)
  const reading = !isNew && rowsReadOnly ? m.reading_presentation : null
  // #825: a Version row reads as the change it records; its fields fold away.
  const changeRecord = !isNew && table === 'Version'
  const RawDetails = reading || changeRecord ? 'details' : 'div'

  return (
    <div data-testid="form-view" className={`min-w-0 max-w-5xl [overflow-wrap:anywhere] ${unsaved && !rowsReadOnly ? 'pb-20' : ''}`}>
      <nav className="mb-2 flex flex-wrap items-center gap-x-1 text-xs text-ink-muted" data-testid="breadcrumbs">
        <RouterLink to="/featherbase/admin" className={touchLinkClasses('hover:underline')}>Admin</RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink
          to="/featherbase/admin/table/$table"
          params={{ table }}
          search={{ filters: undefined }}
          className={touchLinkClasses('hover:underline')}
        >
          {table}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span className="min-w-0 text-ink">{isNew ? 'New' : <RowTitle table={table} rowId={name} />}</span>
      </nav>
      <ArchivedBanner table={table} meta={meta.data} canUnarchive={false} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <h1 className="text-xl font-semibold text-ink">
            {/* The row's title (title column, or a readable stand-in from its
                values) — the same one Home and the activity feed show. */}
            {table}: {isNew ? 'New' : <RowTitle table={table} rowId={name} />}
            <GlossaryHelp table={table} className="ml-1" />
          </h1>
          <span className="text-xs text-ink-muted" data-testid="form-status">
            {dirty ? 'Not saved' : isNew ? 'New document' : 'Saved'}
          </span>
          {boundSource && (
            <span
              className={pillClasses('ml-2 align-middle text-xs')}
              data-testid="source-badge"
              title={`Rows live on data source ${boundSource}`}
            >
              {boundSource} · {sourceReadOnly ? 'read-only' : 'read-write'}
            </span>
          )}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {!isNew && <RecordNav table={table} name={name} />}
          {table === 'Data Source' && !isNew && (
            <RouterLink
              to="/featherbase/admin/source/$name"
              params={{ name }}
              search={{ database: undefined, schema: undefined, connect: undefined }}
              data-testid="form-source-browser"
              className={buttonClasses()}
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
                  ? 'bg-positive-tint text-positive'
                  : status === 'cancelled'
                    ? 'bg-negative-tint text-negative'
                    : 'bg-subtle text-ink-muted'
              }`}
            >
              {status === 'submitted' ? 'Submitted' : status === 'cancelled' ? 'Cancelled' : 'Draft'}
            </span>
          )}
          {!isNew && baseline.retired_at != null && <RetiredBadge />}
          {!isNew && <ActionDisclosure label="Record actions" open={recordActionsOpen} onOpenChange={setRecordActionsOpen}>
          {!isNew && (
            <RouterLink
              to="/featherbase/print/$table/$name"
              params={{ table, name }}
              search={{ format: undefined }}
              data-testid="form-print"
              className={buttonClasses()}
            >
              Print
            </RouterLink>
          )}
          {/* A bound row's pk belongs to the source — never renameable here. */}
          {renamable && !renaming && (
            <button
              onClick={() => {
                setRenameValue(name)
                setRenaming(true)
              }}
              data-testid="form-rename"
              className={buttonClasses()}
            >
              Rename
            </button>
          )}
          {renaming && (
            <span className="flex max-w-full flex-wrap items-center gap-1">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                data-testid="rename-input"
                className={inputClasses('w-40')}
              />
              <button onClick={doRename} data-testid="rename-confirm" className={buttonClasses({ variant: 'primary' })}>
                Rename
              </button>
              <button onClick={() => setRenaming(false)} className={buttonClasses()}>
                Cancel
              </button>
            </span>
          )}
          {/* #859: take the row out of use, keeping it and its history
              (the delete right), or put it back (the write right). */}
          {!isNew && access.data?.retire && !rowManaged && (
            <button
              onClick={() => {
                setRecordActionsOpen(false)
                setRetiring(true)
              }}
              data-testid="form-retire"
              className={buttonClasses()}
            >
              {t('Retire')}
            </button>
          )}
          {!isNew && access.data?.reactivate && !rowManaged && (
            <button
              onClick={async () => {
                setRecordActionsOpen(false)
                setBanner(null)
                suppressStaleUntil.current = Date.now() + 2000
                try {
                  await reactivateRow(queryClient, table, name)
                  setBanner('Done')
                } catch (err) {
                  setBanner(err instanceof ApiError ? err.message : 'Reactivate failed')
                }
              }}
              data-testid="form-reactivate"
              className={buttonClasses()}
            >
              {t('Reactivate')}
            </button>
          )}
          {/* #859: a System Manager's way out of the history rule. */}
          {!isNew && access.data?.purge && !rowManaged && (
            <button
              onClick={() => {
                setRecordActionsOpen(false)
                setPurging(true)
              }}
              data-testid="form-purge"
              className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint' })}
            >
              {t('Delete permanently')}
            </button>
          )}
          {/* TLC-J2.1: the row I am looking at is the row I can remove.
              Absent where rows are not deletable at all — a settings table's
              single row and a sub-table's rows (both refused by the server,
              so an affordance here would only ever produce an error), and a
              read-only source, which owns its rows. */}
          {!isNew &&
            access.data?.delete &&
            !rowManaged &&
            m.kind !== 'settings' &&
            m.kind !== 'sub_table' && (
              <button
                onClick={() => {
                  setDeleteError(null)
                  setDeleteOffersRetire(false)
                  setConfirmingDelete(true)
                }}
                data-testid="form-delete"
                className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint' })}
              >
                {t('Delete')}
              </button>
            )}
          </ActionDisclosure>}
          {!rowsReadOnly && (
            <button
              onClick={save}
              disabled={saveDisabled}
              data-testid="form-save"
              className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
            >
              {saving ? t('Saving…') : t('Save')}
            </button>
          )}
          {submittable && access.data?.submit && status === 'draft' && !dirty && (
            <button
              onClick={() => runAction('submit')}
              data-testid="form-submit"
              className={buttonClasses({ variant: 'primary' })}
            >
              Submit
            </button>
          )}
          {submittable && access.data?.cancel && status === 'submitted' && (
            <button
              onClick={() => runAction('cancel')}
              data-testid="form-cancel"
              className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint' })}
            >
              Cancel
            </button>
          )}
          {submittable && access.data?.amend && status === 'cancelled' && (
            <button
              onClick={() => runAction('amend')}
              data-testid="form-amend"
              className={buttonClasses()}
            >
              Amend
            </button>
          )}
        </div>
      </div>
      {!isNew && <RowConnections table={table} row={name} values={doc.data} />}
      {storage && (
        <section aria-label="Storage" data-testid="table-storage" className={cardClasses('mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm')}>
          <span className="font-medium">Storage</span>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {Object.entries({
              ...(storage.data_source ? { 'Data Source': storage.data_source } : {}),
              Schema: storage.schema || '(none)', Relation: storage.relation, 'Row key': storage.row_key.join(', '),
              ...(storage.discriminator ? { 'Table discriminator': storage.discriminator.table_name } : {}),
            }).map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-baseline gap-2">
                <dt className="text-ink-muted">{label}</dt>
                <dd><code className="select-text break-all text-ink">{value}</code></dd>
              </div>
            ))}
          </dl>
          <button className={buttonClasses({ className: 'ml-auto' })} onClick={async () => {
            try {
              await navigator.clipboard.writeText([
                ...(storage.data_source ? [`Data Source: ${storage.data_source}`] : []),
                `Schema: ${storage.schema}`, `Relation: ${storage.relation}`, `Row key: ${storage.row_key.join(', ')}`,
                ...(storage.discriminator ? [`table_name: ${storage.discriminator.table_name}`] : []),
              ].join('\n'))
              setStorageCopy('Copied')
            } catch { setStorageCopy('Copy unavailable. Select the storage text to copy it.') }
          }}>Copy storage</button>
          <span role="status" className="text-xs text-ink-muted">{storageCopy}</span>
        </section>
      )}
      {/* TLC-J2.2 / TLC-R4: a real dialog that NAMES the row. Deliberately
          the same shape as the table-level confirmation in ListView (DEL-J1.2)
          — labelled, aria-modal, Escape-dismissable, destructive action on the
          right — so a confirmation reads the same wherever it appears. */}
      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40"
          onClick={() => !deleteBusy && setConfirmingDelete(false)}
          onKeyDown={(e) => e.key === 'Escape' && !deleteBusy && setConfirmingDelete(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-row-title"
            className={cardClasses('w-full max-w-lg p-4')}
            data-testid="delete-row-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="delete-row-title"
              className="mb-2 text-base font-semibold text-ink"
            >
              {/* #959: the row as its heading names it. */}
              Delete {table}: <RowTitle table={table} rowId={name} />?
            </h2>
            <p className="mb-3 text-sm text-ink-muted">
              This cannot be undone.
            </p>
            {deleteError && (
              <p className="mb-3 text-sm text-negative" data-testid="delete-row-error">
                {deleteError}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 [&>button]:whitespace-nowrap">
              {deleteError && access.data?.purge && (
                <button
                  onClick={() => {
                    setConfirmingDelete(false)
                    setPurging(true)
                  }}
                  disabled={deleteBusy}
                  className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint' })}
                  data-testid="delete-row-purge-instead"
                >
                  Delete permanently
                </button>
              )}
              {deleteOffersRetire && access.data?.retire && (
                <button
                  onClick={() => {
                    setConfirmingDelete(false)
                    setRetiring(true)
                  }}
                  disabled={deleteBusy}
                  className={buttonClasses({ variant: 'primary' })}
                  data-testid="delete-row-retire-instead"
                >
                  Retire instead
                </button>
              )}
              <button
                autoFocus
                onClick={() => setConfirmingDelete(false)}
                disabled={deleteBusy}
                className={buttonClasses()}
                data-testid="delete-row-cancel"
              >
                Cancel
              </button>
              {/* A refusal with a way out would only be refused again; a failed
                  request (say, offline) can still be retried from here. */}
              {!deleteOffersRetire && <button
                onClick={deleteRow}
                disabled={deleteBusy}
                className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint disabled:opacity-40' })}
                data-testid="delete-row-confirm"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>}
            </div>
          </div>
        </div>
      )}
      {purging && (
        <PurgeDialog
          table={table}
          ids={[name]}
          onClose={() => setPurging(false)}
          onDone={() => {
            setPurging(false)
            queryClient.setQueryData(['row-title', table, name], null)
            navigate({ to: '/featherbase/admin/table/$table', params: { table }, search: { filters: undefined } })
          }}
        />
      )}
      {retiring && (
        <RetireDialog
          table={table}
          name={name}
          // The person's own retire is not someone else's change (RT-002).
          onSubmit={() => { suppressStaleUntil.current = Date.now() + 2000 }}
          onClose={() => setRetiring(false)}
        />
      )}
      {!isNew && <RetiredNotice row={baseline} />}
      {banner && (
        <p
          className={`mb-3 text-sm ${banner === 'Saved' || banner === 'Done' ? 'text-positive' : 'text-negative'}`}
          data-testid="form-banner"
        >
          {banner}
        </p>
      )}
      {!isNew && access.isError && <p role="alert" className="mb-3 text-sm text-negative">Available operations could not be checked. Reload to retry.</p>}
      {scriptError && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-caution/40 bg-caution-tint px-3 py-2 text-sm text-caution"
          data-testid="client-script-error"
        >
          <span>{scriptError}</span>
          <button onClick={() => setScriptError(null)} className="ml-2 text-xs underline">
            dismiss
          </button>
        </div>
      )}
      {uncheckedSaves && (
        <p
          role="note"
          className="mb-3 rounded-md border border-caution/40 bg-caution-tint px-3 py-2 text-sm text-ink"
          data-testid="unchecked-saves-notice"
        >
          {boundSource} doesn’t record when its rows last changed, so changes made there while you
          edit are not detected. Saving replaces what is there.
        </p>
      )}
      {idOutOfStep && naming && (
        <p
          role="note"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-caution/40 bg-caution-tint px-3 py-2 text-sm text-ink"
          data-testid="form-id-out-of-step"
        >
          <span>
            This row keeps the id {name}. Its {m.columns.find((c) => c.column_name === naming.column)?.label || naming.column} now
            gives {idOutOfStep}.
          </span>
          <button
            onClick={() => {
              setRenameValue(idOutOfStep)
              setRenaming(true)
              setRecordActionsOpen(true)
            }}
            data-testid="form-id-rename"
            className={buttonClasses()}
          >
            Rename to {idOutOfStep}
          </button>
        </p>
      )}
      {staleBanner && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-caution/40 bg-caution-tint px-3 py-2 text-sm"
          data-testid="stale-banner"
        >
          <span className="text-ink">
            This document was changed in another session.
          </span>
          <button
            onClick={async () => {
              await queryClient.invalidateQueries({ queryKey: ['doc', table, name] })
              await queryClient.invalidateQueries({ queryKey: ['row-capabilities'] })
              setStaleBanner(false)
            }}
            data-testid="stale-refresh"
            className={buttonClasses()}
          >
            Refresh
          </button>
        </div>
      )}
      {editingOverride && Boolean(values.table_name) && !overrideTarget.data && (
        <p role="status" className="mb-4 text-sm text-ink-muted">
          {overrideTarget.isError ? 'Cannot load the selected Table. Choose another Table or try again.' : 'Loading the selected Table…'}
        </p>
      )}
      {editingOverride && !isNew && typeof baseline.table_name === 'string' && (
        <RouterLink
          to="/featherbase/admin/table/$table"
          params={{ table: baseline.table_name }}
          search={{ filters: undefined }}
          className={touchLinkClasses('mb-4 inline-flex text-sm text-accent hover:underline')}
        >
          Open Table: {baseline.table_name}
        </RouterLink>
      )}
      {reading && <ReadingPresentation presentation={reading} meta={m} values={values} />}
      {changeRecord && <ChangeRecord values={values} />}
      <RawDetails data-testid={reading || changeRecord ? 'raw-details' : undefined}>
      {(reading || changeRecord) && <summary className="mb-4 cursor-pointer rounded-md px-1 py-2 text-sm font-medium text-ink-muted focus-visible:outline-2 focus-visible:outline-accent">{t(changeRecord ? 'Raw JSON' : 'Raw details')}</summary>}
      {isNew ? work : <ContentTabs label="Record workspace" value={area} onChange={setArea} tabs={[
        { id: 'Form', label: 'Form', content: work },
        { id: 'Map', label: 'Map', content: <RowMap table={table} name={name} /> },
        { id: 'Tree', label: 'Tree', content: <RowTree table={table} name={name} /> },
        { id: 'Collaboration', label: 'Collaboration', content: <>
          <p className="mb-4 text-sm text-ink-muted">People, tags and files for this record. Disabled features show existing content read-only.</p>
          <div className="grid max-w-5xl grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <Assignments table={table} name={name} readOnly={!m.enable_assignments || !access.data?.assign} />
            <Tags table={table} name={name} readOnly={!m.enable_tags || !access.data?.tag} />
            <Attachments table={table} name={name} readOnly={!m.enable_files} canUpload={Boolean(access.data?.upload)} />
          </div>
        </> },
        { id: 'Activity', label: 'Activity', content: <div className="max-w-3xl space-y-4">
          <ActivityTimeline table={table} name={name} />
          {m.enable_discussion && access.data?.comment && <Comments table={table} name={name} />}
        </div> },
      ]} />}
      </RawDetails>
      {/* #1009: Save stays in view, wherever the person has scrolled to. Fixed,
          since the page's split makes its own scroll box, which pins sticky. */}
      {unsaved && !rowsReadOnly && (
        <div role="status" data-testid="form-unsaved-bar"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-2 shadow-lg max-sm:left-4 max-sm:justify-between">
          <span className="text-sm font-medium text-ink">{t('Unsaved changes')}</span>
          <button onClick={save} disabled={saveDisabled} aria-label={saving ? undefined : t('Save changes')} className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}>
            {saving ? t('Saving…') : t('Save')}
          </button>
        </div>
      )}
      {leaveGuard.status === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40"
          onClick={() => leaveGuard.reset()}
          onKeyDown={(e) => e.key === 'Escape' && leaveGuard.reset()}>
          <div role="dialog" aria-modal="true" aria-labelledby="unsaved-leave-title" data-testid="unsaved-leave-dialog"
            className={cardClasses('w-full max-w-lg p-4')} onClick={(e) => e.stopPropagation()}>
            <h2 id="unsaved-leave-title" className="mb-2 text-base font-semibold text-ink">{t('Leave without saving?')}</h2>
            <p className="mb-3 text-sm text-ink-muted">{t("Your changes to this form haven't been saved.")}</p>
            <div className="flex flex-wrap justify-end gap-2 [&>button]:whitespace-nowrap">
              <button autoFocus onClick={() => leaveGuard.reset()} className={buttonClasses()}>{t('Stay')}</button>
              <button onClick={() => leaveGuard.proceed()} className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint' })}>{t('Leave without saving')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// #324: the Row ID input a new row gets when its creator names it. Not one of
// the Table's own columns — the ID is a standard column — so it is described
// here, as a required text field.
const ROW_ID_FIELD = {
  column_name: 'row_id',
  label: 'Row ID',
  column_type: 'Data',
  reqd: true,
  description: 'Rows in this table take the ID you type here. It must not already be in use.',
} as ColumnDef

export { unlinkedSourceTable }

function FieldControl({
  field,
  value,
  error,
  onChange,
  meta,
  values,
  setField,
  managedHint,
  errors,
  columns,
}: {
  columns: 1 | 2
  field: ColumnDef
  value: unknown
  error?: string
  /** Every field's error, keyed as the server names them; a grid of nested
   *  rows shows its cells' (`lines.0.customer`) in place (#832). */
  errors?: Record<string, string>
  onChange: (value: unknown) => void
  meta: TableMeta
  values: Row
  setField: (columnName: string, value: unknown) => void
  /** #465 D5: set when the instance settings file sets this field. */
  managedHint?: string
}) {
  const settings = useSettings()
  const { t } = useI18n()
  const base = inputClasses()
  const instanceId = useId()
  const controlId = `${instanceId}-${field.column_name}`
  const labelId = `${controlId}-label`
  const label = (
    <label htmlFor={controlId} className={labelClasses()}>
      <span id={labelId}>{t(field.label ?? field.column_name)}</span>
      {field.reqd && <span aria-hidden="true" className="text-negative"> *</span>}
      <GlossaryHelp table={meta.name} column={field.column_name} className="ml-1" />
    </label>
  )
  // SET-004: below Date/Currency/Float inputs, show the value as it renders
  // globally (native inputs can't honor a custom format), so the form
  // reflects System Settings just like lists do.
  const preview =
    value != null && value !== '' && ['Date', 'Datetime', 'Currency', 'Float'].includes(field.column_type) ? (
      <p className="mt-1 text-xs text-ink-subtle" data-testid={`preview-${field.column_name}`}>
        {formatValue(field.column_type, value, settings)}
      </p>
    ) : null
  const err = error && (
    <p className="mt-1 text-xs text-negative" data-testid={`error-${field.column_name}`}>
      {error}
    </p>
  )
  // #473: the column's own description, from its metadata.
  const hintText = field.description?.trim() || null
  const hintId = `${controlId}-hint`
  const hint = hintText ? (
    <p id={hintId} className="mt-1 text-xs text-ink-subtle" data-testid={`hint-${field.column_name}`}>
      {t(hintText)}
    </p>
  ) : null
  const managedId = `${controlId}-managed`
  const managedNote = managedHint ? (
    <p id={managedId} className="mt-1 text-xs text-ink-subtle" data-testid={`managed-${field.column_name}`}>
      {withFileName(t(managedHint))}
    </p>
  ) : null
  // #796: a column whose source foreign key has no connected table to link
  // to says so, and offers a System Manager the table to connect.
  const unlinkedTarget = unlinkedSourceTable(field, meta)
  const unlinkedId = `${controlId}-unlinked`
  const unlinkedNote = <UnlinkedNote id={unlinkedId} field={field} meta={meta} />
  // #1021: a link to a view whose row has since left it keeps the link, and
  // says so; a new value must still be one of the view's rows.
  const outsideView = Array.isArray(values.links_outside_view) && values.links_outside_view.includes(field.column_name)
  const outsideNote = outsideView ? (
    <p className="mt-1 text-xs text-caution" data-testid={`outside-view-${field.column_name}`}>
      No longer in the {field.reference_table} view. The link stays as it is; a new choice must be one of them.
    </p>
  ) : null
  const describedBy = [hintText ? hintId : null, managedHint ? managedId : null, unlinkedTarget ? unlinkedId : null]
    .filter(Boolean)
    .join(' ')
  const common = {
    id: controlId,
    'aria-labelledby': labelId,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    'aria-required': field.reqd || undefined,
    disabled: field.read_only,
    'data-field': field.column_name,
    'data-fieldtype': field.column_type,
  }

  const wide = ['Text', 'Long Text', 'JSON', 'Sub-table'].includes(field.column_type)
  const wrap = (control: React.ReactNode) => (
    <div className={`min-w-0 ${wide && columns === 2 ? '@2xl:col-span-2' : ''}`} data-form-field={field.column_name} data-label={field.label ?? field.column_name}>
      {label}
      {control}
      {hint}
      {managedNote}
      {unlinkedNote}
      {outsideNote}
      {meta.name === 'Person' && field.column_name === 'roles' && <EveryoneRolesNote />}
      {preview}
      {err}
    </div>
  )

  switch (field.column_type) {
    case 'Check':
      return wrap(
        // On a touch screen the label around the box (no text of its own, so
        // the field's name is unchanged) is the thumb-sized target (index.css).
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 pointer-coarse:size-5"
            {...common}
          />
        </label>,
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
                {choiceLabel(o, field.choice_labels, t)}
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
          className={inputClasses('font-mono')}
          {...common}
        />,
      )
    case 'Sub-table':
      return wrap(
        <ChildGrid
          id={controlId}
          labelledBy={labelId}
          field={field}
          rows={(values[field.column_name] as Row[] | undefined) ?? []}
          onChange={(rows) => setField(field.column_name, rows)}
          errors={errors}
        />,
      )
    case 'Reference': {
      // #881: a link to a row of any Table takes its Table from the row's own
      // Table column, chosen first; a Table column offers only the Tables its
      // row column allows, and choosing another Table clears the row.
      if (field.table_column) {
        const chosen = values[field.table_column]
        if (chosen == null || chosen === '')
          return wrap(
            <input type="text" className={base} {...common} disabled value="" placeholder="Choose its Table first" />,
          )
        return wrap(
          <LinkControl
            key={String(chosen)}
            field={{ ...field, reference_table: String(chosen) }}
            value={value}
            onChange={onChange}
            className={base}
            common={common}
            anyTable
          />,
        )
      }
      const bound = field.reference_table === 'Table'
        ? meta.columns.filter((c) => c.table_column === field.column_name)
        : []
      return wrap(
        <LinkControl
          field={field}
          value={value}
          onChange={bound.length ? (next) => {
            if (next !== value) for (const row of bound) setField(row.column_name, null)
            onChange(next)
          } : onChange}
          className={base}
          common={common}
          extraFilters={bound.length ? anyTableFilters(bound) : undefined}
        />,
      )
    }
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

// The settings file's name never breaks at its hyphen on a narrow screen.
function withFileName(text: string): React.ReactNode {
  const parts = text.split(INSTANCE_SETTINGS_FILE)
  return parts.flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <span key={i} className="whitespace-nowrap" data-testid="settings-file-name">
            {INSTANCE_SETTINGS_FILE}
          </span>,
          part,
        ],
  )
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// #923: the roles System Settings gives everyone who signs in are held by this
// person too, though they are not in the list above. A System Manager, who can
// change both, sees them named here.
function EveryoneRolesNote() {
  const isManager = useIsSystemManager()
  const { data } = useQuery({
    queryKey: ['doc', 'System Settings', 'System Settings'],
    enabled: isManager,
    queryFn: () => api.get<{ everyone_roles?: string | null }>('/api/table/System%20Settings/System%20Settings'),
  })
  const roles = String(data?.everyone_roles ?? '').split('\n').map((r) => r.trim()).filter(Boolean)
  if (!roles.length) return null
  return (
    <p className="mt-1 text-xs text-ink-muted" data-testid="everyone-roles-note">
      Everyone who signs in also holds {roles.join(', ')}, set in{' '}
      <RouterLink to={tableHref('System Settings')} className="text-action hover:underline">System Settings</RouterLink>.
    </p>
  )
}
