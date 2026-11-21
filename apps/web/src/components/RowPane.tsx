import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { choiceLabel, rowDisplayTitle, rowHref, tableHref, type ListFilter, type RecordGroup } from 'shared'
import { appGroupFor, appGroupKey, inAppOrder } from './AppLinkGroup'
import {
  CountChip, FieldGrid, GroupChip, LinkChip, NoneFold, PaneSection, PeekCard, Plus, RecordLink, SplitWithPane, X,
  buttonClasses, countedLabel, cx, fmtCount, fmtDuration, iconButtonClasses, nameAndCode, resolvePanePlace, smallActionClasses, tagClasses, touchLinkClasses, useMediaQuery, PANE_RIGHT_MIN_WIDTH,
  type FieldGridGroup,
} from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { NO_COLUMN_TYPES, linkRowsTable, tableLabel, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'
import { dataColumns } from '../lib/list-view-columns'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { push, type NavGroup, type NavPane, type NavPath, type NavStep } from '../lib/nav-path'
import { useNavigation, type Navigation } from '../lib/navigation'
import { forwardLinks, groupKey, rowNameText, useBacklinkGroups, useGroupRows, useRowName, type BacklinkGroup, type ForwardLink } from '../lib/relations'
import { useConnections } from '../lib/connections'
import { arrangeFields, isBookkeeping, isEmpty, useFormArrangement, userSettingsQuery } from './FormArrangement'
import { useI18n } from '../lib/i18n'
import { ActivityTimeline } from './ActivityTimeline'
import { LinkedRowsGroup } from './LinkedRowsGroup'
import { Indicator } from './Indicator'
import { RecordChips } from './RecordChips'
import { isCodeColumn, isDurationColumn, isSourceColumn } from '../lib/column-kinds'
import { WorkedOutCounts, WorkedOutSections, workedOutId } from './WorkedOut'
import { tableViewDefaultQuery } from '../lib/table-view-default'
import { listOrder, type ListSort } from '../lib/list-order'
import { useGroupPlans } from './LinkTickList'
import { managedBySignIn } from './PersonSignInMethods'

// #910 checklist 4–10: the drill pane. One row of any Table, beside or below
// the screen it was opened from: what it points at (each with Go there and,
// over a list with such a column, Filter), the counted groups that point at
// it, a chosen group's rows, and the row's fields read only, arranged as the
// person arranged its form (#795). Everything it reads is permission-scoped
// on the server (D3); a row the viewer cannot read is never named.

type Row = Record<string, unknown>

const WIDE = `(min-width: ${PANE_RIGHT_MIN_WIDTH}px)`

/**
 * The screen's content with the record panel of the current step beside it
 * (#1259: the right/bottom choice gave way to the list's three views), or
 * below it on a narrow window. `focus` is offered on a row page (centre the
 * page on the pane's row).
 */
export function PaneSplit({ children, onFocus }: { children: ReactNode; onFocus?: (pane: NavPane) => void }) {
  const nav = useNavigation()
  const wide = useMediaQuery(WIDE)
  const pane = nav?.step.pane
  const place = resolvePanePlace('auto', wide ? PANE_RIGHT_MIN_WIDTH : 0)
  return (
    <SplitWithPane place={place} pane={nav && pane ? (
      <RecordPanel key={`${pane.table}\u0000${pane.row}`} nav={nav} pane={pane} place={place} onFocus={onFocus} />
    ) : null}>
      {children}
    </SplitWithPane>
  )
}

/**
 * #1259 (Siraj, 17-Nov; mockups "Option B" and "Option C"): one record panel,
 * for a list's List And Record and Table With Panel views and beside a row
 * page. The record's title and its Table at the top with its actions (Edit,
 * Open Full Page, Close); its links as chips; its fields in two columns; the
 * rows that point at it (#910), counted, drilling in place with Back; then its
 * activity. Everything it reads is permission-scoped on the server (D3); a row
 * the viewer cannot read is never named.
 */
export function RecordPanel({ nav, pane, place = 'right', onFocus, framed = false }: {
  nav: Navigation
  pane: NavPane
  place?: 'right' | 'bottom'
  onFocus?: (pane: NavPane) => void
  /** Drawn as its own white panel, set off by a soft shadow (over a list). */
  framed?: boolean
}) {
  const { table, row } = pane
  const meta = useMeta(table)
  const name = useRowName(table, row)
  const doc = useQuery({
    queryKey: ['doc', table, row],
    enabled: Boolean(meta.data),
    retry: false,
    queryFn: () => api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(row)}`),
  })
  const cnx = useConnections(table, row, doc.isSuccess)
  const [showEmpty, setShowEmpty] = useState(false)
  const step = nav.step
  // Closing is not a step of its own: the step simply no longer shows a pane.
  const close = () => {
    const { pane: _, ...rest } = step
    nav.replace(rest)
  }
  const drill = (target: NavPane) => nav.push({ ...step, pane: target })
  const choose = (group: NavGroup | undefined) => nav.replace({ ...step, pane: group ? { table, row, group } : { table, row } })
  const href = rowHref(table, row)
  const pageHref = nav.addressed ? nav.href(push(nav.path, { screen: 'row', table, row })) : href
  const title = name.state === 'loading' ? '…' : rowNameText(name)
  // Two links from one Table are told apart by the link column's label.
  const groups = useBacklinkGroups(cnx.data?.connections)
  const open = pane.group ? groups.find((g) => g.key === groupKey(pane.group!)) : undefined
  const plans = useGroupPlans(table, row, groups)

  // A row the viewer cannot read offers no way to it (checklist 22), not even
  // while that is still being found out.
  const unreadable = name.state === 'unreadable' || doc.isError
  const readable = doc.isSuccess && !unreadable
  const kind = tableLabel(table, meta.data)
  const code = name.state === 'read' && name.code ? name.code : undefined
  const status = readable && doc.data && !isEmpty(doc.data.status) ? String(doc.data.status) : undefined

  // #1273 (C1): the header reads "Priya S.  Person · Employee · Floor Manager":
  // its Table, its status and its code. A relationship the viewer may change
  // is a section of its own beside the fields; the rest are Pointed At By.
  // #1348 board 4: a Choice status is a chip under the name, so the kicker no longer says it too.
  const statusIsChip = Boolean(meta.data?.columns.some((c) => c.column_name === 'status' && c.column_type === 'Choice'))
  const subtitle = [kind, statusIsChip ? undefined : status, code].filter(Boolean).join(' · ')
  const tickable = groups.filter((g) => plans.get(g.key)?.tick)
  // #1349 item 3 (board 4b): groups with no rows fold behind one muted "+ N tables with none".
  const chipGroups = groups.filter((g) => !plans.get(g.key)?.tick)
  const emptyChips = chipGroups.filter((g) => g.count === 0)
  const fullChips = chipGroups.filter((g) => g.count > 0)
  const levels = peekLevels(nav.path)
  const chip = (g: BacklinkGroup) => (
    <GroupChip key={g.key} label={g.label} count={g.count} selected={open?.key === g.key}
      onSelect={() => choose(open?.key === g.key ? undefined : { table: g.connection.table, column: g.connection.column, via: g.connection.via })} />
  )
  return (
    <RecordFrame kind={subtitle} title={title} place={place} framed={framed} onClose={close}
      chips={readable && doc.data ? <RecordChips meta={meta.data} values={doc.data} className="mt-2" /> : null}
      levels={{ ...levels, back: levels.at > 1 ? () => nav.go(nav.path.at - 1) : undefined }}
      actions={readable ? <>
        {onFocus && !(step.screen === 'row' && step.table === table && step.row === row) &&
          <button type="button" onClick={() => onFocus(pane)} className={buttonClasses({ variant: 'quiet' })}>Focus here</button>}
        {/* The row's page is its editable form: one way there (one-app-chrome, #1259). */}
        <HrefLink href={pageHref} className={buttonClasses({ variant: 'secondary' })}>Open Full Page</HrefLink>
      </> : null}>
      {unreadable ? (
        <p className="text-sm text-ink-muted">You can't see this row.</p>
      ) : !meta.data || !doc.data ? (
        <p className="text-sm text-ink-subtle">Loading…</p>
      ) : <>
        <PointsAt links={forwardLinks(meta.data, doc.data)} nav={nav} onOpen={drill} editHref={pageHref} />
        {/* #1349 item 1 (board 4b): what links here, counted, before the fields. */}
        <CountRow table={table} row={row} size="pane" onSection={(heading) => scrollToWhenShown(workedOutId(heading))} />
        {/* Two columns when the panel is wide, one when narrow (C1). */}
        <div className="@container" data-testid="record-panel-body">
          <div className="grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <PaneSection title="Fields">
              <PaneFields meta={meta.data} row={doc.data} onOpen={drill} />
            </PaneSection>
            <div className="flex min-w-0 flex-col gap-5">
              {tickable.map((g) => <LinkedRowsGroup key={g.key} table={table} record={row} group={g} onOpen={drill} editable
                showAllHref={groupListHref(g, nav)} />)}
              {/* #1282 C10–C11: what an installed app works out about this record (a Person's apps and reports). */}
              <WorkedOutSections table={table} row={row} onOpen={drill} />
              {/* A record whose only groups are tick lists has nothing to show here (verifier). */}
              {(cnx.isPending || chipGroups.length > 0 || !tickable.length) && <PaneSection title="Pointed At By">
                <div className="flex flex-wrap items-center gap-2">
                  {fullChips.map(chip)}
                  {cnx.isPending && <span className="text-sm text-ink-subtle">Loading…</span>}
                  {!cnx.isPending && !fullChips.length && !tickable.length && <NothingPointsAt kind={kind} />}
                  {emptyChips.length > 0 && <NoneFold count={emptyChips.length} open={showEmpty} onToggle={() => setShowEmpty((was) => !was)} />}
                  {showEmpty && emptyChips.map(chip)}
                </div>
                {open && !tickable.includes(open) && <PanelGroup key={open.key} table={table} row={row} group={open} nav={nav} onOpen={drill} />}
              </PaneSection>}
            </div>
          </div>
        </div>
        {/* The timeline heads itself "Activity". */}
        <ActivityTimeline table={table} name={row} bare />
      </>}
    </RecordFrame>
  )
}

/**
 * #1340: a group's count and heading are the app's where it describes the record (rows it marks taken away do not
 * count), and the groups come in its order.
 */
function appCounted(groups: BacklinkGroup[], appGroups: RecordGroup[] | undefined): BacklinkGroup[] {
  if (!appGroups?.length) return groups
  return inAppOrder(groups.map((g) => {
    const app = appGroupFor(appGroups, g.connection.table)
    return app ? { ...g, count: app.count ?? g.count, label: app.heading, worded: true } : g
  }), appGroups)
}

/** #1349 (board 4b): said once the counts are in and nothing with rows points at the record. */
export function NothingPointsAt({ kind }: { kind: string }) {
  return <span className="text-[13.5px] text-ink-muted">Nothing points at this {kind.toLowerCase()} yet.</span>
}

/**
 * #1349 item 1 (boards 3 and 4b): one row of counts under a record's title: a chip per group with rows, the number
 * first, each opening that group's list already filtered; then a chip per section an app works out about the record.
 * A group with no rows has no chip (it waits behind "+ N tables with none"); every count is the viewer's own.
 */
export function CountRow({ table, row, size = 'page', onSection, appGroups, onGroup }: {
  table: string; row: string; size?: 'page' | 'pane'; onSection?: (heading: string) => void
  /** #1340: the app's groups: its counts and headings on the chips, all in its order. */
  appGroups?: RecordGroup[]
  /** #1340: given, each of the app's own groups is a chip too, going to its section on the Links tab. */
  onGroup?: (key: string) => void
}) {
  const nav = useNavigation()
  const navigate = useNavigate()
  const cnx = useConnections(table, row)
  const groups = appCounted(useBacklinkGroups(cnx.data?.connections), appGroups).filter((g) => g.count > 0)
  const own = onGroup ? (appGroups ?? []).filter((g) => !g.table && (g.count ?? g.lines?.length ?? 0) > 0) : []
  const name = useRowName(table, row)
  const of = name.state === 'read' ? name.title : undefined
  return (
    // Drawn only when it holds a chip (empty:hidden), so a record nothing links to keeps no gap.
    <div role="group" aria-label="What links here" data-testid="count-row"
      className={cx('flex flex-wrap items-center empty:hidden', size === 'pane' ? 'gap-1.5' : 'gap-2')}>
      {groups.map((g) => {
        const href = nav ? groupListHref(g, nav) : `${tableHref(g.connection.table)}?filters=${encodeURIComponent(JSON.stringify(g.connection.filters))}`
        return <GroupCount key={g.key} group={g} href={href} size={size} of={of} onNavigate={(to = href) => void navigate({ href: to })} />
      })}
      {own.map((g) => <CountChip key={appGroupKey(g)} count={g.count ?? g.lines?.length ?? 0} label={g.heading} size={size} onSelect={() => onGroup!(appGroupKey(g))} />)}
      <WorkedOutCounts table={table} row={row} size={size} onSection={onSection} />
    </div>
  )
}

/** A group's chip in the count row: "3 Plants", or "1 Visit through Visit Line" for a hop through a sub-table. */
function GroupCount({ group, href, size, of, onNavigate }: {
  group: BacklinkGroup; href: string; size: 'page' | 'pane'
  /** The record's name, for the card's heading ("Plants in Bayside"). */
  of?: string
  onNavigate: (href?: string) => void
}) {
  const via = group.connection.via
  const viaMeta = useMeta(via ?? '', Boolean(via))
  // Two links from one Table read "Orders · Customer": the Table's word is the one counted.
  const [head, ...rest] = group.worded ? [group.label] : group.label.split(' · ')
  // An app's own words are said as it wrote them (#1340); a Table's name is counted.
  const label = [group.worded ? head! : countedLabel(head!, group.count), ...rest].join(' · ')
  const heading = of ? `${label} in ${of}` : label
  // #1349 item 2 (C5): hovering shows the shared peek card with the group's first rows.
  return (
    <PeekCard label={heading} trigger={<CountChip count={group.count} label={label} through={via ? tableLabel(via, viaMeta.data) : undefined}
      href={href} onNavigate={() => onNavigate()} size={size} />}>
      <b className="text-sm font-semibold text-ink">{heading}</b>
      <GroupPeek group={group} />
      <a href={href} className={touchLinkClasses('self-start text-[13px] text-action hover:underline')} onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onNavigate()
      }}>Open all {fmtCount(group.count)} as a list</a>
    </PeekCard>
  )
}

/** How many of a group's rows its card shows. */
const PEEK_ROWS = 5

/** The card's rows: the group's first few, in its own order, each a link to its row. */
function GroupPeek({ group }: { group: BacklinkGroup }) {
  const meta = useMeta(group.connection.table)
  const title = meta.data?.title_column && meta.data.title_column !== 'row_id' ? meta.data.title_column : undefined
  // In the order of the list "Open all" opens: the person's sort there, else the Table's default, else its own (verifier).
  const own = useQuery(userSettingsQuery(group.connection.table))
  const td = useQuery(tableViewDefaultQuery(group.connection.table))
  const ready = Boolean(meta.data) && !own.isPending && !td.isPending
  const order = ready ? listOrder(meta.data, (own.data?.settings?.sort ?? null) as ListSort | null, td.data?.settings.sort).orderBy : undefined
  const rows = useGroupRows(group.connection, {
    fields: ['row_id', ...(title ? [title] : [])], limit: PEEK_ROWS, orderBy: order, enabled: ready,
  })
  if (!meta.data || !rows.data) return <span className="text-[13px] text-ink-subtle">Loading…</span>
  const shown = rows.data.data as Row[]
  const more = group.count - shown.length
  // #1340: in an app's group, a row of a Table with no title column is named by the app's words and its id.
  const untitled = !title && group.worded ? group.label : undefined
  // UI owner: the rows as RecordLinks, no fills inside the raised card, then a muted "+ N more".
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13.5px]">
      {shown.map((r) => (
        <RecordLink key={String(r.row_id)} table={group.connection.table} rowId={String(r.row_id)} name={untitled ? `${untitled} ${String(r.row_id)}` : rowDisplayTitle(meta.data!, r, String(r.row_id))} />
      ))}
      {more > 0 && <span className="text-[13px] text-ink-subtle">+ {fmtCount(more)} more</span>}
    </div>
  )
}

/** Scrolls to a section once it is on screen (it may wait on a tab switch or a read), and gives it focus. */
export function scrollToWhenShown(id: string, tries = 40) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView?.({ block: 'start' })
    el.focus({ preventScroll: true })
  } else if (tries > 0) setTimeout(() => scrollToWhenShown(id, tries - 1), 50)
}

/** A group's rows as a list, on the path when the panel is on one. */
function groupListHref(group: BacklinkGroup, nav: Navigation): string {
  const { connection } = group
  const listStep: NavStep = { screen: 'list', table: connection.table, filters: connection.filters as ListFilter[] }
  return nav.addressed
    ? nav.href(push(nav.path, listStep))
    : `${tableHref(connection.table)}?filters=${encodeURIComponent(JSON.stringify(connection.filters))}`
}

/**
 * #1282 C14: the pane is the peek, and each drill in it a level. The levels are the
 * run of steps around the current one that show a record in the pane over the same
 * page: Level N of N, where N counts the steps still ahead too.
 */
export function peekLevels(path: NavPath): { at: number; of: number } {
  const here = path.steps[path.at]
  const page = (s: NavStep) => JSON.stringify([s.screen, s.table, s.row ?? null, s.filters ?? []])
  const peeks = (s: NavStep | undefined) => Boolean(s?.pane) && page(s!) === page(here!)
  let first = path.at
  while (peeks(path.steps[first - 1])) first--
  let last = path.at
  while (peeks(path.steps[last + 1])) last++
  return { at: path.at - first + 1, of: last - first + 1 }
}

/**
 * The panel's frame (#1259): the record's title (20px) over its Table and code,
 * the actions at the top beside Close. It takes focus when it opens; Escape
 * anywhere inside closes it. No lines: a soft shadow sets it off when framed.
 */
function RecordFrame({ kind, title, chips, onClose, actions, children, place, framed, levels }: {
  kind: string
  /** #1348: the record's status and category chips, under its name. */
  chips?: ReactNode
  /** #1282 C14: "← · Level N of N"; ← steps back one level. */
  levels: { at: number; of: number; back?: () => void }
  title: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
  place: 'right' | 'bottom'
  framed: boolean
}) {
  // Opening (or drilling to) a row puts focus in the panel, so Escape closes it.
  const frame = useRef<HTMLElement>(null)
  useEffect(() => { frame.current?.focus({ preventScroll: true }) }, [])
  return (
    <aside ref={frame} aria-label={title} data-place={place} data-testid="record-panel" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
      className={cx('flex min-h-0 min-w-0 flex-col focus:outline-none',
        framed ? 'h-full rounded-card bg-raised shadow-raised' : place === 'right' ? 'h-full bg-surface' : 'bg-surface')}
    >
      {/* #1282 C14: "← · Level N of N · … · Open Full Page · ✕" on one line, the title under it at full width. */}
      <header className="flex shrink-0 flex-col gap-1.5 px-[22px] pb-2 pt-5">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" aria-label="Back one level" title="Back one level" disabled={!levels.back} onClick={levels.back}
            className={iconButtonClasses('shrink-0 bg-fill hover:bg-fill-hover disabled:opacity-40')}>
            <span aria-hidden>←</span>
          </button>
          <span className="flex-1 text-[13px] text-ink-subtle" data-testid="peek-level">Level {levels.at} of {levels.of}</span>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className={iconButtonClasses('shrink-0 bg-fill hover:bg-fill-hover')}>
            <X aria-hidden size={16} />
          </button>
        </div>
        {/* #1348 board 4: the Table is a muted kicker above the record's name. */}
        <div className="mt-3 flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-ink-subtle" data-testid="record-panel-kind">{kind}</span>
          <h2 className="break-words text-xl font-semibold text-ink">{title}</h2>
          {chips}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-[22px] pb-5">{children}</div>
    </aside>
  )
}

/** A link to an address inside the Admin, followed by the router. */
function HrefLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <a href={href} className={className} onClick={(e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      void navigate({ href })
    }}>{children}</a>
  )
}

// ---------- points at ----------

/** The column of the list underneath that holds links to `link`'s table: the
 *  same column when it is there, else the only one. */
function filterColumn(listMeta: TableMeta | undefined, link: ForwardLink): ColumnDef | undefined {
  const refs = (listMeta ? dataColumns(listMeta) : []).filter((c) => c.column_type === 'Reference' && linkRowsTable(c) === link.table)
  return refs.find((c) => c.column_name === link.column) ?? (refs.length === 1 ? refs[0] : undefined)
}

function PointsAt({ links, nav, onOpen, status, editHref }: {
  links: ForwardLink[]
  nav: Navigation
  onOpen: (pane: NavPane) => void
  /** The row's status, drawn as a pill among the chips. */
  status?: string
  /** Where a field is added: the row's own page. */
  editHref: string
}) {
  const step = nav.step
  // Filter narrows the list the pane sits over, when there is one.
  const overList = step.screen === 'list' && nav.addressed
  const listMeta = useMeta(step.table, overList)
  // #1259: the record's properties as chips under its title: each link by its
  // label and the linked row, the status as a pill, and + to add a field.
  // Soft fills, no lines.
  return (
    <section aria-label="Points at" data-testid="record-chips" className="flex min-w-0 flex-wrap items-center gap-2">
      {/* Named for screen readers; the chips speak for themselves on screen. */}
      <h3 className="sr-only">Points at</h3>
      {!links.length && <span className="text-sm text-ink-muted">No links to other rows</span>}
      {links.map((link) => {
        const column = overList ? filterColumn(listMeta.data, link) : undefined
        // The filter goes on the path before the row it was read from:
        // "Sites › Region: Kerala › Enchakkal", as if narrowed first, so the
        // row's step brings back the narrowed list (spec: "Back to the site
        // from its supermarket").
        const filter = column && (() => {
          const kept = (step.filters ?? []).filter((f) => f[0] !== column.column_name)
          const filtered: NavStep = { ...step, filters: [...kept, [column.column_name, '=', link.row_id]] }
          const { pane: _, ...listOnly } = filtered
          const before = { steps: nav.path.steps.slice(0, nav.path.at), at: nav.path.at - 1 }
          nav.advanceTo(push(push(before, listOnly), filtered))
        })
        return (
          // #1259 (one-app-chrome): the name is a link to the row's page; a small
          // control shows it here instead (#910's drill); Filter shows on hover or focus.
          <span key={link.column} data-testid="record-chip"
            className="group inline-flex min-w-0 items-center gap-1.5 rounded-md bg-canvas px-2 py-1 text-sm [&_button]:hidden group-hover:[&_button]:inline-flex group-focus-within:[&_button]:inline-flex">
            <span className="text-ink-muted">{link.label}</span>
            <ChipLink table={link.table} rowId={link.row_id} onOpen={onOpen}
              onFilter={filter || undefined}
              filterDisabledReason={overList && !column ? `This list has no ${link.label} column` : undefined} />
          </span>
        )
      })}
      {status && <span className="rounded-full bg-action-tint px-2.5 py-0.5 text-xs font-medium text-action" data-testid="record-status">{status}</span>}
      <HrefLink href={editHref} className={iconButtonClasses('size-7 bg-canvas text-ink-muted hover:text-ink')}>
        <Plus aria-hidden size={14} />
        <span className="sr-only">Add a field</span>
      </HrefLink>
    </section>
  )
}

/** #1259, #1282: a chip's linked row: its name peeks it here in the panel (a new-tab
 *  click opens its page), and Filter (the list under the panel by this value). */
function ChipLink({ table, rowId, onOpen, onFilter, filterDisabledReason }: {
  table: string
  rowId: string
  onOpen: (pane: NavPane) => void
  onFilter?: () => void
  filterDisabledReason?: string
}) {
  const name = useRowName(table, rowId)
  if (name.state === 'loading') return <span className="text-sm text-ink-subtle">…</span>
  if (name.state === 'unreadable') return <LinkChip label="" unreadable />
  const text = nameAndCode(name.title, name.code)
  return <>
    {/* #1282 C14 (UI owner, 18-Nov-2026): a plain click peeks, one level deeper in this pane;
        a new-tab click, or Open Full Page, goes to its page. */}
    <RecordLink table={table} rowId={rowId} name={text} onNavigate={() => onOpen({ table, row: rowId })} />
    {(onFilter || filterDisabledReason) && (
      <button type="button" onClick={onFilter} disabled={!!filterDisabledReason} title={filterDisabledReason}
        className={smallActionClasses}>Filter</button>
    )}
  </>
}

/** A linked row by its name and code; opening it shows it in the pane. */
function PaneLink({ table, rowId, onOpen, goThere = false, onFilter, filterDisabledReason }: {
  table: string
  rowId: string
  onOpen: (pane: NavPane) => void
  goThere?: boolean
  onFilter?: () => void
  filterDisabledReason?: string
}) {
  const name = useRowName(table, rowId)
  if (name.state === 'loading') return <span className="text-sm text-ink-subtle">…</span>
  if (name.state === 'unreadable') return <LinkChip label="" unreadable />
  const open = () => onOpen({ table, row: rowId })
  return <LinkChip label={name.title} code={name.code} onOpen={open} onGoThere={goThere ? open : undefined}
    onFilter={onFilter} filterDisabledReason={filterDisabledReason} />
}

// ---------- a group's rows ----------

/** #1218 slice 1: an opened group, its rows by what they point to (LinkedRowsGroup). */
function PanelGroup({ table, row, group, nav, onOpen }: { table: string; row: string; group: BacklinkGroup; nav: Navigation; onOpen: (pane: NavPane) => void }) {
  // Opened from its chip, right above: the chip already names it (verifier, 17-Nov).
  // #1282 C14: a peeked group shows its first 4 rows, then "+ N more".
  return <LinkedRowsGroup table={table} record={row} group={group} showAllHref={groupListHref(group, nav)} onOpen={onOpen} heading={false} maxRows={4} peek />
}

// ---------- fields ----------

const LONG = new Set(['Text', 'Long Text', 'JSON'])

/** The row's fields as its form arranges them for this person (#795), read only. */
export function PaneFields({ meta, row, onOpen, stacked = true }: { meta: TableMeta; row: Row; onOpen: (pane: NavPane) => void; stacked?: boolean }) {
  const settings = useSettings()
  const { t } = useI18n()
  const arrangement = useFormArrangement(meta.name, meta.columns.some((c) => c.column_type === 'Section Break'))
  if (!arrangement.ready) return <p className="text-sm text-ink-subtle">Loading…</p>
  const readable = new Set(dataColumns(meta).map((c) => c.column_name))
  // #1267: a Person's sign-in switches are set on its Sign-In lines only.
  const shown = (c: ColumnDef) => readable.has(c.column_name) && !NO_COLUMN_TYPES.has(c.column_type) && !isBookkeeping(c) && !managedBySignIn(meta.name, c.column_name)
  let sets: { title?: string; fields: ColumnDef[] }[]
  if (arrangement.mode === 'source') {
    sets = [{ fields: [] }]
    for (const c of meta.columns) {
      if (c.column_type === 'Section Break') sets.push({ title: c.label ?? undefined, fields: [] })
      else if (shown(c)) sets[sets.length - 1].fields.push(c)
    }
  } else {
    sets = arrangeFields(meta.columns.filter(shown), row, meta, arrangement.mode, true).groups
      .map((g) => ({ title: g.foldable ? undefined : g.heading, fields: g.fields }))
  }
  const groups: FieldGridGroup[] = sets.map((s) => ({
    title: s.title,
    fields: s.fields.map((c) => ({
      label: t(c.label ?? c.column_name),
      empty: isEmpty(row[c.column_name]),
      long: LONG.has(c.column_type),
      value: <FieldValue col={c} value={row[c.column_name]} settings={settings} onOpen={onOpen} />,
    })),
  }))
  // #1259: two columns, each label over its value, as the record panel is drawn.
  return <FieldGrid groups={groups} stacked={stacked} />
}

function FieldValue({ col, value, settings, onOpen }: { col: ColumnDef; value: unknown; settings: Settings; onOpen: (pane: NavPane) => void }) {
  const { t } = useI18n()
  if (col.column_type === 'Reference' && col.reference_table) return <PaneLink table={linkRowsTable(col)!} rowId={String(value)} onOpen={onOpen} />
  // #1348: the same chips, codes and muted yes/no as the list.
  if (col.column_type === 'Check') return <span className="text-ink-subtle">{value ? 'Yes' : 'No'}</span>
  if (col.column_type === 'Choice' && isSourceColumn(col.column_name)) return <span className={tagClasses()}>{choiceLabel(String(value), col.choice_labels, t)}</span>
  if (col.column_type === 'Choice') return <Indicator value={String(value)} label={choiceLabel(String(value), col.choice_labels, t)} />
  if (isDurationColumn(col)) return <>{fmtDuration(Number(value))}</>
  if (col.column_type === 'Data' && isCodeColumn(col.column_name)) return <span className="font-mono text-[12.5px] text-ink-subtle">{String(value)}</span>
  if (col.column_type === 'JSON') return <code className="text-xs">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</code>
  if (col.column_type === 'Attach' || col.column_type === 'Attach Image') return <>{String(value).split('/').pop()}</>
  return <>{formatValue(col.column_type, value, settings) || String(value)}</>
}

// ---------- a row page's connections ----------

/**
 * #910 checklist 16: a row page's connections directly under its name — the
 * rows it points at and the counted groups that point at it, the same chips
 * as the drill pane. Opening one shows it in the pane.
 */
export function RowConnections({ table, row, values, layout = 'chips', onSection, onGroup, appGroups }: {
  table: string; row: string; values: Row | undefined
  /** #1340: the app's groups: its headings on the chips, its own groups as chips too, all in its order. */
  appGroups?: RecordGroup[]
  /** #1267: 'list' is a Person page's right column, one group per line with its count. */
  layout?: 'chips' | 'list'
  /** #1349: a worked-out section's chip in the count row goes to that section. */
  onSection?: (heading: string) => void
  /** #1340: an app's own group's chip goes to its section on the Links tab, by the group's key. */
  onGroup?: (key: string) => void
}) {
  const nav = useNavigation()
  const meta = useMeta(table)
  const cnx = useConnections(table, row, Boolean(values))
  const groups = useBacklinkGroups(cnx.data?.connections)
  // #1267: groups with no rows wait behind "Show N empty", opened in place.
  const [showEmpty, setShowEmpty] = useState(false)
  if (!nav || !meta.data || !values) return null
  const links = forwardLinks(meta.data, values)
  const step = nav.step
  const open = (pane: NavPane) => nav.push({ ...step, pane })
  const ordered = appCounted(groups, appGroups)
  const full = ordered.filter((g) => g.count > 0)
  const empty = ordered.filter((g) => g.count === 0)
  const shown = showEmpty ? [...full, ...empty] : full
  // #1349 (consistency check): the same fold as the pane and the Links tab.
  const emptyToggle = empty.length > 0 && <NoneFold count={empty.length} open={showEmpty} onToggle={() => setShowEmpty((was) => !was)} />
  // #1267 on #1218 slice 1: a Person's right column draws each group with
  // LinkedRowsGroup, its rows named by what they point to; rows open in the pane.
  if (layout === 'list') {
    if (!links.length && !groups.length) return null
    return (
      <section aria-labelledby="connections-heading" data-testid="connections-list" className="flex min-w-0 flex-col gap-4">
        <h2 id="connections-heading" className="text-sm font-medium text-ink-muted">Linked Records</h2>
        {links.map((link) => (
          <span key={link.column} className="flex min-w-0 items-center justify-between gap-2 text-sm">
            <span className="text-ink-muted">{link.label}</span>
            <PaneLink table={link.table} rowId={link.row_id} onOpen={open} />
          </span>
        ))}
        {shown.map((g) => <LinkedRowsGroup key={g.key} table={table} record={row} group={g} onOpen={open} />)}
        {/* Said only once the counts are in, never while they load. */}
        {cnx.data && !full.length && !showEmpty && <p><NothingPointsAt kind={tableLabel(table, meta.data)} /></p>}
        {emptyToggle && <span className="self-start">{emptyToggle}</span>}
      </section>
    )
  }
  // #1349 item 1 (board 3): what the row points at, then the count row; a group with no rows has no chip here.
  return (
    <section aria-label="Connections" className="mb-4 flex min-w-0 flex-col gap-3">
      {links.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {links.map((link) => (
          <span key={link.column} className="inline-flex min-w-0 items-center gap-2 text-sm">
            <span className="text-ink-muted">{link.label}</span>
            <PaneLink table={link.table} rowId={link.row_id} onOpen={open} />
          </span>
        ))}
      </div>}
      <CountRow table={table} row={row} onSection={onSection} appGroups={appGroups} onGroup={onGroup} />
    </section>
  )
}
