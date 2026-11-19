import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { choiceLabel, rowDisplayTitle, tableHref, wallTimeToInstant, type ListFilter } from 'shared'
import { AreaPicker as AreaColumns, RecordLink, TickMark, ToneChip, cx, fmtCount } from '@featherbase/shop-floor'
import { ApiError, api, listResource } from '../lib/api'
import { forwardLinks, ALL_ROWS, useRowName, UNSEEN_ROW, type BacklinkGroup } from '../lib/relations'
import { linkRowsTable, metaQuery, tableLabel, type ColumnDef, type TableMeta } from '../lib/meta'
import { titleListColumn } from '../lib/list-view-columns'
import { useCapabilities } from '../lib/session'
import { areaLoader, useAppAreas } from '../lib/app-areas'
import { formatValue, useSettings } from '../lib/settings'
import { useI18n } from '../lib/i18n'
import type { NavPane } from '../lib/nav-path'
import {
  FOLD_AFTER, SMALL_SIDE, correctionHref, formColumns, formCompletes, shownColumns, gridOffered, isUntil, mayTick, newLinkRow, tickColumn, tickCount, tickLines,
  useRowSources, type Choice, type TickedLine,
} from '../lib/link-ticks'
import { LinkControl } from './LinkControl'
import { useRowCapabilities } from '../lib/row-capabilities'
import { dataColumns } from '../lib/list-view-columns'

/** The readable columns a Table's correction path names. */
function correctionColumns(meta: TableMeta): string[] {
  const readable = new Set(dataColumns(meta).map((c) => c.column_name))
  return [...(meta.correction_path ?? '').matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!).filter((name) => readable.has(name))
}

type Row = Record<string, unknown>

/**
 * #1273: what one group of rows pointing at a record can offer. `column` is the
 * far side the group ticks or reads by (its link Table's column); `tick` says
 * whether it is a tick list here: the viewer may add and delete its rows and
 * the far side has at most 40 choices, all listed in `choices`. `grid` says
 * whether both sides are small enough for Open as grid.
 */
export interface GroupPlan {
  state: 'loading' | 'ready'
  linkMeta?: TableMeta
  column?: ColumnDef
  farTable?: string
  farMeta?: TableMeta
  choices?: Choice[]
  tick: boolean
  grid: boolean
}

const LOADING: GroupPlan = { state: 'loading', tick: false, grid: false }

/** A Table's first rows, counted: its total, and up to `limit` rows by name. */
function sideQuery(table: string, meta: TableMeta | undefined, limit: number) {
  const title = meta ? titleListColumn(meta)?.column_name : undefined
  return {
    queryKey: ['side', table, limit, title ?? null],
    enabled: Boolean(meta),
    staleTime: 60_000,
    queryFn: () => listResource(table, { fields: ['row_id', ...(title ? [title] : [])], order_by: title ? `${title} asc` : undefined, limit_page_length: limit }),
  }
}

