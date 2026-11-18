import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { MAX_RELATED_DEPTH } from 'shared'
import { api, listResource } from '../lib/api'
import { useBacklinks } from '../lib/connections'
import {
  chainDepth, chainFilter, choiceCountQuery, linkDepth, linkFilter, linkKey, linkOptions, parseChain, stepFilters,
  type ChainStep, type Filter, type LinkOption,
} from '../lib/linked-filters'
import { linkRowsTable, metaQuery, tableLabel, useMeta, type TableMeta } from '../lib/meta'
import { groupOrder } from '../lib/relations'
import { LinkedTitle } from '../lib/row-name'
import { NOT_A_LOGIN } from '../lib/not-a-login'
import { searchColumn } from './ListFilters'
import { Button, SearchInput, X, cardClasses, fmtCount, inputClasses } from '@featherbase/shop-floor'

// #1276 (relational navigation, slice 5): Add filter's "Linked to…" and "Not
// linked to…". Pick a Table this list links to, then rows of it; a step may be
// linked on to another Table in turn, which is how Explore's chains are built
// from the list. Each step says how many rows it holds and each row how many
// rows it links to. The filter is one 'related' list filter, so the server
// scopes every step by what the viewer may read.

/** Where the chip and the builder show how many rows a choice links to. */
const CHOICES = 50

/** The Tables a row of `table` can be linked to, named as people read them. */
export function useLinkOptions(table: string | undefined): { options: LinkOption[]; ready: boolean } {
  const meta = useMeta(table ?? '', Boolean(table))
  const backlinks = useBacklinks(table ?? '', Boolean(table))
  const related = useMemo(() => {
    if (!meta.data) return []
    const names = new Set<string>()
    for (const c of meta.data.columns) {
      const to = c.column_type === 'Reference' ? linkRowsTable(c) : c.column_type === 'Sub-table' ? c.row_table : null
      if (to) names.add(to)
    }
    for (const b of backlinks.data?.backlinks ?? []) {
      names.add(b.table)
      if (b.via) names.add(b.via)
    }
    for (const h of backlinks.data?.holders ?? []) names.add(h)
    return [...names]
  }, [meta.data, backlinks.data])
  const metas = useQueries({ queries: related.map((t) => ({ ...metaQuery(t), retry: false })) })
  // The far sides of link Tables and sub-tables are named by their own metadata.
  const second = useMemo(() => {
    const names = new Set<string>()
    for (const m of metas) for (const c of m.data?.columns ?? []) {
      const to = c.column_type === 'Reference' ? linkRowsTable(c) : null
      if (to && !related.includes(to)) names.add(to)
    }
    return [...names]
  }, [metas, related])
  const farMetas = useQueries({ queries: second.map((t) => ({ ...metaQuery(t), retry: false })) })
  const all = [...metas, ...farMetas]
  const pending = all.some((m) => m.isPending && m.fetchStatus !== 'idle')
  const ready = Boolean(meta.data && backlinks.data && !pending)
  const names = [...related, ...second]
  const metaOf = (t: string) => (t === table ? meta.data : all[names.indexOf(t)]?.data)
  const options = ready && meta.data ? linkOptions(meta.data, backlinks.data!.backlinks, metaOf, backlinks.data!.holders) : []
  return { options, ready }
}

type DraftStep = { option: LinkOption | null; picked: string[]; search?: { column: string; text: string } }

const toChain = (steps: DraftStep[]): ChainStep[] => {
  const out: ChainStep[] = []
  for (const s of steps) {
    if (!s.option) break
    const search = s.search?.text.trim() ? { column: s.search.column, text: s.search.text.trim() } : undefined
    out.push({ table: s.option.table, link: s.option.link, picked: s.picked, ...(search ? { search } : {}) })
  }
  return out
}

/**
 * The builder Add filter shows for Linked to… and Not linked to…: one card per
 * step, each with the Table it goes to, how many of its rows match, a search
 * and the rows to pick (with how many rows each links to).
 */
