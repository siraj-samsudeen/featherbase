import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { rowDisplayTitle } from 'shared'
import { RecordLink, fmtCount } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { linkRowsTable, metaQuery, useMeta, useTableLabels, type ColumnDef, type TableMeta } from '../lib/meta'
import { useConnections, type Connection } from '../lib/connections'
import { farSideTable, farSides, groupBoxWords, groupRowFields, linksOnly, type FarSide } from '../lib/far-side'
import { useNavigation } from '../lib/navigation'
import { push as pushStep, type NavStep } from '../lib/nav-path'
import { ALL_ROWS, UNSEEN_ROW, forwardLinks, groupKey, groupOrder, groupRowsQuery, rowNameText, useRowName } from '../lib/relations'

type Row = Record<string, unknown>

// #910 checklist 17, #1282 (the walkable Map, E2–E5, E8, E10): the record page's
// Map tab, one record at a time. What the record points AT sits on the left;
// each group that points AT IT sits on the right, with its count and its first
// MAP_ROWS rows inside the box, then "+ N more in the panel". Every name the
// viewer may open is a RecordLink: clicking it, or its Focus, re-centres the map
// on that record and the path gains the step, so the walk goes back along the
// path. A group's header opens the whole group in the drill pane. Each
// relationship is named inside its box, never on a line (#794).

/** How many of a group's rows its box lists (E3). */
export const MAP_ROWS = 4

interface ForwardNode {
  label: string
  table: string
  row_id: string
  /** #1241: the Table as people read it. */
  tableLabel?: string
}

/** One row inside a group's box: its far side (a link table's row), or the row itself. */
interface MapRow {
  key: string
  table: string
  rowId: string
  title: string
  far: FarSide[]
}

interface GroupNode {
  kind: 'child' | 'cnx'
  label: string
  table: string
  count: number
  /** The line under its name: "through Job Assignment", "via Assigned To". */
  via?: string
  field?: ColumnDef // child: the Sub-table column on the center's meta
  cnx?: Connection
  /** The first rows, once read; undefined while loading. */
  rows?: MapRow[]
}

// A group without a connection is a sub-table's, built with its column.
const groupId = (g: GroupNode) => (g.cnx ? groupKey(g.cnx) : `child|${g.field!.column_name}`)

