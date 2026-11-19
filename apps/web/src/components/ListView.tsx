import { useFitToWindow } from '../lib/fit-to-window'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { rowDisplayTitle, type ListLayout } from 'shared'
import { ApiError, api, getToken, listResource } from '../lib/api'
import { useNavigation } from '../lib/navigation'
import { TreeOfAll } from './RelationTree'
import { rowCapabilitiesQuery } from '../lib/row-capabilities'
import { NO_COLUMN_TYPES, isArchived, isRowsReadOnly, isSystemWritten, isView, tableLabel, useMeta } from '../lib/meta'
import { SaveAsView, ViewBanner } from './TableViews'
import { dataColumns, isShown, listFields, listLeader, switchColumn, viewColumns, type ColumnArrangement } from '../lib/list-view-columns'
import { describeView, listDefaultsWith, tableViewDefaultQuery, viewAsDefault } from '../lib/table-view-default'
import { TableDefaultDialog } from './TableDefaultDialog'
import { layoutSavesSettled } from '../lib/list-layout'
import { userSettingsQuery } from './FormArrangement'
import { useRealtime } from '../lib/realtime'
import { formatValue, useSettings } from '../lib/settings'
import { useCapabilities, useIsSystemManager } from '../lib/session'
import { ChecklistSwitch } from './ChecklistView'
import { MoreColumnsHint, OneLine, useMoreToTheRight } from './list-one-line'
import { Button, EmptyState, NARROW_QUERY, Notice, PageHeader, ProblemPage, Select, buttonClasses, cardClasses, inputClasses, pillClasses, touchRowClasses, useMediaQuery } from '@featherbase/shop-floor'
import { ChevronDown } from '@featherbase/shop-floor'
import { Columns3, ListTree, Rows4 } from 'lucide-react'
import { tableCanRetire } from './RowRetirement'
import { PurgeDialog, tableCanPurge } from './PurgeDialog'
import { GlossaryHelp } from './GlossaryHelp'
import { fmtCount, fmtINR } from '@featherbase/shop-floor'
import { failureMessage } from '../lib/import-run'
import { ImportConflicts } from './ImportConflicts'
import { ActionDisclosure } from './ActionDisclosure'
import { RenameTable } from './RenameTable'
import { ArchiveTable, ArchivedBanner, canArchive } from './ArchiveTable'
import { rememberListPlace } from './RecordNav'
import { FilterBar, FilterChips, ListSearch, StandardFilters, hasFieldBoxes, heldByBoxes, type Filter } from './ListFilters'
import { SavedViewsBar } from './SavedViewsBar'
import { LayoutSwitch } from './LayoutSwitch'
import { RecordCards } from './RecordCards'
import { RecentStrip } from './RecentStrip'
import { LinkCellFilter, ListRow, NAME_CLIP, PhoneList, cell, isFigure } from './ListRows'
import { usePageTitle } from '../lib/page-title'

const PAGE = 20
/** #1289: a square icon toggle, tinted while on. */
const iconToggle = (on: boolean) => `w-control justify-center px-0 ${on ? 'border-action bg-action-tint text-action' : ''}`

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
/** "New <thing>": the Table's label in sentence case, its acronyms kept ("New job assignment", "New SAP code"). */
export function thingWords(label: string): string {
  return label.split(/\s+/).map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase())).join(' ')
}

