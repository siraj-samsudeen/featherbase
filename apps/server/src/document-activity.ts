import { sql } from './db'
import { getDoc } from './document'

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
