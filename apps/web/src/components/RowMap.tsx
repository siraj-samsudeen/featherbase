import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../lib/api'
import { metaQuery, useMeta, type ColumnDef } from '../lib/meta'
import { useConnections, type Connection } from '../lib/connections'
import { useStepOptions } from '../lib/explore-steps'
import { buttonClasses, cardClasses, fmtCount } from '@featherbase/shop-floor'
import { useNavigation } from '../lib/navigation'
import { groupKey, rowNameText, useRowName } from '../lib/relations'
import { RowName } from '../lib/row-name'

type Row = Record<string, unknown>

// #910 checklist 17 (pattern 6 of #100): the row page's Map tab — the row's
// neighbourhood one step out. What the row points AT fans left (its links,
// and a sub-table row's parent); what points AT IT fans right (child rows and
// backlink collections, dashed, with counts). Clicking any box shows it in
// the drill pane and leaves the map centred where it is; the pane's Focus
// here re-centres the page. Each relationship is named inside its box, never
// on a line, so a label never crosses an edge (#794).

interface ForwardNode {
  label: string
  table: string
  row_id: string
}
interface GroupNode {
  kind: 'child' | 'cnx'
  label: string
  table: string
  count: number
  via: string // how it links back, in words: "via Assigned To"
  field?: ColumnDef // child: the Sub-table column on the center's meta
  cnx?: Connection
}

const NODE_H = 46
// A box whose relationship needs a second line grows every box to this height.
const NODE_H_TWO_LINES = 60
// Characters of 12px text that fit one line of a link box and a collection box.
const FORWARD_CHARS = 29
const GROUP_CHARS = 33
const GAP = 16
const W = 900

const groupId = (g: GroupNode) => (g.cnx ? groupKey(g.cnx) : `child|${g.field?.column_name ?? ''}`)

