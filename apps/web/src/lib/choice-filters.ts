// #820: a Choice column has at most one filter on the list page, `in` with the
// choices ticked. An older `=` on a Choice column counts as `in` with its one
// value; the first change to it saves `in`.
type Filter = [string, string, unknown]

const isChoiceFilter = (f: Filter, column: string) => f[0] === column && (f[1] === 'in' || f[1] === '=')

/** The choices a column's filters tick, in the order they first appear. */
export function tickedChoices(filters: Filter[], column: string): string[] {
  const out: string[] = []
  for (const f of filters)
    if (isChoiceFilter(f, column))
      for (const v of Array.isArray(f[2]) ? f[2] : [f[2]]) if (!out.includes(String(v))) out.push(String(v))
  return out
}

/** The filters with the column's filters replaced by `one`, in place of the
 *  first of them. */
function replaceChoiceFilters(filters: Filter[], column: string, one: Filter[]): Filter[] {
  const at = filters.findIndex((f) => isChoiceFilter(f, column))
  const rest = filters.filter((f) => !isChoiceFilter(f, column))
  if (at < 0) return [...rest, ...one]
  const before = filters.slice(0, at).filter((f) => !isChoiceFilter(f, column)).length
  return [...rest.slice(0, before), ...one, ...rest.slice(before)]
}

/** The filters with the column's one filter set to these choices; with no
 *  choices, or every choice, it has none. */
export function withTicked(filters: Filter[], column: string, ticked: string[], choices: string[]): Filter[] {
  const all = choices.length > 0 && choices.every((c) => ticked.includes(c))
  return replaceChoiceFilters(filters, column, ticked.length && !all ? [[column, 'in', ticked]] : [])
}

/** The values in the order of the column's choices, any others after them. */
export function inChoiceOrder(values: string[], choices: string[]): string[] {
  return [...choices.filter((c) => values.includes(c)), ...new Set(values.filter((v) => !choices.includes(v)))]
}

/** Two or more filters on one Choice column become one `in` filter holding
 *  every value they name. Other columns' filters are left as they are. */
export function mergeChoiceFilters(filters: Filter[], choiceColumns: string[]): Filter[] {
  let out = filters
  for (const column of choiceColumns)
    if (out.filter((f) => isChoiceFilter(f, column)).length > 1)
      out = replaceChoiceFilters(out, column, [[column, 'in', tickedChoices(out, column)]])
  return out
}
