import { useQueries } from '@tanstack/react-query'
import { choiceLabel, RELATED_OPS } from 'shared'
import type { ListFilter } from 'shared'
import { linkRowsTable, metaQuery, type TableMeta } from './meta'
import { stepKind, stepRefs, type NavStep } from './nav-path'
import { rowNameText, useRowNames, type RowName } from './relations'

// #910 checklist 11: each step of the path is named for whoever is looking —
// the list's Table, a filter's column and value, a row's name — through the
// same permission-scoped title lookup as the list, so a step on a row the
// viewer cannot read never shows its name or its id.

type Ref = { table: string; row_id: string }
const keyOf = (r: Ref) => `${r.table}\u0000${r.row_id}`

const ONE = ['=', '!=']
const MANY = ['in', 'not in']

/** The rows a filter names: a link column's (or the row id's) value, or each
 *  of its values for `in` and `not in`. */
export function filterRefs(table: string, meta: TableMeta | undefined, [column, op, value]: ListFilter): Ref[] {
  const related = relatedTarget(op, value)
  if (related) return (related.filters ?? []).flatMap((f) => filterRefs(related.table, undefined, f))
  const col = meta?.columns.find((c) => c.column_name === column)
  const target = column === 'row_id' ? table
    : col?.column_type === 'Reference' && col.reference_table ? linkRowsTable(col)
    : undefined
  if (!target) return []
  const values = ONE.includes(op) ? [value] : MANY.includes(op) && Array.isArray(value) ? value : []
  return values
    .filter((v) => (typeof v === 'string' || typeof v === 'number') && String(v) !== '')
    .map((v) => ({ table: target, row_id: String(v) }))
}

/** A relationship filter's target (nav-path.ts validates its shape). */
function relatedTarget(op: string, value: unknown): { table: string; filters?: ListFilter[] } | undefined {
  return (RELATED_OPS as readonly string[]).includes(op) && typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as { table: string; filters?: ListFilter[] } : undefined
}

/** A filter as its step reads: "Region: Kerala · KL", "Region in Kerala · KL,
 *  Tamil Nadu · TN". Until the table's columns are known, its value is a
 *  placeholder, since it may be a row's id. */
export function filterText(table: string, meta: TableMeta | undefined, filter: ListFilter, name: (r: Ref) => string): string {
  const [column, op, value] = filter
  // A relationship filter reads as the rows it relates to: "Nv Site: Enchakkal · ENK".
  const related = relatedTarget(op, value)
  if (related) {
    const refs = filterRefs(table, meta, filter)
    const named = `${related.table}${refs.length ? `: ${refs.map(name).join(', ')}` : ''}`
    return op === 'related' ? named : `not ${named}`
  }
  const col = meta?.columns.find((c) => c.column_name === column)
  const label = column === 'row_id' ? 'Row ID' : col?.label ?? column
  const refs = filterRefs(table, meta, filter)
  const shown = !meta ? '…'
    : refs.length ? refs.map(name).join(', ')
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
    for (const f of step.filters ?? [])
      for (const r of filterRefs(step.table, metaOf(step.table), f)) refs.set(keyOf(r), r)
  }
  const list = [...refs.values()]
  const names = useRowNames(list)
  const nameOf = new Map<string, RowName>(list.map((r, i) => [keyOf(r), names[i]]))
  const name = (r: Ref) => rowNameText(nameOf.get(keyOf(r)) ?? { state: 'loading' })
  const filterLabel = (step: NavStep) => step.filters!.map((f) => filterText(step.table, metaOf(step.table), f, name)).join(', ')
  return steps.map((step, i) => {
    const kind = stepKind(step)
    // A filter added with a row in the pane is named by the filter, not again by the row.
    const before = steps[i - 1]
    if (step.filters?.length && before?.pane && step.pane && before.pane.table === step.pane.table && before.pane.row === step.pane.row
      && JSON.stringify(before.filters ?? []) !== JSON.stringify(step.filters)) return filterLabel(step)
    if (kind === 'pane' || kind === 'group') return name({ table: step.pane!.table, row_id: step.pane!.row })
    if (kind === 'row') return name({ table: step.table, row_id: step.row! })
    if (kind === 'filter') return filterLabel(step)
    return step.table
  })
}
