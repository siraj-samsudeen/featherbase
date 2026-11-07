import { accessPolicySchema, type AccessPolicy } from './access-policy'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { getRoles } from './permissions'
import { readOnce } from './permission-reads'
import { tableRelation } from './table-engine'
import { ROW_ATTACHED_TABLES } from './row-readers'

const recordedReferences: Record<string, readonly [string, string]> = {
  Share: ['share_table', 'share_name'],
  'Access Log': ['ref_table', 'reference_name'],
}

export async function needsMandatoryRowRead(table: string): Promise<boolean> {
  if (ROW_ATTACHED_TABLES.has(table) || Object.hasOwn(recordedReferences, table)) return true
  const [row] = await sql`select kind, to_jsonb(d)->'access_policy' as policy from table_def d where name = ${table}`
  return !!row?.policy || row?.kind === 'sub_table'
}

export async function tableAccessPolicy(table: string): Promise<AccessPolicy | undefined> {
  // Permission probes also name unavailable or absent Tables. Read only the
  // persisted ceiling here; metadata loading applies app availability later.
  // to_jsonb also works while older bootstrap migrations precede this column.
  const [row] = await readOnce(JSON.stringify(['access policy', table]), () => sql`select to_jsonb(d)->'access_policy' as policy from table_def d where name = ${table}`)
  return row?.policy == null ? undefined : accessPolicySchema.parse(row.policy)
}

/** Signed or public storage URLs never override a protected row's access. */
export async function hasMandatoryRowAccess(table: string, rowId: string, depth = 0): Promise<boolean> {
  if (depth > 8) return true
  if (await tableAccessPolicy(table)) return true
  const meta = await getMeta(table).catch(() => null)
  if (meta?.kind === 'sub_table') {
    const [row] = await sql`select parenttype, parent from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${rowId}`
    return !!row?.parenttype && !!row?.parent && hasMandatoryRowAccess(String(row.parenttype), String(row.parent), depth + 1)
  }
  if (!ROW_ATTACHED_TABLES.has(table)) return false
  const [row] = await sql`select ref_table, ref_name from ${sql(await tableRelation(table))} where row_id = ${rowId}`
  return !!row?.ref_table && !!row?.ref_name && hasMandatoryRowAccess(String(row.ref_table), String(row.ref_name), depth + 1)
}

export async function admittedToTable(user: string, table: string): Promise<boolean> {
  const policy = await tableAccessPolicy(table)
  if (!policy) return true
  const roles = await getRoles(user)
  return policy.roles.some(role => roles.includes(role))
}

export async function assertMandatoryAccess(user: string, meta: TableMeta, row: Record<string, unknown>, depth = 0): Promise<void> {
  if (depth > 8) throw new AppError('PermissionError', 'This work is not available to you')
  if (meta.kind === 'sub_table' && row.parenttype && row.parent) {
    const parent = await getMeta(String(row.parenttype))
    const [value] = await sql`select * from ${sql(await tableRelation(parent.name))} where ${sql(parent.row_key)} = ${String(row.parent)}`
    if (value) await assertMandatoryAccess(user, parent, value, depth + 1)
  }
  const reference = Object.hasOwn(recordedReferences, meta.name) ? recordedReferences[meta.name] : undefined
  if (reference && row[reference[0]] && row[reference[1]]) {
    const targetName = String(row[reference[0]])
    if (await tableAccessPolicy(targetName)) {
      const target = await getMeta(targetName)
      const [value] = await sql`select * from ${sql(await tableRelation(targetName))} where ${sql(target.row_key)} = ${String(row[reference[1]])}`
      if (!value) throw new AppError('PermissionError', 'This work is not available to you')
      await assertMandatoryAccess(user, target, value, depth + 1)
    }
  }
  const policy = meta.access_policy
  if (!policy) return
  if (depth > 8 || !(await admittedToTable(user, meta.name)))
    throw new AppError('PermissionError', 'This work is not available to you')
  const parentId = policy.inherit_column && row[policy.inherit_column]
  if (parentId) {
    const reference = meta.columns.find(c => c.column_name === policy.inherit_column)!
    const parent = await getMeta(reference.reference_table!)
    const [value] = await sql`select * from ${sql(await tableRelation(parent.name))} where ${sql(parent.row_key)} = ${String(parentId)}`
    if (!value) throw new AppError('PermissionError', 'This work is not available to you')
    return assertMandatoryAccess(user, parent, value, depth + 1)
  }
  if ((policy.inherit_column && !policy.shared_column) || (policy.shared_column && !row[policy.shared_column] && row.created_by !== user))
    throw new AppError('PermissionError', 'This work is not available to you')
}

// Box the SQL fragment: returning a bare thenable would execute it.
export async function mandatoryWhere(meta: TableMeta, user: string, alias?: string, depth = 0): Promise<{ frag: ReturnType<typeof sql> }> {
  const policy = meta.access_policy
  if (!policy) {
    const reference = Object.hasOwn(recordedReferences, meta.name) ? recordedReferences[meta.name] : undefined
    return reference ? mandatoryReferencesWhere(user, ...reference) : { frag: sql`true` }
  }
  if (depth > 8 || !(await admittedToTable(user, meta.name))) return { frag: sql`false` }
  const relation = alias ?? await tableRelation(meta.name)
  const field = (name: string) => sql`${sql(relation)}.${sql(name)}`
  const base: ReturnType<typeof sql> = policy.shared_column
    ? sql`(${field(policy.shared_column)} is true or ${field('created_by')} = ${user})`
    : policy.inherit_column ? sql`false` : sql`true`
  if (!policy.inherit_column) return { frag: base }
  const reference = meta.columns.find(c => c.column_name === policy.inherit_column)!
  const parent = await getMeta(reference.reference_table!)
  const parentAlias = `privacy_parent_${depth}`
  const inherited = await mandatoryWhere(parent, user, parentAlias, depth + 1)
  return { frag: sql`((${field(policy.inherit_column)} is null and ${base}) or ${field(policy.inherit_column)} in (
    select ${sql(parentAlias)}.${sql(parent.row_key)} from ${sql(await tableRelation(parent.name))} as ${sql(parentAlias)} where ${inherited.frag}))` }
}

/** Audit streams also carry row references outside the document list path. */
export async function mandatoryReferencesWhere(user: string, tableColumn: string, rowColumn: string): Promise<{ frag: ReturnType<typeof sql> }> {
  const protectedTables = await sql`select name from table_def d where to_jsonb(d)->'access_policy' is not null and to_jsonb(d)->'access_policy' <> 'null'::jsonb`
  let result: ReturnType<typeof sql> = sql`true`
  for (const target of protectedTables) {
    const meta = await getMeta(String(target.name)).catch(() => null)
    const allowed: ReturnType<typeof sql> = meta
      ? sql`${sql(rowColumn)} in (select ${sql(meta.row_key)} from ${sql(await tableRelation(meta.name))} where ${(await mandatoryWhere(meta, user)).frag})`
      : sql`false`
    result = sql`${result} and (${sql(tableColumn)} is distinct from ${String(target.name)} or ${sql(rowColumn)} is null or ${allowed})`
  }
  return { frag: result }
}