/** The plan of each group of a record (keyed by the group's key). */
export function useGroupPlans(table: string, record: string, groups: BacklinkGroup[]): Map<string, GroupPlan> {
  const caps = useCapabilities()
  const recordMeta = useQuery(metaQuery(table)).data
  const doc = useQuery({
    queryKey: ['doc', table, record],
    retry: false,
    queryFn: () => api.get<Row>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(record)}`),
  }).data
  const linkTables = [...new Set(groups.map((g) => g.connection.table))]
  const linkMetas = useQueries({ queries: linkTables.map((t) => metaQuery(t)) })
  const own = recordMeta && doc ? forwardLinks(recordMeta, doc).map((l) => l.table) : undefined
  const columnOf = (g: BacklinkGroup) => {
    const meta = linkMetas[linkTables.indexOf(g.connection.table)]?.data
    return meta && own ? tickColumn(meta, g.connection, { table, own }) : undefined
  }
  // Choices come from the Table the link names, a view's own rows included (Codex review);
  // the far side's records are its base Table's.
  const choiceTable = (c: ColumnDef) => c.reference_table ?? linkRowsTable(c)
  const farTables = [...new Set(groups.map(columnOf).map((c) => (c ? choiceTable(c) : null)).filter((t): t is string => Boolean(t)))]
  const farMetas = useQueries({ queries: farTables.map((t) => metaQuery(t)) })
  const farSides = useQueries({ queries: farTables.map((t, i) => sideQuery(t, farMetas[i]?.data, SMALL_SIDE + 1)) })
  // The record's own Table counted, for the grid (A2).
  const recordSide = useQuery(sideQuery(table, recordMeta, 1))
  const plans = new Map<string, GroupPlan>()
  for (const g of groups) {
    const linkMeta = linkMetas[linkTables.indexOf(g.connection.table)]?.data
    if (!linkMeta || !own) { plans.set(g.key, LOADING); continue }
    const column = columnOf(g)
    const farTable = column ? linkRowsTable(column) ?? undefined : undefined
    if (!column || !farTable) { plans.set(g.key, { state: 'ready', linkMeta, tick: false, grid: false }); continue }
    const i = farTables.indexOf(choiceTable(column)!)
    const farMeta = farMetas[i]?.data
    const side = farSides[i]?.data
    if (!farMeta || !side) { plans.set(g.key, { ...LOADING, linkMeta, column, farTable }); continue }
    const choices = side.data.map((r) => ({ id: String(r.row_id), title: rowDisplayTitle(farMeta, r, String(r.row_id)) }))
    plans.set(g.key, {
      state: 'ready', linkMeta, column, farTable, farMeta, choices,
      // Every link must be read to say which choices are unticked: past one read's worth it lists (Codex review).
      tick: side.total <= SMALL_SIDE && g.count <= ALL_ROWS && mayTick(caps, linkMeta)
        && formCompletes(linkMeta, [g.connection.column, column.column_name]),
      grid: gridOffered(recordSide.data?.total, side.total),
    })
  }
  return plans
}

/** The plan of one group. */
export function useGroupPlan(table: string, record: string, group: BacklinkGroup): GroupPlan {
  return useGroupPlans(table, record, [group]).get(group.key) ?? LOADING
}

/** #1273: a record page tells its one save state when a tick saves (C9). */
export const LinkSaveContext = createContext<{ saved: () => void } | null>(null)

const BOX = 'grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] text-xs leading-none'

/**
 * #1273 C5–C9, C12, C13: a relationship the viewer may change, as a tick list.
 * Its header reads "Business Roles 2 of 7"; every choice is listed, ticked ones
 * first with their area and end date and a source chip, unticked ones greyed.
 * A feed's link is locked (a tinted tick) and offers Correct where its Table
 * names a correction path. Ticking an unticked choice opens the inline form
 * under it; nothing is saved until Add. Unticking a hand-given link removes it.
 */
export function LinkTickList({ table, record, group, plan, onOpen, gridHref, heading, notes, fallback }: {
  table: string
  record: string
  group: BacklinkGroup
  plan: GroupPlan & { linkMeta: TableMeta; column: ColumnDef; farTable: string; farMeta: TableMeta; choices: Choice[] }
  onOpen?: (pane: NavPane) => void
  /** Open as grid: the group's list, until the grid comes (C12). */
  gridHref?: string
  /** #1340: the app's heading for the group, and a note for each choice (by its id): who else holds it. */
  heading?: string
  notes?: Record<string, string>
  /** #1340: what draws the group when a row names no choice (it points elsewhere, a bundle beside reports): the list. */
  fallback?: ReactNode
}) {
  const { connection } = group
  const { linkMeta, column, farTable, farMeta, choices } = plan
  const backLink = connection.column
  const fields = formColumns(linkMeta, [backLink, column.column_name])
  // A ticked link shows every readable area and date, whatever the viewer may give a new one (Codex review).
  const facts = shownColumns(linkMeta, [backLink, column.column_name])
  const otherLinks = facts.filter((c) => c.column_type === 'Reference')
  const dates = facts.filter((c) => c.column_type !== 'Reference')
  const queryClient = useQueryClient()
  const saveState = useContext(LinkSaveContext)
  const rows = useQuery({
    queryKey: ['group-rows', connection.table, JSON.stringify(connection.filters), 'ticks'],
    queryFn: () => listResource(connection.table, {
      filters: connection.filters,
      fields: [...new Set(['row_id', 'updated_at', 'created_by', backLink, column.column_name, ...fields.map((c) => c.column_name), ...facts.map((c) => c.column_name),
        // Correct's address may name any readable column of the row (Codex review).
        ...correctionColumns(linkMeta)])],
      limit_page_length: ALL_ROWS,
    }),
  })
  const data = rows.data?.data ?? []
  const sources = useRowSources(connection.table, data.map((r) => String(r.row_id)), rows.isSuccess)
  const [opened, setOpened] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [status, setStatus] = useState<'saving' | 'saved' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lines = tickLines(choices, data, column.column_name)
  const total = lines.ticked.length + lines.unticked.length
  // The section bears its chip's name, so a chip and its section read the same (verifier).
  const farLabel = heading ?? group.label

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['group-rows', connection.table] }),
      queryClient.invalidateQueries({ queryKey: ['connections'] }),
      queryClient.invalidateQueries({ queryKey: ['row-sources', connection.table] }),
      queryClient.invalidateQueries({ queryKey: ['list', connection.table] }),
    ])
  }
  const change = async (work: () => Promise<unknown>) => {
    setError(null)
    setStatus('saving')
    try {
      await work()
      await refresh()
      setStatus('saved')
      saveState?.saved()
      return true
    } catch (err) {
      setStatus(null)
      setError(err instanceof ApiError ? err.message : 'That did not save. Try again.')
      // A save whose answer was lost may still have landed: read the links again, so a choice
      // it ticked shows ticked rather than inviting a second Add (Codex review).
      await refresh()
      return false
    }
  }
  const untick = (row: Row) => change(() => {
    const stamp = row.updated_at == null ? '' : `?updated_at=${encodeURIComponent(String(row.updated_at))}`
    return api.delete(`/api/table/${encodeURIComponent(connection.table)}/${encodeURIComponent(String(row.row_id))}${stamp}`)
  })
  const add = (choice: Choice, values: Row) => change(() =>
    api.post(`/api/table/${encodeURIComponent(connection.table)}`, newLinkRow(backLink, record, column.column_name, choice.id, values)))
    .then((ok) => { if (ok) setOpened(null) })

  const shown: ({ kind: 'ticked'; line: TickedLine } | { kind: 'unticked'; choice: Choice })[] = [
    ...lines.ticked.map((line) => ({ kind: 'ticked' as const, line })),
    ...lines.unticked.map((choice) => ({ kind: 'unticked' as const, choice })),
  ]
  const visible = all ? shown : shown.slice(0, FOLD_AFTER)
  // A row that names no choice cannot be ticked or counted: the group is a list, every row said as it is.
  if (rows.isSuccess && data.some((r) => r[column.column_name] == null || r[column.column_name] === '')) return <>{fallback}</>
  return (
    <section aria-label={farLabel} data-testid="tick-list" data-group={group.key} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">{farLabel}</h4>
        <span className="text-[12.5px] text-ink-muted" data-testid="tick-count">{rows.isSuccess ? tickCount(lines, choices) : ''}</span>
        <span role="status" aria-live="polite" className={cx('text-xs', status === 'saved' ? 'text-positive' : 'text-ink-muted')} data-testid="tick-status">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : ''}
        </span>
        <span className="flex-1" />
        {plan.grid && gridHref && <GridButton href={gridHref} />}
      </div>
      {error && <p role="alert" className="text-xs text-negative">{error}</p>}
      {rows.isError ? <p role="alert" className="text-xs text-negative">These links could not be read. Reload to try again.</p>
        : rows.isPending ? <p className="text-sm text-ink-subtle">Loading…</p> : (
        <ul className="grid gap-0.5">
          {visible.map((item) => item.kind === 'ticked'
            ? <TickedLineView key={String(item.line.row.row_id)} line={item.line} farTable={farTable} linkMeta={linkMeta} note={notes?.[item.line.choice.id]}
                otherLinks={otherLinks} dates={dates} source={sources.data?.sources[String(item.line.row.row_id)]}
                sourceKnown={sources.isSuccess} onUntick={() => untick(item.line.row)} onOpen={onOpen} busy={status === 'saving'} />
            : <UntickedLineView key={item.choice.id} choice={item.choice} farTable={farTable} open={opened === item.choice.id} note={notes?.[item.choice.id]}
                onTick={() => setOpened(opened === item.choice.id ? null : item.choice.id)} onCancel={() => setOpened(null)}
                fields={fields} onAdd={(values) => add(item.choice, values)} busy={status === 'saving'} />)}
        </ul>
      )}
      {total > FOLD_AFTER && (
        <button type="button" onClick={() => setAll(!all)} data-testid="tick-fold"
          className="self-start px-2 text-sm font-medium text-action underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          {all ? 'Show fewer' : `Show all ${fmtCount(total)}`}
        </button>
      )}
    </section>
  )
}

/** Open as grid (C12): offered where both sides are small; the group's list for now. */
export function GridButton({ href }: { href: string }) {
  return (
    <a href={href} data-testid="open-as-grid"
      className="shrink-0 rounded-[7px] border border-border-control bg-surface px-2.5 py-1 text-[12.5px] text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus">
      Open as grid
    </a>
  )
}

function TickedLineView({ line, farTable, linkMeta, otherLinks, dates, source, sourceKnown, onUntick, onOpen, busy, note }: {
  line: TickedLine
  /** #1340: the app's note on this choice. */
  note?: string
  farTable: string
  linkMeta: TableMeta
  otherLinks: ColumnDef[]
  dates: ColumnDef[]
  /** The feed's name; null: given by hand; undefined: not known (yet). */
  source: string | null | undefined
  sourceKnown: boolean
  onUntick: () => void
  onOpen?: (pane: NavPane) => void
  busy: boolean
}) {
  const settings = useSettings()
  const { row, choice } = line
  const name = useRowName(farTable, choice.id)
  const fromFeed = typeof source === 'string'
  const correct = fromFeed ? correctionHref(linkMeta.correction_path, row) : undefined
  // A delete grant may reach only some rows (one's own): ask the row itself (Codex review).
  const caps = useRowCapabilities(linkMeta.name, String(row.row_id), sourceKnown && !fromFeed)
  const mayUntick = caps.data?.delete === true
  const title = name.state === 'read' ? name.title : choice.title || UNSEEN_ROW
  const areas = otherLinks.filter((c) => row[c.column_name] != null && row[c.column_name] !== '')
  const facts = dates.filter((c) => row[c.column_name] != null && row[c.column_name] !== '')
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-subtle" data-testid="tick-line" data-ticked="true">
      {/* A feed's link is locked: it changes only through Correct (C7). Undecided while its source loads. */}
      {fromFeed || !sourceKnown
        // With no correction path, the feed itself is where it changes (verifier).
        ? <TickMark state="locked" label={`${title}, from ${source ?? 'a feed'}, locked`}
            title={fromFeed ? (correct ? `From ${source}: change it with Correct` : `Comes from ${source}: change it there`) : undefined} />
        : <button type="button" onClick={onUntick} disabled={busy || !mayUntick} aria-label={`Untick ${title}`} data-testid="tick-box"
            title={caps.data && !mayUntick ? 'You may not remove this one' : undefined}
            // A tick the viewer may not remove reads locked and grey, not a faded blue (verifier).
            className={cx(BOX, 'focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60',
              caps.data && !mayUntick ? 'cursor-not-allowed border-border-control bg-subtle text-ink-muted disabled:opacity-100' : 'cursor-pointer border-action bg-action text-surface')}>✓</button>}
      <span className="flex min-w-0 flex-col">
        {name.state === 'unreadable'
          ? <RecordLink table={farTable} rowId={choice.id} name={UNSEEN_ROW} canOpen={false} />
          : <RecordLink table={farTable} rowId={choice.id} name={title} className="self-start"
              onNavigate={onOpen ? () => onOpen({ table: farTable, row: choice.id }) : undefined} />}
        {note && <span className="text-xs text-ink-muted" data-testid="tick-note">{note}</span>}
        {(areas.length > 0 || facts.length > 0) && (
          <span className="text-xs text-ink-muted" data-testid="tick-meta">
            {areas.map((c, i) => <span key={c.column_name}>{i > 0 && ' · '}<AreaName column={c} value={String(row[c.column_name])} /></span>)}
            {facts.map((c, i) => <span key={c.column_name}>{(i > 0 || areas.length > 0) && ' · '}{isUntil(c) ? 'until ' : ''}{formatValue(c.column_type, row[c.column_name], settings) || String(row[c.column_name])}</span>)}
          </span>
        )}
      </span>
      <span className="flex items-center gap-1">
        {sourceKnown && (fromFeed
          ? <ToneChip tone="neutral">from {source}</ToneChip>
          : <ToneChip tone="caution">given by hand</ToneChip>)}
        {correct && <a href={correct} data-testid="correct-link" className="px-1 text-xs text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus">Correct</a>}
      </span>
    </li>
  )
}

function AreaName({ column, value }: { column: ColumnDef; value: string }) {
  const table = linkRowsTable(column)!
  const name = useRowName(table, value)
  if (name.state === 'loading') return <>…</>
  return <RecordLink table={table} rowId={value} name={name.state === 'read' ? name.title : UNSEEN_ROW} canOpen={name.state === 'read'} className="text-ink-muted" />
}

function UntickedLineView({ choice, farTable, open, onTick, onCancel, fields, onAdd, busy, note }: {
  choice: Choice
  note?: string
  farTable: string
  open: boolean
  onTick: () => void
  onCancel: () => void
  fields: ColumnDef[]
  onAdd: (values: Row) => void
  busy: boolean
}) {
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-subtle" data-testid="tick-line" data-ticked="false">
      <button type="button" onClick={onTick} aria-label={`Tick ${choice.title}`} aria-expanded={open} data-testid="tick-box"
        className={cx(BOX, 'cursor-pointer border-border-control bg-surface focus-visible:outline-2 focus-visible:outline-focus')} />
      {/* Unticked choices are greyed: the name still opens its record. */}
      <span className="flex min-w-0 flex-col">
        <RecordLink table={farTable} rowId={choice.id} name={choice.title} className="self-start !font-normal !text-ink-muted" />
        {note && <span className="text-xs text-ink-muted" data-testid="tick-note">{note}</span>}
      </span>
      <span />
      {open && <AlsoGiveForm choice={choice} fields={fields} onAdd={onAdd} onCancel={onCancel} busy={busy} />}
    </li>
  )
}

/** C8: "Also give Team Leader · Area [Pick on the trees ▸] · Ends [optional] · Reason […] · Add · Cancel". */
function AlsoGiveForm({ choice, fields, onAdd, onCancel, busy }: {
  choice: Choice
  fields: ColumnDef[]
  onAdd: (values: Row) => void
  onCancel: () => void
  busy: boolean
}) {
  // Each field starts as it would be saved untouched: its default, and a yes/no always said (Codex review).
  const [values, setValues] = useState<Row>(() => startingValues(fields))
  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }))
  const areas = fields.filter((c) => c.column_type === 'Reference')
  const rest = fields.filter((c) => c.column_type !== 'Reference')
  return (
    <div className="col-start-2 col-end-4 flex flex-wrap items-center gap-2 rounded-lg bg-action-tint px-2.5 py-2 text-[12.5px] text-ink" data-testid="also-give-form"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
      <span>Also give <b className="font-semibold">{choice.title}</b></span>
      {areas.length > 0 && <AreaPicker columns={areas} values={values} set={set} />}
      {rest.map((c) => <FormField key={c.column_name} column={c} value={values[c.column_name]} onChange={(v) => set(c.column_name, v)} />)}
      <button type="button" onClick={() => onAdd(values)} disabled={busy} data-testid="also-give-add"
        className="rounded-[7px] bg-surface px-2.5 py-1 font-medium text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60">Add</button>
      <button type="button" onClick={onCancel} data-testid="also-give-cancel"
        className="px-1 text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus">Cancel</button>
    </div>
  )
}

/** The values a new link starts with: each field's default, typed; a yes/no is always true or false. */
export function startingValues(fields: ColumnDef[]): Row {
  const out: Row = {}
  for (const c of fields) {
    const d = c.default_value
    if (c.column_type === 'Check') out[c.column_name] = d === '1' || d?.toLowerCase() === 'true'
    // A date's default ("Today") is the server's to work out: the box shows it.
    else if (d != null && d !== '' && c.column_type !== 'Date' && c.column_type !== 'Datetime' && c.column_type !== 'Reference')
      out[c.column_name] = ['Int', 'Float', 'Currency', 'Percent'].includes(c.column_type) ? Number(d) : d
  }
  return out
}

const FLD = 'rounded-md border border-border-control bg-surface px-2 py-1 text-[12.5px] text-ink'

/** Area: "Pick on the trees ▸": the shared area picker (#1282 G1) where an app declares the area's
 *  levels; a link of another Table keeps its plain picker. */
function AreaPicker({ columns, values, set }: { columns: ColumnDef[]; values: Row; set: (name: string, value: unknown) => void }) {
  const [picking, setPicking] = useState(false)
  const picked = columns.filter((c) => values[c.column_name])
  const areas = useAppAreas()
  // The columns an area picked on the trees can fill, and the axes that reach them.
  const onTrees = columns.filter((c) => areas.levels.has(linkRowsTable(c) ?? ''))
  const holds = onTrees.map((c) => linkRowsTable(c)!)
  const axes = areas.axes.filter((a) => a.levels.some((l) => holds.includes(l.table)))
  const plain = columns.filter((c) => !onTrees.includes(c))
  // The level's own name, as an admin screen says it ("Site").
  const levelName = (c: ColumnDef) => { const l = areas.levels.get(linkRowsTable(c) ?? '')!; return l.adminLabel ?? l.label }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>· Area</span>
      {!picking && (
        <button type="button" onClick={() => setPicking(true)} data-testid="area-pick" className={cx(FLD, 'hover:bg-subtle')}>
          {picked.length ? picked.map((c) => <PickedName key={c.column_name} column={c} value={String(values[c.column_name])} />) : 'Pick on the trees'} ▸
        </button>
      )}
      {picking && axes.length > 0 && (
        <span className="basis-full" data-testid="area-trees">
          <AreaColumns axes={axes} holds={holds} load={areaLoader(areas.levels)} onCancel={() => setPicking(false)}
            onUse={(area) => { set(onTrees.find((c) => linkRowsTable(c) === area.table)!.column_name, area.row.id); setPicking(false) }} />
        </span>
      )}
      {picking && plain.map((c) => (
        <span key={c.column_name} className="inline-flex items-center gap-1" data-testid="area-picker">
          {columns.length > 1 && <span className="text-ink-muted">{c.label ?? c.column_name}</span>}
          <span className="w-60 min-w-0">
            <LinkControl field={c} value={values[c.column_name] ?? ''} onChange={(v) => set(c.column_name, v)} pickOnly
              className={FLD} common={{ 'aria-label': c.label ?? c.column_name }} />
          </span>
        </span>
      ))}
      {/* Codex standard round 3: the trees never take the plain picker away. One line under the columns, so a viewer who
          may not read the levels above, or a row with no parent, still chooses it from a list. */}
      {picking && axes.length > 0 && (
        <span className="inline-flex basis-full flex-wrap items-center gap-1.5" data-testid="area-direct">
          <span className="text-ink-muted">Or choose the {onTrees.map((c) => levelName(c)).join(' or ')} from a list</span>
          {onTrees.map((c) => (
            <span key={c.column_name} className="w-60 min-w-0">
              <LinkControl field={c} value={values[c.column_name] ?? ''} onChange={(v) => set(c.column_name, v)} pickOnly
                className={FLD} common={{ 'aria-label': levelName(c) }} />
            </span>
          ))}
        </span>
      )}
      {picking && plain.length > 0 && <button type="button" onClick={() => setPicking(false)} className="px-1 text-action hover:underline">Done</button>}
    </span>
  )
}

function PickedName({ column, value }: { column: ColumnDef; value: string }) {
  const name = useRowName(linkRowsTable(column)!, value)
  return <>{name.state === 'read' ? name.title : '…'}</>
}

function FormField({ column, value, onChange }: { column: ColumnDef; value: unknown; onChange: (value: unknown) => void }) {
  const { t } = useI18n()
  const [focused, setFocused] = useState(false)
  // A date and time is typed as the viewer's wall time and saved as that instant (Codex review).
  const [wall, setWall] = useState('')
  const label = column.label ?? column.column_name
  const shown = String(value ?? '')
  let control: ReactNode
  if (column.column_type === 'Date' || column.column_type === 'Datetime') {
    const instant = column.column_type === 'Datetime'
    const text = instant ? wall : shown
    // Reads "optional" until it is used, as a date box cannot say so itself.
    control = <input type={focused || text ? (instant ? 'datetime-local' : 'date') : 'text'} value={text} placeholder={column.default_value ? `default: ${column.default_value}` : column.reqd ? '' : 'optional'} aria-label={label}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className={cx(FLD, 'w-36')}
      onChange={(e) => {
        if (!instant) return onChange(e.target.value)
        setWall(e.target.value)
        onChange(e.target.value ? wallTimeToInstant(e.target.value) : '')
      }} />
  } else if (column.column_type === 'Check') {
    control = <input type="checkbox" checked={value === true} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
  } else if (column.column_type === 'Choice') {
    control = (
      <select value={shown} aria-label={label} onChange={(e) => onChange(e.target.value)} className={FLD}>
        <option value="">{column.reqd ? 'Choose' : 'optional'}</option>
        {(column.choices ?? '').split('\n').filter(Boolean).map((c) => <option key={c} value={c}>{choiceLabel(c, column.choice_labels, t)}</option>)}
      </select>
    )
  } else {
    const numeric = ['Int', 'Float', 'Currency', 'Percent'].includes(column.column_type)
    control = <input type={numeric ? 'number' : 'text'} value={shown} placeholder="…" aria-label={label}
      onChange={(e) => onChange(numeric && e.target.value !== '' ? Number(e.target.value) : e.target.value)} className={cx(FLD, numeric ? 'w-24' : 'w-40')} />
  }
  return <span className="inline-flex items-center gap-1.5"><span>· {label}</span>{control}</span>
}

/** C4: a new row of the group's Table, already linked back to this record. */
export function newRowHref(group: BacklinkGroup, record: string): string | undefined {
  if (group.connection.via) return undefined
  // Every equality the group is read by: a link to a row of any Table names its Table too (Codex review).
  const prefill = Object.fromEntries(group.connection.filters.filter((f) => f[1] === '=').map((f) => [f[0], f[2]]))
  if (!Object.keys(prefill).length) prefill[group.connection.column] = record
  return `${tableHref(group.connection.table)}/new?prefill=${encodeURIComponent(JSON.stringify(prefill))}`
}

/** The group's Table filtered to the record, as a list. */
export function groupListHref(group: BacklinkGroup): string {
  return `${tableHref(group.connection.table)}?filters=${encodeURIComponent(JSON.stringify(group.connection.filters as ListFilter[]))}`
}
