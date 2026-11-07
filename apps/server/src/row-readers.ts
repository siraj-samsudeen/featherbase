import { getMeta, type TableMeta } from './meta'
import { ALL_COLUMNS, filterReadFields, grantsHolding, includesColumn, isPrivileged, isSharedWith, permissionGrants, permissionScope, permittedColumns, reachColumns, reachGrants, type ColumnSelection } from './permissions'

type RowValues = Record<string, unknown>

export interface RowReader {
  columns: ColumnSelection
  childColumns: (childTable: string, parentColumn: string) => Promise<ColumnSelection>
}

// Spelled out, not ALL_COLUMNS: permissions.ts reaches this module through
// mandatory-access.ts, so its constants are not initialised yet here.
export const FULL_READER: RowReader = { columns: new Set(['*']), childColumns: async () => new Set(['*']) }

// #340: what leaves the platform (a webhook's body, an email rule's text) is
// read by nobody in particular, so it carries the basic tier only.
export const OUTSIDE_READER: RowReader = {
  columns: new Set(['@basic']),
  childColumns: async () => new Set(['@basic']),
}

export async function childColumns(user: string, table: string, childTable: string, parentColumn: string, action: 'read' | 'write' | 'create', createdBy?: string): Promise<ColumnSelection> {
  if (await isPrivileged(user)) return new Set(ALL_COLUMNS)
  const columns = await permittedColumns(user, childTable, action, createdBy)
  const link = (await getMeta(table)).columns.find((column) => column.row_id === parentColumn)
  if (!link) return columns
  for (const grant of await permissionGrants(user, table, action)) {
    if (!includesColumn(new Set(grant.columns), link)) continue
    if (createdBy !== undefined && grant.scope === 'own_rows' && createdBy !== user) continue
    // A level grant reaches the line items' Columns of the same level, as the
    // parent's level always did; a listed grant reaches only listed children.
    for (const level of grant.columns) if (level === '*' || level === '@basic') columns.add(level)
    for (const child of await permissionGrants(user, childTable, action, grant.id, parentColumn)) {
      if (createdBy !== undefined && child.scope === 'own_rows' && createdBy !== user) continue
      for (const column of child.columns) columns.add(column)
    }
  }
  return columns
}

export async function readerFor(user: string, table: string, action: 'read' | 'write', createdBy?: string, reach: string[] = []): Promise<RowReader> {
  return {
    // #919: and the Columns of the reach grants that reach the row.
    columns: new Set([...await permittedColumns(user, table, action, createdBy), ...reach]),
    childColumns: (childTable, parentColumn) => childColumns(user, table, childTable, parentColumn, action, createdBy),
  }
}

// #341: a loaded row as one reader may see it — columns above their tiers
// dropped from the row and from every sub-table row it carries.
export async function restrictRow(meta: TableMeta, row: RowValues, reader: RowReader): Promise<RowValues> {
  const out = filterReadFields(meta.columns, reader.columns, row)
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table' || !Array.isArray(out[f.column_name])) continue
    const childMeta = await getMeta(f.row_table!)
    const columns = await reader.childColumns(childMeta.name, f.row_id)
    out[f.column_name] = (out[f.column_name] as RowValues[]).map((r) => filterReadFields(childMeta.columns, columns, r))
  }
  return out
}

// #341: the reply to a save, submit or cancel — the saved row as its caller
// may read it, without asserting read access the write already settled. As
// when the row is opened, a share shows every column.
export async function rowForCaller(table: string, row: RowValues, user: string): Promise<RowValues> {
  const shared = row.row_id != null && (await isSharedWith(user, table, String(row.row_id), 'read'))
  // #919: a row its caller reads through reach shows the Columns reach reads.
  const reach = shared || (await permissionScope(user, table, 'read')) === 'all' ? []
    : reachColumns(await grantsHolding(table, await reachGrants(user, table, 'read'), row, false))
  return restrictRow(await getMeta(table), row, shared ? FULL_READER : await readerFor(user, table, 'read', String(row.created_by), reach))
}

// #342: Comment and Version rows are about one row each (ref_table,
// ref_name), so they are read through that row's access, not the grant on
// their own Table alone. #609: so is a File attached to a row; one attached
// to a whole Table, or to nothing, stays with the File grant.
export const SENSITIVE_HISTORY_TABLES = new Set(['Version', 'Import Conflict', 'Import Source'])

export const ROW_ATTACHED_TABLES = new Set(['Comment', 'Version', 'File', 'Import Conflict', 'Import Source'])

// #342: a Version's diff can carry any column of its row, so a reader whose
// tiers stop short of a column the Table restricts reads its history only
// through the row's activity, which filters each change.
export async function seesEveryColumn(user: string, meta: TableMeta, createdBy = ''): Promise<boolean> {
  const reader = await readerFor(user, meta.name, 'read', createdBy)
  if (!meta.columns.every((column) => includesColumn(reader.columns, column))) return false
  for (const column of meta.columns.filter((column) => column.column_type === 'Sub-table')) {
    const child = await getMeta(column.row_table!)
    const selected = await reader.childColumns(child.name, column.row_id)
    if (!child.columns.every((column) => includesColumn(selected, column))) return false
  }
  return true
}
