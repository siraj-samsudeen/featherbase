// #738 (list-columns-from-the-table, Decision 1): which columns one person's
// list shows — two sets on top of the Table's list columns:
//   Row ID + (list columns ∪ shownCols) − hiddenCols, in the Table's column order.
import { NO_COLUMN_TYPES, type ColumnDef, type TableMeta } from './meta'

/** One person's arrangement of a list's columns, as saved in user_settings.
 *  An arrangement saved before #738 has no shownCols and reads as before. */
export interface ColumnArrangement {
  shownCols?: string[]
  hiddenCols?: string[]
}

export interface ListColumn {
  column_name: string
  label: string
  column_type: string
  reference_table?: string | null
}

export const ROW_ID_COLUMN: ListColumn = { column_name: 'row_id', label: 'Row ID', column_type: 'Data' }

function toListColumn(c: ColumnDef): ListColumn {
  return {
    column_name: c.column_name,
    label: c.label ?? c.column_name,
    column_type: c.column_type,
    reference_table: c.reference_table ?? null,
  }
}

/** The data columns a list may show, in the Table's column order. */
export function dataColumns(meta: TableMeta): ColumnDef[] {
  return meta.columns.filter((c) => !NO_COLUMN_TYPES.has(c.column_type) && !c.hidden)
}

/** The Table's list columns: the flagged ones, or the first two data columns
 *  when none is flagged. */
export function defaultColumnNames(meta: TableMeta): Set<string> {
  const data = dataColumns(meta)
  const flagged = data.filter((c) => c.in_list_view)
  return new Set((flagged.length ? flagged : data.slice(0, 2)).map((c) => c.column_name))
}

/** Whether one data column shows in this person's view. */
export function isShown(name: string, defaults: Set<string>, arrangement: ColumnArrangement): boolean {
  if (arrangement.hiddenCols?.includes(name)) return false
  return defaults.has(name) || Boolean(arrangement.shownCols?.includes(name))
}

/** What this person's list shows: Row ID first, then each shown data column. */
export function viewColumns(meta: TableMeta, arrangement: ColumnArrangement): ListColumn[] {
  const defaults = defaultColumnNames(meta)
  return [
    ROW_ID_COLUMN,
    ...dataColumns(meta)
      .filter((c) => isShown(c.column_name, defaults, arrangement))
      .map(toListColumn),
  ]
}

/** Switches one column on or off in this person's view. Switching on takes
 *  it out of hidden and, when it isn't a list column, adds it to shown;
 *  switching off does the reverse — so neither set holds a redundant entry. */
export function switchColumn(
  meta: TableMeta,
  arrangement: ColumnArrangement,
  name: string,
  on: boolean,
): Required<ColumnArrangement> {
  const inList = defaultColumnNames(meta).has(name)
  const shown = (arrangement.shownCols ?? []).filter((c) => c !== name)
  const hidden = (arrangement.hiddenCols ?? []).filter((c) => c !== name)
  if (on && !inList) shown.push(name)
  if (!on && inList) hidden.push(name)
  return { shownCols: shown, hiddenCols: hidden }
}
