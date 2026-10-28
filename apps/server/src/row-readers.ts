import { getMeta, type TableMeta } from './meta'
import { filterReadFields, isSharedWith, permittedTiers } from './permissions'

type RowValues = Record<string, unknown>
export type Tiers = Set<'basic' | 'restricted'>
export const allTiers = (): Tiers => new Set(['basic', 'restricted'])

// #341: the tiers one reader holds on a row and on each of its sub-tables.
export interface RowReader {
  tiers: Tiers
  childTiers: (childTable: string) => Promise<Tiers>
}

export const FULL_READER: RowReader = { tiers: allTiers(), childTiers: async () => allTiers() }

// #340: what leaves the platform (a webhook's body, an email rule's text) is
// read by nobody in particular, so it carries the basic tier only.
export const OUTSIDE_READER: RowReader = {
  tiers: new Set(['basic']),
  childTiers: async () => new Set(['basic']),
}

// #341: a child row is read through its parent, so the parent's grant
// reaches its columns; a grant on the sub-table itself does too, because a
// direct list of that sub-table already shows what it allows.
export async function readerFor(user: string, table: string, action: 'read' | 'write'): Promise<RowReader> {
  const tiers = await permittedTiers(user, table, action)
  return {
    tiers,
    childTiers: async (childTable) => new Set([...tiers, ...(await permittedTiers(user, childTable, action))]),
  }
}

// #341: a loaded row as one reader may see it — columns above their tiers
// dropped from the row and from every sub-table row it carries.
export async function restrictRow(meta: TableMeta, row: RowValues, reader: RowReader): Promise<RowValues> {
  const out = filterReadFields(meta.columns, reader.tiers, row)
  for (const f of meta.columns) {
    if (f.column_type !== 'Sub-table' || !Array.isArray(out[f.column_name])) continue
    const childMeta = await getMeta(f.row_table!)
    const tiers = await reader.childTiers(childMeta.name)
    out[f.column_name] = (out[f.column_name] as RowValues[]).map((r) => filterReadFields(childMeta.columns, tiers, r))
  }
  return out
}

// #341: the reply to a save, submit or cancel — the saved row as its caller
// may read it, without asserting read access the write already settled. As
// when the row is opened, a share shows every column.
export async function rowForCaller(table: string, row: RowValues, user: string): Promise<RowValues> {
  const shared = row.row_id != null && (await isSharedWith(user, table, String(row.row_id), 'read'))
  return restrictRow(await getMeta(table), row, shared ? FULL_READER : await readerFor(user, table, 'read'))
}

// #342: Comment and Version rows are about one row each (ref_table,
// ref_name), so they are read through that row's access, not the grant on
// their own Table alone. #609: so is a File attached to a row; one attached
// to a whole Table, or to nothing, stays with the File grant.
export const ROW_ATTACHED_TABLES = new Set(['Comment', 'Version', 'File', 'Import Conflict', 'Import Source'])

// #342: a Version's diff can carry any column of its row, so a reader whose
// tiers stop short of a column the Table restricts reads its history only
// through the row's activity, which filters each change.
export async function seesEveryColumn(user: string, meta: TableMeta): Promise<boolean> {
  if (!meta.columns.some((f) => f.tier === 'restricted')) return true
  return (await permittedTiers(user, meta.name, 'read')).has('restricted')
}
