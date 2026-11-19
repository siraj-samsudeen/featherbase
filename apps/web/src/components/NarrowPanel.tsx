import { useEffect, useState } from 'react'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { Sentence, cx, fmtCount, useRecordHref, type SentencePart } from '@featherbase/shop-floor'
import { api, listResource } from '../lib/api'
import { useBacklinks } from '../lib/connections'
import { parseChain, type Filter } from '../lib/linked-filters'
import { metaQuery, useMeta, type TableMeta } from '../lib/meta'
import { narrowLists, pickFilter, splitPicks, togglePick, type MetaOf, type NarrowList, type Picked } from '../lib/narrow'
import { filterRowName, useRowNames } from '../lib/relations'
import { NOT_A_LOGIN } from '../lib/not-a-login'
import { searchColumn } from './ListFilters'
import { useFitToWindow } from '../lib/fit-to-window'
import { useChainCountTip } from './LinkedFilter'

// #1289 option C, Click To Narrow (board A, docs/design/mockups/look-and-relationships.html):
// beside every list, one list of values per table the list's rows reach. Every
// click narrows the list and updates every list's counts at once: picked green,
// still possible plain, ruled out grey at 0, kept and sorted below. A tick is
// the list's Linked to filter (lib/narrow.ts), so the address, saved views and
// the chips keep working.

const enc = encodeURIComponent
/** A list shows its top values; Show all opens the rest in a scroll box. */
const TOP = 6
/** A list longer than this gets "Find in <Table>". */
const FIND_OVER = 12
/** Search matches looked up per list beyond SCOPED_FIND values. */
const FOUND = 500
/** Up to this many values, a list's search looks only among them. */
const SCOPED_FIND = 500

type Value = { value: string | null; count: number }

/** The panel's lists for this Table once every table they reach has its
 *  metadata; null until then. A table the viewer may not read is left out. */
export function useNarrowLists(table: string, meta: TableMeta | undefined, enabled: boolean): NarrowList[] | null {
  const backlinks = useBacklinks(table, enabled && Boolean(meta))
  const [wanted, setWanted] = useState<string[]>([])
  const metas = useQueries({ queries: wanted.map((t) => ({ ...metaQuery(t), retry: false })) })
  const metaOf: MetaOf = (t) => {
    if (meta && t === meta.name) return meta
    const q = metas[wanted.indexOf(t)]
    if (!q) return undefined
    return q.data ?? (q.isError ? null : undefined)
  }
  // A Table whose links the viewer may not list still has its own lists.
  const back = backlinks.data?.backlinks ?? (backlinks.isError ? [] : undefined)
  const result = enabled && meta && back ? narrowLists(meta, back, metaOf) : null
  const ask = result?.missing.filter((t) => !wanted.includes(t)) ?? []
  const askKey = ask.join('\u0000')
  useEffect(() => {
    if (askKey) setWanted((w) => [...new Set([...w, ...askKey.split('\u0000')])])
  }, [askKey])
  return result && !result.missing.length ? result.lists : null
}

/** Every list's counts in one request: under the list's filters and every
 *  other list's picks, scoped by the server to what the viewer may read. */
function useNarrowCounts(table: string, lists: NarrowList[], filters: Filter[], pageFilters: Filter[], withRetired: boolean, refreshedAt: number) {
  const split = splitPicks(lists, filters)
  const { picks } = split
  const base = [...pageFilters, ...split.base]
  const request = lists.map((l, i) => {
    const pick = pickFilter(l, picks[i])
    return pick ? { path: l.path, pick } : { path: l.path }
  })
  return useQuery({
    // Read again whenever the list's rows are (Codex: a changed row must not leave stale counts).
    queryKey: ['narrow-counts', table, JSON.stringify(base), JSON.stringify(request), withRetired, refreshedAt],
    enabled: lists.length > 0,
    // The panel keeps its counts while the next ones load, so a click never blanks it.
    placeholderData: keepPreviousData,
    queryFn: () => api.get<{ lists: { values: Value[] }[] }>(
      `/api/table/${enc(table)}:narrow?filters=${enc(JSON.stringify(base))}&lists=${enc(JSON.stringify(request))}${withRetired ? '&with_retired=true' : ''}`),
  })
}

