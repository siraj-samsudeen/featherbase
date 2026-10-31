// #738 (list-columns-from-the-table): which columns one person's list shows.
import { listColumns, type TableMeta } from './meta'

/** One person's arrangement of a list's columns, as saved in user_settings. */
export interface ColumnArrangement {
  shownCols?: string[]
  hiddenCols?: string[]
}

export function viewColumns(meta: TableMeta, arrangement: ColumnArrangement) {
  const hidden = new Set(arrangement.hiddenCols ?? [])
  return listColumns(meta).filter((c) => !hidden.has(c.column_name))
}
