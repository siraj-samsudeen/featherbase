import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { choiceLabel, parseFilters, rowDisplayTitle } from 'shared'
import { ApiError, api, getSessionUser, getToken, listResource } from '../lib/api'
import { describeFilters, recentActions, type RecentEntry } from '../lib/recents'
import { RowTitle } from '../lib/row-titles'
import { LinkedTitle, RowLink } from '../lib/row-name'
import { UNSEEN_ROW, useLinkTitle } from '../lib/relations'
import { useNavigation } from '../lib/navigation'
import { TreeOfAll } from './RelationTree'
import { rowCapabilitiesQuery } from '../lib/row-capabilities'
import { LinkControl } from './FormView'
import { NO_COLUMN_TYPES, isArchived, isRowsReadOnly, isSystemWritten, isView, useMeta } from '../lib/meta'
import { SaveAsView, ViewBanner } from './TableViews'
import { dataColumns, defaultColumnNames, isShown, listFields, listFlagsFromView, switchColumn, titleListColumn, viewColumns, type ColumnArrangement, type ListColumn } from '../lib/list-view-columns'
import { useI18n } from '../lib/i18n'
import { useRealtime } from '../lib/realtime'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { useCapabilities, useIsSystemManager } from '../lib/session'
import { useStepOptions, type Step } from '../lib/explore-steps'
import { ChecklistSwitch } from './ChecklistView'
import { PrincipalName, usePrincipalLabels } from '../lib/people'
import { NOT_A_LOGIN } from '../lib/not-a-login'
import { MoreColumnsHint, OneLine, useMoreToTheRight } from './list-one-line'
import { Button, DataCards, NARROW_QUERY, ViewToggle, Notice, Select, buttonClasses, cardClasses, inputClasses, pillClasses, touchLinkClasses, touchRowClasses, useMediaQuery, type DataColumn } from '@featherbase/shop-floor'
import { ArrowDown, ArrowUp, ChevronDown } from '@featherbase/shop-floor'
import { RetiredBadge, tableCanRetire } from './RowRetirement'
import { PurgeDialog, tableCanPurge } from './PurgeDialog'
import { GlossaryHelp } from './GlossaryHelp'
import { fmtCount } from '@featherbase/shop-floor'
import { failureMessage } from '../lib/import-run'
import { ImportConflicts } from './ImportConflicts'
import { ActionDisclosure } from './ActionDisclosure'
import { RenameTable } from './RenameTable'
import { ArchiveTable, ArchivedBanner, canArchive } from './ArchiveTable'
import { rememberListPlace } from './RecordNav'

export type Filter = [string, string, unknown]

// Deliberately WITHOUT 'related' (NAV-002): the FilterBar's free-text value
// input cannot author a relationship spec, so offering the operator here
// could only produce malformed filters. Related filters arrive via links
// (Connections, Explore) and render as chips like any other filter.
const OPS = ['=', '!=', 'like', '>', '<', '>=', '<='] as const

const PAGE = 20
// #738: a Show columns row is thumb-sized at phone width even under a mouse
// (a narrowed window still draws the phone layout), as on any touch screen.
const PHONE_ROW = 'max-sm:min-h-touch'

// SET-004: cells render through the global display settings (date format,
// currency/float precision). Non-typed columns fall back to a plain string.
// person-rename: a Reference to a person or a service account shows the
// name, never the opaque id.
function isPrincipalTable(table: string | null | undefined): boolean {
  return table === 'Person' || table === 'Service Account'
}

const DATE_TYPES = new Set(['Date', 'Datetime'])

function cell(value: unknown, columnType: string, settings: Settings): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return formatValue(columnType, value, settings) || '—'
}

// Status dots: a value that is a VERDICT takes its meaning colour (done is
// positive, overdue or failed is negative, "not set" is missing data). Every
// other status (open, urgent, pending, in progress, draft …) is a state, not a
// verdict, so it gets a stable identity colour from the series: the same
// value always has the same dot, and no dot reads as good or bad.
const VERDICT_POSITIVE = /\b(closed|resolved|done|complete|completed|approved|paid|success|succeeded|finished)\b/
const VERDICT_NEGATIVE = /\b(overdue|error|failed|rejected|blocked)\b/
const NO_VALUE = /\b(none|not set)\b/
const INDICATOR_PALETTE = [1, 2, 3, 4, 5].map((n) => `var(--color-series-${n})`)

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

export function indicatorColor(value: string): string {
  const v = value.toLowerCase()
  if (VERDICT_POSITIVE.test(v)) return 'var(--color-positive)'
  if (VERDICT_NEGATIVE.test(v)) return 'var(--color-negative)'
  if (NO_VALUE.test(v)) return 'var(--color-missing)'
  let h = 0
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return INDICATOR_PALETTE[h % INDICATOR_PALETTE.length]
}

export function Indicator({ value, label = value }: { value: string; label?: string }) {
  return (
    // Not inline-flex: a browser drops an atomic box whole when it runs out of
    // room, where plain text clips with an ellipsis (#1015).
    <span>
      <span
        aria-hidden="true"
        className="mr-1.5 inline-block size-2 rounded-full align-[0.05em]"
        style={{ backgroundColor: indicatorColor(value) }}
      />
      {label}
    </span>
  )
}

const NO_FILTERS: Filter[] = []
// A compact list: the row's name, then this many key values.
const COMPACT_COLUMNS = 3
// #1015: the row's name stays in view, so it may not take the whole window. Flex
// keeps its Retired badge beside the link rather than clipped with it.
const NAME_CLIP = 'flex max-w-64 items-center [&>a]:min-w-0 [&>a]:truncate'

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

