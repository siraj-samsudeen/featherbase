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

/**
 * The far side of one row of a group pointing at `record`. `backLink` is the
 * row's column pointing back (unknown for a group linked through a sub-table);
 * any link holding the record's id is passed over as well. `own` are the values
 * of the record's own links.
 */
export function farSide(meta: TableMeta, row: Row, opts: { backLink?: string; record: string; own: Iterable<string> }): FarSide | undefined {
  // Only a link table reads through: a section keeps its name, never its floor.
  if (!isLinkTable(meta)) return undefined
  const skip = new Set([opts.record, ...opts.own])
  for (const c of readableLinks(meta)) {
    const value = row[c.column_name]
    if (c.column_name === opts.backLink || isBlank(value) || skip.has(String(value))) continue
    return { column: c.column_name, label: c.label ?? c.column_name, table: linkRowsTable(c)!, row_id: String(value) }
  }
  return undefined
}

/** The one Table every row's far side is in, or none when any row has no far
 *  side or they differ. */
export function farSideTable(sides: (FarSide | undefined)[]): string | undefined {
  const tables = new Set(sides.map((s) => s?.table))
  const [only] = tables
  return tables.size === 1 && only ? only : undefined
}

const FACT_TYPES = new Set(['Date', 'Datetime', 'Choice'])

/** The row's facts worth a small line under its name: its dates and statuses,
 *  never a code or a link, at most two, only those with values. */
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
