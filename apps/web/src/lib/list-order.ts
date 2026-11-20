import { dataColumns } from './list-view-columns'
import type { TableMeta } from './meta'

export interface ListSort { field: string; dir: 'asc' | 'desc' }

/**
 * The order a list shows its rows in (#1282 A4): the person's sort, else the Table's default's, else the Table's
 * own order. The list and the walk through it (#1343) both ask here, so "3 of 12" counts the rows as they were seen.
 *
 * A default sorted by a column this person may not read gives way to the Table's own order (Codex adversarial
 * round 2): the server refuses a sort on a column the viewer can't read, which would fail the whole list.
 */
export function listOrder(meta: TableMeta | undefined, own: ListSort | null | undefined, tableDefault: ListSort | null | undefined,
  defaultOrderBy?: string): { shownSort: ListSort | null; orderBy: string | undefined } {
  const readable = (field: string) => ['row_id', 'created_at', 'updated_at'].includes(field)
    || (meta ? dataColumns(meta).some((c) => c.column_name === field) : false)
  const shownSort = own ?? (tableDefault && readable(tableDefault.field) ? tableDefault : null)
  if (shownSort) return { shownSort, orderBy: `${shownSort.field} ${shownSort.dir}` }
  if (defaultOrderBy) return { shownSort, orderBy: defaultOrderBy }
  if (!meta) return { shownSort, orderBy: undefined }
  // A bound table only has updated_at when the source table has a modified column to map (external_modified);
  // sending it as the explicit order makes the server refuse every list load (#176).
  const boundNoRevision = Boolean(meta.data_source && !meta.external_modified)
  const column = boundNoRevision && meta.sort_column === 'updated_at' ? '' : (meta.sort_column ?? '')
  return { shownSort, orderBy: `${column || (boundNoRevision ? 'row_id' : 'updated_at')} ${meta.sort_order || 'desc'}` }
}
