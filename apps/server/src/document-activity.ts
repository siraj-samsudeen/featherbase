import { sql } from './db'
import { getDoc } from './document'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { AppError } from './errors'

// Internal callers must authorize and lock the source row first. Counts may
// include hidden activity, but never expose its values or another row's ID.
export async function retainedDocumentCounts(tx: typeof sql, table: string, rowId: string) {
  const [counts] = await tx`
    select (select count(*)::int from comment where ref_table = ${table} and ref_name = ${rowId}) as comments,
           (select count(*)::int from version where ref_table = ${table} and ref_name = ${rowId}) as versions,
           (select count(*)::int from file where ref_table = ${table} and ref_name = ${rowId}) as files,
           (select count(*)::int from share where share_table = ${table} and share_name = ${rowId}) as shares`
  let references = 0
  const columns = await tx`select parent, column_name from column_def where column_type = 'Reference' and reference_table = ${table}`
  for (const column of columns) {
    const meta = await getMeta(String(column.parent))
    if (meta.data_source || meta.kind === 'settings') throw new AppError('ValidationError', 'Deletion cannot prove references from nonlocal Tables')
    const [count] = await tx`select count(*)::int as n from ${tx(await tableRelation(meta.name))} where ${tx(String(column.column_name))} = ${rowId}`
    references += Number(count.n)
  }
  return { comments: Number(counts.comments), versions: Number(counts.versions), references,
    files: Number(counts.files), shares: Number(counts.shares) }
}

export async function documentActivity(table: string, name: string, user: string) {
  const visibleDoc = await getDoc(table, name, user)
  const visibleFields = new Set(Object.keys(visibleDoc))
  const [comments, versions] = await Promise.all([
    sql`select content, created_by, created_at from comment
        where ref_table = ${table} and ref_name = ${name} order by created_at asc`,
    sql`select data, created_by, created_at from version
        where ref_table = ${table} and ref_name = ${name} order by created_at asc`,
  ])
  const visibleVersions = versions.map((version) => {
    const data = version.data as { changed?: [string, unknown, unknown][] } | null
    return {
      ...version,
      data: {
        ...data,
        changed: (data?.changed ?? []).filter(([field]) => visibleFields.has(field)),
      },
    }
  })
  return { comments, versions: visibleVersions }
}
