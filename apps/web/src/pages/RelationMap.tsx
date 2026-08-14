import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, listColumns, useMeta, type ColumnDef } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { connectionLabel, useConnections, type Connection } from '../lib/connections'
import { useStepOptions } from '../lib/explore-steps'

type Row = Record<string, unknown>

// Relational navigation (#100, pattern 6): the row's neighborhood as a
// walkable graph. What the row points AT fans left (forward references,
// plus the owning parent for sub-table rows); what points AT IT fans right
// (child tables and backlink collections, dashed, with counts). Clicking a
// collection opens its rows below; clicking any record re-centers the map.
// Because everything derives from Table metadata, every table gets this
// view for free — it is the schema made walkable.

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
  field?: ColumnDef // child: the Sub-table column on the center's meta
  cnx?: Connection
}

const NODE_H = 46
const GAP = 16
const W = 900

export function RelationMap({
  doctype,
  name,
  trail,
}: {
  doctype: string
  name: string
  trail?: string
}) {
  const meta = useMeta(doctype)
  const cnx = useConnections(doctype, name)
  const settings = useSettings()
  const navigate = useNavigate()
  const [openGroup, setOpenGroup] = useState<number | null>(null)
  // Option C of the Explore entry-point exploration: hand this row's
  // neighborhood to the cross-filter Explore. The chain is the first step of
  // the SAME option list Explore's pickers offer (the shared explore-steps
  // seam), then the first step out of THAT table — two hops, because pane 3
  // chains off pane 2's table, so a second sibling of the root could never
  // resolve. `select` narrows pane 1 to the row being viewed.
  const hop1 = useStepOptions(doctype)
  const hop2 = useStepOptions(hop1.options[0]?.step.table)
  const exploreChain = hop1.options.length
    ? [hop1.options[0].step, ...(hop2.options.length ? [hop2.options[0].step] : [])]
    : []
  const doc = useQuery({
    queryKey: ['doc', doctype, name],
    queryFn: () =>
      api.get<Row>(`/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })

  if (meta.isLoading || doc.isLoading)
    return <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>
  if (meta.isError || doc.isError)
    return <p className="text-sm text-[var(--color-danger)]">Cannot load {doctype} {name}</p>

  const m = meta.data!
  const d = doc.data!

  const parsedTrail = parseTrail(trail)

  const forward: ForwardNode[] = []
  if (m.kind === 'sub_table' && typeof d.parenttype === 'string' && typeof d.parent === 'string')
    forward.push({ label: 'parent', table: d.parenttype, row_id: d.parent })
  for (const f of m.columns)
    if (f.column_type === 'Reference' && f.reference_table && d[f.column_name])
      forward.push({
        label: f.label ?? f.column_name,
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
        field: f,
      })
  for (const c of cnx.data?.connections ?? [])
    groups.push({ kind: 'cnx', label: connectionLabel(c), table: c.table, count: c.count, cnx: c })

  const rows = Math.max(forward.length, groups.length, 1)
  const H = rows * (NODE_H + GAP) + 40
  const cy = H / 2 - NODE_H / 2
  const nodeY = (i: number) => 20 + i * (NODE_H + GAP)

  function hop(table: string, rowName: string) {
    const nextTrail = [...parsedTrail, [doctype, name] as [string, string]].slice(-8)
    setOpenGroup(null)
    navigate({
      to: '/admin/map/$doctype/$name',
      params: { doctype: table, name: rowName },
      search: { trail: JSON.stringify(nextTrail) },
    })
  }
  function backTo(i: number) {
    const [t, n] = parsedTrail[i]
    navigate({
      to: '/admin/map/$doctype/$name',
      params: { doctype: t, name: n },
      search: {
        trail: parsedTrail.length > 1 ? JSON.stringify(parsedTrail.slice(0, i)) : undefined,
      },
    })
  }

  const active = openGroup != null ? groups[openGroup] : null

  return (
    <div data-testid="relation-map">
      <div className="mb-1 text-xs text-[var(--color-ink-faint)]">
        <Link to="/admin" className="hover:text-[var(--color-ink)]">Home</Link>
        {' / '}
        <Link
          to="/admin/$doctype"
          params={{ doctype }}
          search={{ filters: undefined }}
          className="hover:text-[var(--color-ink)]"
        >
          {doctype}
        </Link>
        {' / '}
        Map
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-[var(--color-ink)]">
          {String(d[m.title_column ?? ''] ?? name)}
        </h1>
        <span className="text-xs text-[var(--color-ink-faint)]">{doctype} · {name}</span>
        <Link
          to="/admin/$doctype/$name"
          params={{ doctype, name }}
          search={{ prefill: undefined }}
          data-testid="map-open-form"
          className="fc-btn"
        >
          Open form ↗
        </Link>
        <Link
          to="/admin/explore"
          search={{
            root: doctype,
            chain: exploreChain.length ? JSON.stringify(exploreChain) : undefined,
            select: JSON.stringify([name]),
          }}
          data-testid="map-open-explore"
          className="fc-btn"
        >
          Open in Explore
        </Link>
      </div>
      {parsedTrail.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs" data-testid="map-trail">
          <span className="text-[var(--color-ink-faint)]">Trail:</span>
          {parsedTrail.map(([t, n], i) => (
            <span key={`${t}:${n}:${i}`} className="flex items-center gap-1.5">
              <button
                onClick={() => backTo(i)}
                className="text-[var(--color-brand)] hover:underline"
                data-testid={`map-trail-${i}`}
              >
                {n}
              </button>
              <span className="text-[var(--color-ink-faint)]">›</span>
            </span>
          ))}
          <span className="font-medium text-[var(--color-ink)]">{name}</span>
        </div>
      )}
      <div className="fc-card overflow-x-auto p-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full min-w-[700px]"
          role="img"
          aria-label={`Relationship map for ${doctype} ${name}`}
          data-testid="map-svg"
        >
          {/* edges */}
          {forward.map((f, i) => (
            <g key={`fe-${i}`}>
              <line
                x1={215}
                y1={nodeY(i) + NODE_H / 2}
                x2={340}
                y2={cy + NODE_H / 2}
                stroke="var(--color-border-strong)"
                strokeWidth={1.2}
              />
              <text
                x={277}
                y={(nodeY(i) + NODE_H / 2 + cy + NODE_H / 2) / 2 - 6}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--color-ink-faint)"
              >
                {truncate(f.label, 18)} →
              </text>
            </g>
          ))}
          {groups.map((g, i) => (
            <g key={`ge-${i}`}>
              <line
                x1={560}
                y1={cy + NODE_H / 2}
                x2={660}
                y2={nodeY(i) + NODE_H / 2}
                stroke="var(--color-border-strong)"
                strokeWidth={1.2}
              />
              <text
                x={608}
                y={(nodeY(i) + NODE_H / 2 + cy + NODE_H / 2) / 2 - 6}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--color-ink-faint)"
              >
                {g.kind === 'child' ? 'contains →' : `← ${truncate(g.cnx?.column ?? '', 14)}`}
              </text>
            </g>
          ))}
          {/* center */}
          <g data-testid="map-center">
            <rect
              x={340}
              y={cy}
              width={220}
              height={NODE_H}
              rx={8}
              fill="var(--color-brand-tint)"
              stroke="var(--color-brand)"
              strokeWidth={1.5}
            />
            <text x={352} y={cy + 20} fontSize={12.5} fontWeight={600} fill="var(--color-ink)">
              {truncate(String(d[m.title_column ?? ''] ?? name), 28)}
            </text>
            <text x={352} y={cy + 35} fontSize={10.5} fill="var(--color-ink-muted)">
              {truncate(doctype, 30)}
            </text>
          </g>
          {/* forward reference nodes */}
          {forward.map((f, i) => (
            <g
              key={`fn-${i}`}
              onClick={() => hop(f.table, f.row_id)}
              className="cursor-pointer"
              data-testid={`map-forward-${f.table}`}
            >
              <rect
                x={40}
                y={nodeY(i)}
                width={175}
                height={NODE_H}
                rx={8}
                fill="var(--color-surface)"
                stroke="var(--color-border-strong)"
                className="hover:stroke-[var(--color-brand)]"
              />
              <text x={52} y={nodeY(i) + 20} fontSize={12.5} fontWeight={600} fill="var(--color-ink)">
                {truncate(f.row_id, 20)}
              </text>
              <text x={52} y={nodeY(i) + 35} fontSize={10.5} fill="var(--color-ink-muted)">
                {truncate(f.table, 24)}
              </text>
            </g>
          ))}
          {/* backlink / child collection nodes */}
          {groups.map((g, i) => (
            <g
              key={`gn-${i}`}
              onClick={() => setOpenGroup(openGroup === i ? null : i)}
              className="cursor-pointer"
              data-testid={`map-group-${g.table}`}
            >
              <rect
                x={660}
                y={nodeY(i)}
                width={200}
                height={NODE_H}
                rx={8}
                fill="var(--color-surface)"
                stroke={openGroup === i ? 'var(--color-brand)' : 'var(--color-border-strong)'}
                strokeWidth={openGroup === i ? 1.5 : 1}
                strokeDasharray="3 3"
              />
              <text
                x={672}
                y={nodeY(i) + 20}
                fontSize={12.5}
                fontWeight={600}
                fill={g.count ? 'var(--color-ink)' : 'var(--color-ink-faint)'}
              >
                {truncate(g.label, 20)}
              </text>
              <text x={672} y={nodeY(i) + 35} fontSize={10.5} fill="var(--color-ink-muted)">
                {g.kind === 'child' ? 'child rows' : 'backlink'}
              </text>
              <text
                x={848}
                y={nodeY(i) + 21}
                textAnchor="end"
                fontSize={11}
                fontWeight={700}
                fill="var(--color-brand)"
              >
                {g.count}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {active && (
        <div className="fc-card mt-3 overflow-x-auto" data-testid="map-group-rows">
          <div className="border-b border-[var(--color-border)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            {active.label} — click a row to re-center the map
          </div>
          {active.kind === 'child' ? (
            <ChildRows
              field={active.field!}
              rows={(d[active.field!.column_name] as Row[]) ?? []}
              onPick={(n) => hop(active.table, n)}
            />
          ) : (
            <GroupRows connection={active.cnx!} onPick={(n) => hop(active.table, n)} />
          )}
        </div>
      )}
    </div>
  )
}

function parseTrail(raw: string | undefined): [string, string][] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (
      Array.isArray(value) &&
      value.every(
        (e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string',
      )
    )
      return value as [string, string][]
  } catch {
    /* invalid trail is just no trail */
  }
  return []
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function ChildRows({
  field,
  rows,
  onPick,
}: {
  field: ColumnDef
  rows: Row[]
  onPick: (name: string) => void
}) {
  const childMeta = useMeta(field.row_table ?? '')
  const settings = useSettings()
  if (!childMeta.data) return null
  const cols = childMeta.data.columns
    .filter((f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden)
    .slice(0, 5)
  return (
    <SimpleRowsTable
      cols={cols.map((c) => ({ column_name: c.column_name, label: c.label ?? c.column_name, column_type: c.column_type }))}
      rows={rows}
      settings={settings}
      onPick={onPick}
    />
  )
}

function GroupRows({
  connection,
  onPick,
}: {
  connection: Connection
  onPick: (name: string) => void
}) {
  const meta = useMeta(connection.table)
  const settings = useSettings()
  const columns = meta.data ? listColumns(meta.data) : []
  const list = useQuery({
    queryKey: ['map-group', connection.table, JSON.stringify(connection.filters)],
    enabled: columns.length > 0,
    queryFn: () =>
      listResource(connection.table, {
        filters: connection.filters,
        fields: columns.map((c) => c.column_name),
        limit_page_length: 10,
      }),
  })
  if (!list.data) return <p className="px-4 py-3 text-sm text-[var(--color-ink-faint)]">Loading…</p>
  return (
    <>
      <SimpleRowsTable cols={columns} rows={list.data.data} settings={settings} onPick={onPick} />
      {list.data.total > list.data.data.length && (
        <p className="px-4 py-2 text-xs text-[var(--color-ink-faint)]">
          Showing {list.data.data.length} of {list.data.total}
        </p>
      )}
    </>
  )
}

function SimpleRowsTable({
  cols,
  rows,
  settings,
  onPick,
}: {
  cols: { column_name: string; label: string; column_type: string }[]
  rows: Row[]
  settings: ReturnType<typeof useSettings>
  onPick: (name: string) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-[var(--color-subtle)]">
        <tr>
          {cols.map((c) => (
            <th
              key={c.column_name}
              className="border-b border-[var(--color-border)] px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]"
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={String(r.row_id ?? i)}
            onClick={() => r.row_id && onPick(String(r.row_id))}
            data-testid="map-row"
            className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-subtle)]"
          >
            {cols.map((c, j) => (
              <td
                key={c.column_name}
                className={`px-4 py-1.5 ${j === 0 ? 'font-medium text-[var(--color-brand)]' : ''}`}
              >
                {formatValue(c.column_type, r[c.column_name], settings) || '—'}
              </td>
            ))}
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td colSpan={cols.length} className="px-4 py-5 text-center text-sm text-[var(--color-ink-faint)]">
              No rows
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
