import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { choiceLabel, rowHref, tableHref, type ListFilter } from 'shared'
import {
  FieldGrid, GroupChip, LinkChip, PaneSection, PanelRight, Plus, RecordLink, SplitWithPane, ViewToggle, X,
  buttonClasses, cx, fmtCount, iconButtonClasses, nameAndCode, resolvePanePlace, smallActionClasses, useMediaQuery, PANE_RIGHT_MIN_WIDTH,
  type FieldGridGroup, type ViewMode,
} from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { NO_COLUMN_TYPES, linkRowsTable, tableLabel, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'
import { dataColumns, listFields, viewColumns, type ListColumn } from '../lib/list-view-columns'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { push, type NavGroup, type NavPane, type NavStep } from '../lib/nav-path'
import { useNavigation, type Navigation } from '../lib/navigation'
import { forwardLinks, groupKey, groupOrder, rowNameText, useBacklinkGroups, useGroupRows, useRowName, type BacklinkGroup, type ForwardLink } from '../lib/relations'
import { useConnections } from '../lib/connections'
import { arrangeFields, isBookkeeping, isEmpty, useFormArrangement } from './FormArrangement'
import { useI18n } from '../lib/i18n'
import { ActivityTimeline } from './ActivityTimeline'

// #910 checklist 4–10: the drill pane. One row of any Table, beside or below
// the screen it was opened from: what it points at (each with Go there and,
// over a list with such a column, Filter), the counted groups that point at
// it, a chosen group's rows, and the row's fields read only, arranged as the
// person arranged its form (#795). Everything it reads is permission-scoped
// on the server (D3); a row the viewer cannot read is never named.

type Row = Record<string, unknown>

/** How many of a group's rows the pane lists before "Open as list". */
const PANE_ROWS = 20
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

  // A row the viewer cannot read offers no way to it (checklist 22), not even
  // while that is still being found out.
  const unreadable = name.state === 'unreadable' || doc.isError
  const readable = doc.isSuccess && !unreadable
  const kind = tableLabel(table, meta.data)
  const code = name.state === 'read' && name.code ? name.code : undefined
  const status = readable && doc.data && !isEmpty(doc.data.status) ? String(doc.data.status) : undefined

  return (
    <RecordFrame kind={code ? `${kind} · ${code}` : kind} title={title} place={place} framed={framed} onClose={close}
      actions={readable ? <>
        {onFocus && !(step.screen === 'row' && step.table === table && step.row === row) &&
          <button type="button" onClick={() => onFocus(pane)} className={buttonClasses({ variant: 'quiet' })}>Focus here</button>}
        {/* The row's page is its editable form: one way there (one-app-chrome, #1259). */}
        <HrefLink href={pageHref} className={buttonClasses({ variant: 'secondary' })}>Edit</HrefLink>
      </> : null}>
      {unreadable ? (
        <p className="text-sm text-ink-muted">You can't see this row.</p>
      ) : !meta.data || !doc.data ? (
        <p className="text-sm text-ink-subtle">Loading…</p>
      ) : <>
        <PointsAt links={forwardLinks(meta.data, doc.data)} nav={nav} onOpen={drill} status={status} editHref={pageHref} />
        <PaneSection title="Fields">
          <PaneFields meta={meta.data} row={doc.data} onOpen={drill} />
        </PaneSection>
        <PaneSection title="Pointed At By">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <GroupChip key={g.key} label={g.label} count={g.count} selected={open?.key === g.key}
                onSelect={() => choose(open?.key === g.key ? undefined : { table: g.connection.table, column: g.connection.column, via: g.connection.via })} />
            ))}
            {cnx.isPending && <span className="text-sm text-ink-subtle">Loading…</span>}
            {!cnx.isPending && !groups.length && <span className="text-sm text-ink-muted">No rows point at it</span>}
          </div>
          {open && <GroupRows key={open.key} group={open} nav={nav} onOpen={drill} />}
        </PaneSection>
        {/* The timeline heads itself "Activity". */}
        <ActivityTimeline table={table} name={row} bare />
      </>}
    </RecordFrame>
  )
}

