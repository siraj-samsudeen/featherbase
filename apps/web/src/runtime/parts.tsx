import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ChildList, PagePart, PagePartName, PageTableBand, PageTableColumn, PathRef } from 'shared'
import { BandedTable, Button, cx, Field, fmtCount, Notice, PageHeader, RecordLink, Segmented, Skeleton, TextInput, type BandedColumn } from '@featherbase/shop-floor'
import { usePageTitle } from '../lib/page-title'
import { useCanReadTable } from '../lib/session'
import { asTyped, readPath, resolveValue, type Row } from './grammar'
import { scopeAt, TOP, usePageRuntime, type Place, type PageEvent } from './runtime'
import { rowKey, sourcesRead } from './sources'
import { formatCell, groupRows, sumOf, type PlacedRow } from './table'

// #1410: the ten parts a page may be made of, each a thin wrapper over the
// shared components. A part draws what its settings say and nothing else.

interface PartProps { part: PagePart; place: Place }

/** A setting's value where the part is drawn, as last read from the server: what a part shows. */
function useResolve(place: Place) {
  const { model } = usePageRuntime()
  return (value: unknown) => resolveValue(value, scopeAt(model, place))
}
/** The value a control is bound to, with what was typed laid over what was read: what a box or a toggle holds. */
function useBound(place: Place) {
  const { typed } = usePageRuntime()
  return (value: unknown) => resolveValue(value, scopeAt(typed, place))
}
const asText = (value: unknown) => (value === null || value === undefined ? '' : String(value))

/** The parts a part names: each by its id, or one part once per row of a data source, drawn in that row. */
function Children({ of, place }: { of: ChildList; place: Place }) {
  const { model } = usePageRuntime()
  if (Array.isArray(of)) return <>{of.map((id) => <PartView key={id} id={id} place={place} />)}</>
  const rows = readPath(of.path, { model }) as Row[]
  return <>{rows.map((row, index) => <PartView key={rowKey(row, index)} id={of.componentId} place={{ at: `${of.path}/${index}` }} />)}</>
}

function PagePartView({ part, place }: PartProps) {
  const { definition, sources } = usePageRuntime()
  const resolve = useResolve(place)
  const title = asText(resolve(part.title))
  usePageTitle(title)
  // The shell says what the page cannot leave out: that rows are a sample, or that a Table has more rows than a page reads.
  const notes = Object.entries(definition.data ?? {}).flatMap(([name, source]) => {
    if ('sample' in source) return ['Sample data. These rows are written in the page itself, not read from a Table.']
    const read = sources[name]!
    const capped = read.status === 'ready' && source.limit === undefined && read.total > read.rows.length
    return capped ? [`Showing the first ${fmtCount(read.rows.length)} of ${fmtCount(read.total)} rows of ${source.table}.`] : []
  })
  return (
    <div className="flex flex-col gap-5" data-testid="runtime-page">
      <PageHeader
        title={title}
        actions={part.actions ? <Children of={part.actions as ChildList} place={place} /> : undefined}
        status={notes.length ? [...new Set(notes)].map((note) => <p key={note}>{note}</p>) : undefined}
      />
      <div className="flex flex-col gap-4"><Children of={part.children as ChildList} place={place} /></div>
    </div>
  )
}

const GAP = { small: 'gap-2', medium: 'gap-4', large: 'gap-6' }
function StackPart({ part, place }: PartProps) {
  return <div className={cx('flex flex-col', GAP[(part.gap as keyof typeof GAP | undefined) ?? 'medium'])}><Children of={part.children as ChildList} place={place} /></div>
}

const ALIGN = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' }
function RowPart({ part, place }: PartProps) {
  return <div className={cx('flex flex-wrap items-center gap-2', ALIGN[(part.align as keyof typeof ALIGN | undefined) ?? 'start'])}><Children of={part.children as ChildList} place={place} /></div>
}

const TEXT = { body: 'text-sm text-ink', caption: 'text-[13px] text-ink-subtle', figure: 'text-3xl font-semibold tabular-nums text-ink' }
function TextPart({ part, place }: PartProps) {
  const resolve = useResolve(place)
  const words = asText(resolve(part.text))
  if (part.variant === 'heading') return <h2 className="text-base font-semibold text-ink">{words}</h2>
  return <p className={TEXT[(part.variant as keyof typeof TEXT | undefined) ?? 'body']}>{words}</p>
}

function NoticePart({ part, place }: PartProps) {
  const resolve = useResolve(place)
  return <Notice tone={part.tone as 'info' | 'positive' | 'caution' | 'negative' | undefined}>{asText(resolve(part.text))}</Notice>
}

function RecordLinkPart({ part, place }: PartProps) {
  const resolve = useResolve(place)
  const navigate = useNavigate()
  const table = part.table as string
  const row = asText(resolve(part.row))
  const mayRead = useCanReadTable(table)
  return <RecordLink table={table} rowId={row} name={asText(resolve(part.label))} canOpen={Boolean(mayRead && row)} onNavigate={(href) => void navigate({ href })} />
}

