import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listResource } from '../lib/api'
import { listColumns, useMeta, type TableMeta } from '../lib/meta'
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
// A chain step is either a direct backlink (Supplier ← Purchase Order via
// its `supplier` column) or a child sub-table (Purchase Order ▸ PO Line).
// Via-sub-table backlinks are deliberately not offered as steps — their
// filter is per-row, not per-column, so they don't compose into a pane
// chain without a server join surface this deliberately thin page avoids.

interface Step {
  mode: 'backlink' | 'child'
  table: string
  // backlink: the Reference column on `table` pointing at the upstream table
  // child: unused (linkage is parent/parenttype)
  column: string
}

const PANE_LIMIT = 100

export function ExploreView({
  root,
  onRootChange,
}: {
  root: string | undefined
  onRootChange: (root: string) => void
}) {
  // Every non-sub, non-settings table is a candidate root.
  const tables = useQuery({
    queryKey: ['explore-tables'],
    queryFn: () =>
      listResource<{ name: string }>('Table', {
        filters: [['kind', '=', 'table']],
        fields: ['name'],
        order_by: 'name asc',
        limit_page_length: 500,
      }),
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

  return (
    <div data-testid="explore-view">
      <div className="mb-1 text-xs text-[var(--color-ink-faint)]">Explore</div>
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">Cross-filter workspace</h1>
      <p className="mb-4 mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
        Chain tables along their references, then click rows — each selection filters every pane
        downstream. Click a selected row again to release it.
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
            {(tables.data?.data ?? []).map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
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
            { label: root, names: sel1, clear: (n) => setSel1(toggle(sel1, n)) },
            { label: step2?.table ?? '', names: sel2, clear: (n) => setSel2(toggle(sel2, n)) },
          ]}
        />
      )}
      <div className="grid items-start gap-3 lg:grid-cols-3">
        {root && (
          <Pane
            table={root}
            filters={[]}
            selected={sel1}
            onToggle={(n) => {
              setSel1(toggle(sel1, n))
              setSel2(new Set())
            }}
            testid="explore-pane1"
          />
        )}
        {root && step2 && (
          <ChainedPane
            step={step2}
            upstreamTable={root}
            upstreamSelection={sel1}
            selected={sel2}
            onToggle={(n) => setSel2(toggle(sel2, n))}
            testid="explore-pane2"
          />
        )}
        {root && step2 && step3 && (
          <ChainedPane
            step={step3}
            upstreamTable={step2.table}
            upstreamSelection={sel2}
            upstreamStep={step2}
            upstreamUpstreamTable={root}
            upstreamUpstreamSelection={sel1}
            selected={new Set()}
            onToggle={() => {}}
            testid="explore-pane3"
          />
        )}
      </div>
      {!root && (
        <p className="mt-6 text-sm text-[var(--color-ink-faint)]" data-testid="explore-empty">
          Pick a starting table to build a chain — e.g. Supplier → Purchase Order → PO Line.
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

// The chain-step dropdown for one pane: the upstream table's children and
// direct backlinks, encoded as "mode:table:column".
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
        key: `child:${f.row_table}:`,
        label: `${f.row_table} (rows)`,
        step: { mode: 'child', table: f.row_table, column: '' },
      })
  for (const bl of backlinks.data?.backlinks ?? [])
    if (!bl.via)
      options.push({
        key: `backlink:${bl.table}:${bl.column}`,
        label: `${bl.table} · ${bl.column}`,
        step: { mode: 'backlink', table: bl.table, column: bl.column },
      })
  const current = value ? `${value.mode}:${value.table}:${value.column}` : ''
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        {label}
      </span>
      <select
        value={current}
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
          No selection — click rows to filter downstream panes.
        </span>
      )}
    </div>
  )
}

