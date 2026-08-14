import { useMeta } from './meta'
import { useBacklinks, type Backlink } from './connections'

// The shared chain-step seam for Explore (#100 pattern 4) and its entry
// points. One pure builder derives every legal chain step for a table —
// its Sub-table columns (children) plus its Reference backlinks, direct
// and via-sub-table — and three consumers use it: Explore's StepPicker,
// ListView's Explore split button, and RelationMap's "Open in Explore".
// `parseChain` / `parseSelect` validate the Explore route's URL params the
// #87 parseFilters way: a URL is user input, so malformed values are
// discarded, never thrown.

export interface Step {
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

export interface StepOption {
  key: string
  label: string
  step: Step
}

export function stepKey(s: Step): string {
  return `${s.mode}:${s.table}:${s.column}${s.via ? `:${s.via}` : ''}`
}

type MetaColumns = {
  columns: {
    column_name: string
    label: string | null
    column_type: string
    row_table: string | null
  }[]
}

// Every legal chain step out of `table`: children first, then backlinks —
// keyed and filtered by the Sub-table COLUMN, not just the row table, since
// two columns backed by the same row table are distinct steps (#106 review).
export function stepOptions(meta: MetaColumns | undefined, backlinks: Backlink[] | undefined): StepOption[] {
  const options: StepOption[] = []
  for (const f of meta?.columns ?? [])
    if (f.column_type === 'Sub-table' && f.row_table)
      options.push({
        key: `child:${f.row_table}:${f.column_name}`,
        label: `${f.row_table} (${f.label ?? f.column_name})`,
        step: { mode: 'child', table: f.row_table, column: f.column_name },
      })
  for (const bl of backlinks ?? [])
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
  return options
}

// The two queries behind stepOptions, as one hook — the seam the UI
// consumers share. `ready` distinguishes "no steps" from "still loading".
export function useStepOptions(table: string | undefined) {
  const meta = useMeta(table ?? '')
  const backlinks = useBacklinks(table ?? '', Boolean(table))
  return {
    options: table ? stepOptions(meta.data, backlinks.data?.backlinks) : [],
    ready: Boolean(table && meta.data && backlinks.data),
  }
}

function isStep(value: unknown): value is Step {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  if (s.mode !== 'backlink' && s.mode !== 'child' && s.mode !== 'viabacklink') return false
  if (typeof s.table !== 'string' || typeof s.column !== 'string') return false
  if (s.mode === 'viabacklink') return typeof s.via === 'string'
  return s.via === undefined
}

// `?chain=` — up to two steps initializing Explore's step2/step3. Shape-level
// validation only; resolution against the live meta/backlinks (a stale URL
// naming a dropped column) happens stage-by-stage in ExploreView. A step that
// fails drops itself AND everything after it — a chain is only meaningful as
// a prefix.
export function parseChain(raw: string | undefined): Step[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const steps: Step[] = []
  for (const entry of value.slice(0, 2)) {
    if (!isStep(entry)) break
    steps.push(
      entry.via === undefined
        ? { mode: entry.mode, table: entry.table, column: entry.column }
        : { mode: entry.mode, table: entry.table, column: entry.column, via: entry.via },
    )
  }
  return steps
}

// `?select=` — row names preselected in pane 1. Names that no longer exist
// are harmless: they select nothing and downstream filters simply miss them.
export function parseSelect(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value) && value.every((n) => typeof n === 'string')) return value as string[]
  } catch {
    /* invalid select is just no selection */
  }
  return []
}