export function ListView({
  table,
  filters,
  onFiltersChange,
  breadcrumb,
  title,
  defaultOrderBy,
  empty,
  subtitle,
  count,
  actions,
  baseFilters,
  onRowOpen,
  openRow,
  extraColumns,
  layout,
  onLayoutChange,
  onApplyView,
  recordPanel,
}: {
  table: string
  filters: Filter[]
  onFiltersChange?: (filters: Filter[]) => void
  breadcrumb?: ReactNode
  /** The page's heading in place of the Table's name. */
  title?: ReactNode
  /** The order before the person picks one, in place of the Table's. */
  defaultOrderBy?: string
  /** What an empty list says, in place of "No rows". */
  empty?: ReactNode
  /** One line under the heading saying what the page lists. */
  subtitle?: ReactNode
  /** #1271: what the count beside the title says, in place of "N total". */
  count?: ReactNode
  /** #1271: the page's own actions, first in the toolbar, with More beside them. */
  actions?: ReactNode
  /** #1173: filters the page always applies, not shown as chips nor saved in the address. */
  baseFilters?: Filter[]
  /** #1173: a click on a line opens the row in the page's own panel, in place of the drill pane. */
  onRowOpen?: (row: string) => void
  /** The row that panel shows, marked in the list. */
  openRow?: string
  /** #1173: columns this page shows on top of the person's own choice. */
  extraColumns?: string[]
  /** #1259: the view this list shows (Table opens a row on its own page). */
  layout?: ListLayout
  /** #1259: the switch beside the title, where the page offers one. */
  onLayoutChange?: (layout: ListLayout) => void
  /** #1259: a saved view's filters and the view it was saved in. */
  onApplyView?: (filters: Filter[], layout?: ListLayout) => void
  /** #1259: the open record, placed by the view: beside the cards (List And
   *  Record) or over the table's right side (Table With Panel). */
  recordPanel?: ReactNode
}) {
  const meta = useMeta(table)
  // #1237, #1242: the Table as people read it.
  const label = tableLabel(table, meta.data)
  usePageTitle(title ? undefined : label)
  const settings = useSettings()
  // #910: on a list page, selecting a row shows it in the drill pane.
  const navigation = useNavigation()
  const nav = navigation?.step.screen === 'list' && navigation.step.table === table ? navigation : null
  const paneRow = onRowOpen ? openRow : nav?.step.pane?.table === table ? nav.step.pane.row : undefined
  // #1259: in the Table view a row opens on its own page, so a line opens no panel.
  // Tree of all has no row pages to go to, so its lines open the record beside it in every view.
  const openInPanel = onRowOpen ? (pane: { table: string; row: string }) => onRowOpen(pane.row)
    : nav ? (pane: { table: string; row: string }) => nav.push({ ...nav.step, pane }) : undefined
  const openPane = layout === 'table' ? undefined : openInPanel
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
  const canAddRows = Boolean(caps?.manage || caps?.creatable.includes(table))
  // #910: a list narrowed to the rows linking to one row (a drill pane group
  // opened as a list) starts its new rows linked to that row too.
  const newRowPrefill = meta.data ? linkPrefill(meta.data, filters) : undefined
  const queryClient = useQueryClient()
  // usable-on-any-device "Lists fit a phone": below 40rem the rows are cards.
  const narrow = useMediaQuery(NARROW_QUERY)
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const [start, setStart] = useState(0)
  // UI-013 / #738: per-user saved settings — sort, and which columns show,
  // kept as columns switched on and off on top of the Table's list columns.
  const [arrangement, setArrangement] = useState<Required<ColumnArrangement>>({ shownCols: [], hiddenCols: [] })
  // #910 checklist 1: Compact shows each row's name and two key values.
  // #1282 A4: compact rows as this person chose, if they did; otherwise the Table's default decides.
  const [ownCompact, setOwnCompact] = useState<boolean | undefined>(undefined)
  const viewDefault = useQuery(tableViewDefaultQuery(table))
  const td = viewDefault.data?.settings ?? {}
  // The person's raw settings, as the Links tab keeps them (read here before any early return: a hook).
  const ownSettings = useQuery(userSettingsQuery(table))
  const compact = ownCompact ?? td.compact ?? false
  const [confirmingDefault, setConfirmingDefault] = useState(false)
  // Bumped by Reset, so this person's settings load again from what the server now holds.
  const [settingsEpoch, setSettingsEpoch] = useState(0)
  // #1289: Save View… in the View menu opens the saved views' name form.
  const [namingView, setNamingView] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [tableScroll, setTableScroll] = useState<HTMLDivElement | null>(null)
  const moreToTheRight = useMoreToTheRight(tableScroll)
  // #1249: the table fits the window, so its scroll bar and the pager stay in view.
  useFitToWindow(tableScroll)
  // #1017: the Add filter row waits until it's asked for.
  const [addFilterOpen, setAddFilterOpen] = useState(false)
  // #1276 (B2): a link cell's Filter narrows the list to rows linked to that same
  // row, in place of any exact filter on that column.
  const cellFilter = onFiltersChange
    ? (exact: Filter[]) =>
        onFiltersChange([...filters.filter((f) => !(f[1] === '=' && exact.some((e) => e[0] === f[0]))), ...exact])
    : null
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
  // #1282 A4: remembered per person per Table with their list settings; while on, its toggle is tinted.
  const [showRetired, setShowRetired] = useState(false)
  const retirable = tableCanRetire(meta.data)
  // #859: a System Manager may delete the selection permanently.
  const [purging, setPurging] = useState(false)
  const canPurge = isSystemManager && tableCanPurge(meta.data)
  const withRetired = retirable && showRetired
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsUnsaved, setSettingsUnsaved] = useState(false)
  const settingsWrite = useRef(Promise.resolve())
  // #1282 A4: what the person changed before their saved settings arrived; the load leaves those alone.
  const touched = useRef(new Set<string>())
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
  const filterKey = JSON.stringify([baseFilters ?? [], filters])
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
      setDeleteError(e instanceof ApiError ? e.message : 'Delete failed')
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
    // A Table's own settings, never the last Table's.
    touched.current = new Set()
    setSort(null)
    setOwnCompact(undefined)
    setArrangement({ shownCols: [], hiddenCols: [] })
    setShowRetired(false)
    api
      .get<{ settings: { sort?: typeof sort; hiddenCols?: string[]; shownCols?: string[]; compact?: boolean; showRetired?: boolean } | null }>(
        `/api/user_settings/${encodeURIComponent(table)}`,
      )
      .then((res) => {
        if (cancelled) return
        const s = res.settings
        if (s) {
          const fresh = (key: string) => !touched.current.has(key)
          if (s.sort && fresh('sort')) setSort(s.sort)
          if (typeof s.compact === 'boolean' && fresh('compact')) setOwnCompact(s.compact)
          if (fresh('showRetired')) setShowRetired(s.showRetired === true)
          if (fresh('arrangement')) setArrangement({
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
    // Only re-run when the Table changes, or Reset cleared what was saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, settingsEpoch])

  // Persist settings whenever the user changes them (after the initial load).
  // A save that fails is said, not swallowed (#546): the change still shows
  // now, but the list would open the old way next time.
  function persist(next: { sort?: typeof sort; arrangement?: Required<ColumnArrangement>; compact?: boolean; showRetired?: boolean }) {
    for (const key of Object.keys(next)) touched.current.add(key)
    const token = getToken()
    // #1282 A4: only what the person changed is saved (the server merges it), so a choice they never made keeps
    // following the Table's default. Writes keep interaction order, so a slower earlier one never lands last.
    const { arrangement: cols, ...rest } = next
    const snapshot = { ...rest, ...(cols ?? {}) }
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

  // #1282 A4: the Table's list columns with its default's columns switched on and off, then this person's own.
  const listDefaults = meta.data ? listDefaultsWith(meta.data, td) : new Set<string>()
  const allColumns = meta.data
    ? viewColumns(meta.data, extraColumns?.length ? { ...arrangement, shownCols: [...arrangement.shownCols, ...extraColumns] } : arrangement, listDefaults)
    : []
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
  const leadingTitle = meta.data ? listLeader(meta.data) : undefined
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
  // #1282 A4: the person's sort, else the Table's default's, else the Table's own order.
  // A default sorted by a column this person may not read gives way to the Table's own order (Codex adversarial
  // round 2): the server refuses a sort on a column the viewer can't read, which would fail the whole list.
  const readableSort = (field: string) => ['row_id', 'created_at', 'updated_at'].includes(field)
    || (meta.data ? dataColumns(meta.data).some((c) => c.column_name === field) : false)
  const shownSort = sort ?? (td.sort && readableSort(td.sort.field) ? td.sort : null)
  const orderBy = shownSort
    ? `${shownSort.field} ${shownSort.dir}`
    : defaultOrderBy ?? (meta.data
      ? `${metaSortColumn || (boundNoRevision ? 'row_id' : 'updated_at')} ${meta.data.sort_order || 'desc'}`
      : undefined)

  // #1276: the column a list totals, as Explore's panes did: money first, then other measures.
  const sumColumn = ['Currency', 'Float', 'Int'].map((t) => columns.find((c) => c.column_type === t)).find(Boolean)
  const list = useQuery({
    queryKey: ['list', table, columns.map((c) => c.column_name), orderBy, start, filterKey, withRetired],
    // #1282 A4: the rows wait for this person's settings and the Table's default, so they load once, in the
    // order and columns the person will see.
    enabled: Boolean(meta.data) && settingsLoaded && !viewDefault.isPending,
    placeholderData: keepPreviousData,
    queryFn: () =>
      listResource(table, {
        filters: [...(baseFilters ?? []), ...filters],
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
      filters, orderBy, withRetired, start,
      ids: list.data.data.map((r) => String(r.row_id)),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, list.isError, table])

  // Codex review, round 8: rows deleted from the last page leave the offset past
  // the end; the list goes back to its last page rather than show none. (Above
  // the early returns: a hook runs on every render.)
  const knownTotal = list.data?.total
  useEffect(() => {
    if (knownTotal !== undefined && knownTotal > 0 && start >= knownTotal) setStart(Math.floor((knownTotal - 1) / PAGE) * PAGE)
  }, [knownTotal, start])

  const rows = list.isError ? [] : list.data?.data ?? []

  // #1259: with a record open beside or over the list, the arrow keys move to
  // the next or previous row and the record follows (one step, not one per
  // row); closing it puts the focus back on the same row.
  const panelled = !treeOn && (layout === 'split' || layout === 'panel')
  useEffect(() => {
    if (!panelled || !paneRow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="listbox"],[role="menu"],[role="dialog"]')) return
      const at = rows.findIndex((r) => String(r.row_id) === paneRow)
      const next = at < 0 ? undefined : rows[at + (e.key === 'ArrowDown' ? 1 : -1)]
      if (!next) return
      e.preventDefault()
      // Only a page with the view switch has these views, and it walks the path (nav).
      nav?.replace({ ...nav.step, pane: { table, row: String(next.row_id) } })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelled, paneRow, rows, nav, table])
  const lastPane = useRef<string | undefined>(undefined)
  useEffect(() => {
    const was = lastPane.current
    lastPane.current = paneRow
    if (!panelled || paneRow || !was) return
    const line = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(was)}"]`)
    ;(line?.querySelector<HTMLElement>('button[aria-current], button') && layout === 'split'
      ? line.querySelector<HTMLElement>('button')
      : line)?.focus({ preventScroll: true })
  }, [panelled, paneRow, layout])
  // #1259 (one-app-chrome): the panel over the table starts under its column
  // names, so they stay in sight.
  const [headRow, setHeadRow] = useState(0)
  const panelShown = Boolean(recordPanel) && layout !== 'split'
  useLayoutEffect(() => {
    if (!panelShown) return
    setHeadRow(tableScroll?.querySelector('thead')?.getBoundingClientRect().height ?? 0)
  }, [panelShown, tableScroll, rows.length])

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
      // #1327: a dropped request is the shared Couldn't open page, with Try again.
      <ProblemPage
        kind="failed"
        title={`The rows of ${label} couldn’t be loaded`}
        body="The server didn’t answer. Try again in a moment."
        action={<Button onClick={() => void list.refetch()}>Try again</Button>}
      />
    )
  ) : list.isPending ? (
    // Not yet loaded is not empty: "No rows" would alarm someone whose
    // Table holds data (#871, a list reopened after its rename).
    'Loading…'
  ) : empty ?? (
    // #1242 (admin-lists 9): an empty Table shows the way forward (TLC-J1.2):
    // New, and Import data for those who may import.
    <EmptyState
      title="No rows"
      body={canAddRows && !isRowsReadOnly(meta.data) ? `Add the first ${thingWords(label)}, or bring them in from a file.` : undefined}
      action={canAddRows && !isRowsReadOnly(meta.data) && meta.data?.kind !== 'settings' && meta.data?.kind !== 'sub_table' ? (
        <span className="flex flex-wrap justify-center gap-2">
          <Link
            to="/featherbase/admin/table/$table/new"
            params={{ table }}
            search={{ prefill: newRowPrefill ? JSON.stringify(newRowPrefill) : undefined }}
            className={buttonClasses({ variant: 'primary' })}
            data-testid="list-empty-new"
          >
            New {thingWords(label)}
          </Link>
          {caps?.manage && (
            <Link to="/featherbase/admin/import" search={{ table }} className={buttonClasses()} data-testid="list-empty-import">
              Import data
            </Link>
          )}
        </span>
      ) : undefined}
    />
  )

  function toggleSort(field: string) {
    setStart(0)
    const next: { field: string; dir: 'asc' | 'desc' } =
      shownSort?.field === field
        ? { field, dir: shownSort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    setSort(next)
    persist({ sort: next })
  }

  // #1282 A4 (UI owner): the view a person sees, compared with the Table's default, for Reset, and saved as the
  // default by "Make This the Table's Default…" (which replaced the Columns menu's "default for everyone").
  const builtInLayout: ListLayout = meta.data?.queue ? 'split' : 'panel'
  const ownLinks = (ownSettings.data?.settings?.links ?? {}) as { as?: 'sections' | 'tree'; fields?: boolean }
  const shownLinks = { as: ownLinks.as ?? td.links?.as ?? 'sections', fields: ownLinks.fields ?? td.links?.fields ?? true }
  const visible = (defaults: Set<string>, arr: ColumnArrangement) =>
    (meta.data ? dataColumns(meta.data) : []).map((c) => c.column_name).filter((c) => isShown(c, defaults, arr)).join('\u0000')
  const viewDiffers = Boolean(meta.data) && (
    (!narrow && Boolean(layout) && layout !== (td.layout ?? builtInLayout))
    || visible(listDefaults, arrangement) !== visible(listDefaults, {})
    || JSON.stringify(shownSort) !== JSON.stringify(td.sort ?? null)
    || compact !== (td.compact ?? false)
    || shownLinks.as !== (td.links?.as ?? 'sections') || shownLinks.fields !== (td.links?.fields ?? true)
    || showRetired)
  const asDefault = () => viewAsDefault(meta.data!, arrangement, td, { layout: layout ?? builtInLayout, sort: shownSort, compact, links: shownLinks })
  async function resetView() {
    // After every save already on its way, so none of them lands after the reset and brings a choice back
    // (Codex adversarial round 2): this list's own saves, and the layout's.
    const token = getToken()
    const done = settingsWrite.current
      .then(() => layoutSavesSettled(table))
      .then(() => (getToken() === token ? api.post(`/api/user_settings/${encodeURIComponent(table)}/reset`, {}) : undefined))
      .catch(() => setSettingsUnsaved(true))
    settingsWrite.current = done.then(() => undefined)
    await done
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['list-layout', table] }),
      queryClient.invalidateQueries({ queryKey: ['user-settings', table] }),
    ])
    setSettingsEpoch((n) => n + 1)
  }

  // UI-013 / #738: switch a column on or off in this person's view (saved
  // per user). Its checkboxes are the columns of meta.data, so it is there.
  function toggleColumn(columnName: string, on: boolean) {
    const next = switchColumn(meta.data!, arrangement, columnName, on, listDefaults)
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

  // #1242: what the header's ⋯ More holds, under the same conditions the two
  // menus it replaces had.
  const hasListActions = table === 'Person' || Boolean(!isRowsReadOnly(meta.data) && caps?.manage)
    || Boolean(meta.data?.kind === 'table' && !meta.data.data_source && !isSystemWritten(meta.data))
  const hasTableAdministration = Boolean(canShapeColumns || caps?.manage || isSystemManager)
  return (
    <div data-testid="list-view">
      {/* #1288: the shared page header. The page's own actions first, then the one primary (New), then More. */}
      <PageHeader
        className="mb-2"
        breadcrumb={breadcrumb ?? <div className="text-xs text-ink-subtle" data-testid="list-breadcrumb">
            <Link to="/featherbase/admin" className="hover:text-ink">
              {meta.data?.module || 'Home'}
            </Link>
            {' / '}
            {label}
          </div>}
        title={title ?? <>{label}<GlossaryHelp table={table} className="ml-1" /></>}
        count={<>
          {/* #1259: the three views, right after the title. */}
          {layout && onLayoutChange && <span className="self-center"><LayoutSwitch value={layout} onChange={onLayoutChange} /></span>}
          <span className="text-xs text-ink-muted" data-testid="list-total">
            {count ?? <>{fmtCount(total)} total</>}
          </span>
          {/* #1276: Explore's totals live on the list: the exact sum of its money
              (or other measure) column over every row the filters keep. */}
          {sumColumn && !withRetired && (
            <ListSum table={table} filters={[...(baseFilters ?? []), ...filters]} column={sumColumn} refreshedAt={list.dataUpdatedAt} />
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
        </>}
        status={subtitle}
        actions={<div className="flex flex-wrap items-center justify-end gap-2" data-testid="list-toolbar">
          {actions}
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
              New {thingWords(label)}
            </Link>
          )}
          {/* #1242 (admin-lists 2): one ⋯ More for what is not the page's own action. */}
          {(hasListActions || hasTableAdministration) && <ActionDisclosure label="More">
          {hasListActions && <div role="group" aria-label="List actions" className="flex flex-col items-stretch gap-1">
          <p className="px-1 pt-1 text-xs font-medium text-ink-muted">List actions</p>
            {table === 'Person' && <Link to="/featherbase/admin/find-person" className={buttonClasses()} data-testid="open-find-person">Find by code</Link>}
            {!isRowsReadOnly(meta.data) && caps?.manage && <Link to="/featherbase/admin/import" search={{ table }} className={buttonClasses()} data-testid="open-import">Import</Link>}
            {meta.data?.kind === 'table' && !meta.data.data_source && !isSystemWritten(meta.data) && <Button aria-expanded={conflictsOpen} aria-controls="import-conflicts" onClick={() => setConflictsOpen((open) => !open)}>Import conflicts</Button>}
          </div>}
          {hasTableAdministration && <div role="group" aria-label="Table administration" className="flex flex-col items-stretch gap-1 border-t border-border pt-1 first:border-t-0 first:pt-0">
          <p className="px-1 pt-1 text-xs font-medium text-ink-muted">Table administration</p>
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
          </div>}
          </ActionDisclosure>}
        </div>}
      />
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
      {onFiltersChange && <SavedViewsBar table={table} filters={filters} layout={layout} onApply={onApplyView ?? onFiltersChange} naming={namingView} onNamingChange={setNamingView} />}
      {onFiltersChange && <RecentStrip table={table} meta={meta.data} withRetired={withRetired} onApply={onFiltersChange} />}
      {/* #1017: filters, Add filter and the list's layouts share a line, so the rows start high up. */}
      {/* #1289: the filters (and their chips) wrap inside the left part, so the view tools keep the first line. */}
      <div className="mb-2 flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
        {onFiltersChange && meta.data && (
          <>
            <ListSearch meta={meta.data} filters={filters} onChange={onFiltersChange} label={label} />
            <StandardFilters meta={meta.data} filters={filters} onChange={onFiltersChange} />
            <Button aria-expanded={addFilterOpen} onClick={() => setAddFilterOpen((open) => !open)} data-testid="filter-toggle">
              Add filter
              <ChevronDown aria-hidden data-chevron size={18} />
            </Button>
            {/* #1289: the active filters as big chips, in this same row. */}
            <FilterChips meta={meta.data} filters={filters} onChange={onFiltersChange} held={heldByBoxes(meta.data, filters)} />
          </>
        )}
        </div>
        {/* Level with the boxes' controls, below their labels (a text-xs line and gap-0.5). */}
        <div className={`ml-auto flex flex-none items-end gap-2 ${onFiltersChange && meta.data && hasFieldBoxes(meta.data) ? 'mt-[1.125rem]' : ''}`} data-testid="list-view-tools">
          {/* #859, #1242, #1289: Show Retired leads the right end of the filter row. */}
          {retirable && (
            // A real checkbox, drawn as a chip: what it is stays plain to everyone.
            <label className={pillClasses(`min-h-control cursor-pointer gap-1.5 border px-3 text-sm has-focus-visible:outline-2 has-focus-visible:outline-focus ${showRetired ? 'border-action bg-action-tint text-action' : 'border-border-control bg-surface text-ink-muted hover:bg-subtle'}`)}>
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => {
                  setShowRetired(e.target.checked)
                  persist({ showRetired: e.target.checked })
                  setStart(0)
                }}
                data-testid="list-show-retired-toggle"
                className="size-3.5 accent-action"
              />
              Show Retired
            </label>
          )}
          {/* #1242 (admin-lists 2-3): the other ways to see this Table. */}
          <ActionDisclosure label="View" open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
          {onFiltersChange && filters.length > 0 && (
            <button
              type="button"
              className={buttonClasses()}
              data-testid="save-view-open"
              onClick={() => {
                setViewMenuOpen(false)
                setNamingView(true)
              }}
            >
              Save View…
            </button>
          )}
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
          {/* #1282 A4 (UI owner): the Table's managers make their whole view the Table's default; anyone whose view
              differs from it goes back to it. */}
          {canShapeColumns && meta.data && (
            <button type="button" className={buttonClasses()} data-testid="make-table-default"
              onClick={() => { setViewMenuOpen(false); setConfirmingDefault(true) }}>
              Make This the Table's Default…
            </button>
          )}
          {viewDiffers && (
            <button type="button" className={buttonClasses()} data-testid="reset-table-default"
              onClick={() => { setViewMenuOpen(false); void resetView() }}>
              Reset to the Table's Default
            </button>
          )}
          </ActionDisclosure>
          {confirmingDefault && meta.data && (
            <TableDefaultDialog table={table} view={asDefault()} words={describeView(meta.data, asDefault())} onClose={() => setConfirmingDefault(false)} />
          )}
          <div className="relative">
            {/* #1289: the view controls are icons, each named in full for a tooltip and a screen reader. */}
            <button
              onClick={() => setColPickerOpen((o) => !o)}
              className={buttonClasses({ className: 'gap-0.5 px-2' })}
              aria-expanded={colPickerOpen}
              aria-label="Show Columns"
              title="Show Columns"
              data-testid="list-columns"
            >
              <Columns3 aria-hidden size={18} />
              <ChevronDown aria-hidden data-chevron size={16} />
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
              </div>
            )}
          </div>
          {/* #1259: density is one on/off button, so "Table" names only the view. */}
          <Button aria-pressed={compact} aria-label="Compact Rows" title="Compact Rows" data-testid="compact-rows" onClick={() => {
            setOwnCompact(!compact)
            persist({ compact: !compact })
          }} className={iconToggle(compact)}><Rows4 aria-hidden size={18} /></Button>
          <Button aria-pressed={treeOn} aria-label="Tree of All" title="Tree of All" data-testid="tree-of-all" onClick={() => setTree(!treeOn)}
            className={iconToggle(treeOn)}><ListTree aria-hidden size={18} /></Button>
        </div>
      </div>
      {onFiltersChange && meta.data && addFilterOpen && (
        <FilterBar meta={meta.data} filters={filters} onChange={onFiltersChange} onLinkedAdded={() => setAddFilterOpen(false)} chips={false} />
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
        <div className="flex min-h-0 items-start gap-3" data-testid="list-tree">
          <div className={cardClasses('min-w-0 flex-1 p-3')}>
            <TreeOfAll table={table} filters={[...(baseFilters ?? []), ...filters]} expanded={treeExpanded}
              onExpandedChange={(next) => setTree(true, [...next])}
              onOpen={(pane) => openInPanel?.(pane)} />
          </div>
          {recordPanel && <div className="w-[min(430px,45%)] shrink-0">{recordPanel}</div>}
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
          sort={shownSort}
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
      ) : layout === 'split' ? (
        // #1259: List And Record: the cards on the left, the open record beside them.
        <div className="flex min-h-0 items-stretch gap-3" data-testid="list-split">
          <div className="flex w-[330px] shrink-0 flex-col rounded-xl bg-surface p-1.5 shadow-sm" ref={setTableScroll}>
            {rows.length ? (
              <RecordCards table={table} titleColumn={meta.data?.title_column} rows={rows} columns={columns} settings={settings}
                open={paneRow} onOpen={(row) => openPane?.({ table, row })} />
            ) : <p className="px-3 py-6 text-center text-sm text-ink-subtle">{noRows}</p>}
          </div>
          <div className="min-w-0 flex-1">
            {recordPanel ?? (
              <div className="grid h-full min-h-24 place-items-center rounded-xl bg-canvas/40 text-sm text-ink-subtle" data-testid="record-panel-empty">
                Choose a card to read it here.
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="relative">
      {/* #1259: Table With Panel: the record slides over the table's right side, under its header. */}
      {/* A record the address opens shows here in the Table view too (a pasted link). */}
      {(layout === 'panel' || layout === 'table') && recordPanel && (
        <div className="absolute bottom-0 right-0 z-[3] w-[min(430px,100%)]" style={{ top: headRow }} data-testid="record-panel-over">{recordPanel}</div>
      )}
      <div className={cardClasses('featherbase-scroll overflow-auto')} ref={setTableScroll} data-testid="list-table-scroll">
        {/* Separate borders: a collapsed one stays behind when its sticky cell scrolls. */}
        <LinkCellFilter.Provider value={cellFilter}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          {/* #1249: the header row stays in view while the rows scroll under it. */}
          <thead className="sticky top-0 z-[2] bg-subtle text-left">
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
                <th key={col.column_name} className={`border-b border-border bg-subtle ${i === 0 ? 'sticky left-0 z-[3] border-r' : ''}`}>
                  <button
                    className={`flex w-full px-3 py-2 font-medium text-ink-muted hover:text-ink ${isFigure(col) ? 'justify-end text-right' : 'text-left'}`}
                    data-testid={`col-${col.column_name}`}
                    onClick={() => toggleSort(col.column_name)}
                  >
                    {/* The sort arrow sits outside the clip, so it always shows. */}
                    <OneLine className={i === 0 ? NAME_CLIP : 'max-w-80'}>{col.label}</OneLine>
                    {shownSort?.field === col.column_name && <span className="shrink-0 whitespace-pre">{shownSort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
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
                titleOpensPane={Boolean(onRowOpen)}
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
        </LinkCellFilter.Provider>
      </div>
      {moreToTheRight && <MoreColumnsHint box={tableScroll} />}
      </div>
      )}
      {/* #1242 (admin-lists 6): "1–4 of 4" on the left; Prev and Next only when there is
          another page, or this one is not the first (Codex review, round 8). */}
      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className="text-xs text-ink-muted" data-testid="page-info">
          {pageRange(start, PAGE, total)}
        </span>
        {(total > PAGE || start > 0) && <>
        <button
          disabled={start === 0}
          onClick={() => setStart((s) => Math.max(0, s - PAGE))}
          data-testid="prev-page"
          className={buttonClasses({ className: 'disabled:opacity-40' })}
        >
          Prev
        </button>
        <button
          disabled={start + PAGE >= total}
          onClick={() => setStart((s) => s + PAGE)}
          data-testid="next-page"
          className={buttonClasses({ className: 'disabled:opacity-40' })}
        >
          Next
        </button>
        </>}
      </div>
    </div>
  )
}

/** #1276: the exact total of one column over a list's filters, from the server's
 *  scoped aggregate, never a sum of the page that happened to load. */
function ListSum({ table, filters, column, refreshedAt }: {
  table: string
  filters: Filter[]
  column: { column_name: string; label: string; column_type: string }
  /** When the list's rows last arrived: the sum follows every refresh of them. */
  refreshedAt: number
}) {
  const settings = useSettings()
  const filterKey = JSON.stringify(filters)
  const sum = useQuery({
    // Keyed to the list's last refresh, so an edit, a delete or realtime refreshes the sum
    // too, without anything that awaits the list's refresh also waiting for it.
    queryKey: ['list-sum', table, filterKey, column.column_name, refreshedAt],
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => api.get<{ count: number; sum: string | null }>(
      `/api/table/${encodeURIComponent(table)}:aggregate?filters=${encodeURIComponent(filterKey)}&sum=${encodeURIComponent(column.column_name)}`),
  })
  if (sum.data?.sum == null) return null
  return (
    <span className="text-xs text-ink-muted" data-testid="list-sum">
      {/* A total answers "how big is this?": Indian grouping, the readable ₹ ladder for money (ADR 750). */}
      Σ {column.label}: {column.column_type !== 'Currency' ? fmtCount(Number(sum.data.sum), column.column_type === 'Int' ? 0 : settings.float_precision)
        : settings.currency === 'INR' ? fmtINR(Number(sum.data.sum)) : formatValue('Currency', Number(sum.data.sum), settings)}
    </span>
  )
}
