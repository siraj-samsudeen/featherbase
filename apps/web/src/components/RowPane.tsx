import { type ReactNode, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { choiceLabel, rowHref, tableHref, type ListFilter } from 'shared'
import {
  DrillPane, FieldGrid, GroupChip, LinkChip, PanePlace, PaneSection, SplitWithPane, ViewToggle,
  buttonClasses, fmtCount, resolvePanePlace, useMediaQuery, PANE_RIGHT_MIN_WIDTH,
  type FieldGridGroup, type PanePlaceValue, type ViewMode,
} from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { NO_COLUMN_TYPES, linkRowsTable, metaQuery, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'
import { dataColumns, listFields, viewColumns, type ListColumn } from '../lib/list-view-columns'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { push, type NavGroup, type NavPane, type NavStep } from '../lib/nav-path'
import { useNavigation, type Navigation } from '../lib/navigation'
import { useNavigationSettings } from '../lib/nav-settings'
import { backlinkGroups, forwardLinks, groupKey, groupOrder, rowNameText, useGroupRows, useRowName, type BacklinkGroup, type ForwardLink } from '../lib/relations'
import { useConnections } from '../lib/connections'
import { arrangeFields, isBookkeeping, isEmpty, useFormArrangement } from './FormArrangement'
import { useI18n } from '../lib/i18n'

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
 * The screen's content with the drill pane of the current step beside or
 * below it. `focus` is offered on a row page (centre the page on the pane's row).
 */
export function PaneSplit({ children, onFocus }: { children: ReactNode; onFocus?: (pane: NavPane) => void }) {
  const nav = useNavigation()
  const settings = useNavigationSettings()
  const wide = useMediaQuery(WIDE)
  const pane = nav?.step.pane
  const chosen: PanePlaceValue = nav?.step.place ?? settings.panePlace
  const place = resolvePanePlace(chosen, wide ? PANE_RIGHT_MIN_WIDTH : 0)
  return (
    <SplitWithPane place={place} pane={nav && pane ? (
      <RowPane key={`${pane.table}\u0000${pane.row}`} nav={nav} pane={pane} place={place}
        placeChoice={<PanePlace value={chosen} resolved={resolvePanePlace('auto', wide ? PANE_RIGHT_MIN_WIDTH : 0)} onChange={(value) => {
          settings.setPanePlace(value)
          nav.replace({ ...nav.step, place: value })
        }} />}
        onFocus={onFocus} />
    ) : null}>
      {children}
    </SplitWithPane>
  )
}

function RowPane({ nav, pane, place, placeChoice, onFocus }: {
  nav: Navigation
  pane: NavPane
  place: 'right' | 'bottom'
  placeChoice: ReactNode
  onFocus?: (pane: NavPane) => void
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
  const holders = [...new Set((cnx.data?.connections ?? []).map((c) => c.via ?? c.table))]
  const holderMetas = useQueries({ queries: holders.map((t) => metaQuery(t)) })
  const groups = cnx.data ? backlinkGroups(cnx.data.connections, (c) => {
    const col = holderMetas[holders.indexOf(c.via ?? c.table)]?.data?.columns.find((x) => x.column_name === c.column)
    return col?.label ?? c.column
  }) : []
  const open = pane.group ? groups.find((g) => g.key === groupKey(pane.group!)) : undefined

  // A row the viewer cannot read offers no way to it (checklist 22), not even
  // while that is still being found out.
  const unreadable = name.state === 'unreadable' || doc.isError
  const readable = doc.isSuccess && !unreadable

  return (
    <DrillPane kind={table} title={title} place={place} onClose={close}
      actions={readable ? <>
        {onFocus && !(step.screen === 'row' && step.table === table && step.row === row) &&
          <button type="button" onClick={() => onFocus(pane)} className={buttonClasses({ variant: 'quiet' })}>Focus here</button>}
        <HrefLink href={pageHref} className={buttonClasses({ variant: 'quiet' })}>Open row page</HrefLink>
        <HrefLink href={pageHref} className={buttonClasses({ variant: 'quiet' })}>Edit</HrefLink>
      </> : null}>
      <div className="flex flex-wrap items-center gap-2">{placeChoice}</div>
      {unreadable ? (
        <p className="text-sm text-ink-muted">You can't see this row.</p>
      ) : !meta.data || !doc.data ? (
        <p className="text-sm text-ink-subtle">Loading…</p>
      ) : <>
        <PointsAt links={forwardLinks(meta.data, doc.data)} nav={nav} onOpen={drill} />
        <PaneSection title="Pointed at by">
          <div className="flex flex-wrap gap-2">
            <GroupChip label="Fields" selected={!open} onSelect={() => choose(undefined)} />
            {groups.map((g) => (
              <GroupChip key={g.key} label={g.label} count={g.count} selected={open?.key === g.key}
                onSelect={() => choose({ table: g.connection.table, column: g.connection.column, via: g.connection.via })} />
            ))}
            {cnx.isPending && <span className="text-sm text-ink-subtle">Loading…</span>}
          </div>
          {open
            ? <GroupRows key={open.key} group={open} nav={nav} onOpen={drill} />
            : <PaneFields meta={meta.data} row={doc.data} onOpen={drill} />}
        </PaneSection>
      </>}
    </DrillPane>
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

function PointsAt({ links, nav, onOpen }: { links: ForwardLink[]; nav: Navigation; onOpen: (pane: NavPane) => void }) {
  const step = nav.step
  // Filter narrows the list the pane sits over; Explore's pane has none.
  const overList = step.screen === 'list' && nav.addressed
  const listMeta = useMeta(step.table, overList)
  if (!links.length) return <PaneSection title="Points at"><p className="text-sm text-ink-muted">No links to other rows</p></PaneSection>
  return (
    <PaneSection title="Points at">
      <dl className="grid grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
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
            <div key={link.column} className="contents">
              <dt className="text-ink-muted">{link.label}</dt>
              <dd className="min-w-0">
                <PaneLink table={link.table} rowId={link.row_id} onOpen={onOpen} goThere
                  onFilter={filter || undefined}
                  filterDisabledReason={overList && !column ? `This list has no ${link.label} column` : undefined} />
              </dd>
            </div>
          )
        })}
      </dl>
    </PaneSection>
  )
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
  if (col.column_type === 'Reference' && col.reference_table) return <LinkName table={linkRowsTable(col) ?? col.reference_table} rowId={String(value)} />
  if (col.column_type === 'Choice') return <>{choiceLabel(String(value), col.choice_labels, t)}</>
  return <>{formatValue(col.column_type, value, settings) || String(value)}</>
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
  return <FieldGrid groups={groups} />
}

function FieldValue({ col, value, settings, onOpen }: { col: ColumnDef; value: unknown; settings: Settings; onOpen: (pane: NavPane) => void }) {
  const { t } = useI18n()
  if (col.column_type === 'Reference' && col.reference_table) return <PaneLink table={linkRowsTable(col) ?? col.reference_table} rowId={String(value)} onOpen={onOpen} />
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
  const holders = [...new Set((cnx.data?.connections ?? []).map((c) => c.via ?? c.table))]
  const holderMetas = useQueries({ queries: holders.map((t) => metaQuery(t)) })
  if (!nav || !meta.data || !values) return null
  const links = forwardLinks(meta.data, values)
  const groups = cnx.data ? backlinkGroups(cnx.data.connections, (c) =>
    holderMetas[holders.indexOf(c.via ?? c.table)]?.data?.columns.find((x) => x.column_name === c.column)?.label ?? c.column) : []
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
