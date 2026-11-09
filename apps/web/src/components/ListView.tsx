import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { rowDisplayTitle } from 'shared'
import { ApiError, api, getToken, listResource } from '../lib/api'
import { useNavigation } from '../lib/navigation'
import { TreeOfAll } from './RelationTree'
import { rowCapabilitiesQuery } from '../lib/row-capabilities'
import { NO_COLUMN_TYPES, isArchived, isRowsReadOnly, isSystemWritten, isView, useMeta } from '../lib/meta'
import { SaveAsView, ViewBanner } from './TableViews'
import { dataColumns, defaultColumnNames, isShown, listFields, listFlagsFromView, switchColumn, titleListColumn, viewColumns, type ColumnArrangement } from '../lib/list-view-columns'
import { useRealtime } from '../lib/realtime'
import { useSettings } from '../lib/settings'
import { useCapabilities, useIsSystemManager } from '../lib/session'
import { ChecklistSwitch } from './ChecklistView'
import { MoreColumnsHint, OneLine, useMoreToTheRight } from './list-one-line'
import { Button, NARROW_QUERY, ViewToggle, Notice, Select, buttonClasses, cardClasses, inputClasses, pillClasses, touchRowClasses, useMediaQuery } from '@featherbase/shop-floor'
import { ChevronDown } from '@featherbase/shop-floor'
import { tableCanRetire } from './RowRetirement'
import { PurgeDialog, tableCanPurge } from './PurgeDialog'
import { GlossaryHelp } from './GlossaryHelp'
import { fmtCount } from '@featherbase/shop-floor'
import { failureMessage } from '../lib/import-run'
import { ImportConflicts } from './ImportConflicts'
import { ActionDisclosure } from './ActionDisclosure'
import { RenameTable } from './RenameTable'
import { ArchiveTable, ArchivedBanner, canArchive } from './ArchiveTable'
import { rememberListPlace } from './RecordNav'
import { FilterBar, StandardFilters, type Filter } from './ListFilters'
import { SavedViewsBar } from './SavedViewsBar'
import { RecentStrip } from './RecentStrip'
import { ExploreSplitButton } from './ExploreSplitButton'
import { ListRow, NAME_CLIP, PhoneList, cell, isFigure } from './ListRows'

const PAGE = 20
// #738: a Show columns row is thumb-sized at phone width even under a mouse
// (a narrowed window still draws the phone layout), as on any touch screen.
const PHONE_ROW = 'max-sm:min-h-touch'

/** The pager's "1–20 of 1,23,456", counts Indian-grouped. */
/** A row a bulk change on a connected Table could not change (#332). */
interface BulkFailure {
  row_id: string
  message: string
  fields?: Record<string, string>
}

export function pageRange(start: number, pageSize: number, total: number): string {
  return `${fmtCount(total === 0 ? 0 : start + 1)}–${fmtCount(Math.min(start + pageSize, total))} of ${fmtCount(total)}`
}

const NO_FILTERS: Filter[] = []
// A compact list: the row's name, then this many key values.
const COMPACT_COLUMNS = 3

/** The link values a filtered list's new rows start with: each "= one row"
 *  filter on a link column the person may set. */
function linkPrefill(meta: import('../lib/meta').TableMeta, filters: Filter[]): Record<string, unknown> | undefined {
  const prefill: Record<string, unknown> = {}
  for (const [column, op, value] of filters) {
    const col = meta.columns.find((c) => c.column_name === column)
    if (op === '=' && col?.column_type === 'Reference' && !col.read_only && !col.hidden && (typeof value === 'string' || typeof value === 'number'))
      prefill[column] = value
  }
  return Object.keys(prefill).length ? prefill : undefined
}

