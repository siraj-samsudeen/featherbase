import { useEffect, useState } from 'react'
import { Button, iconButtonClasses } from './Button'
import { X } from './icons'
import { cx } from './cx'
import { fmtCount } from './format'
import { RecordLink } from './RecordLink'

// #1282 G1–G6: the area picker (Columns), the one way to pick an area. An axis
// (Location: Region › Cluster › Store › Floor; Merchandise: Division › … ›
// Subcategories) is browsed in columns, one per level; picking in a column
// clears the columns to its right. The bar below names the area picked, each part
// a link, and one action that names it ("Use North"). It knows nothing of where its
// rows come from: `load` reads each column, as the viewer may see it.

/** One level of an axis: its words ("Store" on a staff screen, "Site" on an admin one). */
export interface AreaLevel {
  /** The level's Table, which a picked row belongs to. */
  table: string
  /** "Store" */
  label: string
  /** "stores", for the count under a row of the level above. */
  plural: string
}

export interface AreaAxis {
  name: string
  /** What the area is with nothing picked: "Whole company", "All merchandise". */
  whole: string
  levels: AreaLevel[]
}

/** A row of a column: its record, its name, and how many rows of the next level the viewer may see under it. */
export interface AreaRow {
  id: string
  name: string
  count?: number
}

/** A picked area: the axis, the level picked at, and the row. */
export interface PickedArea {
  axis: string
  level: number
  table: string
  row: AreaRow
}

export function AreaPicker({ axes, holds, load, onUse, onCancel }: {
  axes: AreaAxis[]
  /** The Tables the field being filled can hold; another level shows but cannot be used yet. */
  holds: string[]
  /** A column's rows: the axis, the level, and the row picked in the column before it (none for the first). */
  load: (axis: AreaAxis, level: number, parent: AreaRow | null) => Promise<AreaRow[]>
  onUse: (area: PickedArea) => void
  onCancel: () => void
}) {
  const [axisName, setAxisName] = useState(axes[0]!.name)
  const axis = axes.find((a) => a.name === axisName)!
  const [picked, setPicked] = useState<AreaRow[]>([])
  const choose = (name: string) => { setAxisName(name); setPicked([]) }
  const pick = (level: number, row: AreaRow) => setPicked([...picked.slice(0, level), row])
  const back = () => setPicked(picked.slice(0, -1))
  // A column for each level picked so far, and the next one.
  const shownLevels = Math.min(axis.levels.length, picked.length + 1)
  const last = picked.length - 1
  const lastLevel = last >= 0 ? axis.levels[last]! : undefined
  const usable = lastLevel ? holds.includes(lastLevel.table) : false
  const holdsLabel = axis.levels.find((l) => holds.includes(l.table))?.label
  return (
    <div role="dialog" aria-label="Pick an area" data-testid="area-picker" className="@container flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-3 shadow-lg">
      <div className="flex items-center gap-1">
      {axes.length > 1 && (
        <div role="group" aria-label="Area by" className="flex gap-1">
          {axes.map((a) => (
            <button key={a.name} type="button" aria-pressed={a.name === axisName} onClick={() => choose(a.name)}
              className={cx('rounded-full px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-focus',
                a.name === axisName ? 'bg-action-tint font-medium text-action' : 'text-ink-muted hover:bg-subtle')}>
              {a.name}
            </button>
          ))}
        </div>
      )}
        <span className="flex-1" />
        {/* Closing is the picker's own, so it never sits beside the form's Cancel (UI owner). */}
        <button type="button" onClick={onCancel} aria-label="Close" title="Close" className={iconButtonClasses('size-7 text-ink-muted hover:text-ink')}>
          <X aria-hidden size={14} />
        </button>
      </div>
      {/* On a phone, one column at a time with a way back (G5). */}
      {picked.length > 0 && (
        <button type="button" onClick={back} aria-label="Back one level" className="self-start rounded px-1 text-sm text-ink-muted hover:text-ink @lg:hidden">← {axis.levels[last]!.label}</button>
      )}
      <div className="grid min-w-0 gap-3 @lg:auto-cols-[minmax(9rem,1fr)] @lg:grid-flow-col">
        {axis.levels.slice(0, shownLevels).map((level, i) => (
          <AreaColumn key={`${axis.name}:${i}:${picked[i - 1]?.id ?? ''}`} axis={axis} level={i} parent={picked[i - 1] ?? null}
            chosen={picked[i]?.id} onPick={(row) => pick(i, row)} load={load}
            narrowHidden={i !== shownLevels - 1} />
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border pt-3 text-sm" data-testid="area-bar">
        <span className="min-w-0" data-testid="area-words">
          <span className="text-ink-muted">Area: </span>
          {picked.length === 0 ? <span className="text-ink">{axis.whole}</span>
            : picked.map((row, i) => (
              <span key={row.id}>{i > 0 && <span className="text-ink-muted"> › </span>}
                <RecordLink table={axis.levels[i]!.table} rowId={row.id} name={row.name} />
              </span>
            ))}
        </span>
        <span className="flex-1" />
        {/* One action, named for the area (UI owner): off where the field cannot hold that level yet. */}
        <Button variant="primary" disabled={!usable} onClick={() => onUse({ axis: axis.name, level: last, table: lastLevel!.table, row: picked[last]! })}>
          {picked.length ? `Use ${picked[last]!.name}` : 'Use this area'}
        </Button>
      </div>
      {picked.length > 0 && !usable && holdsLabel && (
        <p className="text-xs text-ink-muted" data-testid="area-not-yet">Can be given at {holdsLabel} level for now</p>
      )}
    </div>
  )
}

function AreaColumn({ axis, level, parent, chosen, onPick, load, narrowHidden }: {
  axis: AreaAxis
  level: number
  parent: AreaRow | null
  chosen?: string
  onPick: (row: AreaRow) => void
  load: (axis: AreaAxis, level: number, parent: AreaRow | null) => Promise<AreaRow[]>
  narrowHidden: boolean
}) {
  const [rows, setRows] = useState<AreaRow[] | null>(null)
  useEffect(() => {
    let live = true
    void load(axis, level, parent).then((found) => { if (live) setRows(found) }, () => { if (live) setRows([]) })
    return () => { live = false }
    // The column is keyed by its axis, level and parent, so it loads once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const here = axis.levels[level]!
  const below = axis.levels[level + 1]
  return (
    <section aria-label={here.label} data-testid="area-column" className={cx('flex min-w-0 flex-col gap-1', narrowHidden && 'hidden @lg:flex')}>
      <h3 className="px-2 text-xs font-semibold text-ink-muted">{here.label}</h3>
      {rows === null ? <p className="px-2 text-sm text-ink-subtle">Loading…</p>
        : !rows.length ? <p className="px-2 text-sm text-ink-muted">None</p>
        : (
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => onPick(row)} aria-pressed={row.id === chosen}
                  className={cx('flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-focus',
                    row.id === chosen ? 'bg-action-tint text-action' : 'text-ink hover:bg-subtle')}>
                  <span className="min-w-0 break-words">{row.name}</span>
                  {below && row.count !== undefined && <span className="shrink-0 text-xs text-ink-muted">{fmtCount(row.count)} {row.count === 1 ? below.label.toLowerCase() : below.plural}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