// Builds the filter a chained pane needs from its upstream pane's state.
// Upstream selection wins; with none, the pane follows the upstream pane's
// own (possibly filtered) row set, fetched here as names only.
function useChainFilters(
  step: Step,
  upstreamTable: string,
  upstreamSelection: Set<string>,
  upstreamFilters: Filter[],
): { filters: Filter[]; ready: boolean } {
  const needNames = upstreamSelection.size === 0
  const names = useQuery({
    queryKey: ['explore-names', upstreamTable, JSON.stringify(upstreamFilters)],
    enabled: needNames,
    queryFn: () =>
      listResource<{ name: string }>(upstreamTable, {
        filters: upstreamFilters,
        fields: ['name'],
        limit_page_length: PANE_LIMIT,
      }),
  })
  const upstream = upstreamSelection.size
    ? [...upstreamSelection]
    : (names.data?.data ?? []).map((r) => r.name)
  const ready = !needNames || Boolean(names.data)
  const filters: Filter[] =
    step.mode === 'child'
      ? [
          ['parenttype', '=', upstreamTable],
          ['parent', 'in', upstream],
        ]
      : [[step.column, 'in', upstream]]
  return { filters, ready }
}

function ChainedPane(props: {
  step: Step
  upstreamTable: string
  upstreamSelection: Set<string>
  upstreamStep?: Step
  upstreamUpstreamTable?: string
  upstreamUpstreamSelection?: Set<string>
  selected: Set<string>
  onToggle: (name: string) => void
  testid: string
}) {
  // Rebuild the upstream pane's own filters (pane 3 needs pane 2's).
  const grandParent = useChainFilters(
    props.upstreamStep ?? { mode: 'backlink', table: '', column: 'name' },
    props.upstreamUpstreamTable ?? '',
    props.upstreamUpstreamSelection ?? new Set(),
    [],
  )
  const upstreamFilters = props.upstreamStep && props.upstreamUpstreamTable ? grandParent.filters : []
  const chain = useChainFilters(
    props.step,
    props.upstreamTable,
    props.upstreamSelection,
    upstreamFilters,
  )
  if (!chain.ready) return <div className="fc-card p-4 text-sm text-[var(--color-ink-faint)]">Loading…</div>
  return (
    <Pane
      table={props.step.table}
      filters={chain.filters}
      selected={props.selected}
      onToggle={props.onToggle}
      testid={props.testid}
    />
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
  const list = useQuery({
    queryKey: ['explore-pane', table, JSON.stringify(filters), columns.map((c) => c.column_name)],
    enabled: columns.length > 0,
    queryFn: () =>
      listResource(table, {
        filters,
        fields: columns.map((c) => c.column_name),
        limit_page_length: PANE_LIMIT,
      }),
  })
  if (meta.isLoading || list.isLoading)
    return <div className="fc-card p-4 text-sm text-[var(--color-ink-faint)]">Loading…</div>
  if (meta.isError || list.isError)
    return <div className="fc-card p-4 text-sm text-[var(--color-danger)]">Cannot load {table}</div>

  const rows = list.data!.data
  const total = list.data!.total
  // Headline: hash-named tables (sub-tables, mostly) lead with their first
  // real column instead of an opaque row id.
  const displayColumns =
    meta.data!.id_pattern === 'hash' && columns.length > 1 ? columns.slice(1) : columns
  // Σ prefers money over measures: Currency, then Float, then Int.
  const numericCol = ['Currency', 'Float', 'Int']
    .map((t) => displayColumns.find((c) => c.column_type === t))
    .find(Boolean)
  const sum = numericCol
    ? rows.reduce((s, r) => s + (Number(r[numericCol.column_name]) || 0), 0)
    : null

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
            key={String(r.name)}
            row={r}
            columns={displayColumns}
            settings={settings}
            selected={selected.has(String(r.name))}
            onToggle={() => onToggle(String(r.name))}
            onPeek={
              peek.available
                ? () => peek.push({ kind: 'record', table, name: String(r.name) })
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
          {rows.length} row{rows.length === 1 ? '' : 's'}
          {rows.length < total ? ` shown of ${total}` : ''}
        </span>
        {sum != null && numericCol && (
          <span data-testid={`${testid}-sum`}>
            Σ {numericCol.label}: {formatValue(numericCol.column_type, sum, settings)}
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
          {formatValue(first.column_type, row[first.column_name], settings) || String(row.name)}
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
