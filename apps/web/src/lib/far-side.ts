// Relational navigation slice 1 (#1218): a group's rows read by what they point
// to. A row of a link table (its title is its own id) in a group is named by its far
// side: its first readable link, with a value, that is neither the link back to
// the record nor a link holding one of the record's own values (a Section
// Subcategory's store is the section's own site). With none, the row keeps its
// own name. One rule for the record panel, the Tree and the Map.
import { dataColumns, isLinkTable, readableLinks, titleListColumn } from './list-view-columns'
import { linkRowsTable, type ColumnDef, type TableMeta } from './meta'

type Row = Record<string, unknown>

/** The row a group's row points to, through one of its links. */
export interface FarSide {
  column: string
  label: string
  table: string
  row_id: string
}

const isBlank = (v: unknown) => v == null || String(v).trim() === ''

/** How many of a group's rows show before "Show all N". */
export const GROUP_ROWS = 10

/** One record: its Table and its id. An id alone may repeat across Tables. */
export interface RecordRef {
  table: string
  row_id: string
}

const key = (r: RecordRef) => `${r.table}\u0000${r.row_id}`

/**
 * The far sides of one row of a group pointing at `record`: its readable links
 * with a value, in column order, passing over the link back (`backLink`; unknown
 * for a group linked through a sub-table), any link to the record itself, and
 * any link to one of the records the record's own links point to (`own`).
 * Records match by Table and id together. A second link into a Table already
 * named (an assignment's Reports to beside its Employee) is no new side. At
 * most two: a section subcategory seen from its site reads "Sarees › Silk sarees".
 */
export function farSides(meta: TableMeta, row: Row, opts: { backLink?: string; record: RecordRef; own: Iterable<RecordRef> }): FarSide[] {
  // Only a Table whose rows only link reads through: a section keeps its name, never its
  // floor. #1273: a Table with no title is one too, as the tick list treats it.
  if (!linksOnly(meta)) return []
  const skip = new Set([opts.record, ...opts.own].map(key))
  const sides: FarSide[] = []
  for (const c of readableLinks(meta)) {
    const value = row[c.column_name]
    if (c.column_name === opts.backLink || isBlank(value)) continue
    const target = { table: linkRowsTable(c)!, row_id: String(value) }
    if (skip.has(key(target)) || sides.some((s) => s.table === target.table)) continue
    sides.push({ column: c.column_name, label: c.label ?? c.column_name, ...target })
    if (sides.length === 2) break
  }
  return sides
}

/** A Table whose rows only link others (#1273): its title is its own id, or it
 *  has no title at all. Its rows read by their far side, and its group can tick it. */
export function linksOnly(meta: TableMeta): boolean {
  return isLinkTable(meta) || !titleListColumn(meta)
}

/** The one Table the group's rows point to, when every row has exactly one far
 *  side and all are in that Table; else none (the group keeps its own name). */
export function farSideTable(rows: FarSide[][]): string | undefined {
  const tables = new Set(rows.map((sides) => (sides.length === 1 ? sides[0]!.table : undefined)))
  const [only] = tables
  return tables.size === 1 && only ? only : undefined
}

/** The far-side record's code, after its name: kept when it is a code people use
 *  (an employee's 2001), dropped when it only spells the name again inside a
 *  composed key ("LKS-Bags & Silk-2026-11-17"). */
export function farSideCode(title: string, code: string | undefined): string | undefined {
  return code && !code.toLowerCase().includes(title.trim().toLowerCase()) ? code : undefined
}

const FACT_TYPES = new Set(['Date', 'Datetime', 'Choice', 'Check'])

/** The row's facts worth a small line under its name: its dates and statuses,
 *  never a code or a link, at most two, only those with values. A yes/no
 *  reads with its label, "Passed ✓", since a bare tick says nothing. */
export function groupFacts(meta: TableMeta, row: Row, max = 2): ColumnDef[] {
  return factColumns(meta).filter((c) => !isBlank(row[c.column_name])).slice(0, max)
}

function factColumns(meta: TableMeta): ColumnDef[] {
  const title = titleListColumn(meta)
  return dataColumns(meta).filter((c) => c !== title && FACT_TYPES.has(c.column_type))
}

/** The fields a group's rows are read with: the id, the title, the readable
 *  links (the far side) and the facts. */
export function groupRowFields(meta: TableMeta): string[] {
  const title = titleListColumn(meta)
  return [...new Set([
    'row_id',
    ...(title ? [title.column_name] : []),
    // rowDisplayTitle builds a name from the row's values when there is no title.
    ...(title ? [] : dataColumns(meta).map((c) => c.column_name)),
    ...readableLinks(meta).map((c) => c.column_name),
    ...factColumns(meta).map((c) => c.column_name),
  ])]
}

/**
 * A Map group box in words: the far-side Table when every row points to one
 * ("Employee", "through Job Assignment"), else the group's own Table; the link
 * only when the group's Table points at the record by more than one.
 */
export function groupBoxWords({ group, farSide, via }: { group: string; farSide?: string; via?: string }): { title: string; detail?: string } {
  const detail = [farSide ? `through ${group}` : '', via ? `via ${via}` : ''].filter(Boolean).join(' · ')
  return detail ? { title: farSide ?? group, detail } : { title: farSide ?? group }
}
