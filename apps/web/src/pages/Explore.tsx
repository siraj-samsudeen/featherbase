import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, listResource } from '../lib/api'
import { listColumns, useMeta } from '../lib/meta'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { useBacklinks } from '../lib/connections'
import { usePeek } from '../components/Peek'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]

// Relational navigation (#100, pattern 4): Tableau's filter actions with
// Miller-column geometry. Three live panes chained over reference links —
// clicking rows IS the filter: everything downstream narrows instantly,
// counts and sums included. Selections accumulate; chips release them.
//
// NAV-002: the join between panes is SERVER-SIDE — each pane's filter is a
// 'related' relationship filter the list engine compiles to permission-
// scoped subqueries. No name shuttling, no 100-row ceiling, and Σ/count
// come from :aggregate over the full filtered set, so panes are exact at
// any scale. That also makes via-sub-table hops ("Purchase Orders · via
// PO Line" from an Item root) real chain steps.

interface Step {
  mode: 'backlink' | 'child' | 'viabacklink'
  table: string
  // backlink: the Reference column on `table` pointing at the upstream table
  // viabacklink: the Reference column on `via` pointing at the upstream table
  // child: the upstream table's Sub-table COLUMN — one row table can back
  //   several Sub-table columns, and the step must name which one (#106
  //   review), both to disambiguate the picker and to filter parentfield
  column: string
  via?: string
}

const PANE_LIMIT = 100

// The filter a chained pane sends: an explicit selection filters by names;
// otherwise the pane follows the upstream pane's ENTIRE filtered set via a
// relationship filter evaluated in the database.
function chainFilters(
  step: Step,
  upstreamTable: string,
  upstreamSelection: Set<string>,
  upstreamFilters: Filter[],
): Filter[] {
  if (upstreamSelection.size) {
    const names = [...upstreamSelection]
    if (step.mode === 'child')
      return [
        ['parenttype', '=', upstreamTable],
        ['parentfield', '=', step.column],
        ['parent', 'in', names],
      ]
    if (step.mode === 'viabacklink')
      return [
        [
          'row_id',
          'related',
          { via: step.via, column: step.column, table: upstreamTable, filters: [['row_id', 'in', names]] },
        ],
      ]
    return [[step.column, 'in', names]]
  }
  const spec = { table: upstreamTable, filters: upstreamFilters }
  if (step.mode === 'child')
    return [
      ['parenttype', '=', upstreamTable],
      ['parentfield', '=', step.column],
      ['parent', 'related', spec],
    ]
  if (step.mode === 'viabacklink')
    return [['row_id', 'related', { via: step.via, column: step.column, ...spec }]]
  return [[step.column, 'related', spec]]
}