export function LinkedFilterBuilder({ meta, listFilters, negate, onAdd }: {
  meta: TableMeta
  /** The list's other filters: a step's counts are counted within them. */
  listFilters: Filter[]
  negate: boolean
  onAdd: (filter: Filter) => void
}) {
  const [steps, setSteps] = useState<DraftStep[]>([{ option: null, picked: [] }])
  const chain = toChain(steps)
  // A step's new Table makes the steps after it meaningless: they go with it.
  // A new pick keeps them.
  const update = (at: number, next: DraftStep | null) =>
    setSteps((was) => {
      if (!next) return was.slice(0, at)
      const sameTable = was[at]?.option?.key === next.option?.key
      return [...was.slice(0, at), next, ...(sameTable ? was.slice(at + 1) : [])]
    })
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="linked-builder">
      {steps.map((step, i) => {
        const from = i === 0 ? meta.name : steps[i - 1].option!.table
        const before = chainDepth(chain.slice(0, i))
        const last = i === steps.length - 1
        const room = MAX_RELATED_DEPTH - before - (step.option ? linkDepth(step.option.link) : 0)
        return (
          <LinkedStep
            key={`${i}:${from}`}
            at={i}
            negate={negate}
            from={from}
            fromFilters={i === 0 ? listFilters : []}
            room={MAX_RELATED_DEPTH - before}
            step={step}
            next={chain.slice(i + 1)}
            onChange={(next) => update(i, next)}
            onRemove={i > 0 ? () => update(i, null) : undefined}
            onLinkOn={last && step.option && room > 0 ? () => setSteps((was) => [...was, { option: null, picked: [] }]) : undefined}
          />
        )
      })}
      <div>
        <Button
          variant="primary"
          disabled={!chain.length}
          onClick={() => {
            onAdd(chainFilter(chain, negate))
            setSteps([{ option: null, picked: [] }])
          }}
          data-testid="linked-add"
        >
          Add filter
        </Button>
      </div>
    </div>
  )
}

function LinkedStep({ at, negate, from, fromFilters, room, step, next, onChange, onRemove, onLinkOn }: {
  at: number
  negate: boolean
  from: string
  fromFilters: Filter[]
  /** How many related levels this step and the ones after may still use. */
  room: number
  step: DraftStep
  /** The completed steps after this one: they narrow this step's rows. */
  next: ChainStep[]
  onChange: (step: DraftStep) => void
  onRemove?: () => void
  onLinkOn?: () => void
}) {
  const { options, ready } = useLinkOptions(from)
  const fits = options.filter((o) => linkDepth(o.link) <= room)
  const word = at === 0 ? (negate ? 'Not linked to' : 'Linked to') : 'Linked on to'
  return (
    <div className={cardClasses('flex max-w-xl flex-col gap-2 p-3')} data-testid="linked-step">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-ink">
          {word}
          <select
            value={step.option?.key ?? ''}
            onChange={(e) => onChange({ option: fits.find((o) => o.key === e.target.value) ?? null, picked: [] })}
            aria-label={at === 0 ? `${word} which Table` : 'Linked on to which Table'}
            data-testid="linked-table"
            className={inputClasses('max-w-[18rem]')}
          >
            <option value="">{ready ? (fits.length ? 'Choose a Table' : 'No linked Tables') : 'Loading…'}</option>
            {fits.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label="Remove this step" data-testid="linked-step-remove"
            className="ml-auto text-ink-subtle hover:text-ink">
            <X aria-hidden size={16} />
          </button>
        )}
      </div>
      {step.option && (
        <StepRows
          from={from}
          fromFilters={fromFilters}
          option={step.option}
          picked={step.picked}
          search={step.search?.text ?? ''}
          next={next}
          onPick={(picked) => onChange({ ...step, picked })}
          onSearch={(search) => onChange({ ...step, search })}
        />
      )}
      {onLinkOn && (
        <button type="button" onClick={onLinkOn} data-testid="linked-link-on"
          className="self-start text-sm text-action underline-offset-2 hover:underline">
          + Linked on to another Table…
        </button>
      )}
    </div>
  )
}

/** A step's rows: those the steps after it allow, searchable, each with how many
 *  rows of the Table before it link to it. None picked means any of them. */
