// #1348: two kinds of column the calmer look draws its own way, read from the column's name.

/** Where a row came from (source, source_system): drawn as the shared tag, never a category tint. */
export const isSourceColumn = (name: string) => /(^|_)source(_|$)/.test(name)

/** A code that tells same-named rows apart (code, site_code), drawn small, mono and grey. A postal code is an
 *  address, not one of these. */
export const isCodeColumn = (name: string) => /(^|_)code$/.test(name) && !/(postal|zip|pin)_code$/.test(name)

/** A run time held in milliseconds (last_duration_ms): read as time ("1 min 5 s"), never summed. */
export const isDurationColumn = (col: { column_name: string; column_type: string }) =>
  ['Int', 'Float'].includes(col.column_type) && /_ms$/.test(col.column_name)

/** The one column a list totals under its rows (Σ): its first money column, else its first decimal one, else
 *  its first whole-number one. A run time is never added up. */
export function summableColumn<C extends { column_name: string; column_type: string }>(columns: C[]): C | undefined {
  const candidates = columns.filter((c) => !isDurationColumn(c))
  return ['Currency', 'Float', 'Int'].map((t) => candidates.find((c) => c.column_type === t)).find(Boolean)
}