export function NarrowPanel({ table, lists, filters, baseFilters = [], withRetired = false, refreshedAt = 0, onFiltersChange, columns = 2, className }: {
  table: string
  lists: NarrowList[]
  /** The person's filters, picks among them. */
  filters: Filter[]
  /** The page's own filters, always applied (#1173). */
  baseFilters?: Filter[]
  withRetired?: boolean
  /** When the list last read its rows: the counts are read again with them. */
  refreshedAt?: number
  onFiltersChange: (filters: Filter[]) => void
  /** Two columns of lists beside a table (board A); one in the phone sheet. */
  columns?: 1 | 2
  className?: string
}) {
  const counts = useNarrowCounts(table, lists, filters, baseFilters, withRetired, refreshedAt)
  const { picks } = splitPicks(lists, filters)
  // Beside a table fitted to the window (#1249), the panel fits it too and scrolls inside.
  const [box, setBox] = useState<HTMLElement | null>(null)
  useFitToWindow(columns === 2 ? box : null)
  return (
    <aside
      ref={setBox}
      aria-label="Click To Narrow"
      className={cx('grid content-start gap-x-[10px] gap-y-[14px] overflow-y-auto rounded-[12px] bg-narrow-fill px-2 py-3', columns === 2 ? 'grid-cols-2' : 'grid-cols-1', className)}
      data-testid="narrow-panel"
    >
      {counts.isError && <p className="col-span-full px-1.5 text-[13px] text-ink-subtle">The counts could not be read. The list itself is unchanged.</p>}
      {lists.map((list, i) => (
        <NarrowValues
          key={list.key}
          list={list}
          values={counts.data?.lists[i]?.values}
          picked={picks[i]}
          onToggle={(value) => onFiltersChange(togglePick(lists, filters, i, value))}
        />
      ))}
    </aside>
  )
}

/** What a list's value reads: the row's name, the Choice value, or the "none" value. */
function noneLabel(list: NarrowList) {
  // The heading already names the table, so the value is short and keeps it in view (UI owner).
  return `No ${list.label}`
}

/** The "none" value said in full, as its tooltip: "Not linked to any Store Floor". */
function noneTitle(list: NarrowList) {
  return list.kind === 'choice' ? `No ${list.label}` : `Not linked to any ${list.label}`
}