function StepRows({ from, fromFilters, option, picked, search, next, onPick, onSearch }: {
  from: string
  fromFilters: Filter[]
  option: LinkOption
  picked: string[]
  /** With none picked, the search is part of the filter: the rows it finds. */
  search: string
  next: ChainStep[]
  onPick: (picked: string[]) => void
  onSearch: (search: { column: string; text: string }) => void
}) {
  const meta = useMeta(option.table)
  const column = meta.data ? searchColumn(meta.data) : undefined
  const narrowed: Filter[] = next.length ? [linkFilter(next[0].link, next[0].table, stepFilters(next, 0))] : []
  const filters: Filter[] = [...narrowed, ...(column && search.trim() ? [[column, 'like', `%${search.trim()}%`] as Filter] : [])]
  const rows = useQuery({
    queryKey: ['linked-step-rows', option.table, JSON.stringify(filters)],
    enabled: Boolean(meta.data),
    queryFn: () => listResource<{ row_id: string }>(option.table, {
      filters, fields: ['row_id'], limit_page_length: CHOICES, order_by: meta.data ? groupOrder(meta.data) : undefined,
    }),
  })
  const countSpec = choiceCountQuery(from, fromFilters, option)
  const counts = useQuery({
    queryKey: ['linked-step-counts', JSON.stringify(countSpec)],
    retry: false,
    queryFn: () => api.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', countSpec),
  })
  const countOf = (id: string) => counts.data?.data.find((g) => g.label === id)?.value ?? 0
  const name = tableLabel(option.table, meta.data)
  const total = rows.data?.total
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted" data-testid="linked-step-count">
        <span>{total === undefined ? '…' : `${name}: ${fmtCount(total)} match`}</span>
        <span>· {picked.length ? `${fmtCount(picked.length)} picked`
          : search.trim() ? `none picked: those matching "${search.trim()}"` : 'none picked: any of them'}</span>
      </div>
      {column && (
        <SearchInput
          aria-label={`Search ${name}`}
          placeholder={`Search ${name}`}
          value={search}
          onChange={(e) => onSearch({ column, text: e.target.value })}
          data-testid="linked-search"
          className="w-full"
          {...NOT_A_LOGIN}
        />
      )}
      <div className="max-h-56 overflow-y-auto rounded-control bg-subtle p-1" role="group" aria-label={`Pick ${name}`}>
        {(rows.data?.data ?? []).map((r) => {
          const id = String(r.row_id)
          const on = picked.includes(id)
          return (
            <label key={id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface" data-testid="linked-choice">
              <input type="checkbox" checked={on} className="accent-action"
                onChange={() => onPick(on ? picked.filter((p) => p !== id) : [...picked, id])} />
              <span className="min-w-0 flex-1 truncate"><LinkedTitle table={option.table} rowId={id} /></span>
              {counts.data && <span className="text-xs tabular-nums text-ink-muted" data-testid="linked-choice-count">{fmtCount(countOf(id))}</span>}
            </label>
          )
        })}
        {rows.data && !rows.data.data.length && <p className="px-2 py-1 text-sm text-ink-muted">No rows</p>}
        {rows.data && rows.data.total > rows.data.data.length && (
          <p className="px-2 py-1 text-xs text-ink-muted">Showing {fmtCount(rows.data.data.length)} of {fmtCount(rows.data.total)}: search to narrow</p>
        )}
      </div>
    </div>
  )
}

/** A Linked to chain as its chip reads: "Linked to Accident (2) › linked to
 *  Vehicle: Truck 1 (1)", each step with how many of its rows the viewer may
 *  read match. */
export function LinkedFilterWords({ meta, chain }: { meta: TableMeta; chain: NonNullable<ReturnType<typeof parseChain>> }) {
  return (
    <span data-testid="linked-words">
      {chain.steps.map((step, i) => (
        <ChipStep key={i} at={i} negate={chain.negate} from={i === 0 ? meta.name : chain.steps[i - 1].table} steps={chain.steps} />
      ))}
    </span>
  )
}

function ChipStep({ at, negate, from, steps }: { at: number; negate: boolean; from: string; steps: ChainStep[] }) {
  const step = steps[at]
  const { options } = useLinkOptions(from)
  const meta = useMeta(step.table)
  const label = options.find((o) => o.key === linkKey(step.table, step.link))?.label ?? tableLabel(step.table, meta.data)
  const own = stepFilters(steps, at)
  const count = useQuery({
    queryKey: ['linked-chip-count', step.table, JSON.stringify(own)],
    retry: false,
    queryFn: () => api.post<{ count: number }>('/api/dashboard/count', { table: step.table, filters: own }),
  })
  const shown = step.picked.slice(0, 3)
  return (
    <>
      {at === 0 ? (negate ? 'Not linked to ' : 'Linked to ') : ' › linked to '}
      {label}
      {shown.length > 0 && <>: {shown.map((id, i) => <span key={id}>{i ? ', ' : ''}<LinkedTitle table={step.table} rowId={id} /></span>)}
        {step.picked.length > shown.length && ` +${step.picked.length - shown.length}`}</>}
      {!shown.length && step.search && ` matching "${step.search.text}"`}
      {count.data && <span className="ml-1 rounded-full bg-canvas px-1.5 text-xs tabular-nums text-ink-muted" data-testid="linked-step-total"
        title={`${fmtCount(count.data.count)} ${tableLabel(step.table, meta.data)} match`}>{fmtCount(count.data.count)}</span>}
    </>
  )
}