function TablePart({ part, place }: PartProps) {
  const { model, write } = usePageRuntime()
  const resolve = useResolve(place)
  const [openHere, setOpenHere] = useState<string | null>(null)
  const from = (part.rows as PathRef)['@path']
  const rows = (resolve(part.rows) as Row[]).map((row, index): PlacedRow => ({ row, index }))
  const shown = (part.columns as PageTableColumn[]).filter((column) => column.visible === undefined || Boolean(resolve(column.visible)))
  const byId = new Map(shown.map((column) => [column.id, column]))
  const columns: BandedColumn[] = shown.map((column, i) => ({
    key: column.id, header: asText(resolve(column.header)), align: column.align,
    // Controls drawn in each row (a box and its buttons) need more room than a figure; the first column names the row.
    width: column.cell && i > 0 ? 3 : undefined,
  }))
  /** A row's own place: its values are what a path with no leading slash reads, and where a typed value is written. */
  const placeOf = ({ index }: PlacedRow): Place => ({ at: `${from}/${index}` })
  // A column's value, and so a group's total, is the saved one: what is typed into a box changes neither.
  const valueIn = (placed: PlacedRow, column: PageTableColumn) => resolveValue(column.value, { model, row: placed.row, at: placeOf(placed).at })
  const cell = (placed: PlacedRow, { key }: BandedColumn) => {
    const column = byId.get(key)!
    return column.cell ? <PartView id={column.cell} place={placeOf(placed)} /> : formatCell(valueIn(placed, column), column.format)
  }
  const shared = {
    caption: part.caption as string,
    columns,
    bands: part.bands as PageTableBand[] | undefined,
    cell,
    rowKey: ({ row, index }: PlacedRow) => asText(row[(part.row_key as string | undefined) ?? 'row_id'] ?? index),
  }
  if (!part.group_by) return <BandedTable {...shared} rows={rows} />

  const open = part.open as PathRef | undefined
  const groups = groupRows(rows.map(({ row }) => row), part.group_by as string).map((group) => ({
    ...group,
    totals: Object.fromEntries(shown.filter((column) => column.total === 'sum').map((column) => [
      column.id,
      formatCell(sumOf(group.rows.map((placed) => valueIn(placed, column))), column.format === 'currency' ? 'currency' : 'number'),
    ])),
  }))
  return (
    <BandedTable {...shared} groups={groups}
      // Which group is open is the page's state when the table binds it, so it is in the address.
      openGroup={open ? asText(resolve(open)) : openHere}
      onOpenGroup={(key) => (open ? write(open['@path'], key ?? '', place) : setOpenHere(key))} />
  )
}

function TogglePart({ part, place }: PartProps) {
  const { write } = usePageRuntime()
  const bound = useBound(place)
  return (
    <Segmented label={part.label as string} options={part.options as { value: string; label: string }[]}
      value={asText(bound(part.value))} onChange={(value) => write((part.value as PathRef)['@path'], value, place)} />
  )
}

function InputPart({ part, place }: PartProps) {
  const { write } = usePageRuntime()
  const resolve = useResolve(place)
  const bound = useBound(place)
  const number = part.kind === 'number'
  const label = part.label as string
  const box = (
    <TextInput type={number ? 'number' : 'text'} className={number ? 'w-28' : 'w-56'} placeholder={part.placeholder === undefined ? undefined : asText(resolve(part.placeholder))}
      // In a table's row the box is named for assistive tech only: the column's header already says what it is.
      aria-label={place.at ? label : undefined}
      value={asText(bound(part.value))}
      // Typing changes the box's own copy; nothing else on the page changes, and nothing reaches the server, until a button saves it.
      onChange={(event) => write((part.value as PathRef)['@path'], asTyped(event.target.value, part.kind), place)} />
  )
  return place.at ? box : <Field label={label}>{box}</Field>
}

function ButtonPart({ part, place }: PartProps) {
  const { fire } = usePageRuntime()
  const resolve = useResolve(place)
  const [busy, setBusy] = useState(false)
  return (
    <Button variant={part.variant as 'primary' | 'secondary' | 'quiet' | undefined} loading={busy}
      onClick={() => {
        setBusy(true)
        void fire((part.action as { event: PageEvent }).event, place).finally(() => setBusy(false))
      }}>
      {asText(resolve(part.label))}
    </Button>
  )
}

/** Every part of the catalog, by name: a part the catalog gains must be drawn here. */
const PARTS: Record<PagePartName, (props: PartProps) => ReactNode> = {
  Page: PagePartView,
  Stack: StackPart,
  Row: RowPart,
  Text: TextPart,
  Notice: NoticePart,
  RecordLink: RecordLinkPart,
  Table: TablePart,
  Toggle: TogglePart,
  Input: InputPart,
  Button: ButtonPart,
}

/** One part of the page, by its id, drawn where it is placed: once the rows it needs are there. */
export function PartView({ id, place = TOP }: { id: string; place?: Place }) {
  const { parts, sources } = usePageRuntime()
  const part = parts.get(id)!
  // A source the page does not have is no source: words that only look like a path are drawn as written.
  const needed = sourcesRead(part).flatMap((source) => sources[source] ?? [])
  // Rows the viewer may not read: the server's own words in the part's place, and the rest of the page stands.
  const failed = needed.find((source) => source.status === 'failed')
  if (failed) return <Notice tone="caution">{failed.message}</Notice>
  if (needed.some((source) => source.status === 'loading')) return <Skeleton label="Loading rows" />
  const Draw = PARTS[part.component as PagePartName]
  return <Draw part={part} place={place} />
}
