import type { DatasetColumn, DatasetWhere } from './types'

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

// #625 (design E3): the declared query, wrapped twice. The inner wrap picks
// the declared columns, a `date` column cast to a day in the source itself,
// so a snapshot build and a live read see the same day for a time of day.
// The outer wrap limits the rows to what a read may see, comparing those
// same columns as text. The query text is the app's own, unchanged; the
// platform adds only quoted declared column names and bound values, so
// nothing from a request reaches the source as SQL.
export function datasetQueryText(
  query: string,
  columns: readonly DatasetColumn[],
  where: DatasetWhere | undefined,
  dialect: { placeholder: (n: number) => string; asText: (quoted: string) => string; asDay: (quoted: string) => string },
): { text: string; values: string[] } {
  const values: string[] = []
  const condition = (column: string, list: string[]) => {
    if (!list.length) return 'false'
    const marks = list.map((value) => {
      values.push(value)
      return dialect.placeholder(values.length)
    })
    return `${dialect.asText(quote(column))} in (${marks.join(', ')})`
  }
  let clause = 'true'
  if (where) {
    const group = (conditions: { column: string; values: string[] }[]) =>
      conditions.length ? conditions.map((c) => condition(c.column, c.values)).join(' and ') : 'true'
    const any = where.any.length ? where.any.map((g) => `(${group(g)})`).join(' or ') : 'false'
    clause = `(${any}) and (${group(where.all)})`
  }
  const picked = columns.map(({ name, type }) => (type === 'date' ? `${dialect.asDay(quote(name))} as ${quote(name)}` : quote(name)))
  return { text: `select * from (select ${picked.join(', ')} from (${query}) as source) as dataset where ${clause}`, values }
}