export function ExploreView({
  root,
  onRootChange,
}: {
  root: string | undefined
  onRootChange: (root: string) => void
}) {
  // Candidate roots come from the permission-filtered navigation endpoint —
  // NOT from reading the metadata `Table` table, which most roles cannot
  // read (and which would list tables the caller can't open). #102 review.
  const tables = useQuery({
    queryKey: ['navigable-tables'],
    queryFn: () => api.get<{ tables: string[] }>('/api/navigable_tables'),
  })

  const [step2, setStep2] = useState<Step | null>(null)
  const [step3, setStep3] = useState<Step | null>(null)
  const [sel1, setSel1] = useState<Set<string>>(new Set())
  const [sel2, setSel2] = useState<Set<string>>(new Set())

  function changeRoot(next: string) {
    setStep2(null)
    setStep3(null)
    setSel1(new Set())
    setSel2(new Set())
    onRootChange(next)
  }
  function changeStep2(s: Step | null) {
    setStep2(s)
    setStep3(null)
    setSel2(new Set())
  }

  const pane1Filters: Filter[] = []
  const pane2Filters = root && step2 ? chainFilters(step2, root, sel1, pane1Filters) : null
  const pane3Filters =
    step2 && step3 && pane2Filters ? chainFilters(step3, step2.table, sel2, pane2Filters) : null

  return (
    <div data-testid="explore-view">
      <div className="mb-1 text-xs text-[var(--color-ink-faint)]">Explore</div>
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">Cross-filter workspace</h1>
      <p className="mb-4 mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
        Chain tables along their references, then click rows — each selection filters every pane
        downstream. With nothing selected, a pane follows the whole upstream set. Click a selected
        row again to release it.
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Start from
          </span>
          <select
            value={root ?? ''}
            onChange={(e) => changeRoot(e.target.value)}
            data-testid="explore-root"
            className="fc-input w-56"
          >
            <option value="">Pick a table…</option>
            {(tables.data?.tables ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {root && (
          <StepPicker
            label="Then"
            table={root}
            value={step2}
            onChange={changeStep2}
            testid="explore-step2"
          />
        )}
        {step2 && (
          <StepPicker
            label="Then"
            table={step2.table}
            value={step3}
            onChange={setStep3}
            testid="explore-step3"
          />
        )}
      </div>
      {root && (
        <Chips
          groups={[
            // Any root-selection change invalidates the pane-2 selection —
            // whether it came from a row click or a chip ✕ (#106 review:
            // a stale sel2 kept driving pane 3 after its row vanished).
            {
              label: root,
              names: sel1,
              clear: (n) => {
                setSel1(toggle(sel1, n))
                setSel2(new Set())
              },
            },
            { label: step2?.table ?? '', names: sel2, clear: (n) => setSel2(toggle(sel2, n)) },
          ]}
        />
      )}
      <div className="grid items-start gap-3 lg:grid-cols-3">
        {root && (
          <Pane
            table={root}
            filters={pane1Filters}
            selected={sel1}
            onToggle={(n) => {
              setSel1(toggle(sel1, n))
              setSel2(new Set())
            }}
            testid="explore-pane1"
          />
        )}
        {step2 && pane2Filters && (
          <Pane
            table={step2.table}
            filters={pane2Filters}
            selected={sel2}
            onToggle={(n) => setSel2(toggle(sel2, n))}
            testid="explore-pane2"
          />
        )}
        {step3 && pane3Filters && (
          <Pane
            table={step3.table}
            filters={pane3Filters}
            selected={new Set<string>()}
            onToggle={() => {}}
            testid="explore-pane3"
          />
        )}
      </div>
      {!root && (
        <p className="mt-6 text-sm text-[var(--color-ink-faint)]" data-testid="explore-empty">
          Pick a starting table to build a chain — e.g. Supplier → Purchase Order → PO Line, or
          Item → Purchase Order · via PO Line.
        </p>
      )}
    </div>
  )
}

function toggle(set: Set<string>, name: string): Set<string> {
  const next = new Set(set)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

// The chain-step dropdown for one pane: the upstream table's children plus
// its backlinks — DIRECT (Reference column on the next table) and VIA a
// sub-table (the next table contains rows pointing here), both served by
// the 'related' filter.
function StepPicker({
  label,
  table,
  value,
  onChange,
  testid,
}: {
  label: string
  table: string
  value: Step | null
  onChange: (s: Step | null) => void
  testid: string
}) {
  const meta = useMeta(table)
  const backlinks = useBacklinks(table)
  const options: { key: string; label: string; step: Step }[] = []
  for (const f of meta.data?.columns ?? [])
    if (f.column_type === 'Sub-table' && f.row_table)
      options.push({
        // Keyed and filtered by the Sub-table COLUMN, not just the row
        // table — two columns backed by the same row table are distinct
        // steps (#106 review).
        key: `child:${f.row_table}:${f.column_name}`,
        label: `${f.row_table} (${f.label ?? f.column_name})`,
        step: { mode: 'child', table: f.row_table, column: f.column_name },
      })
  for (const bl of backlinks.data?.backlinks ?? [])
    options.push(
      bl.via
        ? {
            key: `viabacklink:${bl.table}:${bl.column}:${bl.via}`,
            label: `${bl.table} · via ${bl.via}`,
            step: { mode: 'viabacklink', table: bl.table, column: bl.column, via: bl.via },
          }
        : {
            key: `backlink:${bl.table}:${bl.column}`,
            label: `${bl.table} · ${bl.column}`,
            step: { mode: 'backlink', table: bl.table, column: bl.column },
          },
    )
  const keyOf = (s: Step) => `${s.mode}:${s.table}:${s.column}${s.via ? `:${s.via}` : ''}`
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        {label}
      </span>
      <select
        value={value ? keyOf(value) : ''}
        onChange={(e) => {
          const hit = options.find((o) => o.key === e.target.value)
          onChange(hit ? hit.step : null)
        }}
        data-testid={testid}
        className="fc-input w-56"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Chips({
  groups,
}: {
  groups: { label: string; names: Set<string>; clear: (name: string) => void }[]
}) {
  const any = groups.some((g) => g.names.size)
  return (
    <div className="mb-3 flex min-h-[26px] flex-wrap items-center gap-2" data-testid="explore-chips">
      {any ? (
        groups.flatMap((g) =>
          [...g.names].map((n) => (
            <span
              key={`${g.label}:${n}`}
              className="fc-pill gap-1 bg-[var(--color-brand-tint)] text-[var(--color-brand)]"
              data-testid="explore-chip"
            >
              {g.label}: {n}
              <button
                aria-label={`Release ${n}`}
                onClick={() => g.clear(n)}
                className="hover:opacity-70"
              >
                ×
              </button>
            </span>
          )),
        )
      ) : (
        <span className="text-xs text-[var(--color-ink-faint)]">
          No selection — panes follow the whole upstream set. Click rows to narrow.
        </span>
      )}
    </div>
  )
}

function Pane({
  table,
  filters,
  selected,
  onToggle,
  testid,
}: {
  table: string
  filters: Filter[]
  selected: Set<string>
  onToggle: (name: string) => void
  testid: string
}) {
  const meta = useMeta(table)
  const settings = useSettings()
  const peek = usePeek()
  const columns = useMemo(() => (meta.data ? listColumns(meta.data) : []), [meta.data])
  // Headline: hash-named tables (sub-tables, mostly) lead with their first
  // real column instead of an opaque row id.
  const displayColumns = useMemo(
    () => (meta.data?.id_pattern === 'hash' && columns.length > 1 ? columns.slice(1) : columns),
    [meta.data, columns],
  )
  // Σ prefers money over measures: Currency, then Float, then Int.
  const numericCol = useMemo(
    () =>
      ['Currency', 'Float', 'Int']
        .map((t) => displayColumns.find((c) => c.column_type === t))
        .find(Boolean),
    [displayColumns],
  )
  const filterKey = JSON.stringify(filters)
  const list = useQuery({
    queryKey: ['explore-pane', table, filterKey, columns.map((c) => c.column_name)],
    enabled: columns.length > 0,
    queryFn: () =>
      listResource(table, {
        filters,
        fields: columns.map((c) => c.column_name),
        limit_page_length: PANE_LIMIT,
      }),
  })
  // NAV-002: true totals from the database over the SAME filters — never a
  // sum of whatever page happened to load.
  // `sum` arrives as a string — the server keeps numeric(21,9) exact and
  // leaves formatting (where precision loss is acceptable) to the client.
  const agg = useQuery({
    queryKey: ['explore-agg', table, filterKey, numericCol?.column_name ?? ''],
    enabled: columns.length > 0 && Boolean(numericCol),
    queryFn: () =>
      api.get<{ count: number; sum: string | null }>(
        `/api/table/${encodeURIComponent(table)}:aggregate?filters=${encodeURIComponent(filterKey)}${
          numericCol ? `&sum=${encodeURIComponent(numericCol.column_name)}` : ''
        }`,
      ),
  })
  if (meta.isLoading || list.isLoading)
    return <div className="fc-card p-4 text-sm text-[var(--color-ink-faint)]">Loading…</div>
  if (meta.isError || list.isError)
    return <div className="fc-card p-4 text-sm text-[var(--color-danger)]">Cannot load {table}</div>

  const rows = list.data!.data
  const total = list.data!.total

  return (
    <div className="fc-card overflow-hidden" data-testid={testid}>
      <div className="flex items-baseline gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-sm font-semibold text-[var(--color-ink)]">{table}</span>
        <span className="text-[11px] text-[var(--color-ink-faint)]" data-testid={`${testid}-count`}>
          {rows.length === total ? total : `${rows.length} of ${total}`}
        </span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows.map((r) => (
          <PaneRow
            key={String(r.row_id)}
            row={r}
            columns={displayColumns}
            settings={settings}
            selected={selected.has(String(r.row_id))}
            onToggle={() => onToggle(String(r.row_id))}
            onPeek={
              peek.available
                ? () => peek.push({ kind: 'record', table, name: String(r.row_id) })
                : undefined
            }
          />
        ))}
        {!rows.length && (
          <p className="px-3 py-6 text-center text-sm text-[var(--color-ink-faint)]">No rows</p>
        )}
      </div>
      <div className="flex justify-between border-t border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]">
        <span>
          {total} row{total === 1 ? '' : 's'}
          {rows.length < total ? ` · showing ${rows.length}` : ''}
        </span>
        {numericCol && agg.data?.sum != null && (
          <span data-testid={`${testid}-sum`}>
            Σ {numericCol.label}: {formatValue(numericCol.column_type, Number(agg.data.sum), settings)}
          </span>
        )}
      </div>
    </div>
  )
}

function PaneRow({
  row,
  columns,
  settings,
  selected,
  onToggle,
  onPeek,
}: {
  row: Row
  columns: { column_name: string; label: string; column_type: string }[]
  settings: Settings
  selected: boolean
  onToggle: () => void
  onPeek?: () => void
}) {
  const [first, ...rest] = columns
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      data-testid="explore-row"
      data-selected={selected || undefined}
      className={`group block w-full cursor-pointer border-b border-l-[3px] border-b-[var(--color-border)] px-3 py-1.5 text-left last:border-b-0 ${
        selected
          ? 'border-l-[var(--color-brand)] bg-[var(--color-brand-tint)]'
          : 'border-l-transparent hover:bg-[var(--color-subtle)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-[var(--color-ink)]">
          {formatValue(first.column_type, row[first.column_name], settings) || String(row.row_id)}
        </span>
        {onPeek && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPeek()
            }}
            title="Peek"
            className="invisible text-[var(--color-ink-faint)] hover:text-[var(--color-brand)] group-hover:visible"
          >
            ◎
          </button>
        )}
      </div>
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-x-3 text-xs text-[var(--color-ink-muted)]">
          {rest.slice(0, 3).map((c) => (
            <span key={c.column_name} className="truncate">
              {formatValue(c.column_type, row[c.column_name], settings) || '—'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
