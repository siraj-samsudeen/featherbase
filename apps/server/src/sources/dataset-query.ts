import type { DatasetWhere } from './types'

// #625 (design E3): the declared query, wrapped as a sub-query and limited to
// what a read may see. The query text is the app's own, unchanged; the
// platform adds only quoted declared column names and bound values, so
// nothing from a request reaches the source as SQL.
export function datasetQueryText(
  query: string,
  where: DatasetWhere | undefined,
  dialect: { placeholder: (n: number) => string; asText: (quoted: string) => string },
): { text: string; values: string[] } {
  const values: string[] = []
  const condition = (column: string, list: string[]) => {
    if (!list.length) return 'false'
    const marks = list.map((value) => {
      values.push(value)
      return dialect.placeholder(values.length)
    })
    return `${dialect.asText(`"${column.replace(/"/g, '""')}"`)} in (${marks.join(', ')})`
  }
  let clause = 'true'
  if (where) {
    const group = (conditions: { column: string; values: string[] }[]) =>
      conditions.length ? conditions.map((c) => condition(c.column, c.values)).join(' and ') : 'true'
    const any = where.any.length ? where.any.map((g) => `(${group(g)})`).join(' or ') : 'false'
    clause = `(${any}) and (${group(where.all)})`
  }
  return { text: `select * from (${query}) as dataset where ${clause}`, values }
}