function NarrowValues({ list, values, picked, onToggle }: {
  list: NarrowList
  values: Value[] | undefined
  picked: Picked
  onToggle: (value: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim()
  const isPicked = (v: string | null) => (v === null ? picked === 'none' : Array.isArray(picked) && picked.includes(v))
  const all: Value[] = [...(values ?? [])]
  // A picked value no row reaches any more still shows, at 0, so it can be taken back.
  for (const id of picked === 'none' ? [null] : picked ?? []) if (!all.some((v) => v.value === id)) all.push({ value: id, count: 0 })
  // The server orders by count. Picked values are pinned on top; "Not linked to any"
  // closes the possible values; ruled-out ones fall below.
  const rank = (v: Value) => isPicked(v.value) ? 0 : v.count > 0 ? (v.value === null ? 2 : 1) : 3
  const sorted = all.map((v, i) => [v, i] as const)
    .sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)
    .map(([v]) => v)
  const found = useFound(list, q, sorted)
  const matching = q ? sorted.filter((v) => isPicked(v.value) || found(v.value)) : sorted
  const boxed = open || Boolean(q)
  // "Not linked to any" stays in view past the top values.
  const none = matching.find((v) => v.value === null && v.count > 0)
  const top = matching.filter((v) => v !== none).slice(0, TOP)
  // Back in rank order, so "Not linked" stays before ruled-out values.
  const shown = boxed ? matching : [...top, ...(none ? [none] : [])].sort((a, b) => rank(a) - rank(b))
  const records = list.kind !== 'choice'
  const refs = records ? shown.filter((v) => v.value !== null).map((v) => ({ table: list.table!, row_id: v.value! })) : []
  const names = useRowNames(refs)
  const labelOf = (v: string | null) => v === null ? noneLabel(list)
    : records ? filterRowName(names[refs.findIndex((r) => r.row_id === v)]) : v
  const max = Math.max(1, ...all.map((v) => v.count))
  const possible = all.filter((v) => v.count > 0).length
  const findLabel = `Find in ${list.label}`
  return (
    <section aria-label={list.label} className="min-w-0" data-testid="narrow-list">
      <h3 className="mb-1 flex flex-wrap items-baseline gap-x-1.5 px-1.5 text-[13.5px] font-semibold leading-4 text-ink">
        {list.label}
        <span className="text-xs font-normal text-ink-subtle" data-testid="narrow-note">{values ? `${fmtCount(possible)} of ${fmtCount(all.length)}` : '…'}</span>
        {list.through && <span className="rounded-md bg-tag px-2 py-0.5 text-xs font-normal text-ink-muted">through {list.through}</span>}
      </h3>
      {all.length > FIND_OVER && (
        <input
          type="search"
          aria-label={findLabel}
          placeholder={findLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-1 w-full rounded-[7px] bg-surface px-2 py-1.5 text-[12.5px] leading-[15px] text-ink shadow-sm outline-none placeholder:text-ink-subtle focus:shadow-[inset_0_0_0_1.5px_var(--color-focus)]"
          {...NOT_A_LOGIN}
        />
      )}
      <div className={boxed ? 'max-h-[232px] overflow-y-auto pr-0.5' : undefined} data-testid={boxed ? 'narrow-scroll' : undefined}>
        {shown.map((v) => (
          <NarrowValue key={v.value ?? '\u0000none'} list={list} value={v} label={labelOf(v.value)} max={max}
            on={isPicked(v.value)} title={v.value === null ? noneTitle(list) : undefined} onToggle={() => onToggle(v.value)} />
        ))}
        {q && !shown.length && <p className="px-1.5 py-1 text-[12.5px] text-ink-subtle">No value matches</p>}
      </div>
      {all.length > TOP && !q && (
        <button type="button" onClick={() => setOpen(!open)} className="px-1.5 py-[3px] text-[12.5px] leading-[15px] text-action hover:underline">
          {open ? 'Show fewer' : `Show all ${fmtCount(all.length)}`}
        </button>
      )}
    </section>
  )
}

/** One value: a pick control drawn as board A draws it. A record value is a
 *  real link underneath (UI owner, 19-Nov-2026): a plain click picks, while
 *  Cmd/Ctrl-click and middle-click open the record in a new tab. */
function NarrowValue({ list, value: v, label, max, on, title, onToggle }: {
  list: NarrowList
  value: Value
  label: string
  max: number
  on: boolean
  /** What a hover shows; the label itself by default. */
  title?: string
  onToggle: () => void
}) {
  const out = !on && v.count === 0
  const record = list.kind !== 'choice' && v.value !== null
  const href = useRecordHref(list.table ?? '', v.value ?? '')
  const className = cx(
    'grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_54px_44px] items-center gap-2 rounded-[7px] px-1.5 py-[5px] text-left text-[13px] leading-4 no-underline focus-visible:outline-2 focus-visible:outline-focus',
    on ? 'bg-chip-green font-medium text-chip-green-ink' : out ? 'text-ruled-out-ink hover:bg-fill-hover' : 'text-ink hover:bg-fill-hover',
    v.value === null && !on && !out && list.kind !== 'choice' && 'text-negative',
  )
  const body = <>
    <span className="truncate" title={title ?? label}>{label}</span>
    <span
      aria-hidden
      className={cx('h-1.5 rounded-[3px]', on ? 'bg-picked-bar' : out ? 'bg-ruled-out-bar' : 'bg-count-bar')}
      style={{ width: `${Math.max(2, Math.round((100 * v.count) / max))}%` }}
    />
    <span aria-hidden className={cx('text-right text-xs', !on && !out && 'text-ink-subtle')}>{fmtCount(v.count)}</span>
  </>
  const common = {
    'aria-pressed': on,
    'aria-label': `${label} ${fmtCount(v.count)}`,
    'data-state': on ? 'picked' : out ? 'ruled-out' : 'possible',
    className,
  } as const
  if (!record) return <button type="button" {...common} onClick={onToggle}>{body}</button>
  return (
    <a
      href={href}
      role="button"
      {...common}
      onClick={(e) => {
        // A plain click picks; any other opens the record, as a link does.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onToggle()
      }}
      onKeyDown={(e) => {
        if (e.key !== ' ') return
        e.preventDefault()
        onToggle()
      }}
    >
      {body}
    </a>
  )
}

/** Which values a list's search finds: by the row's searchable column on the
 *  server for records (as the list's own Search does), by the words for a Choice. */
function useFound(list: NarrowList, q: string, values: Value[]): (value: string | null) => boolean {
  const records = list.kind !== 'choice'
  const meta = useMeta(list.table ?? '', records && Boolean(q))
  const column = meta.data ? searchColumn(meta.data) : undefined
  // Search among this list's own values, so a limit never hides one of them
  // behind matches elsewhere in the table (Codex). A very long list searches
  // its table's first matches instead.
  const ids = values.flatMap((v) => (v.value === null ? [] : [v.value]))
  const within: Filter[] = ids.length <= SCOPED_FIND ? [['row_id', 'in', ids]] : []
  const rows = useQuery({
    queryKey: ['narrow-find', list.table, column, q, JSON.stringify(within)],
    enabled: records && Boolean(q && column),
    placeholderData: keepPreviousData,
    queryFn: () => listResource<{ row_id: string }>(list.table!, {
      filters: [[column!, 'like', `%${q}%`], ...within], fields: ['row_id'], limit_page_length: within.length ? ids.length : FOUND,
    }),
  })
  const words = q.toLowerCase()
  const hits = new Set((rows.data?.data ?? []).map((r) => String(r.row_id)))
  return (value) => value === null ? noneLabel(list).toLowerCase().includes(words)
    : records ? hits.has(value) : value.toLowerCase().includes(words)
}

/** One picked value as its chip reads, through the shared Sentence: the list's
 *  table, then the value, a record as a link ("Store: [Bayside]"), or "No Store". */
export function NarrowPickWords({ list, value }: { list: NarrowList; value: string | null }) {
  // A linked list's pick is a Linked to chain: how many rows each step holds is its tooltip, as on every Linked to chip (#1276).
  const filter = list.kind === 'link' ? pickFilter(list, value === null ? 'none' : [value]) : null
  const chain = filter ? parseChain(filter) : null
  const tip = useChainCountTip(chain?.steps ?? [])
  const records = list.kind !== 'choice'
  const [name] = useRowNames(records && value !== null ? [{ table: list.table!, row_id: value }] : [])
  const parts: SentencePart[] = value === null ? [noneLabel(list)]
    : [`${list.label}: `, records && name?.state === 'read' ? { record: { table: list.table!, row: value, name: name.title } } : records ? filterRowName(name) : value]
  return <span data-testid={chain ? 'linked-words' : undefined} title={chain ? tip : undefined}><Sentence parts={parts} /></span>
}