// One list row (+ its optional expanded child-rows row). Extracted so the
// chevron and the inline subgrid don't clutter the main table loop.
function ListRow({
  row,
  table,
  columns,
  settings,
  title,
  selected,
  onToggleSelect,
  selectable,
  expandable,
  childFields,
  expanded,
  onToggleExpand,
  inPane = false,
  onOpenPane,
}: {
  row: Record<string, unknown>
  table: string
  columns: { column_name: string; label: string; column_type: string; reference_table?: string | null; reference_base?: string | null }[]
  settings: Settings
  // What the row's checkbox names it (#514): the row's display title.
  title: string
  selected: boolean
  onToggleSelect: () => void
  // Read-only sources have no bulk bar, so no selection either (EDS-13).
  selectable: boolean
  expandable: boolean
  childFields: import('../lib/meta').ColumnDef[]
  expanded: boolean
  onToggleExpand: () => void
  /** #910: this row is the one in the drill pane. */
  inPane?: boolean
  /** #910: shows a row in the drill pane; absent where there is no pane. */
  onOpenPane?: (pane: { table: string; row: string }) => void
}) {
  // A title that is a person's id reads as their name.
  const shownTitle = usePrincipalLabels([title])
  const rowId = String(row.row_id)
  // A click on the line itself, not on a link, button or checkbox in it.
  const select = onOpenPane && ((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button,input,select,label,textarea')) return
    onOpenPane({ table, row: rowId })
  })
  return (
    <>
      <tr onClick={select || undefined} aria-selected={onOpenPane ? inPane : undefined}
        // #910 checklist 21: a line goes to the pane from the keyboard too;
        // Enter on a link or control inside it keeps doing its own thing.
        tabIndex={onOpenPane ? 0 : undefined}
        onKeyDown={onOpenPane && ((e) => {
          if (e.key !== 'Enter' || e.target !== e.currentTarget) return
          e.preventDefault()
          onOpenPane({ table, row: rowId })
        })}
        className={`group ${inPane ? '' : 'hover:bg-subtle'} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${onOpenPane ? 'cursor-pointer' : ''} ${inPane ? 'bg-action-tint' : ''}`}>
        {expandable && (
          <td className="border-b border-border pl-2 group-last:border-b-0">
            <button
              onClick={onToggleExpand}
              aria-label={expanded ? 'Collapse child rows' : 'Expand child rows'}
              aria-expanded={expanded}
              data-testid="row-expand"
              className={`rounded px-1 text-xs text-ink-subtle transition-transform hover:text-action ${
                expanded ? 'rotate-90 text-action' : ''
              }`}
            >
              ▶
            </button>
          </td>
        )}
        {selectable && (
          <td className="border-b border-border px-3 py-2 group-last:border-b-0">
            <label className="cursor-pointer">
              <input
                type="checkbox"
                aria-label={`Select ${shownTitle(title)}`}
                data-testid="row-check"
                checked={selected}
                onChange={onToggleSelect}
              />
            </label>
          </td>
        )}
        {columns.map((col, i) => (
          <td key={col.column_name} className={`border-b border-border px-3 py-2 group-last:border-b-0 ${isFigure(col) ? 'text-right tabular-nums' : ''} ${i === 0 ? `sticky left-0 z-[1] border-r group-focus-visible:bg-action-tint ${inPane ? 'bg-action-tint' : 'bg-surface group-hover:bg-subtle'}` : ''}`}>
            <OneLine className={i === 0 ? NAME_CLIP : 'max-w-80'}>
              <ListCell row={row} col={col} table={table} settings={settings} first={i === 0} />
            </OneLine>
          </td>
        ))}
        <td aria-hidden className="border-b border-border p-0 group-last:border-b-0" />
      </tr>
      {expanded && (
        <tr data-testid="expanded-row">
          <td
            colSpan={columns.length + 2 + (selectable ? 1 : 0)}
            className="border-b border-border bg-subtle py-3 pl-10 pr-4"
          >
            <InlineChildren table={table} name={String(row.row_id)} childFields={childFields} />
          </td>
        </tr>
      )}
    </>
  )
}

// One value of a row, the same in both shapes: the first column links to the
// row's form, a Choice reads as its status dot and words, a person shows
// their name, and everything else goes through the display settings.
/** A number column: right-aligned in the table and on a card, so figures line up. */
const isFigure = (col: ListColumn) => ['Int', 'Float', 'Currency', 'Percent'].includes(col.column_type)

