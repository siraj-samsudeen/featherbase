// #742: one reading of a Yes/No filter value, for normal and connected Tables.
const WORDS = new Map([
  ['true', true],
  ['yes', true],
  ['false', false],
  ['no', false],
])

/** Whether this filter compares a Yes/No column by its value. */
export function isYesNoFilter(
  columns: readonly { column_name: string; column_type: string }[],
  field: string,
  op: string,
): boolean {
  return (
    (op === '=' || op === '!=') &&
    columns.some((c) => c.column_name === field && c.column_type === 'Check')
  )
}

/** The value to compare with. Empty stays empty; undefined means a value that
 *  is neither yes nor no, which finds no rows, as an unknown choice does. */
export function readYesNo(value: unknown): boolean | null | undefined {
  if (value === null || typeof value === 'boolean') return value
  return typeof value === 'string' ? WORDS.get(value.toLowerCase()) : undefined
}
