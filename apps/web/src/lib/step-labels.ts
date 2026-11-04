import { useQueries } from '@tanstack/react-query'
import { choiceLabel } from 'shared'
import type { ListFilter } from 'shared'
import { metaQuery, type TableMeta } from './meta'
import { stepKind, stepRefs, type NavStep } from './nav-path'
import { rowNameText, useRowNames, type RowName } from './relations'

// #910 checklist 11: each step of the path is named for whoever is looking —
// the list's Table, a filter's column and value, a row's name — through the
// same permission-scoped title lookup as the list, so a step on a row the
// viewer cannot read never shows its name or its id.

type Ref = { table: string; row_id: string }
const keyOf = (r: Ref) => `${r.table}\u0000${r.row_id}`

function linkedFilter(meta: TableMeta | undefined, [column, op, value]: ListFilter): Ref | null {
  const col = meta?.columns.find((c) => c.column_name === column)
  if (col?.column_type !== 'Reference' || !col.reference_table || (op !== '=' && op !== '!=')) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  return String(value) ? { table: col.reference_table, row_id: String(value) } : null
}

function filterText(meta: TableMeta | undefined, filter: ListFilter, name: (r: Ref) => string): string {
  const [column, op, value] = filter
  const col = meta?.columns.find((c) => c.column_name === column)
  const label = column === 'row_id' ? 'Row ID' : col?.label ?? column
  const ref = linkedFilter(meta, filter)
  const shown = ref ? name(ref)
    : col?.column_type === 'Choice' && typeof value === 'string' ? choiceLabel(value, col.choice_labels)
    : op === 'like' && typeof value === 'string' ? value.replace(/^%|%$/g, '')
    : Array.isArray(value) ? value.join(', ')
    : typeof value === 'object' && value ? (value as { table?: string }).table ?? ''
    : String(value)
  if (op === '=' || op === 'like') return `${label}: ${shown}`
  return `${label} ${op} ${shown}`
}

/** One label per step, in order. */
export function useStepLabels(steps: NavStep[]): string[] {
  const tables = [...new Set(steps.map((s) => s.table))]
  const metas = useQueries({ queries: tables.map((t) => metaQuery(t)) })
  const metaOf = (t: string) => metas[tables.indexOf(t)]?.data
  const refs = new Map<string, Ref>()
  for (const step of steps) {
    for (const r of stepRefs(step)) refs.set(keyOf(r), r)
    for (const f of step.filters ?? []) {
      const r = linkedFilter(metaOf(step.table), f)
      if (r) refs.set(keyOf(r), r)
    }
  }
  const list = [...refs.values()]
  const names = useRowNames(list)
  const nameOf = new Map<string, RowName>(list.map((r, i) => [keyOf(r), names[i]]))
  const name = (r: Ref) => rowNameText(nameOf.get(keyOf(r)) ?? { state: 'loading' })
  return steps.map((step) => {
    const kind = stepKind(step)
    if (kind === 'pane' || kind === 'group') return name({ table: step.pane!.table, row_id: step.pane!.row })
    if (kind === 'row') return name({ table: step.table, row_id: step.row! })
    if (kind === 'filter') return step.filters!.map((f) => filterText(metaOf(step.table), f, name)).join(', ')
    return step.table
  })
}