function ListCell({
  row,
  col: shownCol,
  table,
  settings,
  first,
  quiet = false,
}: {
  row: Record<string, unknown>
  col: ListColumn
  table: string
  settings: Settings
  first: boolean
  /** A card's meta line (the row id under the title): grey, not body ink. */
  quiet?: boolean
}) {
  const { t } = useI18n()
  // #910: a link opens the linked row in the drill pane, over this list.
  const navigation = useNavigation()
  const nav = navigation?.step.screen === 'list' && navigation.step.table === table ? navigation : null
  // #881: a link to a row of any Table reads as a link to the row's own Table.
  const anyTable = shownCol.table_column ? row[shownCol.table_column] : undefined
  const col = shownCol.table_column
    ? { ...shownCol, reference_table: isBlank(anyTable) ? null : String(anyTable) }
    : shownCol
  if (first)
    return (
      <>
      <Link
        to="/featherbase/admin/table/$table/row/$name"
        search={{ prefill: undefined }}
        params={{ table, name: String(row.row_id) }}
        className={touchLinkClasses('font-medium text-action hover:underline')}
      >
        {col.column_name === 'row_id' && isPrincipalTable(table) ? (
          <PrincipalName id={String(row.row_id)} />
        ) : col.column_type === 'Reference' && isPrincipalTable(col.reference_table) && row[col.column_name] ? (
          // A title column that names a person reads as their name, never the opaque id.
          <PrincipalName id={String(row[col.column_name])} />
        ) : col.column_type === 'Reference' && col.reference_table && !isBlank(row[col.column_name]) ? (
          // A title that links to another row reads as that row's title.
          <LinkedTitle table={col.reference_base ?? col.reference_table} rowId={String(row[col.column_name])} />
        ) : col.column_name !== 'row_id' && isBlank(row[col.column_name]) ? (
          // #792: a row with a blank title is led by its id, never a blank; a
          // person's opaque id reads as what identifies them (#835).
          isPrincipalTable(table) ? <PrincipalName id={String(row.row_id)} /> : String(row.row_id)
        ) : (
          col.column_type === 'Choice' && row[col.column_name] != null
            ? choiceLabel(String(row[col.column_name]), col.choice_labels, t)
            : cell(row[col.column_name], col.column_type, settings)
        )}
      </Link>
      {row.retired_at != null && <RetiredBadge className="-my-1 ml-2 shrink-0 align-middle" />}
      </>
    )
  const value = row[col.column_name]
  return (
    <span
      // A date never breaks at its hyphens in a narrow cell.
      className={`${quiet ? 'text-ink-muted' : 'text-ink'} ${DATE_TYPES.has(col.column_type) ? 'whitespace-nowrap' : ''}`}
      data-testid={`cell-${col.column_name}`}
    >
      {col.column_type === 'Choice' && value != null && value !== '' ? (
        <Indicator value={String(value)} label={choiceLabel(String(value), col.choice_labels, t)} />
      ) : col.column_type === 'Reference' && isPrincipalTable(col.reference_table) && value ? (
        <PrincipalName id={String(value)} />
      ) : col.column_type === 'Reference' && col.reference_table && !isBlank(value) ? (
        // #792: a link reads as the linked row's title and opens that row;
        // #910 D5: its code follows when people use one.
        <RowLink
          table={col.reference_base ?? col.reference_table}
          rowId={String(value)}
          onClick={(e) => {
            e.stopPropagation()
            if (!nav || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            nav.push({ ...nav.step, pane: { table: col.reference_base ?? col.reference_table!, row: String(value) } })
          }}
        />
      ) : (
        cell(value, col.column_type, settings)
      )}
    </span>
  )
}

const isBlank = (v: unknown) => v == null || String(v).trim() === ''

/** A nested row's link, by its key as before; a row the viewer cannot read
 *  is neutral words with no link (#910 D3). */
function NestedLink({ table, rowId }: { table: string; rowId: string }) {
  const principal = isPrincipalTable(table)
  const title = useLinkTitle(principal ? undefined : table, rowId)
  if (!principal && title.state === 'unreadable') return <span className="text-ink-muted">{UNSEEN_ROW}</span>
  return (
    <Link to="/featherbase/admin/table/$table/row/$name" search={{ prefill: undefined }}
      params={{ table, name: rowId }} className="text-action hover:underline">
      {principal ? <PrincipalName id={rowId} /> : rowId}
    </Link>
  )
}

// usable-on-any-device "Lists fit a phone": the same rows as cards. The first
// column is the card's title and link, the first Choice its status, and the
// rest labelled figures. What the table's header row does — select the page,
// sort by a column — sits above the cards as two controls.
function PhoneList({
  table,
  titleColumn,
  rows,
  columns,
  settings,
  selectable,
  selected,
  onToggleRow,
  onSelectPage,
  sort,
  onSort,
  childFields,
  expanded,
  onToggleExpand,
  empty,
}: {
  table: string
  /** The Table's own title column, if it has one. */
  titleColumn: string | null | undefined
  rows: Record<string, unknown>[]
  columns: ListColumn[]
  settings: Settings
  selectable: boolean
  selected: Set<string>
  onToggleRow: (name: string) => void
  onSelectPage: (all: boolean) => void
  sort: { field: string; dir: 'asc' | 'desc' } | null
  onSort: (next: { field: string; dir: 'asc' | 'desc' } | null) => void
  /** The Sub-table columns a card can show in place; null when there are none. */
  childFields: import('../lib/meta').ColumnDef[] | null
  expanded: Set<string>
  onToggleExpand: (name: string) => void
  empty: ReactNode
}) {
  const key = (row: Record<string, unknown>) => String(row.row_id)
  // A card leads with the row's title, never an opaque id: the Table's title
  // column when it is listed, else the first listed column. A person's id
  // already reads as their name. The id, when it is not the title, is the
  // card's quiet meta line.
  const titleCol =
    columns.find((c) => c.column_name === titleColumn) ??
    (isPrincipalTable(table) ? columns[0] : (columns[1] ?? columns[0]))
  const statusColumn = columns.find((c) => c !== titleCol && c.column_type === 'Choice')
  const cardColumns: DataColumn<Record<string, unknown>>[] = columns.map((col) => ({
    key: col.column_name,
    header: col.label,
    phone: col === titleCol ? 'title' : col === statusColumn ? 'status' : col.column_name === 'row_id' ? 'meta' : 'value',
    align: isFigure(col) ? 'end' : 'start',
    cell: (row) => <ListCell row={row} col={col} table={table} settings={settings} first={col === titleCol} quiet={col.column_name === 'row_id' && col !== titleCol} />,
  }))
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(key(r)))
  const titleValue = (row: Record<string, unknown>) =>
    titleCol ? cell(row[titleCol.column_name], titleCol.column_type, settings) : key(row)
  // A title that is a person's id reads as their name, as the card's link does.
  const shownTitle = usePrincipalLabels(rows.map(titleValue))
  const titleText = (row: Record<string, unknown>) => shownTitle(titleValue(row))
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {selectable && rows.length > 0 && (
          <label className="inline-flex min-h-control cursor-pointer items-center gap-2 text-control text-ink">
            <input
              type="checkbox"
              data-testid="select-all"
              checked={allSelected}
              onChange={(e) => onSelectPage(e.target.checked)}
              className="size-5 accent-action"
            />
            Select all on this page
          </label>
        )}
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-2">
          <label htmlFor="list-sort-by" className="shrink-0 text-control text-ink-muted">
            Sort by
          </label>
          <Select
            id="list-sort-by"
            data-testid="list-sort-by"
            // A long column label is cut, rather than pushing the page sideways.
            wrapperClassName="min-w-0"
            className="truncate"
            value={sort?.field ?? ''}
            onChange={(e) => onSort(e.target.value ? { field: e.target.value, dir: sort?.dir ?? 'asc' } : null)}
          >
            <option value="">Default order</option>
            {columns.map((c) => (
              <option key={c.column_name} value={c.column_name}>
                {c.label}
              </option>
            ))}
          </Select>
          {sort && (
            <Button
              aria-label={`Sort order: ${sort.dir === 'asc' ? 'ascending' : 'descending'}`}
              data-testid="list-sort-dir"
              className="size-control shrink-0 px-0"
              onClick={() => onSort({ field: sort.field, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
              icon={sort.dir === 'asc' ? <ArrowUp aria-hidden size={18} /> : <ArrowDown aria-hidden size={18} />}
            />
          )}
        </div>
      </div>
      {rows.length ? (
        <DataCards
          caption={`Rows of ${table}`}
          testId="list-rows"
          rows={rows}
          columns={cardColumns}
          rowKey={key}
          select={
            selectable
              ? {
                  isSelected: (row) => selected.has(key(row)),
                  onToggle: (row) => onToggleRow(key(row)),
                  label: (row) => `Select ${titleText(row)}`,
                }
              : undefined
          }
          expand={
            childFields
              ? {
                  isExpanded: (row) => expanded.has(key(row)),
                  onToggle: (row) => onToggleExpand(key(row)),
                  render: (row) => <InlineChildren table={table} name={key(row)} childFields={childFields} />,
                }
              : undefined
          }
        />
      ) : (
        empty
      )}
    </div>
  )
}

// The expanded row's content: every Sub-table column's rows, read-only,
// fetched through the ordinary row GET (children arrive embedded).
function InlineChildren({
  table,
  name,
  childFields,
}: {
  table: string
  name: string
  childFields: import('../lib/meta').ColumnDef[]
}) {
  const settings = useSettings()
  const doc = useQuery({
    queryKey: ['doc', table, name],
    queryFn: () =>
      api.get<Record<string, unknown>>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
      ),
  })
  if (doc.isLoading) return <p className="text-xs text-ink-subtle">Loading…</p>
  if (doc.isError) return <p className="text-xs text-negative">Cannot load {name}</p>
  return (
    <div className="flex flex-col gap-3">
      {childFields.map((f) => (
        <InlineChildGrid
          key={f.column_name}
          field={f}
          rows={(doc.data?.[f.column_name] as Record<string, unknown>[]) ?? []}
          settings={settings}
        />
      ))}
    </div>
  )
}

function InlineChildGrid({
  field,
  rows,
  settings,
}: {
  field: import('../lib/meta').ColumnDef
  rows: Record<string, unknown>[]
  settings: Settings
}) {
  const { t } = useI18n()
  const childMeta = useMeta(field.row_table ?? '')
  if (!childMeta.data) return null
  const cols = childMeta.data.columns.filter(
    (f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden,
  )
  const currencyCols = cols.filter((c) => c.column_type === 'Currency')
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface" data-testid={`inline-children-${field.column_name}`}>
      <div className="border-b border-border px-3 py-1 text-xs font-semibold text-ink-muted">
        {field.label ?? field.column_name} ({fmtCount(rows.length)})
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.column_name} className="border-b border-border px-3 py-1 text-left font-medium text-ink-muted">
                {c.label ?? c.column_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.row_id ?? i)} className="border-b border-border last:border-0">
              {cols.map((c) => (
                <td key={c.column_name} className="px-3 py-1 text-ink">
                  {c.column_type === 'Reference' && c.reference_table && r[c.column_name] ? (
                    <NestedLink table={c.reference_base ?? c.reference_table} rowId={String(r[c.column_name])} />
                  ) : (
                    c.column_type === 'Choice' && r[c.column_name] != null
                      ? choiceLabel(String(r[c.column_name]), c.choice_labels, t)
                      : cell(r[c.column_name], c.column_type, settings)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-3 text-center text-ink-subtle">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {currencyCols.length > 0 && rows.length > 0 && (
        <div className="border-t border-border bg-subtle px-3 py-1 text-xs text-ink-muted">
          {currencyCols
            .map(
              (c) =>
                `Σ ${c.label ?? c.column_name}: ${
                  formatValue(
                    'Currency',
                    rows.reduce((s, r) => s + (Number(r[c.column_name]) || 0), 0),
                    settings,
                  )
                }`,
            )
            .join(' · ')}
        </div>
      )}
    </div>
  )
}


// Standard filters (adopted from PR 2's Admin screen): typed per-column
// inputs for the list's visible columns — Choices become dropdowns, text-ish
// columns match with contains. They read and write the same URL-driven filter
// list the advanced FilterBar manages, so chips stay in sync.
const STANDARD_TEXT_TYPES = new Set(['Data', 'Reference', 'Email', 'Small Text'])
// #1017: one width for every kind of box, so a long Choice can't stretch its own
// and four of them share a line with the list's other controls.
const FILTER_BOX = 'flex w-32 flex-col gap-0.5'
const FILTER_LABEL = 'truncate text-xs font-semibold text-ink-subtle'

// A value's box in the Add filter row suits its column, where the condition can use it (#1019).
const NUMBER_TYPES = new Set(['Int', 'Float', 'Currency', 'Percent'])
function filterBoxKind(col: import('../lib/meta').ColumnDef | undefined, op: string) {
  const exact = op === '=' || op === '!='
  if (!col || op === 'like') return 'text'
  if (exact && col.column_type === 'Reference' && col.reference_table) return 'link'
  if (exact && col.column_type === 'Choice') return 'choice'
  if (col.column_type === 'Date') return 'date'
  if (col.column_type === 'Datetime') return 'datetime-local'
  if (NUMBER_TYPES.has(col.column_type)) return 'number'
  return 'text'
}

function StandardFilters({
  meta,
  filters,
  onChange,
}: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
}) {
  const { t } = useI18n()
  const columns = meta.columns
    .filter(
      (f) =>
        f.in_list_view &&
        !f.hidden &&
        (f.column_type === 'Choice' || STANDARD_TEXT_TYPES.has(f.column_type)),
    )
    .slice(0, 4)
  // Drafts for the text inputs (applied on Enter/blur); choices apply at once.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  if (!columns.length) return null

  function current(columnName: string, op: string): string {
    const hit = filters.find((f) => f[0] === columnName && f[1] === op)
    if (!hit) return ''
    const v = String(hit[2] ?? '')
    return op === 'like' ? v.replace(/^%|%$/g, '') : v
  }

  function apply(columnName: string, op: string, value: string) {
    const rest = filters.filter((f) => f[0] !== columnName)
    onChange(value ? [...rest, [columnName, op, op === 'like' ? `%${value}%` : value]] : rest)
  }

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="standard-filters">
      {columns.map((f) =>
        f.column_type === 'Reference' && f.reference_table ? (
          // #793: a link filters by picking a row by its name, not by typing its id.
          <label key={f.column_name} className={FILTER_BOX}>
            <span className={FILTER_LABEL} title={f.label ?? f.column_name}>
              {f.label ?? f.column_name}
            </span>
            <span className="flex items-center gap-1 [&>div]:min-w-0 [&>div]:flex-1">
              <LinkControl
                field={f}
                value={current(f.column_name, '=')}
                onChange={(v) => apply(f.column_name, '=', String(v ?? ''))}
                className={inputClasses('text-ellipsis')}
                common={{ 'data-testid': `std-filter-${f.column_name}` }}
                forFilter
              />
              {current(f.column_name, '=') && (
                <button
                  type="button"
                  onClick={() => apply(f.column_name, '=', '')}
                  aria-label={`Clear the ${f.label ?? f.column_name} filter`}
                  data-testid={`std-filter-clear-${f.column_name}`}
                  className="px-1 text-ink-subtle hover:text-action"
                >
                  ×
                </button>
              )}
            </span>
          </label>
        ) : f.column_type === 'Choice' ? (
          <label key={f.column_name} className={FILTER_BOX}>
            <span className={FILTER_LABEL} title={f.label ?? f.column_name}>
              {f.label ?? f.column_name}
            </span>
            <select
              value={current(f.column_name, '=')}
              onChange={(e) => apply(f.column_name, '=', e.target.value)}
              data-testid={`std-filter-${f.column_name}`}
              className={inputClasses()}
            >
              <option value="">All</option>
              {(f.choices ?? '')
                .split('\n')
                .filter(Boolean)
                .map((o) => (
                  <option key={o} value={o}>
                    {choiceLabel(o, f.choice_labels, t)}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label key={f.column_name} className={FILTER_BOX}>
            <span className={FILTER_LABEL} title={f.label ?? f.column_name}>
              {f.label ?? f.column_name}
            </span>
            <input
              value={drafts[f.column_name] ?? current(f.column_name, 'like')}
              onChange={(e) => setDrafts((d) => ({ ...d, [f.column_name]: e.target.value }))}
              onBlur={(e) => apply(f.column_name, 'like', e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  apply(f.column_name, 'like', (e.target as HTMLInputElement).value.trim())
                }
              }}
              placeholder={`Filter ${f.label ?? f.column_name}…`}
              data-testid={`std-filter-${f.column_name}`}
              className={inputClasses('text-ellipsis')}
              {...NOT_A_LOGIN}
            />
          </label>
        ),
      )}
    </div>
  )
}

// Chips must stay readable for non-scalar filter values: a 'related'
// relationship filter (NAV-002) names its target, long in-lists truncate.
export function filterValueLabel(op: string, value: unknown): string {
  if ((op === 'related' || op === 'not related') && value && typeof value === 'object' && !Array.isArray(value)) {
    const spec = value as { table?: string; via?: string }
    return spec.via ? `${spec.table ?? ''} via ${spec.via}` : String(spec.table ?? '')
  }
  if (Array.isArray(value))
    return value.length > 3
      ? `${value.slice(0, 3).map(String).join(', ')} +${value.length - 3}`
      : value.map(String).join(', ')
  return String(value)
}

/** One filter as a person reads it (#792): its column as the list's heading
 *  names it, and a link compared with one row reads as that row's title. */
export function FilterWords({ meta, filter }: { meta: import('../lib/meta').TableMeta | undefined; filter: Filter }) {
  const { t } = useI18n()
  const [column, op, value] = filter
  const col = meta?.columns.find((c) => c.column_name === column)
  const label = column === 'row_id' ? 'Row ID' : t(col?.label ?? column)
  const linked =
    col?.column_type === 'Reference' && col.reference_table && (op === '=' || op === '!=') &&
    (typeof value === 'string' || typeof value === 'number') && String(value) !== ''
  return (
    <>
      {label} {op}{' '}
      {linked ? <LinkedTitle table={col.reference_base ?? col.reference_table!} rowId={String(value)} />
        : (op === '=' || op === '!=') && col?.column_type === 'Choice' ? choiceLabel(String(value), col.choice_labels, t)
        : filterValueLabel(op, value)}
    </>
  )
}

export function FilterBar({
  meta,
  filters,
  onChange,
  builderOpen = true,
}: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
  /** False leaves only the chips of the filters already applied (#1017). */
  builderOpen?: boolean
}) {
  const { t } = useI18n()
  const fields = [
    { fieldname: 'row_id', label: 'Row ID' },
    ...meta.columns
      .filter((f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden)
      .map((f) => ({ fieldname: f.column_name, label: f.label ?? f.column_name })),
  ]
  const [field, setField] = useState('row_id')
  const [op, setOp] = useState<string>('=')
  const [value, setValue] = useState('')
  const column = meta.columns.find((c) => c.column_name === field)
  const kind = filterBoxKind(column, op)

  function add() {
    if (!value.trim()) return
    const v = op === 'like' ? `%${value.trim()}%` : value.trim()
    onChange([...filters, [field, op, v]])
    setValue('')
  }

  return (
    <div className="mb-3">
      {builderOpen && <div className="flex flex-wrap items-center gap-2">
        <select
          value={field}
          onChange={(e) => { setField(e.target.value); setValue('') }}
          aria-label="Filter by field"
          data-testid="filter-field"
          className={inputClasses('max-w-[10rem]')}
        >
          {fields.map((f) => (
            <option key={f.fieldname} value={f.fieldname}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={op}
          onChange={(e) => {
            if (filterBoxKind(column, e.target.value) !== kind) setValue('')
            setOp(e.target.value)
          }}
          aria-label="Filter condition"
          data-testid="filter-op"
          className={inputClasses('max-w-[10rem]')}
        >
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {kind === 'link' ? (
          <LinkControl
            key={field}
            field={column!}
            value={value}
            onChange={(v) => setValue(String(v ?? ''))}
            className={inputClasses('max-w-[10rem]')}
            common={{ 'aria-label': 'Filter value', 'data-testid': 'filter-value' }}
            forFilter
          />
        ) : kind === 'choice' ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Filter value"
            data-testid="filter-value"
            className={inputClasses('max-w-[20rem]')}
          >
            <option value="">Choose a value</option>
            {(column!.choices ?? '').split('\n').filter(Boolean).map((raw) => (
              <option key={raw} value={raw}>{choiceLabel(raw, column!.choice_labels, t)}</option>
            ))}
          </select>
        ) : <input
          type={kind}
          step={kind === 'number' ? 'any' : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Value"
          aria-label="Filter value"
          data-testid="filter-value"
          className={inputClasses('max-w-[10rem]')}
          {...NOT_A_LOGIN}
        />}
        <button
          onClick={add}
          data-testid="filter-add"
          className={buttonClasses()}
        >
          Add
        </button>
      </div>}
      {filters.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${builderOpen ? 'mt-2' : ''}`} data-testid="filter-chips">
          {filters.map((f, i) => (
            <span
              key={i}
              className={pillClasses('bg-subtle text-ink gap-1 border border-border')}
              data-testid="filter-chip"
            >
              <FilterWords meta={meta} filter={f} />
              <button
                aria-label="Remove filter"
                onClick={() => onChange(filters.filter((_, j) => j !== i))}
                className="text-ink-subtle hover:text-ink"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// #101 Phase 2: recall placed where the repeat work happens — this user's
// recent rows and recent filter sets for THIS table, from the same
// localStorage buffer the command bar reads. A view chip re-applies its
// whole filter set through the normal onFiltersChange pipeline (the filters
// live in the URL, so this is just replaying a remembered list state).
function RecentStrip({
  table,
  meta,
  withRetired,
  onApply,
}: {
  table: string
  /** Names each filter's column; until it loads a filter reads as stored. */
  meta: import('../lib/meta').TableMeta | undefined
  /** #959: offer retired rows only while the list shows them. */
  withRetired: boolean
  onApply: (filters: Filter[]) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const user = getSessionUser()
  const entries = user ? recentActions(user.row_id, 60) : []
  const remembered = entries.filter((e) => e.kind === 'row' && e.key.startsWith(`row:${table}/`)).slice(0, 8)
  // #741: history outlives rows. Offer only rows the server still has for this
  // reader (row_titles answers for those alone), and none until it has said.
  const ids = remembered.map((e) => e.label)
  const present = useQuery({
    queryKey: ['recent-strip-rows', table, ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { titles } = await api.post<{ titles: Array<{ table: string; row_id: string; title: string; retired?: true }> }>(
        '/api/row_titles', { rows: ids.map((row_id) => ({ table, row_id })) })
      for (const t of titles) queryClient.setQueryData(['row-title', table, t.row_id], t.title)
      return new Map(titles.map((t) => [t.row_id, t.retired === true]))
    },
  })
  // #959: a retired row stays out of the chips while the list leaves it out.
  const rows = remembered.filter((e) => present.data?.has(e.label) && (withRetired || !present.data.get(e.label))).slice(0, 4)
  const views = entries
    .map((e) => {
      if (e.kind !== 'list' || !e.key.startsWith(`list:${table}?`)) return null
      // A remembered address is user input: keep only well-formed filters (#87),
      // so one typed by hand can never blank the list.
      const parsed = parseFilters(e.key.slice(`list:${table}?`.length)) as Filter[]
      return parsed.length > 0 ? { entry: e, parsed } : null
    })
    .filter((v): v is { entry: RecentEntry; parsed: Filter[] } => v !== null)
    .slice(0, 3)
  if (rows.length === 0 && views.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="recent-strip">
      <span className="text-xs font-semibold text-ink-subtle">
        Recent
      </span>
      {rows.map((r) => (
        <Link
          key={r.key}
          to="/featherbase/admin/table/$table/row/$name"
          params={{ table, name: r.label }}
          search={{ prefill: undefined }}
          data-testid="recent-strip-row"
          className={touchRowClasses('inline-flex items-center rounded-full border border-border-control bg-surface px-2.5 py-0.5 text-xs text-ink-muted hover:border-action hover:text-action')}
        >
          <RowTitle table={table} rowId={r.label} />
        </Link>
      ))}
      {views.map(({ entry, parsed }) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => onApply(parsed)}
          data-testid="recent-strip-view"
          title={describeFilters(JSON.stringify(parsed), meta?.columns, t)}
          className={touchRowClasses('max-w-72 truncate rounded-full bg-action-tint px-2.5 py-0.5 text-xs font-medium text-action hover:opacity-80')}
        >
          {parsed.map((f, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              <FilterWords meta={meta} filter={f} />
            </Fragment>
          ))}
        </button>
      ))}
    </div>
  )
}

// #101 Phase 6: saved views + the proactive nudge. A saved view is a named,
// shareable filter set (server-owned rows); the nudge notices the same
// filter set applied 3+ times inside a week and offers to name it — the
// habit becomes an artifact instead of a memory.
const NUDGE_THRESHOLD = 3
const NUDGE_WINDOW_MS = 7 * 86_400_000

interface SavedViewRow {
  row_id: string
  label: string
  filters: Filter[]
  shared: boolean
  mine: boolean
}

function SavedViewsBar({
  table,
  filters,
  onApply,
}: {
  table: string
  filters: Filter[]
  onApply: (filters: Filter[]) => void
}) {
  const user = getSessionUser()
  const queryClient = useQueryClient()
  const [nudgeGone, setNudgeGone] = useState(false)
  const [applyCount, setApplyCount] = useState(0)
  const [nudgeName, setNudgeName] = useState('')
  const [naming, setNaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const views = useQuery({
    queryKey: ['saved-views', table],
    enabled: Boolean(user),
    queryFn: () => api.get<{ views: SavedViewRow[] }>(`/api/saved_views?table=${encodeURIComponent(table)}`),
  })

  const sig = filters.length > 0 ? JSON.stringify(filters) : ''
  const countKey = user ? `fc-filter-count:${user.row_id}` : ''
  const dismissKey = user ? `fc-nudge-dismissed:${user.row_id}` : ''

  // Every arrival at a non-empty filter state counts as one application.
  useEffect(() => {
    setNudgeGone(false)
    setNaming(false)
    setNudgeName('')
    setSaveError('')
    if (!user || !sig) {
      setApplyCount(0)
      return
    }
    try {
      const store = JSON.parse(localStorage.getItem(countKey) ?? '{}') as Record<
        string,
        { n: number; t: number }
      >
      const k = `${table}|${sig}`
      const rec = store[k] ?? { n: 0, t: 0 }
      const now = Date.now()
      if (now - rec.t > NUDGE_WINDOW_MS) rec.n = 0
      // A re-mount within half a second is the same arrival (StrictMode
      // double-invokes effects in dev), not a second application.
      if (now - rec.t > 500) rec.n += 1
      rec.t = now
      store[k] = rec
      const keys = Object.keys(store)
      if (keys.length > 50) {
        keys.sort((a, b) => store[a].t - store[b].t)
        for (const stale of keys.slice(0, keys.length - 50)) delete store[stale]
      }
      localStorage.setItem(countKey, JSON.stringify(store))
      setApplyCount(rec.n)
    } catch {
      setApplyCount(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sig, user?.row_id])

  if (!user) return null
  const list = views.data?.views ?? []

  const matching = list.find((v) => JSON.stringify(v.filters) === sig)
  let dismissed = false
  try {
    dismissed = Boolean(
      (JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>)[
        `${table}|${sig}`
      ],
    )
  } catch {
    /* ignore */
  }
  const showNudge = Boolean(sig && applyCount >= NUDGE_THRESHOLD && !matching && !dismissed && !nudgeGone)
  const showForm = Boolean(sig && (naming || showNudge))

  async function saveView() {
    const label = nudgeName.trim() || `${table} view`
    setSaving(true)
    setSaveError('')
    try {
      await api.post('/api/saved_views', { table, label, filters })
      try {
        const store = JSON.parse(localStorage.getItem(countKey) ?? '{}') as Record<string, unknown>
        delete store[`${table}|${sig}`]
        localStorage.setItem(countKey, JSON.stringify(store))
      } catch {
        /* ignore */
      }
      setNudgeGone(true)
      setNaming(false)
      setNudgeName('')
      // Invalidation reuses a pending initial read with no cached data. Cancel
      // it first so its pre-save result cannot hide the newly saved view.
      await queryClient.cancelQueries({ queryKey: ['saved-views', table] })
      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn't save this view. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function dismissNudge() {
    try {
      const store = JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>
      store[`${table}|${sig}`] = true
      localStorage.setItem(dismissKey, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    setNudgeGone(true)
  }

  if (list.length === 0 && !sig) return null

  return (
    <div className="mb-3" data-testid="saved-views-bar">
      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-subtle">
            Views
          </span>
          {list.map((v) => {
            const active = JSON.stringify(v.filters) === sig
            return (
              <span
                key={v.row_id}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  active
                    ? 'bg-action text-action-ink'
                    : 'bg-action-tint text-action'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onApply(v.filters)}
                  data-testid="saved-view-chip"
                  title={v.mine ? undefined : `shared by its owner`}
                >
                  ★ {v.label}
                  {v.shared && <span className="ml-1 opacity-70">{v.mine ? '· shared' : '· 👥'}</span>}
                </button>
                {v.mine && active && (
                  <button
                    type="button"
                    data-testid="saved-view-share"
                    title={v.shared ? 'Make private' : 'Share with everyone'}
                    onClick={async () => {
                      await api.post(`/api/saved_views/${encodeURIComponent(v.row_id)}/share`, {
                        shared: !v.shared,
                      })
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
                    }}
                    className="rounded-full px-1 hover:bg-surface/20"
                  >
                    {v.shared ? '🔒' : '👥'}
                  </button>
                )}
                {v.mine && (
                  <button
                    type="button"
                    aria-label={`Delete view ${v.label}`}
                    data-testid="saved-view-delete"
                    onClick={async () => {
                      await api.delete(`/api/saved_views/${encodeURIComponent(v.row_id)}`)
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
                    }}
                    className="rounded-full px-1 hover:bg-surface/20"
                  >
                    ✕
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      {sig && !showForm && (
        <button type="button" onClick={() => setNaming(true)} data-testid="save-view-open" className={buttonClasses({ className: 'mt-2' })}>
          Save view
        </button>
      )}
      {showForm && (
        <form
          onSubmit={(event) => { event.preventDefault(); void saveView() }}
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-action/40 bg-action-tint px-3 py-2 text-sm"
          data-testid="saved-view-form"
        >
          {showNudge && (
            <span className="text-ink" data-testid="filter-nudge">
              That's <b>{applyCount}×</b> for this filter in a week — save it as a view?
            </span>
          )}
          <label className="flex min-w-0 flex-wrap items-center gap-2 text-ink">
            View name
            <input
              value={nudgeName}
              onChange={(e) => setNudgeName(e.target.value)}
              placeholder={`${table} view`}
              data-testid="nudge-name"
              disabled={saving}
              className={inputClasses('w-44 max-w-full')}
            />
          </label>
          <button type="submit" disabled={saving} data-testid="nudge-save" className={buttonClasses({ variant: 'primary' })}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" disabled={saving} onClick={() => {
            setNaming(false)
            setNudgeName('')
            setSaveError('')
            setNudgeGone(true)
          }} className={buttonClasses()}>
            Cancel
          </button>
          {showNudge && (
            <button type="button" disabled={saving} onClick={dismissNudge} data-testid="nudge-dismiss" className={buttonClasses()}>
              Not now
            </button>
          )}
          {saveError && <p role="alert" data-testid="saved-view-error" className="w-full break-words text-sm text-negative">{saveError}</p>}
        </form>
      )}
    </div>
  )
}

// Option B of the Explore entry-point exploration: a split button on the
// list header. The main face opens the cross-filter Explore rooted at this
// table; the chevron reveals this table's chainable dependents — the SAME
// options Explore's own step pickers offer (the shared explore-steps seam)
// — to deep-link a pre-built chain. Selection is capped at two, the pane
// limit, and kept in CHECK order because chain order is pane order. No
// per-option row counts on purpose: each would cost a query.
function ExploreSplitButton({ table }: { table: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { options } = useStepOptions(open ? table : undefined)
  const [picked, setPicked] = useState<string[]>([])
  const togglePick = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key].slice(0, 2)))
  const openExplore = (chain: Step[]) =>
    navigate({
      to: '/featherbase/admin/explore',
      search: {
        root: table,
        chain: chain.length ? JSON.stringify(chain) : undefined,
        select: undefined,
      },
    })
  return (
    <div className="relative">
      <div className="flex">
        <button
          type="button"
          onClick={() => void openExplore([])}
          className={buttonClasses({ className: 'rounded-r-none' })}
          data-testid="open-explore"
        >
          Explore
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Explore with a chain"
          aria-expanded={open}
          className={buttonClasses({ className: 'rounded-l-none border-l-0 pointer-fine:px-1.5 pointer-coarse:min-w-control' })}
          data-testid="explore-split-toggle"
        >
          <span aria-hidden data-chevron className="inline-block">▾</span>
        </button>
      </div>
      {open && (
        <div className={cardClasses('absolute right-0 z-10 mt-1 w-64 p-2')} data-testid="explore-split-panel">
          <div className="px-2 pb-1 text-xs font-semibold text-ink-subtle">
            Chain into
          </div>
          {options.map((o) => {
            const checked = picked.includes(o.key)
            return (
              <label
                key={o.key}
                className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-subtle ${
                  !checked && picked.length >= 2 ? 'opacity-40' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && picked.length >= 2}
                  data-testid="explore-split-option"
                  onChange={() => togglePick(o.key)}
                />
                {o.label}
              </label>
            )
          })}
          {!options.length && (
            <p className="px-2 py-1 text-sm text-ink-subtle">No dependents</p>
          )}
          <div className="mt-1 border-t border-border px-2 pt-2">
            <button
              type="button"
              disabled={!picked.length}
              onClick={() =>
                void openExplore(
                  picked
                    .map((k) => options.find((o) => o.key === k)?.step)
                    .filter((s): s is Step => Boolean(s)),
                )
              }
              className={buttonClasses({ variant: 'primary', className: 'w-full !py-1 text-xs' })}
              data-testid="explore-split-open"
            >
              Open
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