/**
 * The panel's frame (#1259): the record's title (20px) over its Table and code,
 * the actions at the top beside Close. It takes focus when it opens; Escape
 * anywhere inside closes it. No lines: a soft shadow sets it off when framed.
 */
function RecordFrame({ kind, title, onClose, actions, children, place, framed }: {
  kind: string
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
      className={cx('flex min-h-0 min-w-0 flex-col bg-surface focus:outline-none',
        framed ? 'h-full rounded-xl shadow-lg' : place === 'right' ? 'h-full' : '')}
    >
      <header className="flex shrink-0 items-start gap-3 px-5 pb-2 pt-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="break-words text-xl font-semibold text-ink">{title}</h2>
          <span className="text-sm text-ink-muted">{kind}</span>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className={iconButtonClasses('shrink-0 bg-canvas')}>
          <X aria-hidden size={16} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">{children}</div>
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
  // Filter narrows the list the pane sits over; Explore's pane has none.
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
            className="group inline-flex min-w-0 items-center gap-1.5 rounded-md bg-canvas px-2 py-1 text-sm [&_button:not(:first-of-type)]:hidden group-hover:[&_button:not(:first-of-type)]:inline-flex group-focus-within:[&_button:not(:first-of-type)]:inline-flex">
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

/** #1259: a chip's linked row: its name a link to its page, a control to show it
 *  here in the panel, and Filter (the list under the panel by this value). */
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
    <RecordLink table={table} rowId={rowId} name={text} />
    <button type="button" onClick={() => onOpen({ table, row: rowId })} aria-label={`Show ${text} here`} title="Show here"
      className={iconButtonClasses('size-6 text-ink-muted hover:text-ink')}>
      <PanelRight aria-hidden size={14} />
    </button>
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

function GroupRows({ group, nav, onOpen }: { group: BacklinkGroup; nav: Navigation; onOpen: (pane: NavPane) => void }) {
  const { connection } = group
  const meta = useMeta(connection.table)
  const settings = useSettings()
  const [view, setView] = useState<ViewMode>('table')
  const columns = meta.data ? viewColumns(meta.data, {}) : []
  const rows = useGroupRows(connection, { fields: listFields(columns), limit: PANE_ROWS, enabled: columns.length > 0, orderBy: meta.data ? groupOrder(meta.data) : undefined })
  const listStep: NavStep = { screen: 'list', table: connection.table, filters: connection.filters as ListFilter[] }
  const listHref = nav.addressed
    ? nav.href(push(nav.path, listStep))
    : `${tableHref(connection.table)}?filters=${encodeURIComponent(JSON.stringify(connection.filters))}`
  const data = rows.data?.data ?? []
  const total = rows.data?.total ?? group.count
  const openRow = (r: Row) => onOpen({ table: connection.table, row: String(r.row_id) })
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{group.label} · {fmtCount(total)} {total === 1 ? 'row' : 'rows'}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <HrefLink href={listHref} className={buttonClasses({ variant: 'quiet' })}>Open as list</HrefLink>
        </div>
      </div>
      {rows.isPending ? <p className="text-sm text-ink-subtle">Loading…</p>
        : !data.length ? <p className="text-sm text-ink-muted">No rows</p>
        : view === 'compact' ? (
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border text-sm">
            {data.map((r) => (
              <li key={String(r.row_id)}>
                <button type="button" onClick={() => openRow(r)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus">
                  <span className="font-medium text-action"><CellValue col={columns[0]} row={r} settings={settings} lead /></span>
                  <span className="text-ink-muted">
                    {columns.slice(1, 3).map((c, i) => <span key={c.column_name}>{i > 0 && ' · '}<CellValue col={c} row={r} settings={settings} /></span>)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-left">
                <tr>{columns.map((c) => <th key={c.column_name} className="px-3 py-2 font-semibold text-ink-muted">{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={String(r.row_id)} onClick={() => openRow(r)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') openRow(r) }}
                    className="cursor-pointer border-t border-border hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus">
                    {columns.map((c, i) => (
                      <td key={c.column_name} className={`px-3 py-2 ${i === 0 ? 'font-medium text-action' : 'text-ink'}`}>
                        <CellValue col={c} row={r} settings={settings} lead={i === 0} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {total > data.length && <p className="text-xs text-ink-muted">Showing {fmtCount(data.length)} of {fmtCount(total)}</p>}
    </div>
  )
}

/** One value of a group's row: a link by its name and code, else formatted. */
function CellValue({ col, row, settings, lead = false }: { col: ListColumn; row: Row; settings: Settings; lead?: boolean }) {
  const { t } = useI18n()
  const value = row[col.column_name]
  if (col.column_name === 'row_id') return <>{String(row.row_id)}</>
  if (isEmpty(value)) return lead ? <>{String(row.row_id)}</> : <span className="text-ink-subtle">—</span>
  if (col.column_type === 'Reference' && col.reference_table) return <LinkName table={linkRowsTable(col)!} rowId={String(value)} />
  if (col.column_type === 'Choice') return <>{choiceLabel(String(value), col.choice_labels, t)}</>
  // formatValue gives '' only for an empty value, handled above.
  return <>{formatValue(col.column_type, value, settings)}</>
}

function LinkName({ table, rowId }: { table: string; rowId: string }) {
  const name = useRowName(table, rowId)
  return <>{name.state === 'unreadable' ? 'Not visible to you' : rowNameText(name)}</>
}

// ---------- fields ----------

const LONG = new Set(['Text', 'Long Text', 'JSON'])

/** The row's fields as its form arranges them for this person (#795), read only. */
function PaneFields({ meta, row, onOpen }: { meta: TableMeta; row: Row; onOpen: (pane: NavPane) => void }) {
  const settings = useSettings()
  const { t } = useI18n()
  const arrangement = useFormArrangement(meta.name, meta.columns.some((c) => c.column_type === 'Section Break'))
  if (!arrangement.ready) return <p className="text-sm text-ink-subtle">Loading…</p>
  const readable = new Set(dataColumns(meta).map((c) => c.column_name))
  const shown = (c: ColumnDef) => readable.has(c.column_name) && !NO_COLUMN_TYPES.has(c.column_type) && !isBookkeeping(c)
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
  return <FieldGrid groups={groups} stacked />
}

function FieldValue({ col, value, settings, onOpen }: { col: ColumnDef; value: unknown; settings: Settings; onOpen: (pane: NavPane) => void }) {
  const { t } = useI18n()
  if (col.column_type === 'Reference' && col.reference_table) return <PaneLink table={linkRowsTable(col)!} rowId={String(value)} onOpen={onOpen} />
  if (col.column_type === 'Check') return <>{value ? 'Yes' : 'No'}</>
  if (col.column_type === 'Choice') return <>{choiceLabel(String(value), col.choice_labels, t)}</>
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
export function RowConnections({ table, row, values }: { table: string; row: string; values: Row | undefined }) {
  const nav = useNavigation()
  const meta = useMeta(table)
  const cnx = useConnections(table, row, Boolean(values))
  const groups = useBacklinkGroups(cnx.data?.connections)
  if (!nav || !meta.data || !values) return null
  const links = forwardLinks(meta.data, values)
  if (!links.length && !groups.length) return null
  const step = nav.step
  const open = (pane: NavPane) => nav.push({ ...step, pane })
  const chosen = step.pane?.table === table && step.pane.row === row ? step.pane.group : undefined
  return (
    <section aria-label="Connections" className="mb-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {links.map((link) => (
        <span key={link.column} className="inline-flex min-w-0 items-center gap-2 text-sm">
          <span className="text-ink-muted">{link.label}</span>
          <PaneLink table={link.table} rowId={link.row_id} onOpen={open} />
        </span>
      ))}
      {groups.length > 0 && <span className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <GroupChip key={g.key} label={g.label} count={g.count}
            selected={chosen ? groupKey(chosen) === g.key : false}
            onSelect={() => open({ table, row, group: { table: g.connection.table, column: g.connection.column, via: g.connection.via } })} />
        ))}
      </span>}
    </section>
  )
}