export function RowMap({ table, name }: { table: string; name: string }) {
  const meta = useMeta(table)
  const nav = useNavigation()
  const cnx = useConnections(table, name)
  // A collection names its link as the Table holding the link labels it.
  const holders = [...new Set((cnx.data?.connections ?? []).map((c) => c.via ?? c.table))]
  const holderMetas = useQueries({ queries: holders.map((t) => metaQuery(t)) })
  const centre = useRowName(table, name)
  const connections = cnx.data?.connections ?? []
  const childTables = (meta.data?.columns ?? []).filter((f) => f.column_type === 'Sub-table' && f.row_table).map((f) => f.row_table!)
  const groupTables = [...new Set([...connections.map((c) => c.table), ...childTables])]
  const groupMetas = useQueries({ queries: groupTables.map((t) => metaQuery(t)) })
  const groupMetaOf = (t: string) => groupMetas[groupTables.indexOf(t)]?.data
  // E10 / #1282 item 11: one read per group. A group of a Table that only links
  // others (a link table, or one with no title: #1273's rule) reads its rows whole,
  // as before, to name the one Table they point to (#1218 slice 1); any other
  // group reads only the rows its box lists.
  const groupRows = useQueries({
    queries: connections.map((c) => {
      const gm = groupMetaOf(c.table)
      const whole = Boolean(gm && linksOnly(gm))
      return {
        ...groupRowsQuery(c, { fields: gm ? groupRowFields(gm) : [], limit: whole ? ALL_ROWS : MAP_ROWS, orderBy: gm ? groupOrder(gm) : undefined }),
        enabled: Boolean(gm) && c.count > 0,
      }
    }),
  })
  const doc = useQuery({
    queryKey: ['doc', table, name],
    queryFn: () =>
      api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`),
  })

  // The row page draws this tab only once it holds the same two queries
  // loaded, and stops drawing it when either fails.
  const m = meta.data!
  const d = doc.data!
  const centreTitle = centre.state === 'read' ? centre.title : rowNameText(centre)
  const record = { table, row_id: name }

  const forward: ForwardNode[] = []
  if (m.kind === 'sub_table' && typeof d.parenttype === 'string' && typeof d.parent === 'string')
    forward.push({ label: 'parent', table: d.parenttype, row_id: d.parent })
  for (const f of m.columns) {
    // #881: a link to a row of any Table points into the Table its row names.
    const target = linkRowsTable(f) ?? (f.table_column && d[f.table_column] ? String(d[f.table_column]) : null)
    if (f.column_type === 'Reference' && target && d[f.column_name])
      forward.push({
        label: linkWords(f),
        table: target,
        row_id: String(d[f.column_name]),
      })
  }

  const own = forwardLinks(m, d)
  const groups: GroupNode[] = []
  for (const f of m.columns)
    if (f.column_type === 'Sub-table' && f.row_table) {
      const lines = (d[f.column_name] as Row[]) ?? []
      const lm = groupMetaOf(f.row_table)
      groups.push({
        kind: 'child',
        label: f.label ?? f.column_name,
        table: f.row_table,
        count: lines.length,
        via: 'child rows',
        field: f,
        rows: lm ? lines.slice(0, MAP_ROWS).map((r) => ownRow(lm, r)) : undefined,
      })
    }
  const linksPerTable = new Map<string, number>()
  for (const c of connections) linksPerTable.set(c.table, (linksPerTable.get(c.table) ?? 0) + 1)
  const farTables = connections.map((c, i) => {
    const gm = groupMetaOf(c.table)
    const rows = groupRows[i]?.data?.data
    // Codex round 2: a capped read is not the whole group; name it only when every row was read.
    if (!gm || !linksOnly(gm) || !rows || rows.length < c.count) return undefined
    return farSideTable(rows.map((r) => farSides(gm, r, { backLink: c.via ? undefined : c.column, record, own })))
  })
  connections.forEach((c, i) => {
    const gm = groupMetaOf(c.table)
    const read = groupRows[i]?.data?.data
    // A group linked through a sub-table has no column of its own pointing back.
    const backLink = c.via ? undefined : c.column
    groups.push({
      kind: 'cnx', label: c.table, table: c.table, count: c.count, cnx: c,
      // The link that joins it, only where its Table points here by more than one.
      via: linksPerTable.get(c.table)! > 1 ? linkWords(
        holderMetas[holders.indexOf(c.via ?? c.table)]?.data?.columns.find((col) => col.column_name === c.column)
          ?? { column_name: c.column },
      ) : undefined,
      rows: !c.count ? [] : gm && read ? read.slice(0, MAP_ROWS).map((r) => ({ ...ownRow(gm, r), far: farSides(gm, r, { backLink, record, own }) })) : undefined,
    })
  })

  // #1241: every Table on the map by its label, never its internal name.
  const labelOf = useTableLabels([table, ...forward.map((f) => f.table), ...groups.map((g) => g.table), ...farTables.filter((t): t is string => Boolean(t))])
  for (const f of forward) f.tableLabel = labelOf(f.table)
  groups.filter((g) => g.kind === 'cnx').forEach((g, i) => {
    const far = farTables[i]
    const words = groupBoxWords({ group: labelOf(g.table), farSide: far ? labelOf(far) : undefined, via: g.via })
    g.label = words.title
    g.via = words.detail
  })
  const tableWords = labelOf(table)

  const step = nav?.step
  const chosen = step?.pane?.table === table && step.pane.row === name && step.pane.group ? groupKey(step.pane.group) : undefined
  // E5: re-centring is a step of the walk, on the Map tab of the record it centres on.
  const focusStep = (t: string, r: string): NavStep => ({ screen: 'row', table: t, row: r, view: 'map' })
  const focus = nav ? (t: string, r: string) => nav.push(focusStep(t, r)) : undefined
  const focusHref = nav ? (t: string, r: string) => nav.href(pushStep(nav.path, focusStep(t, r))) : undefined
  // A collection opens on the centre row in the pane; child rows have no
  // group there, so the centre row's own fields show.
  function openGroup(g: GroupNode) {
    if (!nav) return
    nav.push({ ...nav.step, pane: g.cnx
      ? { table, row: name, group: { table: g.cnx.table, column: g.cnx.column, via: g.cnx.via } }
      : { table, row: name } })
  }

  const frame = useRef<HTMLElement>(null)
  const edges = useEdges(frame)
  const walk: Walk = { focus, href: focusHref }

  return (
    <section ref={frame} data-testid="relation-map" aria-label={`Relationship map for ${centreTitle}`}
      className="@container relative" onKeyDown={spaceFollowsLinks}>
      {/* The lines join the centre to each box; they sit behind the boxes, drawn where they fall.
          The columns follow the map's own width, not the window's, so they still fit beside the drill pane. */}
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" data-testid="map-edges">
        {edges.map((p, i) => <path key={i} d={p} fill="none" stroke="var(--color-border)" strokeWidth={1.5} />)}
      </svg>
      <div className="relative grid grid-cols-1 items-start gap-4 @2xl:grid-cols-[minmax(9rem,15rem)_minmax(8rem,13rem)_minmax(12rem,18rem)] @2xl:gap-x-12">
        <div className="flex min-w-0 flex-col gap-3 @2xl:self-center">
          {forward.map((f, i) => <ForwardBox key={i} link={f} walk={walk} />)}
        </div>
        <div data-testid="map-center" data-map-centre="" className="order-first min-w-0 rounded-lg border border-action bg-action-tint px-3 py-2.5 @2xl:order-none @2xl:self-center">
          <div className="text-xs text-ink-muted">{tableWords}</div>
          <div className="break-words text-sm font-semibold text-ink">{centreTitle}</div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {groups.map((g, i) => (
            <GroupBox key={i} group={g} chosen={chosen === groupId(g)} onOpen={nav ? () => openGroup(g) : undefined} walk={walk} />
          ))}
        </div>
      </div>
      {!forward.length && !groups.length && <p className="mt-3 text-sm text-ink-muted">No related rows</p>}
    </section>
  )
}

/** A row read as itself: its Table, id and title. */
function ownRow(meta: TableMeta, r: Row): MapRow {
  const rowId = String(r.row_id)
  return { key: rowId, table: meta.name, rowId, title: rowDisplayTitle(meta, r, rowId), far: [] }
}

/** How a name on the map walks: re-centre on its record, at the address that shows it. */
interface Walk {
  focus?: (table: string, rowId: string) => void
  href?: (table: string, rowId: string) => string
}

/** E8: Space on a name acts as Enter does, as on every box of the map. */
function spaceFollowsLinks(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== ' ' || !(event.target instanceof HTMLAnchorElement)) return
  event.preventDefault()
  event.target.click()
}

/** A record on the map, as a link that re-centres the map on it. */
function MapLink({ table, rowId, name, walk, canOpen = true }: { table: string; rowId: string; name: string; walk: Walk; canOpen?: boolean }) {
  return <RecordLink table={table} rowId={rowId} name={name} canOpen={canOpen} href={walk.href?.(table, rowId)}
    onNavigate={walk.focus ? () => walk.focus!(table, rowId) : undefined} className="min-w-0 break-words" />
}

/** One link box of the map, at the left: the link's name small, the record's name below. */
function ForwardBox({ link, walk }: { link: ForwardNode; walk: Walk }) {
  const name = useRowName(link.table, link.row_id)
  const words = linkAndTable(link)
  return (
    <div data-testid={`map-forward-${link.table}`} data-map-from="" className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
      <div data-testid="map-link-words" title={words} className="line-clamp-2 text-xs text-ink-muted">{words}</div>
      <div className="text-sm">
        {name.state === 'loading' ? <span className="text-ink-subtle">…</span>
          // Never its id (#907), and never the name of a row the viewer cannot read (checklist 22).
          : name.state === 'unreadable' ? <RecordLink table={link.table} rowId={link.row_id} name={UNSEEN_ROW} canOpen={false} />
          : <MapLink table={link.table} rowId={link.row_id} name={name.title} walk={walk} />}
      </div>
    </div>
  )
}

/** One group box of the map, at the right: its name and count, then its first rows. */
function GroupBox({ group: g, chosen, onOpen, walk }: { group: GroupNode; chosen: boolean; onOpen?: () => void; walk: Walk }) {
  const empty = g.count === 0
  const more = g.count - (g.rows?.length ?? 0)
  const header = (
    <>
      <span className={empty ? 'min-w-0 break-words font-semibold text-ink-muted' : 'min-w-0 break-words font-semibold text-ink'}>{g.label}</span>
      {/* a space first, so the header reads "Plant 3", not "Plant3" */}
      <span className="shrink-0 font-semibold text-ink-muted">{` ${fmtCount(g.count)}`}</span>
    </>
  )
  return (
    <div data-testid={`map-group-${g.table}`} data-map-to="" data-empty={empty ? 'true' : undefined}
      className={`min-w-0 rounded-lg border bg-surface p-1.5 ${chosen ? 'border-action' : 'border-border'} ${empty ? 'opacity-60' : ''}`}>
      {onOpen
        ? <button type="button" onClick={onOpen} aria-pressed={chosen} aria-label={`${g.label} ${fmtCount(g.count)}`}
            className="flex w-full items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus">
            {header}
          </button>
        : <div className="flex items-baseline justify-between gap-2 px-1.5 py-1 text-sm">{header}</div>}
      {g.via && <div className="px-1.5 text-xs text-ink-muted">{g.via}</div>}
      {!empty && (g.rows === undefined
        ? <p className="px-1.5 py-1 text-xs text-ink-subtle">Loading…</p>
        : <ul className="mt-1 flex flex-col gap-1">
            {g.rows.map((r) => <RowLine key={r.key} row={r} walk={walk} />)}
          </ul>)}
      {g.rows !== undefined && more > 0 && (
        onOpen
          ? <button type="button" onClick={onOpen}
              className="mt-1 rounded-md px-1.5 py-0.5 text-left text-xs text-ink-muted hover:text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              {`+ ${fmtCount(more)} more in the panel`}
            </button>
          : <p className="mt-1 px-1.5 text-xs text-ink-muted">{`+ ${fmtCount(more)} more`}</p>
      )}
    </div>
  )
}

/** One row inside a group's box: its name as a link, and Focus at its right (E5). */
function RowLine({ row, walk }: { row: MapRow; walk: Walk }) {
  if (row.far.length) return <FarRowLine far={row.far} walk={walk} />
  return <Line name={row.title} focus={walk.focus ? () => walk.focus!(row.table, row.rowId) : undefined}>
    <MapLink table={row.table} rowId={row.rowId} name={row.title} walk={walk} />
  </Line>
}

/** A link table's row, read by its far side (or two: "Sarees › Silk sarees"); Focus goes to the first. */
function FarRowLine({ far, walk }: { far: FarSide[]; walk: Walk }) {
  const first = useRowName(far[0]!.table, far[0]!.row_id)
  const second = useRowName(far[1]?.table, far[1]?.row_id)
  const part = (f: FarSide, n: ReturnType<typeof useRowName>) =>
    n.state === 'loading' ? <span className="text-ink-subtle">…</span>
      // The row is listed; what it points to the viewer may not open: plain words, no id.
      : n.state === 'unreadable' ? <RecordLink table={f.table} rowId={f.row_id} name={UNSEEN_ROW} canOpen={false} />
      : <MapLink table={f.table} rowId={f.row_id} name={n.title} walk={walk} />
  const canFocus = first.state === 'read' && walk.focus
  return <Line name={first.state === 'read' ? first.title : UNSEEN_ROW} focus={canFocus ? () => walk.focus!(far[0]!.table, far[0]!.row_id) : undefined}>
    <span className="min-w-0">
      {part(far[0]!, first)}
      {far[1] && <><span className="text-ink-muted"> › </span>{part(far[1], second)}</>}
    </span>
  </Line>
}

function Line({ name, focus, children }: { name: string; focus?: () => void; children: ReactNode }) {
  return (
    <li data-testid="map-row" className="flex min-w-0 items-center gap-2 rounded-md bg-subtle px-2 py-1 text-[13px]">
      <span className="min-w-0 flex-1">{children}</span>
      {focus && (
        <button type="button" onClick={focus} aria-label={`Focus on ${name}`}
          className="shrink-0 rounded px-1 text-xs text-ink-muted hover:text-action focus-visible:outline-2 focus-visible:outline-focus">
          Focus
        </button>
      )}
    </li>
  )
}

/**
 * The lines from the centre to each box, measured where the boxes fall: a
 * curve from each link box on the left into the centre, and from the centre to
 * the header of each group box on the right. None where the boxes stack (a
 * narrow window), since a box is then not beside the centre.
 */
function useEdges(frame: RefObject<HTMLElement | null>): string[] {
  const [paths, setPaths] = useState<string[]>([])
  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const draw = () => {
      const box = el.getBoundingClientRect()
      const c = el.querySelector('[data-map-centre]')?.getBoundingClientRect()
      const next: string[] = []
      if (c && c.width) {
        const cy = c.top + c.height / 2 - box.top
        const curve = (x1: number, y1: number, x2: number, y2: number) => {
          const mx = (x1 + x2) / 2
          return `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
        }
        el.querySelectorAll('[data-map-from]').forEach((n) => {
          const r = n.getBoundingClientRect()
          if (r.right < c.left) next.push(curve(r.right - box.left, r.top + r.height / 2 - box.top, c.left - box.left, cy))
        })
        el.querySelectorAll('[data-map-to]').forEach((n) => {
          const r = n.getBoundingClientRect()
          if (r.left > c.right) next.push(curve(c.right - box.left, cy, r.left - box.left, r.top + 18 - box.top))
        })
      }
      setPaths((was) => (was.join('|') === next.join('|') ? was : next))
    }
    draw()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(draw)
    watch.observe(el)
    el.querySelectorAll('[data-map-from],[data-map-to],[data-map-centre]').forEach((n) => watch.observe(n))
    return () => watch.disconnect()
  })
  return paths
}

/** A link column as words, for a column with no label: `assigned_to_id` → "Assigned To". */
function columnWords(column: string): string {
  return column.replace(/_?id$/i, '').split('_').filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || column
}

/** A link column's name in words: its label, unless that is only the column name again. */
function linkWords(c: { column_name: string; label?: string | null }): string {
  return c.label && c.label !== c.column_name ? c.label : columnWords(c.column_name)
}

/** What a linked row's box says above its name: "<link> · <Table>", or the Table alone when they match. */
function linkAndTable(f: ForwardNode): string {
  const words = f.tableLabel ?? f.table
  return f.label === f.table || f.label === words ? words : `${f.label} · ${words}`
}