// UI-002/UI-003: ONE list component renders every Table from its metadata.
export function ListView({
  table,
  filters = [],
  onFiltersChange,
  breadcrumb,
  newRowPrefill,
  baseFilters = NO_FILTERS,
  title,
  defaultOrderBy,
  empty,
  subtitle,
}: {
  table: string
  filters?: Filter[]
  onFiltersChange?: (filters: Filter[]) => void
  breadcrumb?: ReactNode
  /** null disables direct creation for a via-sub-table relationship. */
  newRowPrefill?: Record<string, unknown> | null
  /** #835: filters that define the page itself (Waiting for access). Always
   *  applied, never shown as chips or saved into a view. */
  baseFilters?: Filter[]
  /** The page's heading in place of the Table's name. */
  title?: ReactNode
  /** The order before the person picks one, in place of the Table's. */
  defaultOrderBy?: string
  /** What an empty list says, in place of "No rows". */
  empty?: ReactNode
  /** One line under the heading saying what the page lists. */
  subtitle?: ReactNode
}) {
  const meta = useMeta(table)
  const settings = useSettings()
  // #910: on a list page, selecting a row shows it in the drill pane.
  const navigation = useNavigation()
  const nav = navigation?.step.screen === 'list' && navigation.step.table === table ? navigation : null
  const paneRow = nav?.step.pane?.table === table ? nav.step.pane.row : undefined
  const openPane = nav ? (pane: { table: string; row: string }) => nav.push({ ...nav.step, pane }) : undefined
  // #910 checklist 19: every row as a folded tree line, kept in the path.
  const [localTree, setLocalTree] = useState<{ on: boolean; expanded: string[] }>({ on: false, expanded: [] })
  const treeOn = nav ? nav.step.view === 'tree' : localTree.on
  const treeExpanded = new Set(nav ? nav.step.expanded ?? [] : localTree.expanded)
  function setTree(on: boolean, expandedIds: string[] = []) {
    if (nav) {
      const { view: _, expanded: __, ...rest } = nav.step
      nav.replace(on ? { ...rest, view: 'tree', ...(expandedIds.length ? { expanded: expandedIds } : {}) } : rest)
    } else setLocalTree({ on, expanded: expandedIds })
  }
  const isSystemManager = useIsSystemManager()
  const caps = useCapabilities()
  // #410: New is offered only to someone the server would let create a row here.
  const canAddRows = newRowPrefill !== null && Boolean(caps?.manage || caps?.creatable.includes(table))
  // #910: a list narrowed to the rows linking to one row (a drill pane group
  // opened as a list) starts its new rows linked to that row too.
  if (newRowPrefill === undefined && meta.data) newRowPrefill = linkPrefill(meta.data, filters)
  const queryClient = useQueryClient()
  // usable-on-any-device "Lists fit a phone": below 40rem the rows are cards.
  const narrow = useMediaQuery(NARROW_QUERY)
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const [start, setStart] = useState(0)
  // UI-013 / #738: per-user saved settings — sort, and which columns show,
  // kept as columns switched on and off on top of the Table's list columns.
  const [arrangement, setArrangement] = useState<Required<ColumnArrangement>>({ shownCols: [], hiddenCols: [] })
  // #910 checklist 1: Compact shows each row's name and two key values.
  const [compact, setCompact] = useState(false)
  const [tableScroll, setTableScroll] = useState<HTMLDivElement | null>(null)
  const moreToTheRight = useMoreToTheRight(tableScroll)
  // #1017: the Add filter row waits until it's asked for.
  const [addFilterOpen, setAddFilterOpen] = useState(false)
  const [colPickerOpen, setColPickerOpen] = useState(false)
  // #738: the Show columns menu grows into the space below its button and no
  // further, so it ends on screen; it scrolls inside only when that is short.
  const colPickerRef = useRef<HTMLDivElement>(null)
  const [colPickerMax, setColPickerMax] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = colPickerRef.current
    if (!colPickerOpen || !el) return
    const fit = () => setColPickerMax(Math.max(160, window.innerHeight - el.getBoundingClientRect().top - 12))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [colPickerOpen])
  const [conflictsOpen, setConflictsOpen] = useState(false)
  useEffect(() => setConflictsOpen(false), [table])
  // #859: retired rows are left out unless the person asks to see them.
  const [showRetired, setShowRetired] = useState(false)
  useEffect(() => setShowRetired(false), [table])
  const retirable = tableCanRetire(meta.data)
  // #859: a System Manager may delete the selection permanently.
  const [purging, setPurging] = useState(false)
  const canPurge = isSystemManager && tableCanPurge(meta.data)
  const withRetired = retirable && showRetired
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsUnsaved, setSettingsUnsaved] = useState(false)
  const settingsWrite = useRef(Promise.resolve())
  const [makingDefault, setMakingDefault] = useState<'saving' | 'failed' | null>(null)
  // UI-012: bulk selection state.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectedAccess = useQueries({ queries: [...selected].map((name) => rowCapabilitiesQuery(table, name)) })
  // Keep existing bulk refusal/partial-result semantics. A mixed selection
  // still reaches the server; no mutation is offered when none is authorized.
  const canBulkDelete = selectedAccess.some((q) => q.data?.delete)
  const canBulkEdit = selectedAccess.some((q) => q.data?.write)
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  // #327: bulk delete asks first, like deleting one row or the whole Table.
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)
  const bulkDeleteButton = useRef<HTMLButtonElement>(null)
  // Escape closes it wherever focus has wandered, and focus goes back to the
  // Delete that opened it.
  useEffect(() => {
    if (!confirmingBulkDelete || bulkBusy) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setConfirmingBulkDelete(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmingBulkDelete, bulkBusy])
  useEffect(() => {
    if (!confirmingBulkDelete) return
    const opener = bulkDeleteButton.current
    return () => opener?.focus()
  }, [confirmingBulkDelete])
  const queryFilters = baseFilters.length ? [...baseFilters, ...filters] : filters
  const filterKey = JSON.stringify(queryFilters)
  useEffect(() => setStart(0), [filterKey])
  useEffect(() => setSelected(new Set()), [filterKey, start, table])
  // DEL-J1 (docs/specs/0003-table-deletion.md): deleting the whole Table.
  // The confirmation must carry the LIVE row count, never a bare "sure?".
  const navigate = useNavigate()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteCount = useQuery({
    queryKey: ['delete-count', table],
    enabled: confirmingDelete,
    queryFn: () => api.post<{ count: number }>('/api/dashboard/count', { table }),
  })
  async function deleteTable() {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.delete(`/api/table_def/${encodeURIComponent(table)}`)
      // Drop this table's queries (refetching them would 404), then let the
      // rest of the app refetch what the sweep touched (nav, home pages).
      for (const key of ['meta', 'list', 'doc', 'delete-count'])
        queryClient.removeQueries({ queryKey: [key, table] })
      await navigate({ to: '/featherbase/admin/all-tables' })
      void queryClient.invalidateQueries()
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : String(e))
      setDeleteBusy(false)
    }
  }
  // #100 pattern 5 (Access subdatasheets): rows of tables with Sub-table
  // columns expand their child rows inline via a chevron.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => setExpanded(new Set()), [filterKey, start, table])

  // RT-001: another session creating/updating/deleting a doc of this type
  // refreshes the list without a reload.
  useRealtime([`list:${table}`], () => {
    void queryClient.invalidateQueries({ queryKey: ['list', table] })
  })

  // UI-013: load this user's saved view settings (sort + hidden columns)
  // once per Table. Filters stay URL-driven (UI-003), so they're not
  // persisted here — this covers the durable "customize a list" bits.
  useEffect(() => {
    let cancelled = false
    setSettingsLoaded(false)
    setSettingsUnsaved(false)
    api
      .get<{ settings: { sort?: typeof sort; hiddenCols?: string[]; shownCols?: string[]; compact?: boolean } | null }>(
        `/api/user_settings/${encodeURIComponent(table)}`,
      )
      .then((res) => {
        if (cancelled) return
        const s = res.settings
        if (s) {
          if (s.sort) setSort(s.sort)
          setCompact(s.compact === true)
          setArrangement({
            shownCols: Array.isArray(s.shownCols) ? s.shownCols : [],
            hiddenCols: Array.isArray(s.hiddenCols) ? s.hiddenCols : [],
          })
        }
        setSettingsLoaded(true)
      })
      .catch(
        () => setSettingsLoaded(true),
      )
    return () => {
      cancelled = true
    }
    // Only re-run when the Table changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])

  // Persist settings whenever the user changes them (after the initial load).
  // A save that fails is said, not swallowed (#546): the change still shows
  // now, but the list would open the old way next time.
  function persist(next: { sort?: typeof sort; arrangement?: Required<ColumnArrangement>; compact?: boolean }) {
    if (!settingsLoaded) return
    const token = getToken()
    const snapshot = {
      sort: next.sort !== undefined ? next.sort : sort,
      ...(next.arrangement ?? arrangement),
      compact: next.compact ?? compact,
    }
    // Settings are whole snapshots. Keep writes in interaction order so a
    // slower earlier request cannot restore an obsolete sort or column set.
    settingsWrite.current = settingsWrite.current
      .then(() => {
        // A queued edit belongs to the sign-in that made it. api.put reads
        // the current token, so discard it if that sign-in has ended.
        if (getToken() !== token) return
        return api.put(`/api/user_settings/${encodeURIComponent(table)}`, snapshot)
      })
      .then(() => { if (getToken() === token) setSettingsUnsaved(false) })
      .catch(() => { if (getToken() === token) setSettingsUnsaved(true) })
  }

  const allColumns = meta.data ? viewColumns(meta.data, arrangement) : []
  const columns = compact ? allColumns.slice(0, COMPACT_COLUMNS) : allColumns
  // #209 / #738: who may shape this Table's columns for everyone — "Edit
  // columns" and "Make this the default for everyone" show exactly here.
  // Not on system Tables (their columns are the platform's) nor bound ones
  // (their storage is the source's).
  // #1021: a view's columns are its base's, shaped there.
  const canShapeColumns = Boolean(
    caps?.manage && !meta.data?.system && !isSystemWritten(meta.data) && !meta.data?.data_source && !isView(meta.data),
  )
  // The menu (#738): the Table's list columns first, then every other column
  // the person may read; the column the list leads with (its title, else
  // Row ID, #792) is always on.
  const listDefaults = meta.data ? defaultColumnNames(meta.data) : new Set<string>()
  const leadingTitle = meta.data ? titleListColumn(meta.data) : undefined
  const readableColumns = (meta.data ? dataColumns(meta.data) : []).filter((c) => c !== leadingTitle)
  const inListChoices = readableColumns.filter((c) => listDefaults.has(c.column_name))
  const otherChoices = readableColumns.filter((c) => !listDefaults.has(c.column_name))
  // A bound table only has updated_at when the source table has a modified
  // column to map (external_modified) — sending it as the explicit order
  // makes the server refuse EVERY list load (a caller-supplied order_by must
  // resolve; only server-side defaults fall back to the pk). That covers both
  // the hardcoded fallback AND a stale stored sort_column ('updated_at' is
  // the table_def DB default; migration 0075 repairs it, this guards the
  // window). #176
  const boundNoRevision = Boolean(meta.data?.data_source && !meta.data.external_modified)
  const metaSortColumn =
    boundNoRevision && meta.data?.sort_column === 'updated_at' ? '' : (meta.data?.sort_column ?? '')
  const orderBy = sort
    ? `${sort.field} ${sort.dir}`
    : defaultOrderBy ?? (meta.data
      ? `${metaSortColumn || (boundNoRevision ? 'row_id' : 'updated_at')} ${meta.data.sort_order || 'desc'}`
      : undefined)

  const list = useQuery({
    queryKey: ['list', table, columns.map((c) => c.column_name), orderBy, start, filterKey, withRetired],
    enabled: Boolean(meta.data),
    placeholderData: keepPreviousData,
    queryFn: () =>
      listResource(table, {
        filters: queryFilters,
        fields: retirable ? [...listFields(columns), 'retired_at'] : listFields(columns),
        with_retired: withRetired,
        order_by: orderBy,
        limit_start: start,
        limit_page_length: PAGE,
      }),
  })
  // A form opened from this list steps through it (RecordNav).
  useEffect(() => {
    if (!list.data || list.isError) return
    rememberListPlace(table, {
      filters: queryFilters, orderBy, withRetired, start,
      ids: list.data.data.map((r) => String(r.row_id)),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, list.isError, table])

  if (meta.isLoading) return <p className="text-sm text-ink-subtle">Loading…</p>
  // DEL-R9: the server's not-found can carry a tombstone ("X was deleted by
  // … on …") — show its words, not a generic shrug.
  if (meta.isError)
    return (
      <p className="text-sm text-negative" data-testid="list-error">
        {meta.error instanceof ApiError ? meta.error.message : `Cannot load ${table}`}
      </p>
    )

  const total = list.data?.total ?? 0
  // A refetch refusal must replace cached rows with the error, not silently
  // keep showing a successful list after its Table/access disappeared.
  const rows = list.isError ? [] : list.data?.data ?? []
  const childFields = (meta.data?.columns ?? []).filter(
    (f) => f.column_type === 'Sub-table' && !f.hidden,
  )
  const expandable = childFields.length > 0

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // What an empty or refused list says, in either shape. A refused list query
  // is an error, not an empty table — rendering it as "No rows" hides real
  // data (#176).
  const noRows = list.isError ? (
    list.error instanceof ApiError ? (
      list.error.message
    ) : (
      `Cannot load rows for ${table}`
    )
  ) : list.isPending ? (
    // Not yet loaded is not empty: "No rows" would alarm someone whose
    // Table holds data (#871, a list reopened after its rename).
    'Loading…'
  ) : empty ?? (
    <>
      No rows
      {/* TLC-J1.2: an empty table is the moment the user most
          needs the way forward, so the empty state carries it
          too — the toolbar action is not the only door. */}
      {canAddRows &&
        !isRowsReadOnly(meta.data) &&
        meta.data?.kind !== 'settings' &&
        meta.data?.kind !== 'sub_table' && (
        <>
          {' — '}
          <Link
            to="/featherbase/admin/table/$table/new"
            params={{ table }}
            search={{ prefill: newRowPrefill ? JSON.stringify(newRowPrefill) : undefined }}
            className="text-action underline"
            data-testid="list-empty-new"
          >
            add the first one
          </Link>
        </>
      )}
    </>
  )

  function toggleSort(field: string) {
    setStart(0)
    const next: { field: string; dir: 'asc' | 'desc' } =
      sort?.field === field
        ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    setSort(next)
    persist({ sort: next })
  }

  // #738 (Decision 3): this person's view becomes the Table's list for
  // everyone, in one definition save; their own two sets are then empty,
  // since their view is now the default. The new meta lands before the sets
  // empty, so the list never flashes the old default.
  async function makeDefaultForEveryone() {
    if (!meta.data) return
    setMakingDefault('saving')
    try {
      await api.put(`/api/table_def/${encodeURIComponent(table)}`, listFlagsFromView(meta.data, arrangement))
      await queryClient.invalidateQueries({ queryKey: ['meta', table] })
      const cleared = { shownCols: [], hiddenCols: [] }
      setArrangement(cleared)
      persist({ arrangement: cleared })
      setMakingDefault(null)
    } catch {
      setMakingDefault('failed')
    }
  }

  // UI-013 / #738: switch a column on or off in this person's view (saved
  // per user). Its checkboxes are the columns of meta.data, so it is there.
  function toggleColumn(columnName: string, on: boolean) {
    const next = switchColumn(meta.data!, arrangement, columnName, on)
    setArrangement(next)
    persist({ arrangement: next })
  }
  const columnChoice = (col: { column_name: string; label: string | null }) => {
    const on = isShown(col.column_name, listDefaults, arrangement)
    return (
      <label
        key={col.column_name}
        className={touchRowClasses(`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-subtle ${PHONE_ROW}`)}
      >
        <input
          type="checkbox"
          checked={on}
          data-testid={`list-col-toggle-${col.column_name}`}
          onChange={() => toggleColumn(col.column_name, !on)}
        />
        {col.label ?? col.column_name}
      </label>
    )
  }

  // UI-012: bulk actions over the selected rows. The server puts each row
  // through the normal row lifecycle (save / delete) — no side-channel.
  const editableColumns = (meta.data?.columns ?? []).filter(
    (f) =>
      !NO_COLUMN_TYPES.has(f.column_type) &&
      !['Sub-table', 'Attach', 'Attach Image', 'JSON'].includes(f.column_type) &&
      !f.read_only &&
      !f.hidden,
  )

  function toggleRow(name: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['list', table] })
    setSelected(new Set())
    setBulkError(null)
  }

  // #332: one request for the whole selection. On a platform Table it is
  // all-or-nothing, so a refusal means no row changed. A connected Table's
  // rows are tried one by one; the ones that failed stay selected, named
  // with their reasons.
  function reportPartial(verb: string, done: number, failed: BulkFailure[]) {
    if (!failed.length) return refresh()
    setSelected(new Set(failed.map((f) => f.row_id)))
    setBulkError(
      `${fmtCount(done)} of ${fmtCount(done + failed.length)} ${verb}. ` +
        failed.map((f) => `${f.row_id}: ${refusal(f)}`).join('; '),
    )
    return queryClient.invalidateQueries({ queryKey: ['list', table] })
  }

  // #540: a refusal names each refused field by its label, and why.
  function refusal(err: { message: string; fields?: Record<string, string> }): string {
    const labels = new Map((meta.data?.columns ?? []).map((f) => [f.column_name, f.label ?? f.column_name]))
    return failureMessage(err, (column) => labels.get(column) ?? column)
  }

  async function bulkDelete() {
    setBulkBusy(true)
    setBulkError(null)
    try {
      const result = await api.post<{ deleted: number; failed?: BulkFailure[] }>(
        `/api/table/${encodeURIComponent(table)}:bulk-delete`,
        { rows: [...selected] },
      )
      // #898: the deleted rows' titles go, so recents stop offering them.
      const failed = new Set((result.failed ?? []).map((f) => f.row_id))
      for (const id of selected) if (!failed.has(id)) queryClient.setQueryData(['row-title', table, id], null)
      // The Recent chips ask again, so a deleted row leaves them at once.
      void queryClient.invalidateQueries({ queryKey: ['recent-strip-rows', table] })
      await reportPartial('deleted', result.deleted, result.failed ?? [])
    } catch (err) {
      setBulkError(err instanceof ApiError ? refusal(err) : 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
      setConfirmingBulkDelete(false)
    }
  }

  async function bulkEdit() {
    setBulkBusy(true)
    setBulkError(null)
    const columnType = editableColumns.find((f) => f.column_name === bulkField)?.column_type
    const value: unknown =
      columnType === 'Check'
        ? ['1', 'true', 'yes'].includes(bulkValue.trim().toLowerCase())
        : bulkValue === ''
          ? null
          : bulkValue
    try {
      const result = await api.post<{ changed: number; failed?: BulkFailure[] }>(
        `/api/table/${encodeURIComponent(table)}:bulk-edit`,
        { rows: [...selected], values: { [bulkField]: value } },
      )
      await reportPartial('changed', result.changed, result.failed ?? [])
    } catch (err) {
      setBulkError(err instanceof ApiError ? refusal(err) : 'Bulk edit failed')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div data-testid="list-view">
      {/* Top-aligned on desktop: however many rows the actions wrap to, the first
          row sits level with the title (listview.spec "share a vertical band"). */}
      <div className="mb-2 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          {breadcrumb ?? <div className="text-xs text-ink-subtle">
            <Link to="/featherbase/admin" className="hover:text-ink">
              Home
            </Link>
            {' / '}
            {table}
          </div>}
          {/* #1017: the count reads on the title's line, not one of its own. */}
          <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-xl font-semibold text-ink">{title ?? <>{table}<GlossaryHelp table={table} className="ml-1" /></>}</h1>
          <span className="text-xs text-ink-muted" data-testid="list-total">
            {fmtCount(total)} total
          </span>
          {/* #859: beside the total it changes; the toolbar stays as it was. */}
          {retirable && (
            <label className="ml-1 inline-flex cursor-pointer items-center gap-1 text-xs text-ink-muted" data-testid="list-show-retired">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => {
                  setShowRetired(e.target.checked)
                  setStart(0)
                }}
                data-testid="list-show-retired-toggle"
              />
              Show retired
            </label>
          )}
          {meta.data?.data_source && (
            <span
              className={pillClasses('text-xs')}
              data-testid="source-badge"
              title={`Rows live on data source ${meta.data.data_source}`}
            >
              {meta.data.data_source} · {meta.data.source_writable ? 'read-write' : 'read-only'}
            </span>
          )}
          </div>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        <div
          className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1 sm:basis-64 sm:justify-end"
          data-testid="list-toolbar"
        >
          <div className="relative">
            <button
              onClick={() => setColPickerOpen((o) => !o)}
              className={buttonClasses()}
              aria-expanded={colPickerOpen}
              data-testid="list-columns"
            >
              Show columns
              <ChevronDown aria-hidden data-chevron size={18} />
            </button>
            {colPickerOpen && (
              <div
                // #581: on a phone the button starts the wrapped toolbar,
                // so the pop-up opens from its left edge; from sm up it
                // lines up with the button's right edge as before.
                ref={colPickerRef}
                className={cardClasses('absolute left-0 z-10 mt-1 max-h-[calc(100dvh-12rem)] w-52 max-w-[calc(100vw-2rem)] overflow-y-auto p-2 sm:left-auto sm:right-0')}
                style={colPickerMax ? { maxHeight: colPickerMax } : undefined}
                data-testid="list-columns-popup"
              >
                {/* The leading column names each row, so it is always on. */}
                <label className={touchRowClasses(`flex items-center gap-2 rounded px-2 py-1 text-sm text-ink-muted ${PHONE_ROW}`)}>
                  <input type="checkbox" checked disabled data-testid={`list-col-toggle-${leadingTitle?.column_name ?? 'row_id'}`} />
                  {leadingTitle ? (leadingTitle.label ?? leadingTitle.column_name) : 'Row ID'}
                </label>
                {inListChoices.map(columnChoice)}
                {otherChoices.length > 0 && (
                  <div
                    className="mt-1 border-t border-border px-2 pb-1 pt-2 text-xs text-ink-subtle"
                    data-testid="list-columns-divider"
                  >
                    Not in the list by default
                  </div>
                )}
                {otherChoices.map(columnChoice)}
                {canShapeColumns && (
                  // Pinned to the menu's foot, so it shows even when the rows scroll.
                  <div className="sticky -bottom-2 -mx-2 -mb-2 mt-1 border-t border-border bg-surface px-2 pb-2 pt-1">
                    <button
                      type="button"
                      className={touchRowClasses(`flex w-full items-center rounded px-2 py-1 text-left text-sm text-action hover:bg-subtle disabled:opacity-50 ${PHONE_ROW}`)}
                      disabled={makingDefault === 'saving'}
                      onClick={() => void makeDefaultForEveryone()}
                      data-testid="list-make-default"
                    >
                      Make this the default for everyone
                    </button>
                    {makingDefault === 'failed' && (
                      <p className="px-2 pb-1 text-xs text-negative" data-testid="list-make-default-error">
                        Couldn't make this the default. Everyone's list is as it was.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* TLC-R1 (docs/specs/0007-table-lifecycle.md): the create
              affordance is metadata-gated and lives HERE, in the toolbar of
              the list the user is already looking at. It used to exist only
              as an awesomebar suggestion, which meant a table you had just
              built could not be filled unless you knew to search for its own
              name (#247). Absent, not disabled, where rows cannot be made:
              a read-only source owns its rows (EDS-13), a settings table
              has one row and no list at all, and a sub-table's rows exist only
              inside a parent — `saveDoc` refuses a direct child insert, so
              offering New on a directly-reached child list could only ever
              produce an error. */}
          {canAddRows &&
            !isRowsReadOnly(meta.data) &&
            meta.data?.kind !== 'settings' &&
            meta.data?.kind !== 'sub_table' && (
            <Link
              to="/featherbase/admin/table/$table/new"
              params={{ table }}
              search={{ prefill: newRowPrefill ? JSON.stringify(newRowPrefill) : undefined }}
              className={buttonClasses({ variant: 'primary' })}
              data-testid="list-new"
            >
              New
            </Link>
          )}
          <ActionDisclosure label="View: List">
          <Link
            to="/featherbase/admin/table/$table/view/report"
            params={{ table }}
            search={{ report: undefined }}
            className={buttonClasses()}
            data-testid="open-report"
          >
            Report
          </Link>
          {(meta.data?.columns ?? []).some((f) => f.column_type === 'Choice') && (
            <Link
              to="/featherbase/admin/table/$table/view/kanban"
              params={{ table }}
              search={{ group_by: undefined }}
              className={buttonClasses()}
              data-testid="open-kanban"
            >
              Kanban
            </Link>
          )}
          {(meta.data?.columns ?? []).some((f) => f.column_type === 'Date') && (
            <Link
              to="/featherbase/admin/table/$table/view/calendar"
              params={{ table }}
              className={buttonClasses()}
              data-testid="open-calendar"
            >
              Calendar
            </Link>
          )}
          {/* UI-022: Gantt needs two Date columns (start + end). */}
          {(meta.data?.columns ?? []).filter((f) => f.column_type === 'Date').length >= 2 && (
            <Link
              to="/featherbase/admin/table/$table/view/gantt"
              params={{ table }}
              className={buttonClasses()}
              data-testid="open-gantt"
            >
              Gantt
            </Link>
          )}
          {/* Checklist needs a Sub-table whose row table has a Check column —
              the component renders nothing when the shape is absent. */}
          <ChecklistSwitch table={table} meta={meta.data} />
          </ActionDisclosure>
          <ExploreSplitButton table={table} />
          {(table === 'Person' || (!isRowsReadOnly(meta.data) && caps?.manage) || (meta.data?.kind === 'table' && !meta.data.data_source && !isSystemWritten(meta.data))) && <ActionDisclosure label="List actions">
            {table === 'Person' && <Link to="/featherbase/admin/find-person" className={buttonClasses()} data-testid="open-find-person">Find by code</Link>}
            {!isRowsReadOnly(meta.data) && caps?.manage && <Link to="/featherbase/admin/import" search={{ table }} className={buttonClasses()} data-testid="open-import">Import</Link>}
            {meta.data?.kind === 'table' && !meta.data.data_source && !isSystemWritten(meta.data) && <Button aria-expanded={conflictsOpen} aria-controls="import-conflicts" onClick={() => setConflictsOpen((open) => !open)}>Import conflicts</Button>}
          </ActionDisclosure>}
          {(canShapeColumns || caps?.manage || isSystemManager) && <ActionDisclosure label="Table administration">
          {canShapeColumns && <Link to="/featherbase/admin/table/$table/columns" params={{ table }} className={buttonClasses()} data-testid="open-columns">Edit columns</Link>}
          {caps?.manage && !meta.data?.system && !isSystemWritten(meta.data) && !meta.data?.data_source && !isView(meta.data) && <Link to="/featherbase/admin/table/$table/merge" params={{ table }} className={buttonClasses()} data-testid="open-merge">Merge into…</Link>}
          {isSystemManager && (
            <>
              {/* NAM-001: change how new rows in this Table are named —
                  never for a Table whose rows the platform writes (#432). */}
              {/* #1021: keep the list's filters as a view links can name. */}
              {meta.data?.kind === 'table' && !meta.data.data_source && !isSystemWritten(meta.data) && !isArchived(meta.data) && (
                <SaveAsView table={table} filters={filters} />
              )}
              {!isSystemWritten(meta.data) && !isView(meta.data) && (
                <Link
                  to="/featherbase/admin/table/$table/naming"
                  params={{ table }}
                  className={buttonClasses()}
                  data-testid="open-naming"
                >
                  Naming
                </Link>
              )}
              {/* #1021: a view takes no grants; its base's apply. */}
              {!isView(meta.data) && <Link
                to="/featherbase/admin/table/$table/permissions"
                params={{ table }}
                className={buttonClasses()}
                data-testid="open-permissions"
              >
                Permissions
              </Link>}
              {/* DEL-J1/DEL-R1 (docs/specs/0003-table-deletion.md): the
                  affordance is generic and metadata-gated — never rendered
                  for system tables, never per-table code. */}
              {/* #871: a custom Table only; app and platform Tables are named elsewhere. */}
              {meta.data && !meta.data.system && !meta.data.owner_app && !meta.data.data_source && meta.data.kind !== 'settings' && !isSystemWritten(meta.data) && (
                <RenameTable table={table} noun={isView(meta.data) ? 'view' : 'Table'} />
              )}
              {/* #905: archive a custom Table something replaced; deleting stays separate. */}
              {canArchive(meta.data) && !isArchived(meta.data) && <ArchiveTable table={table} />}
              {!meta.data?.system && !isSystemWritten(meta.data) && (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className={buttonClasses({ variant: 'danger' })}
                  data-testid="delete-table"
                >
                  {isView(meta.data) ? 'Delete view' : 'Delete Table'}
                </button>
              )}
            </>
          )}
          </ActionDisclosure>}
        </div>
      </div>
      <ArchivedBanner table={table} meta={meta.data} canUnarchive={isSystemManager} />
      <ViewBanner meta={meta.data} />
      {conflictsOpen && meta.data && <ImportConflicts key={table} table={table} meta={meta.data} />}
      {settingsUnsaved && (
        <div className="mb-3" data-testid="list-settings-error">
          <Notice tone="negative">
            Couldn't save how this list is sorted and which columns show. It will open the old way next time.
          </Notice>
        </div>
      )}
      {/* DEL-J1.2: a real dialog — labelled, Escape-dismissable — that names
          the Table and its live row count before anything irreversible. */}
      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40"
          onClick={() => !deleteBusy && setConfirmingDelete(false)}
          onKeyDown={(e) => e.key === 'Escape' && !deleteBusy && setConfirmingDelete(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-table-title"
            className={cardClasses('w-full max-w-md p-4')}
            data-testid="delete-table-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-table-title" className="mb-2 text-base font-semibold text-ink">
              Delete {table}?
            </h2>
            <p className="mb-3 text-sm text-ink-muted" data-testid="delete-table-count">
              {isView(meta.data)
                ? `The view goes; the rows of ${meta.data.view_of} stay as they are.`
                : deleteCount.data
                ? `${fmtCount(deleteCount.data.count)} row${deleteCount.data.count === 1 ? '' : 's'} will be permanently deleted.`
                : 'Counting rows…'}{' '}
              This cannot be undone.
            </p>
            {deleteError && (
              <p className="mb-3 text-sm text-negative" data-testid="delete-table-error">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                autoFocus
                onClick={() => setConfirmingDelete(false)}
                disabled={deleteBusy}
                className={buttonClasses()}
                data-testid="delete-table-cancel"
              >
                Cancel
              </button>
              <button
                onClick={deleteTable}
                disabled={deleteBusy || !deleteCount.data}
                className={buttonClasses({ variant: 'danger', className: 'disabled:opacity-40' })}
                data-testid="delete-table-confirm"
              >
                {deleteBusy ? 'Deleting…' : isView(meta.data) ? 'Delete view' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* #327: the same confirmation as Delete Table and a form's Delete —
          labelled, Escape-dismissable, Cancel first — naming how many rows
          go. Whatever the server answers shows in the bulk bar afterwards. */}
      {purging && (
        <PurgeDialog
          table={table}
          ids={[...selected]}
          onClose={() => setPurging(false)}
          onDone={() => {
            setPurging(false)
            setSelected(new Set())
          }}
        />
      )}
      {confirmingBulkDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4"
          onClick={() => !bulkBusy && setConfirmingBulkDelete(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-delete-title"
            className={cardClasses('w-full max-w-md p-4')}
            data-testid="bulk-delete-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="bulk-delete-title" className="mb-2 text-base font-semibold text-ink">
              Delete {fmtCount(selected.size)} row{selected.size === 1 ? '' : 's'}?
            </h2>
            <p className="mb-3 text-sm text-ink-muted">
              The selected rows will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                autoFocus
                onClick={() => setConfirmingBulkDelete(false)}
                disabled={bulkBusy}
                className={buttonClasses()}
                data-testid="bulk-delete-cancel"
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                disabled={bulkBusy}
                className={buttonClasses({ variant: 'danger', className: 'disabled:opacity-40' })}
                data-testid="bulk-delete-confirm"
              >
                {bulkBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {onFiltersChange && !baseFilters.length && <SavedViewsBar table={table} filters={filters} onApply={onFiltersChange} />}
      {onFiltersChange && !baseFilters.length && <RecentStrip table={table} meta={meta.data} withRetired={withRetired} onApply={onFiltersChange} />}
      {/* #1017: filters, Add filter and the list's layouts share a line, so the rows start high up. */}
      <div className="mb-2 flex flex-wrap items-end gap-2">
        {onFiltersChange && meta.data && (
          <>
            <StandardFilters meta={meta.data} filters={filters} onChange={onFiltersChange} />
            <Button aria-expanded={addFilterOpen} onClick={() => setAddFilterOpen((open) => !open)} data-testid="filter-toggle">
              Add filter
              <ChevronDown aria-hidden data-chevron size={18} />
            </Button>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <ViewToggle label="List layout" value={compact ? 'compact' : 'table'} onChange={(v) => {
            setCompact(v === 'compact')
            persist({ compact: v === 'compact' })
          }} />
          <Button aria-pressed={treeOn} onClick={() => setTree(!treeOn)}
            className={treeOn ? 'border-action bg-action-tint text-action' : undefined}>Tree of all</Button>
        </div>
      </div>
      {onFiltersChange && meta.data && (addFilterOpen || filters.length > 0) && (
        <FilterBar meta={meta.data} filters={filters} onChange={onFiltersChange} builderOpen={addFilterOpen} />
      )}
      {selected.size > 0 && !isRowsReadOnly(meta.data) && (
        <div
          className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-action/30 bg-action-tint px-3 py-2 text-sm"
          data-testid="bulk-bar"
        >
          <span className="font-medium text-ink" data-testid="bulk-count">
            {fmtCount(selected.size)} selected
          </span>
          {canBulkDelete && <button
            ref={bulkDeleteButton}
            onClick={() => setConfirmingBulkDelete(true)}
            disabled={bulkBusy}
            className={buttonClasses({ variant: 'danger' })}
            data-testid="bulk-delete"
          >
            Delete rows
          </button>}
          <button onClick={() => setSelected(new Set())} disabled={bulkBusy} className={buttonClasses()}>Clear selection</button>
          {canBulkEdit && <span className="flex flex-wrap items-center gap-2">
            <select
              value={bulkField}
              onChange={(e) => setBulkField(e.target.value)}
              className={inputClasses('w-40')}
              aria-label="Field to edit"
              data-testid="bulk-edit-field"
            >
              <option value="">Edit field…</option>
              {editableColumns.map((f) => (
                <option key={f.column_name} value={f.column_name}>
                  {f.label ?? f.column_name}
                </option>
              ))}
            </select>
            {bulkField && (
              <>
                <input
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder="New value"
                  className={inputClasses('w-40')}
                  aria-label="New value"
                  data-testid="bulk-edit-value"
                />
                <button
                  onClick={bulkEdit}
                  disabled={bulkBusy}
                  className={buttonClasses({ variant: 'primary' })}
                  data-testid="bulk-edit-apply"
                >
                  Apply
                </button>
              </>
            )}
          </span>}
          {canPurge && <button
            onClick={() => setPurging(true)}
            disabled={bulkBusy}
            className={buttonClasses({ className: 'border-negative text-negative hover:bg-negative-tint' })}
            data-testid="bulk-purge"
          >
            Delete permanently
          </button>}
          {bulkError && (
            <span className="text-xs text-negative" data-testid="bulk-error">
              {bulkError}
            </span>
          )}
        </div>
      )}
      {treeOn ? (
        <div className={cardClasses('p-3')}>
          <TreeOfAll table={table} filters={queryFilters} expanded={treeExpanded}
            onExpandedChange={(next) => setTree(true, [...next])}
            onOpen={(pane) => openPane?.(pane)} />
        </div>
      ) : narrow ? (
        <PhoneList
          table={table}
          titleColumn={meta.data?.title_column}
          rows={rows}
          columns={columns}
          settings={settings}
          selectable={!isRowsReadOnly(meta.data)}
          selected={selected}
          onToggleRow={toggleRow}
          onSelectPage={(all) => setSelected(all ? new Set(rows.map((r) => String(r.row_id))) : new Set())}
          sort={sort}
          onSort={(next) => {
            setStart(0)
            setSort(next)
            persist({ sort: next })
          }}
          childFields={expandable ? childFields : null}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          empty={
            <div
              className={cardClasses(`px-3 py-8 text-center text-control ${list.isError ? 'text-negative' : 'text-ink-subtle'}`)}
              data-testid={list.isError ? 'list-rows-error' : undefined}
            >
              {noRows}
            </div>
          }
        />
      ) : (
      <div className="relative">
      <div className={cardClasses('overflow-x-auto')} ref={setTableScroll} data-testid="list-table-scroll">
        {/* Separate borders: a collapsed one stays behind when its sticky cell scrolls. */}
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-subtle text-left">
            <tr>
              {/* Selection exists only to feed the bulk bar — a read-only
                  source has neither (EDS-13: absent, not disabled). */}
              {expandable && <th className="w-7 border-b border-border" />}
              {!isRowsReadOnly(meta.data) && (
                <th className="w-8 border-b border-border px-3 py-2">
                  <label className="cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      data-testid="select-all"
                      checked={rows.length > 0 && rows.every((r) => selected.has(String(r.row_id)))}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? new Set(rows.map((r) => String(r.row_id))) : new Set(),
                        )
                      }
                    />
                  </label>
                </th>
              )}
              {columns.map((col, i) => (
                <th key={col.column_name} className={`border-b border-border ${i === 0 ? 'sticky left-0 z-[1] border-r bg-subtle' : ''}`}>
                  <button
                    className={`flex w-full px-3 py-2 font-medium text-ink-muted hover:text-ink ${isFigure(col) ? 'justify-end text-right' : 'text-left'}`}
                    data-testid={`col-${col.column_name}`}
                    onClick={() => toggleSort(col.column_name)}
                  >
                    {/* The sort arrow sits outside the clip, so it always shows. */}
                    <OneLine className={i === 0 ? NAME_CLIP : 'max-w-80'}>{col.label}</OneLine>
                    {sort?.field === col.column_name && <span className="shrink-0 whitespace-pre">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                  </button>
                </th>
              ))}
              {/* Takes the spare width, so columns stay as wide as their content. */}
              <td aria-hidden className="w-full border-b border-border p-0" />
            </tr>
          </thead>
          <tbody data-testid="list-rows">
            {rows.map((row) => (
              <ListRow
                key={String(row.row_id)}
                row={row}
                table={table}
                columns={columns}
                settings={settings}
                title={meta.data ? rowDisplayTitle(meta.data, row, String(row.row_id)) : String(row.row_id)}
                selected={selected.has(String(row.row_id))}
                onToggleSelect={() => toggleRow(String(row.row_id))}
                selectable={!isRowsReadOnly(meta.data)}
                expandable={expandable}
                childFields={childFields}
                expanded={expanded.has(String(row.row_id))}
                onToggleExpand={() => toggleExpand(String(row.row_id))}
                inPane={paneRow === String(row.row_id)}
                onOpenPane={openPane}
              />
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={
                    columns.length + 1 +
                    (expandable ? 1 : 0) +
                    (isRowsReadOnly(meta.data) ? 0 : 1)
                  }
                  className={`px-3 py-8 text-center ${list.isError ? 'text-negative' : 'text-ink-subtle'}`}
                  data-testid={list.isError ? 'list-rows-error' : undefined}
                >
                  {noRows}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {moreToTheRight && <MoreColumnsHint box={tableScroll} />}
      </div>
      )}
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button
          disabled={start === 0}
          onClick={() => setStart((s) => Math.max(0, s - PAGE))}
          data-testid="prev-page"
          className={buttonClasses({ className: 'disabled:opacity-40' })}
        >
          Prev
        </button>
        <span className="text-xs text-ink-muted" data-testid="page-info">
          {pageRange(start, PAGE, total)}
        </span>
        <button
          disabled={start + PAGE >= total}
          onClick={() => setStart((s) => s + PAGE)}
          data-testid="next-page"
          className={buttonClasses({ className: 'disabled:opacity-40' })}
        >
          Next
        </button>
      </div>
    </div>
  )
}