export function RowMap({ table, name }: { table: string; name: string }) {
  const meta = useMeta(table)
  const nav = useNavigation()
  const cnx = useConnections(table, name)
  // A collection names its link as the Table holding the link labels it.
  const holders = [...new Set((cnx.data?.connections ?? []).map((c) => c.via ?? c.table))]
  const holderMetas = useQueries({ queries: holders.map((t) => metaQuery(t)) })
  const centre = useRowName(table, name)
  // Option C of the Explore entry-point exploration: hand this row's
  // neighbourhood to the cross-filter Explore (the shared explore-steps seam):
  // two hops, with pane 1 narrowed to the row being viewed.
  const hop1 = useStepOptions(table)
  const hop2 = useStepOptions(hop1.options[0]?.step.table)
  const exploreChain = hop1.options.length
    ? [hop1.options[0].step, ...(hop2.options.length ? [hop2.options[0].step] : [])]
    : []
  const doc = useQuery({
    queryKey: ['doc', table, name],
    queryFn: () =>
      api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`),
  })

  if (meta.isLoading || doc.isLoading)
    return <p className="text-sm text-ink-subtle">Loading…</p>
  if (meta.isError || doc.isError)
    return <p className="text-sm text-negative">Cannot load {table} {name}</p>

  const m = meta.data!
  const d = doc.data!
  const centreTitle = centre.state === 'read' ? centre.title : rowNameText(centre, name)

  const forward: ForwardNode[] = []
  if (m.kind === 'sub_table' && typeof d.parenttype === 'string' && typeof d.parent === 'string')
    forward.push({ label: 'parent', table: d.parenttype, row_id: d.parent })
  for (const f of m.columns)
    if (f.column_type === 'Reference' && f.reference_table && d[f.column_name])
      forward.push({
        label: linkWords(f),
        table: f.reference_table,
        row_id: String(d[f.column_name]),
      })

  const groups: GroupNode[] = []
  for (const f of m.columns)
    if (f.column_type === 'Sub-table' && f.row_table)
      groups.push({
        kind: 'child',
        label: f.label ?? f.column_name,
        table: f.row_table,
        count: ((d[f.column_name] as Row[]) ?? []).length,
        via: 'child rows',
        field: f,
      })
  for (const c of cnx.data?.connections ?? [])
    groups.push({
      // The Table it comes from; the link that joins it reads in words below.
      kind: 'cnx', label: c.table, table: c.table, count: c.count, cnx: c,
      via: `via ${linkWords(
        holderMetas[holders.indexOf(c.via ?? c.table)]?.data?.columns.find((col) => col.column_name === c.column)
          ?? { column_name: c.column },
      )}`,
    })

  const rows = Math.max(forward.length, groups.length, 1)
  const forwardLines = forward.map((f) => wrapText(linkAndTable(f), FORWARD_CHARS))
  const groupLines = groups.map((g) => wrapText(g.via, GROUP_CHARS))
  const nodeH = [...forwardLines, ...groupLines].some((l) => l.length > 1) ? NODE_H_TWO_LINES : NODE_H
  const H = rows * (nodeH + GAP) + 40
  const cy = H / 2 - nodeH / 2
  const nodeY = (i: number) => 20 + i * (nodeH + GAP)

  const step = nav?.step
  const chosen = step?.pane?.table === table && step.pane.row === name && step.pane.group ? groupKey(step.pane.group) : undefined
  function openRow(f: ForwardNode) {
    if (nav) nav.push({ ...nav.step, pane: { table: f.table, row: f.row_id } })
  }
  // A collection opens on the centre row in the pane; child rows have no
  // group there, so the centre row's own fields show.
  function openGroup(g: GroupNode) {
    if (!nav) return
    nav.push({ ...nav.step, pane: g.cnx
      ? { table, row: name, group: { table: g.cnx.table, column: g.cnx.column, via: g.cnx.via } }
      : { table, row: name } })
  }

  return (
    <div data-testid="relation-map" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/featherbase/admin/explore"
          search={{
            root: table,
            chain: exploreChain.length ? JSON.stringify(exploreChain) : undefined,
            select: JSON.stringify([name]),
          }}
          data-testid="map-open-explore"
          className={buttonClasses()}
        >
          Open in Explore
        </Link>
      </div>
      <div className={cardClasses('p-2')}>
        <div className="space-y-3 xl:hidden" data-testid="map-narrow">
          <div className="break-words rounded-control border border-action bg-action-tint px-3 py-2 text-sm">
            <div className="font-semibold text-ink">{centreTitle}</div>
            <div className="text-xs text-ink-muted">{table}</div>
          </div>
          {forward.length > 0 && (
            <section aria-label="Links from this row" className="space-y-2">
              <h2 className="text-xs font-semibold text-ink-muted">Links from this row</h2>
              {forward.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => openRow(f)}
                  data-testid={`map-narrow-forward-${f.table}`}
                  className={buttonClasses({ className: 'w-full justify-start whitespace-normal break-words py-2 text-left' })}
                >
                  <span className="min-w-0">
                    <RowName table={f.table} rowId={f.row_id} />
                    <span className="block text-xs text-ink-muted">{linkAndTable(f)}</span>
                  </span>
                </button>
              ))}
            </section>
          )}
          {groups.length > 0 && (
            <section aria-label="Related rows" className="space-y-2">
              <h2 className="text-xs font-semibold text-ink-muted">Related rows</h2>
              {groups.map((g, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => openGroup(g)}
                  aria-pressed={chosen === groupId(g)}
                  data-testid={`map-narrow-group-${g.table}`}
                  className={buttonClasses({ className: 'w-full justify-between whitespace-normal break-words py-2 text-left' })}
                >
                  <span className="min-w-0">
                    <span className="block">{g.label}</span>
                    <span className="block text-xs text-ink-muted">{g.via}</span>
                  </span>
                  <span className="shrink-0 text-action">{fmtCount(g.count)}</span>
                </button>
              ))}
            </section>
          )}
          {!forward.length && !groups.length && <p className="text-sm text-ink-muted">No related rows</p>}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="hidden h-auto w-full xl:block"
          role="img"
          aria-label={`Relationship map for ${centreTitle}`}
          data-testid="map-svg"
        >
          {/* edges */}
          {forward.map((f, i) => (
            <g key={`fe-${i}`}>
              <line
                x1={260}
                y1={nodeY(i) + nodeH / 2}
                x2={340}
                y2={cy + nodeH / 2}
                stroke="var(--color-border-control)"
                strokeWidth={1.2}
              />
            </g>
          ))}
          {groups.map((g, i) => (
            <g key={`ge-${i}`}>
              <line
                x1={560}
                y1={cy + nodeH / 2}
                x2={620}
                y2={nodeY(i) + nodeH / 2}
                stroke="var(--color-border-control)"
                strokeWidth={1.2}
              />
            </g>
          ))}
          {/* center */}
          <g data-testid="map-center">
            <rect
              x={340}
              y={cy}
              width={220}
              height={nodeH}
              rx={8}
              fill="var(--color-action-tint)"
              stroke="var(--color-action)"
              strokeWidth={1.5}
            />
            <text x={352} y={cy + 20} fontSize={12.5} fontWeight={600} fill="var(--color-ink)">
              {truncate(centreTitle, 28)}
            </text>
            <text x={352} y={cy + 35} fontSize={12} fill="var(--color-ink-muted)">
              {truncate(table, 30)}
            </text>
          </g>
          {/* forward reference nodes */}
          {forward.map((f, i) => (
            <g
              key={`fn-${i}`}
              onClick={() => openRow(f)}
              className="cursor-pointer"
              data-testid={`map-forward-${f.table}`}
            >
              <title>{linkAndTable(f)}</title>
              <rect
                x={40}
                y={nodeY(i)}
                width={220}
                height={nodeH}
                rx={8}
                fill="var(--color-surface)"
                stroke="var(--color-border-control)"
                className="hover:stroke-action"
              />
              <text x={52} y={nodeY(i) + 20} fontSize={12.5} fontWeight={600} fill="var(--color-ink)">
                <SvgRowTitle table={f.table} rowId={f.row_id} max={30} />
              </text>
              {/* the relationship is named in the box, not on the line, so the line never crosses it */}
              <BoxLines x={52} y={nodeY(i) + 35} lines={forwardLines[i]} />
            </g>
          ))}
          {/* backlink / child collection nodes */}
          {groups.map((g, i) => (
            <g
              key={`gn-${i}`}
              onClick={() => openGroup(g)}
              className="cursor-pointer"
              data-testid={`map-group-${g.table}`}
            >
              <title>{`${g.label}, ${g.via}`}</title>
              <rect
                x={620}
                y={nodeY(i)}
                width={240}
                height={nodeH}
                rx={8}
                fill="var(--color-surface)"
                stroke={chosen === groupId(g) ? 'var(--color-action)' : 'var(--color-border-control)'}
                strokeWidth={chosen === groupId(g) ? 1.5 : 1}
                strokeDasharray="3 3"
              />
              <text
                x={632}
                y={nodeY(i) + 20}
                fontSize={12.5}
                fontWeight={600}
                fill={g.count ? 'var(--color-ink)' : 'var(--color-ink-subtle)'}
              >
                {truncate(g.label, 26)}
              </text>
              <BoxLines x={632} y={nodeY(i) + 35} lines={groupLines[i]} />
              <text
                x={848}
                y={nodeY(i) + 21}
                textAnchor="end"
                fontSize={12}
                fontWeight={700}
                fill="var(--color-action)"
              >
                {fmtCount(g.count)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
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

/** What a linked row's box says beneath its title: "<link> · <Table>", or the Table alone when they match. */
function linkAndTable(f: ForwardNode): string {
  return f.label === f.table ? f.table : `${f.label} · ${f.table}`
}

/** Words split into at most `max` lines of about `n` characters; the last line ends in … if more is left. */
function wrapText(text: string, n: number, max = 2): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > n) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  if (lines.length <= max) return lines.map((l) => truncate(l, n))
  return [...lines.slice(0, max - 1), truncate(lines.slice(max - 1).join(' '), n)]
}

/** A box's relationship lines inside SVG, one under the other. */
function BoxLines({ x, y, lines }: { x: number; y: number; lines: string[] }) {
  return (
    <text x={x} y={y} fontSize={12} fill="var(--color-ink-muted)">
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i ? 14 : 0}>{l}</tspan>
      ))}
    </text>
  )
}

/** A linked row's name inside SVG text: never its id (#907), and never the
 *  name of a row the viewer cannot read. */
function SvgRowTitle({ table, rowId, max }: { table: string; rowId: string; max: number }) {
  const name = useRowName(table, rowId)
  return <>{truncate(name.state === 'read' ? name.title : name.state === 'unreadable' ? 'Not visible to you' : '…', max)}</>
}

